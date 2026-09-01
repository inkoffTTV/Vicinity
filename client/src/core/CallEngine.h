#pragma once
#include <QObject>
#include <QString>
#include <QJsonObject>
#include <QElapsedTimer>
#include <memory>
#include <mutex>
#include <atomic>
#include <cstdint>

// WebRTC-движок звонков (libdatachannel + Opus + openh264).
// Фаза B: аудио 1:1. Фаза C: видео (камера) — H264-трек + DataChannel «ctrl»
// для вкл/выкл камеры (без изменений бэка). Сигналинг (offer/answer/ICE +
// lifecycle) идёт поверх существующего WS (relay на бэке, Фаза A).
namespace rtc { class PeerConnection; class Track; class RtpPacketizationConfig; class DataChannel; }
struct OpusEncoder;
struct OpusDecoder;
class ISVCEncoder;   // openh264
class ISVCDecoder;
class VoiceEngine;
class VideoEngine;

class CallEngine : public QObject {
    Q_OBJECT
    // idle | outgoing | incoming | connecting | incall
    Q_PROPERTY(QString   state       READ state       NOTIFY stateChanged)
    Q_PROPERTY(qlonglong peerId      READ peerId      NOTIFY peerChanged)
    Q_PROPERTY(QString   peerName    READ peerName    NOTIFY peerChanged)
    Q_PROPERTY(bool      remoteVideo  READ remoteVideo  NOTIFY videoStateChanged)
    Q_PROPERTY(bool      remoteScreen READ remoteScreen NOTIFY videoStateChanged)
    Q_PROPERTY(QString   selfName    MEMBER m_selfName)   // моё имя (шлём звонящему)
public:
    explicit CallEngine(VoiceEngine* voice, VideoEngine* video = nullptr, QObject* parent = nullptr);
    ~CallEngine();

    // Список ICE-серверов в формате libdatachannel ("stun:host:port" или "turn:host:port")
    // + опциональные turn-креды. Пока задаётся из main; позже — из настроек/бэка.
    void setIceServers(const QStringList& urls);

    Q_INVOKABLE void startCall(qlonglong peer, const QString& name);
    Q_INVOKABLE void acceptCall();
    Q_INVOKABLE void rejectCall();
    Q_INVOKABLE void hangup();
    Q_INVOKABLE void toggleCamera();   // вкл/выкл свою камеру в звонке
    Q_INVOKABLE void toggleScreen();   // вкл/выкл демонстрацию экрана (Фаза D)

    // Входящий сигналинг из WS (роутится из ChatView.onMessageReceived)
    Q_INVOKABLE void handleSignal(const QJsonObject& msg);

    QString   state()       const { return m_state; }
    qlonglong peerId()      const { return m_peerId; }
    QString   peerName()    const { return m_peerName; }
    bool      remoteVideo()  const { return m_remoteVideo; }
    bool      remoteScreen() const { return m_remoteScreen; }

signals:
    void stateChanged();
    void peerChanged();
    void videoStateChanged();
    void sendSignal(const QString& json);   // → networkManager.sendMessage
    void incomingCall(qlonglong fromId);    // UI: показать экран входящего

private slots:
    void onMicFrame(const QByteArray& pcm);                    // VoiceEngine → Opus → трек
    void onVideoFrame(const QByteArray& i420, int w, int h);   // камера → H264 → трек "video"
    void onScreenFrame(const QByteArray& i420, int w, int h);  // экран  → H264 → трек "screen"

private:
    void   setupPeer(bool asCaller);
    void   teardown();
    void   setState(const QString& s);
    void   setPeer(qlonglong id, const QString& name);
    void   sendJson(const QJsonObject& o);
    void   onIncomingOpus(const QByteArray& opus);  // из трека: декод → playFrame
    void   onIncomingH264(const QByteArray& au);    // трек "video": декод → displayRemoteFrame
    void   onIncomingScreenH264(const QByteArray& au); // трек "screen": декод → displayRemoteScreen
    void   setupCtrl(std::shared_ptr<rtc::DataChannel> ch);
    void   sendCtrl();                              // {"video":bool,"screen":bool} собеседнику
    void   setRemoteVideo(bool on);
    void   setRemoteScreen(bool on);
    // Общий энкод кадра I420 → H264 → трек (звать под соответствующим мьютексом)
    void   encodeAndSend(ISVCEncoder*& enc, int& encW, int& encH, std::atomic<bool>& forceIdr,
                         const std::shared_ptr<rtc::Track>& track,
                         const std::shared_ptr<rtc::RtpPacketizationConfig>& rtp,
                         const QByteArray& i420, int w, int h);

    VoiceEngine*                              m_voice = nullptr;
    VideoEngine*                              m_video = nullptr;
    std::shared_ptr<rtc::PeerConnection>      m_pc;
    std::shared_ptr<rtc::Track>               m_track;
    std::shared_ptr<rtc::RtpPacketizationConfig> m_rtp;
    OpusEncoder*                              m_enc = nullptr;
    OpusDecoder*                              m_dec = nullptr;

    // Видео: камера (Фаза C) + экран (Фаза D) — два независимых трека
    std::shared_ptr<rtc::Track>               m_vtrack, m_strack;
    std::shared_ptr<rtc::RtpPacketizationConfig> m_vrtp, m_srtp;
    std::shared_ptr<rtc::DataChannel>         m_ctrl;
    ISVCEncoder*      m_venc = nullptr;       // камера: защищены m_encMx / m_decMx
    ISVCDecoder*      m_vdec = nullptr;
    ISVCEncoder*      m_senc = nullptr;       // экран: защищены m_sencMx / m_sdecMx
    ISVCDecoder*      m_sdec = nullptr;
    int               m_encW = 0, m_encH = 0;
    int               m_sencW = 0, m_sencH = 0;
    std::mutex        m_encMx, m_decMx, m_sencMx, m_sdecMx;
    std::atomic<bool> m_forceIdr{false};      // PLI от собеседника → форсим IDR (камера)
    std::atomic<bool> m_sForceIdr{false};     // PLI (экран)
    std::atomic<bool> m_live{false};          // peer жив (гейт для поздних коллбеков)
    QElapsedTimer     m_vClock;               // RTP-таймстемпы видео (90 кГц)
    QElapsedTimer     m_pliTimer, m_sPliTimer;// рейт-лимит своих PLI
    bool              m_remoteVideo  = false;
    bool              m_remoteScreen = false;

    QString    m_state   = "idle";
    qlonglong  m_peerId  = 0;
    QString    m_peerName;
    QString    m_selfName;
    QJsonObject m_pendingOffer;      // входящий offer до accept
    QList<QPair<QString,QString>> m_pendingIce;   // ICE-кандидаты, пришедшие до accept (candidate, mid)
    QStringList m_iceUrls;
    uint32_t   m_ssrc = 42;
};
