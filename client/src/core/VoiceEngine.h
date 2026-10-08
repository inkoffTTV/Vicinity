#pragma once
#include <QObject>
#include <QByteArray>
#include <QStringList>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

#ifdef _WIN32
  #ifndef NOMINMAX
  #define NOMINMAX
  #endif
  #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
  #endif
  #include <windows.h>
  #include <mmsystem.h>
#else
  #include <alsa/asoundlib.h>
#endif

// Захват микрофона + воспроизведение.
// Windows: Win32 winmm (waveIn/waveOut). Linux: ALSA (через PipeWire-совместимость).
// Аудио PCM 16kHz mono 16-bit. Устройства открыты, пока они нужны голосовому каналу
// или звонку. frameCaptured → звонок; channelFrame → WebSocket (только в канале и только
// пока говорим). Воспроизведение: у каждого говорящего (и у звонка) свой джиттер-буфер,
// поток воспроизведения сводит их в один выход — GUI-поток устройство не ждёт.
class VoiceEngine : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool muted     READ muted     NOTIFY mutedChanged)
    Q_PROPERTY(int  micVolume READ micVolume WRITE setMicVolume NOTIFY micVolumeChanged)
    Q_PROPERTY(int  outVolume READ outVolume WRITE setOutVolume NOTIFY outVolumeChanged)
    Q_PROPERTY(int  inputDeviceIndex  READ inputDeviceIndex  NOTIFY devicesChanged)
    Q_PROPERTY(int  outputDeviceIndex READ outputDeviceIndex NOTIFY devicesChanged)
public:
    explicit VoiceEngine(QObject* parent = nullptr);
    ~VoiceEngine();

    // Голосовой канал (QML): микрофон/динамики + отправка кадров в WebSocket
    Q_INVOKABLE void setChannelActive(bool on);
    Q_INVOKABLE void toggleMute();
    bool muted() const { return m_muted.load(); }

    Q_INVOKABLE QStringList inputDevices()  const;
    Q_INVOKABLE QStringList outputDevices() const;
    Q_INVOKABLE void setInputDevice(int uiIndex);
    Q_INVOKABLE void setOutputDevice(int uiIndex);
    int inputDeviceIndex()  const;
    int outputDeviceIndex() const;

    int  micVolume() const { return m_micVol.load(); }
    void setMicVolume(int v);
    int  outVolume() const { return m_outVol.load(); }
    void setOutVolume(int v);

public slots:
    // Кадр голосового канала, протокол v2: [int64 LE id отправителя][PCM s16le 16 кГц моно];
    // ровно 640 байт без префикса — от сервера без v2
    void playChannelPacket(const QByteArray& packet);
    // Звук собеседника в звонке (PCM). Потокобезопасно: зовётся из потока сети.
    void playCallFrame(const QByteArray& pcm);
    void setCallActive(bool on);   // звонку нужны устройства (CallEngine::audioActiveChanged)

signals:
    void frameCaptured(const QByteArray& pcm);   // каждый кадр микрофона (поток захвата)
    void channelFrame(const QByteArray& pcm);    // в голосовой канал: пока в нём и говорим (+ хвост)
    void speakingChanged(bool speaking);
    void mutedChanged();
    void micVolumeChanged();
    void outVolumeChanged();
    void devicesChanged();

private:
    // Джиттер-буфер одного источника (говорящий в канале или собеседник в звонке)
    struct Source {
        std::deque<int16_t> pcm;
        bool primed = false;                          // накопили предбуфер — играем
        std::chrono::steady_clock::time_point last;   // когда пришли последние данные
    };

    void start();
    void stop();
    void updateActive();   // устройства открыты, пока нужны каналу или звонку
    void openAudio();
    void closeAudio();
    void restartAudio();
    void captureLoop();
    void playbackLoop();
    void processCaptured(int16_t* samples, int n);    // поток захвата: громкость, VAD, сигналы
    void pushSource(int64_t id, const int16_t* samples, int n);
    void dropSources(bool channel);                   // забыть буферы канала (true) или звонка
    void mixInto(int16_t* out, int n);                // поток воспроизведения
    void loadSettings();
    void saveSettings();
    void detectSpeaking(const int16_t* samples, int n, std::chrono::steady_clock::time_point now);

    std::atomic<bool> m_active{false};
    std::atomic<bool> m_running{false};       // поток захвата
    std::atomic<bool> m_playRunning{false};   // поток воспроизведения
    std::atomic<bool> m_inChannel{false};
    std::atomic<bool> m_inCall{false};
    std::atomic<bool> m_muted{false};
    std::atomic<int>  m_micVol{100};
    std::atomic<int>  m_outVol{100};

    // Только поток захвата
    bool m_speaking = false;
    bool m_txOpen   = false;                  // кадры канала сейчас уходят
    QByteArray m_prevFrame;                   // предыдущий кадр — начало слова при открытии
    std::chrono::steady_clock::time_point m_lastLoud;
    std::thread m_thread;

    // Микшер: источники под m_mixMx; аккумулятор — только поток воспроизведения
    std::mutex m_mixMx;
    std::map<int64_t, Source> m_sources;
    std::vector<int32_t> m_acc;
    std::thread m_playThread;

    static const int kFrameSamples = 320;     // 20ms @ 16kHz mono
    static const int kFrameBytes   = 640;     // 320 * 2

#ifdef _WIN32
    UINT m_inDev  = WAVE_MAPPER;
    UINT m_outDev = WAVE_MAPPER;
    HWAVEIN  m_hIn = nullptr;
    HANDLE   m_inEvent = nullptr;
    static const int kInBuffers = 4;
    std::vector<WAVEHDR>            m_inHdr;
    std::vector<std::vector<char>>  m_inBuf;
    HWAVEOUT m_hOut = nullptr;
    HANDLE   m_outEvent = nullptr;
    static const int kOutBuffers = 5;          // 5 × 20 мс в очереди устройства
    std::vector<WAVEHDR>            m_outHdr;
    std::vector<std::vector<char>>  m_outBuf;
#else
    int m_inDev  = 0;     // 0 = устройство по умолчанию
    int m_outDev = 0;
    snd_pcm_t* m_capture  = nullptr;
    snd_pcm_t* m_playback = nullptr;
#endif
};
