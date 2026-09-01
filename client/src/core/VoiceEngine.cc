#include "VoiceEngine.h"
#include <QSettings>
#include <cmath>
#include <algorithm>

// ── Общее ─────────────────────────────────────────────────────────────────────
VoiceEngine::VoiceEngine(QObject* parent) : QObject(parent) { loadSettings(); }
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
    m_outVol = v; saveSettings(); emit outVolumeChanged();
#ifdef _WIN32
    applyOutVolume();
#endif
}

void VoiceEngine::toggleMute() {
    m_muted = !m_muted.load();
    emit mutedChanged();
}

void VoiceEngine::start() {
    if (m_active) return;
    openAudio();
    m_active = true;
}

void VoiceEngine::stop() {
    if (!m_active) return;
    closeAudio();
    m_active = false;
    if (m_speaking)       { m_speaking = false; emit speakingChanged(false); }
    if (m_muted.load())   { m_muted = false;    emit mutedChanged(); }
}

void VoiceEngine::restartAudio() {
    if (!m_active) return;
    closeAudio();
    openAudio();
}

// RMS-детектор речи (общий для платформ)
void VoiceEngine::detectSpeaking(const int16_t* s, int n) {
    using namespace std::chrono;
    const double kThreshold = 380.0;
    const auto   kHold      = milliseconds(300);
    double sumsq = 0.0;
    for (int k = 0; k < n; ++k) sumsq += double(s[k]) * double(s[k]);
    double rms = n > 0 ? std::sqrt(sumsq / n) : 0.0;
    auto now = steady_clock::now();
    if (rms > kThreshold) m_lastLoud = now;
    bool sp = (now - m_lastLoud) < kHold;
    if (sp != m_speaking) { m_speaking = sp; emit speakingChanged(sp); }
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

void VoiceEngine::applyOutVolume() {
    if (!m_hOut) return;
    DWORD vol = (DWORD)(m_outVol.load() * 0xFFFF / 100);
    waveOutSetVolume(m_hOut, (vol & 0xFFFF) | (vol << 16));
}

void VoiceEngine::openAudio() {
    WAVEFORMATEX fmt = makeFormat();
    if (waveOutOpen(&m_hOut, m_outDev, &fmt, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) m_hOut = nullptr;
    m_outHdr.assign(kOutBuffers, WAVEHDR{}); m_outBuf.assign(kOutBuffers, std::vector<char>());
    m_outIdx = 0; applyOutVolume();

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
    if (m_inEvent) SetEvent(m_inEvent);
    if (m_thread.joinable()) m_thread.join();
    if (m_hIn) {
        waveInStop(m_hIn); waveInReset(m_hIn);
        for (auto& h : m_inHdr) if (h.dwFlags & WHDR_PREPARED) waveInUnprepareHeader(m_hIn, &h, sizeof(WAVEHDR));
        waveInClose(m_hIn); m_hIn = nullptr;
    }
    if (m_inEvent) { CloseHandle(m_inEvent); m_inEvent = nullptr; }
    if (m_hOut) {
        waveOutReset(m_hOut);
        for (auto& h : m_outHdr) if (h.dwFlags & WHDR_PREPARED) waveOutUnprepareHeader(m_hOut, &h, sizeof(WAVEHDR));
        waveOutClose(m_hOut); m_hOut = nullptr;
    }
    m_inHdr.clear(); m_inBuf.clear(); m_outHdr.clear(); m_outBuf.clear();
}

void VoiceEngine::captureLoop() {
    while (m_running) {
        WaitForSingleObject(m_inEvent, 100);
        if (!m_running) break;
        for (int i = 0; i < kInBuffers; ++i) {
            WAVEHDR& h = m_inHdr[i];
            if (!(h.dwFlags & WHDR_DONE)) continue;
            int bytes = (int)h.dwBytesRecorded;
            if (!m_muted.load() && bytes > 0) {
                int16_t* s = reinterpret_cast<int16_t*>(h.lpData);
                int n = bytes / 2, vol = m_micVol.load();
                if (vol != 100) for (int k = 0; k < n; ++k) {
                    int v = (int)s[k] * vol / 100; s[k] = (int16_t)std::clamp(v, -32768, 32767); }
                emit frameCaptured(QByteArray(h.lpData, bytes));
                detectSpeaking(s, n);
            } else if (m_speaking) { m_speaking = false; emit speakingChanged(false); }
            h.dwFlags &= ~WHDR_DONE;
            waveInAddBuffer(m_hIn, &h, sizeof(WAVEHDR));
        }
    }
}

void VoiceEngine::playFrame(const QByteArray& pcm) {
    if (!m_active || !m_hOut || pcm.isEmpty()) return;
    int idx = m_outIdx; WAVEHDR& h = m_outHdr[idx];
    if (h.dwFlags & WHDR_INQUEUE) return;
    if (h.dwFlags & WHDR_PREPARED) waveOutUnprepareHeader(m_hOut, &h, sizeof(WAVEHDR));
    std::vector<char>& buf = m_outBuf[idx];
    buf.assign(pcm.constData(), pcm.constData() + pcm.size());
    ZeroMemory(&h, sizeof(WAVEHDR));
    h.lpData = buf.data(); h.dwBufferLength = (DWORD)buf.size();
    waveOutPrepareHeader(m_hOut, &h, sizeof(WAVEHDR));
    waveOutWrite(m_hOut, &h, sizeof(WAVEHDR));
    m_outIdx = (idx + 1) % kOutBuffers;
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
    if (snd_pcm_open(&m_playback, "default", SND_PCM_STREAM_PLAYBACK, 0) < 0) m_playback = nullptr;
    if (m_playback && snd_pcm_set_params(m_playback, SND_PCM_FORMAT_S16_LE,
            SND_PCM_ACCESS_RW_INTERLEAVED, 1, 16000, 1, 100000) < 0) {
        snd_pcm_close(m_playback); m_playback = nullptr;
    }
    if (m_capture) {
        m_running = true;
        m_thread = std::thread(&VoiceEngine::captureLoop, this);
    }
}

void VoiceEngine::closeAudio() {
    m_running = false;
    if (m_thread.joinable()) m_thread.join();   // ждём выхода из readi
    if (m_capture)  { snd_pcm_close(m_capture);  m_capture = nullptr; }
    if (m_playback) { snd_pcm_drain(m_playback); snd_pcm_close(m_playback); m_playback = nullptr; }
}

void VoiceEngine::captureLoop() {
    std::vector<int16_t> buf(kFrameSamples);
    while (m_running) {
        snd_pcm_sframes_t r = snd_pcm_readi(m_capture, buf.data(), kFrameSamples);
        if (r == -EPIPE) { snd_pcm_prepare(m_capture); continue; }
        if (r < 0)       { snd_pcm_recover(m_capture, (int)r, 1); continue; }
        int n = (int)r;
        if (m_muted.load()) { if (m_speaking) { m_speaking = false; emit speakingChanged(false); } continue; }
        int vol = m_micVol.load();
        if (vol != 100) for (int k = 0; k < n; ++k) {
            int v = (int)buf[k] * vol / 100; buf[k] = (int16_t)std::clamp(v, -32768, 32767); }
        emit frameCaptured(QByteArray(reinterpret_cast<const char*>(buf.data()), n * 2));
        detectSpeaking(buf.data(), n);
    }
}

void VoiceEngine::playFrame(const QByteArray& pcm) {
    if (!m_active || !m_playback || pcm.isEmpty()) return;
    int n = pcm.size() / 2;
    const int16_t* src = reinterpret_cast<const int16_t*>(pcm.constData());
    std::vector<int16_t> tmp;
    int vol = m_outVol.load();
    if (vol != 100) {
        tmp.resize(n);
        for (int k = 0; k < n; ++k) {
            int v = (int)src[k] * vol / 100; tmp[k] = (int16_t)std::clamp(v, -32768, 32767); }
        src = tmp.data();
    }
    snd_pcm_sframes_t w = snd_pcm_writei(m_playback, src, n);
    if (w == -EPIPE)      { snd_pcm_prepare(m_playback); snd_pcm_writei(m_playback, src, n); }
    else if (w < 0)       { snd_pcm_recover(m_playback, (int)w, 1); }
}
#endif
