#pragma once
#include <QObject>
#include <QByteArray>
#include <QStringList>
#include <atomic>
#include <thread>
#include <vector>
#include <chrono>

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
// Аудио PCM 16kHz mono 16-bit. frameCaptured → WebSocket; playFrame ← WebSocket.
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

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();
    Q_INVOKABLE bool isActive() const { return m_active; }
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
    void playFrame(const QByteArray& pcm);

signals:
    void frameCaptured(const QByteArray& pcm);
    void speakingChanged(bool speaking);
    void mutedChanged();
    void micVolumeChanged();
    void outVolumeChanged();
    void devicesChanged();

private:
    void openAudio();
    void closeAudio();
    void restartAudio();
    void captureLoop();
    void loadSettings();
    void saveSettings();
    void detectSpeaking(const int16_t* samples, int n);   // общий RMS-детектор

    std::atomic<bool> m_active{false};
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_muted{false};
    std::atomic<int>  m_micVol{100};
    std::atomic<int>  m_outVol{100};
    bool m_speaking = false;
    std::chrono::steady_clock::time_point m_lastLoud;
    std::thread m_thread;

    static const int kFrameSamples = 320;     // 20ms @ 16kHz mono
    static const int kFrameBytes   = 640;     // 320 * 2

#ifdef _WIN32
    void applyOutVolume();
    UINT m_inDev  = WAVE_MAPPER;
    UINT m_outDev = WAVE_MAPPER;
    HWAVEIN  m_hIn = nullptr;
    HANDLE   m_inEvent = nullptr;
    static const int kInBuffers = 4;
    std::vector<WAVEHDR>            m_inHdr;
    std::vector<std::vector<char>>  m_inBuf;
    HWAVEOUT m_hOut = nullptr;
    static const int kOutBuffers = 24;
    std::vector<WAVEHDR>            m_outHdr;
    std::vector<std::vector<char>>  m_outBuf;
    int m_outIdx = 0;
#else
    int m_inDev  = 0;     // 0 = устройство по умолчанию
    int m_outDev = 0;
    snd_pcm_t* m_capture  = nullptr;
    snd_pcm_t* m_playback = nullptr;
#endif
};
