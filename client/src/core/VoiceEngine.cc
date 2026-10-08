#include "VoiceEngine.h"
#include <QSettings>
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <limits>

using std::chrono::steady_clock;
using std::chrono::milliseconds;

// Детектор речи — как у браузера (docs/CALLS.md §2.3): RMS > 380 на кадре, удержание 300 мс
static constexpr double kSpeakThreshold = 380.0;
static constexpr auto   kSpeakHold      = milliseconds(300);
// Кадры в канал уходят, пока говорим, и ещё 300 мс после — конец фразы не обрывается
static constexpr auto   kTxHangover     = milliseconds(300);

// Джиттер-буфер источника (16 кГц): копим 60 мс перед стартом, больше 250 мс — отстали,
// срезаем старое до 80 мс. Обрывок короче предбуфера доигрываем через 100 мс тишины.
static constexpr size_t kPrebuffer    = 960;
static constexpr size_t kMaxBuffered  = 4000;
static constexpr size_t kTrimTo       = 1280;
static constexpr auto   kFlushAfter   = milliseconds(100);
static constexpr auto   kSourceIdle   = std::chrono::seconds(10);   // молчащий источник забываем

// Звук звонка — отдельный источник микшера (id говорящих в канале — положительные)
static constexpr int64_t kCallSource = std::numeric_limits<int64_t>::min();
// Кадры без id отправителя (сервер без протокола v2) — все в одном буфере, как раньше
static constexpr int64_t kLegacySource = 0;

// Сведение: до 3/4 шкалы как есть, выше — плавное насыщение вместо жёсткого среза
static int16_t softClip(int32_t v) {
    constexpr int32_t kKnee = 24576;
    constexpr float   kRoom = 32767.0f - kKnee;
    const int32_t a = std::abs(v);
    if (a <= kKnee) return static_cast<int16_t>(v);
    const float y = kKnee + kRoom * std::tanh((a - kKnee) / kRoom);
    return static_cast<int16_t>(v < 0 ? -y : y);
}

// ── Общее ─────────────────────────────────────────────────────────────────────
VoiceEngine::VoiceEngine(QObject* parent) : QObject(parent), m_acc(kFrameSamples) { loadSettings(); }
VoiceEngine::~VoiceEngine() { stop(); }

void VoiceEngine::loadSettings() {
    QSettings s("Vicinity", "Vicinity");
    m_micVol = s.value("voice/micVol", 100).toInt();
    m_outVol = s.value("voice/outVol", 100).toInt();
#ifdef _WIN32
    m_inDev  = (UINT)s.value("voice/inDev",  (qulonglong)WAVE_MAPPER).toULongLong();
    m_outDev = (UINT)s.value("voice/outDev", (qulonglong)WAVE_MAPPER).toULongLong();
#endif
}

void VoiceEngine::saveSettings() {
    QSettings s("Vicinity", "Vicinity");
    s.setValue("voice/micVol", m_micVol.load());
    s.setValue("voice/outVol", m_outVol.load());
#ifdef _WIN32
    s.setValue("voice/inDev",  (qulonglong)m_inDev);
    s.setValue("voice/outDev", (qulonglong)m_outDev);
#endif
}

void VoiceEngine::setMicVolume(int v) {
    v = std::clamp(v, 0, 200);
    if (v == m_micVol.load()) return;
    m_micVol = v; saveSettings(); emit micVolumeChanged();
}

void VoiceEngine::setOutVolume(int v) {
    v = std::clamp(v, 0, 100);
    if (v == m_outVol.load()) return;
    m_outVol = v; saveSettings(); emit outVolumeChanged();   // применяется в микшере
}

void VoiceEngine::toggleMute() {
    m_muted = !m_muted.load();
    emit mutedChanged();
}

void VoiceEngine::setChannelActive(bool on) {
    m_inChannel = on;
    if (!on) dropSources(true);   // голоса канала не доигрываем в звонок
    updateActive();
}

void VoiceEngine::setCallActive(bool on) {
    m_inCall = on;
    if (!on) dropSources(false);
    updateActive();
}

void VoiceEngine::updateActive() {
    if (m_inChannel.load() || m_inCall.load()) start();
    else                                       stop();
}

void VoiceEngine::start() {
    if (m_active) return;
    m_active = true;
    openAudio();
}

void VoiceEngine::stop() {
    if (!m_active) return;
    m_active = false;
    closeAudio();
    {
        std::lock_guard<std::mutex> lk(m_mixMx);
        m_sources.clear();
    }
    m_txOpen = false;
    m_prevFrame.clear();
    if (m_speaking)       { m_speaking = false; emit speakingChanged(false); }
    if (m_muted.load())   { m_muted = false;    emit mutedChanged(); }
}

void VoiceEngine::restartAudio() {
    if (!m_active) return;
    closeAudio();
    openAudio();
}

// RMS-детектор речи (общий для платформ)
void VoiceEngine::detectSpeaking(const int16_t* s, int n, steady_clock::time_point now) {
    double sumsq = 0.0;
    for (int k = 0; k < n; ++k) sumsq += double(s[k]) * double(s[k]);
    const double rms = n > 0 ? std::sqrt(sumsq / n) : 0.0;
    if (rms > kSpeakThreshold) m_lastLoud = now;
    const bool sp = (now - m_lastLoud) < kSpeakHold;
    if (sp != m_speaking) { m_speaking = sp; emit speakingChanged(sp); }
}

// Кадр микрофона (поток захвата): громкость → звонок; в канал — только речь
void VoiceEngine::processCaptured(int16_t* s, int n) {
    if (m_muted.load() || n <= 0) {
        if (m_speaking) { m_speaking = false; emit speakingChanged(false); }
        m_txOpen = false;
        m_prevFrame.clear();
        return;
    }
    const int vol = m_micVol.load();
    if (vol != 100) for (int k = 0; k < n; ++k) {
        const int v = int(s[k]) * vol / 100;
        s[k] = static_cast<int16_t>(std::clamp(v, -32768, 32767));
    }
    const QByteArray frame(reinterpret_cast<const char*>(s), n * 2);
    emit frameCaptured(frame);

    const auto now = steady_clock::now();
    detectSpeaking(s, n, now);
    if (m_inChannel.load()) {
        // Тишину в канал не шлём (у старых десктопов кадры не сводятся — каждый лишний
        // слышен); первый кадр речи уходит вместе с предыдущим, чтобы не съесть начало слова
        const bool open = (now - m_lastLoud) < kSpeakHold + kTxHangover;
        if (open) {
            if (!m_txOpen && !m_prevFrame.isEmpty()) emit channelFrame(m_prevFrame);
            emit channelFrame(frame);
        }
        m_txOpen = open;
    }
    m_prevFrame = frame;
}

// ── Микшер ────────────────────────────────────────────────────────────────────
void VoiceEngine::playChannelPacket(const QByteArray& packet) {
    // Протокол v2 (voice_join с "proto":2): 8 байт id отправителя (int64 LE), затем PCM.
    // Все клиенты шлют ровные кадры по 640 байт, так что v2-кадр — 648 байт, а ровно 640 —
    // голый PCM от сервера, который v2 ещё не знает
    if (!m_inChannel.load()) return;
    int64_t id = kLegacySource;
    int offset = 0;
    if (packet.size() != kFrameBytes) {
        if (packet.size() < 8 + 2) return;
        const auto* p = reinterpret_cast<const unsigned char*>(packet.constData());
        uint64_t raw = 0;
        for (int i = 0; i < 8; ++i) raw |= uint64_t(p[i]) << (8 * i);
        id = static_cast<int64_t>(raw);
        offset = 8;
    }
    const int n = (packet.size() - offset) / 2;
    std::vector<int16_t> pcm(static_cast<size_t>(n));
    std::memcpy(pcm.data(), packet.constData() + offset, static_cast<size_t>(n) * 2);
    pushSource(id, pcm.data(), n);
}

void VoiceEngine::playCallFrame(const QByteArray& pcm) {
    if (!m_inCall.load() || pcm.size() < 2) return;
    const int n = pcm.size() / 2;
    std::vector<int16_t> s(static_cast<size_t>(n));
    std::memcpy(s.data(), pcm.constData(), static_cast<size_t>(n) * 2);
    pushSource(kCallSource, s.data(), n);
}

void VoiceEngine::pushSource(int64_t id, const int16_t* s, int n) {
    if (!m_active.load() || n <= 0) return;
    std::lock_guard<std::mutex> lk(m_mixMx);
    Source& src = m_sources[id];
    src.pcm.insert(src.pcm.end(), s, s + n);
    if (src.pcm.size() > kMaxBuffered)   // отстали (пачка после задержки сети) — старое выкидываем
        src.pcm.erase(src.pcm.begin(), src.pcm.begin() + static_cast<std::ptrdiff_t>(src.pcm.size() - kTrimTo));
    src.last = steady_clock::now();
}

void VoiceEngine::dropSources(bool channel) {
    std::lock_guard<std::mutex> lk(m_mixMx);
    for (auto it = m_sources.begin(); it != m_sources.end();) {
        if ((it->first == kCallSource) != channel) it = m_sources.erase(it);
        else ++it;
    }
}

void VoiceEngine::mixInto(int16_t* out, int n) {
    std::fill(m_acc.begin(), m_acc.begin() + n, 0);
    {
        std::lock_guard<std::mutex> lk(m_mixMx);
        const auto now = steady_clock::now();
        for (auto it = m_sources.begin(); it != m_sources.end();) {
            Source& src = it->second;
            if (!src.primed && (src.pcm.size() >= kPrebuffer ||
                                (!src.pcm.empty() && now - src.last > kFlushAfter)))
                src.primed = true;
            if (src.primed) {
                const int take = std::min(n, static_cast<int>(src.pcm.size()));
                for (int i = 0; i < take; ++i) m_acc[i] += src.pcm[i];
                src.pcm.erase(src.pcm.begin(), src.pcm.begin() + take);
                if (take < n) src.primed = false;   // опустел — снова копим предбуфер
            }
            if (src.pcm.empty() && now - src.last > kSourceIdle) it = m_sources.erase(it);
            else ++it;
        }
    }
    const int vol = m_outVol.load();
    for (int i = 0; i < n; ++i) out[i] = softClip(m_acc[i] * vol / 100);
}

// ══════════════════════════════════════════════════════════════════════════════
#ifdef _WIN32
// ── Windows: winmm ────────────────────────────────────────────────────────────
static WAVEFORMATEX makeFormat() {
    WAVEFORMATEX f;
    f.wFormatTag = WAVE_FORMAT_PCM; f.nChannels = 1; f.nSamplesPerSec = 16000;
    f.wBitsPerSample = 16; f.nBlockAlign = 2; f.nAvgBytesPerSec = 32000; f.cbSize = 0;
    return f;
}

QStringList VoiceEngine::inputDevices() const {
    QStringList list; list << "По умолчанию";
    UINT n = waveInGetNumDevs();
    for (UINT i = 0; i < n; ++i) { WAVEINCAPS c;
        if (waveInGetDevCaps(i, &c, sizeof(c)) == MMSYSERR_NOERROR)
            list << QString::fromWCharArray(c.szPname); }
    return list;
}
QStringList VoiceEngine::outputDevices() const {
    QStringList list; list << "По умолчанию";
    UINT n = waveOutGetNumDevs();
    for (UINT i = 0; i < n; ++i) { WAVEOUTCAPS c;
        if (waveOutGetDevCaps(i, &c, sizeof(c)) == MMSYSERR_NOERROR)
            list << QString::fromWCharArray(c.szPname); }
    return list;
}
int VoiceEngine::inputDeviceIndex()  const { return m_inDev  == WAVE_MAPPER ? 0 : int(m_inDev)  + 1; }
int VoiceEngine::outputDeviceIndex() const { return m_outDev == WAVE_MAPPER ? 0 : int(m_outDev) + 1; }

void VoiceEngine::setInputDevice(int uiIndex) {
    UINT dev = uiIndex <= 0 ? WAVE_MAPPER : (UINT)(uiIndex - 1);
    if (dev == m_inDev) return;
    m_inDev = dev; saveSettings(); emit devicesChanged(); restartAudio();
}
void VoiceEngine::setOutputDevice(int uiIndex) {
    UINT dev = uiIndex <= 0 ? WAVE_MAPPER : (UINT)(uiIndex - 1);
    if (dev == m_outDev) return;
    m_outDev = dev; saveSettings(); emit devicesChanged(); restartAudio();
}

void VoiceEngine::openAudio() {
    WAVEFORMATEX fmt = makeFormat();
    m_outEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (waveOutOpen(&m_hOut, m_outDev, &fmt, (DWORD_PTR)m_outEvent, 0, CALLBACK_EVENT) != MMSYSERR_NOERROR)
        m_hOut = nullptr;
    if (m_hOut) {
        m_outHdr.assign(kOutBuffers, WAVEHDR{}); m_outBuf.assign(kOutBuffers, std::vector<char>(kFrameBytes));
        for (int i = 0; i < kOutBuffers; ++i) {
            ZeroMemory(&m_outHdr[i], sizeof(WAVEHDR));
            m_outHdr[i].lpData = m_outBuf[i].data(); m_outHdr[i].dwBufferLength = kFrameBytes;
            waveOutPrepareHeader(m_hOut, &m_outHdr[i], sizeof(WAVEHDR));
        }
        m_playRunning = true;
        m_playThread = std::thread(&VoiceEngine::playbackLoop, this);
    }

    m_inEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (waveInOpen(&m_hIn, m_inDev, &fmt, (DWORD_PTR)m_inEvent, 0, CALLBACK_EVENT) != MMSYSERR_NOERROR)
        m_hIn = nullptr;
    if (m_hIn) {
        m_inHdr.assign(kInBuffers, WAVEHDR{}); m_inBuf.assign(kInBuffers, std::vector<char>(kFrameBytes));
        for (int i = 0; i < kInBuffers; ++i) {
            ZeroMemory(&m_inHdr[i], sizeof(WAVEHDR));
            m_inHdr[i].lpData = m_inBuf[i].data(); m_inHdr[i].dwBufferLength = kFrameBytes;
            waveInPrepareHeader(m_hIn, &m_inHdr[i], sizeof(WAVEHDR));
            waveInAddBuffer(m_hIn, &m_inHdr[i], sizeof(WAVEHDR));
        }
        m_running = true; waveInStart(m_hIn);
        m_thread = std::thread(&VoiceEngine::captureLoop, this);
    }
}

void VoiceEngine::closeAudio() {
    m_running = false;
    m_playRunning = false;
    if (m_inEvent)  SetEvent(m_inEvent);
    if (m_outEvent) SetEvent(m_outEvent);
    if (m_thread.joinable()) m_thread.join();
    if (m_playThread.joinable()) m_playThread.join();
    if (m_hIn) {
        waveInStop(m_hIn); waveInReset(m_hIn);
        for (auto& h : m_inHdr) if (h.dwFlags & WHDR_PREPARED) waveInUnprepareHeader(m_hIn, &h, sizeof(WAVEHDR));
        waveInClose(m_hIn); m_hIn = nullptr;
    }
    if (m_inEvent) { CloseHandle(m_inEvent); m_inEvent = nullptr; }
    if (m_hOut) {
        waveOutReset(m_hOut);   // возвращает все буферы из очереди
        for (auto& h : m_outHdr) if (h.dwFlags & WHDR_PREPARED) waveOutUnprepareHeader(m_hOut, &h, sizeof(WAVEHDR));
        waveOutClose(m_hOut); m_hOut = nullptr;
    }
    if (m_outEvent) { CloseHandle(m_outEvent); m_outEvent = nullptr; }
    m_inHdr.clear(); m_inBuf.clear(); m_outHdr.clear(); m_outBuf.clear();
}

void VoiceEngine::captureLoop() {
    while (m_running) {
        WaitForSingleObject(m_inEvent, 100);
        if (!m_running) break;
        for (int i = 0; i < kInBuffers; ++i) {
            WAVEHDR& h = m_inHdr[i];
            if (!(h.dwFlags & WHDR_DONE)) continue;
            processCaptured(reinterpret_cast<int16_t*>(h.lpData), (int)h.dwBytesRecorded / 2);
            h.dwFlags &= ~WHDR_DONE;
            waveInAddBuffer(m_hIn, &h, sizeof(WAVEHDR));
        }
    }
}

// Поток воспроизведения: держим в устройстве kOutBuffers кадров; вернувшийся (WHDR_DONE)
// буфер заполняем следующими 20 мс микса (или тишиной) и ставим обратно
void VoiceEngine::playbackLoop() {
    for (auto& h : m_outHdr) {
        mixInto(reinterpret_cast<int16_t*>(h.lpData), kFrameSamples);
        waveOutWrite(m_hOut, &h, sizeof(WAVEHDR));
    }
    while (m_playRunning) {
        WaitForSingleObject(m_outEvent, 100);
        if (!m_playRunning) break;
        for (auto& h : m_outHdr) {
            if (!(h.dwFlags & WHDR_DONE)) continue;
            h.dwFlags &= ~WHDR_DONE;
            mixInto(reinterpret_cast<int16_t*>(h.lpData), kFrameSamples);
            waveOutWrite(m_hOut, &h, sizeof(WAVEHDR));
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
#else
// ── Linux: ALSA (работает поверх PipeWire через alsa-compat) ───────────────────
QStringList VoiceEngine::inputDevices()  const { return QStringList() << "По умолчанию"; }
QStringList VoiceEngine::outputDevices() const { return QStringList() << "По умолчанию"; }
int  VoiceEngine::inputDeviceIndex()  const { return 0; }
int  VoiceEngine::outputDeviceIndex() const { return 0; }
void VoiceEngine::setInputDevice(int)  {}   // в v1 только устройство по умолчанию
void VoiceEngine::setOutputDevice(int) {}

void VoiceEngine::openAudio() {
    if (snd_pcm_open(&m_capture, "default", SND_PCM_STREAM_CAPTURE, 0) < 0) m_capture = nullptr;
    if (m_capture && snd_pcm_set_params(m_capture, SND_PCM_FORMAT_S16_LE,
            SND_PCM_ACCESS_RW_INTERLEAVED, 1, 16000, 1, 100000) < 0) {
        snd_pcm_close(m_capture); m_capture = nullptr;
    }
    // Воспроизведение: ~60 мс в ALSA, остальное сглаживают джиттер-буферы микшера
    if (snd_pcm_open(&m_playback, "default", SND_PCM_STREAM_PLAYBACK, 0) < 0) m_playback = nullptr;
    if (m_playback && snd_pcm_set_params(m_playback, SND_PCM_FORMAT_S16_LE,
            SND_PCM_ACCESS_RW_INTERLEAVED, 1, 16000, 1, 60000) < 0) {
        snd_pcm_close(m_playback); m_playback = nullptr;
    }
    if (m_playback) {
        m_playRunning = true;
        m_playThread = std::thread(&VoiceEngine::playbackLoop, this);
    }
    if (m_capture) {
        m_running = true;
        m_thread = std::thread(&VoiceEngine::captureLoop, this);
    }
}

void VoiceEngine::closeAudio() {
    m_running = false;
    m_playRunning = false;
    if (m_thread.joinable()) m_thread.join();           // ждём выхода из readi (≤ 20 мс)
    if (m_playThread.joinable()) m_playThread.join();   // и из writei (≤ буфера ALSA)
    if (m_capture)  { snd_pcm_close(m_capture);  m_capture = nullptr; }
    if (m_playback) { snd_pcm_drop(m_playback); snd_pcm_close(m_playback); m_playback = nullptr; }
}

void VoiceEngine::captureLoop() {
    std::vector<int16_t> buf(kFrameSamples);
    int filled = 0;   // readi может вернуть меньше кадра — добираем до ровных 20 мс
    while (m_running) {
        snd_pcm_sframes_t r = snd_pcm_readi(m_capture, buf.data() + filled, kFrameSamples - filled);
        if (r == -EPIPE) { snd_pcm_prepare(m_capture); continue; }
        if (r < 0)       { snd_pcm_recover(m_capture, (int)r, 1); continue; }
        filled += (int)r;
        if (filled < kFrameSamples) continue;
        filled = 0;
        processCaptured(buf.data(), kFrameSamples);
    }
}

// Поток воспроизведения: writei блокируется, пока в буфере ALSA нет места, — он и задаёт такт
void VoiceEngine::playbackLoop() {
    std::vector<int16_t> frame(kFrameSamples);
    while (m_playRunning) {
        mixInto(frame.data(), kFrameSamples);
        const snd_pcm_sframes_t w = snd_pcm_writei(m_playback, frame.data(), kFrameSamples);
        if (w < 0 && snd_pcm_recover(m_playback, (int)w, 1) < 0)
            std::this_thread::sleep_for(milliseconds(20));   // устройство пропало — не крутим вхолостую
    }
}
#endif
