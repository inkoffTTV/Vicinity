#pragma once
#include <QObject>
#include <QString>
#include <QStringList>
#include <QJsonObject>
#include <QElapsedTimer>
#include <QTimer>
#include <QList>
#include <QPair>
#include <memory>
#include <mutex>
#include <atomic>
#include <cstdint>
#include <string>

// WebRTC-движок звонков (libdatachannel + Opus + openh264).
// Фаза B: аудио 1:1. Фаза C: видео (камера) — H264-трек + DataChannel «ctrl»
// для вкл/выкл камеры (без изменений бэка). Сигналинг (offer/answer/ICE +
// lifecycle) идёт поверх существующего WS (relay на бэке, Фаза A).
// Протокол и совместимость с браузером — docs/CALLS.md.
//
// Звук с устройствами не связан напрямую: микрофон приходит в pushMicFrame,
// звук собеседника уходит сигналом remoteAudio, а audioActiveChanged говорит,
// когда звонку нужны устройства (main.cpp связывает это с VoiceEngine).
namespace rtc { class PeerConnection; class Track; class RtpPacketizationConfig; class DataChannel; }
struct OpusEncoder;
struct OpusDecoder;
class ISVCEncoder;   // openh264
class ISVCDecoder;
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
    explicit CallEngine(VideoEngine* video = nullptr, QObject* parent = nullptr);
    ~CallEngine();

    // Запасные ICE-серверы в формате libdatachannel ("stun:host:port",
    // "turn:user:pass@host:port?transport=udp") — если GET /rtc/ice недоступен.
    void setIceServers(const QStringList& urls);

    // Ответ GET /api/v1/rtc/ice → URL'ы libdatachannel (TURN — с учёткой в URL)
    static QStringList iceUrlsFromResponse(const QJsonObject& resp);

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

public slots:
    // PCM 16 кГц моно, 320 сэмплов (20 мс). Зовётся из потока захвата (DirectConnection).
    void pushMicFrame(const QByteArray& pcm);

signals:
    void stateChanged();
    void peerChanged();
    void videoStateChanged();
    void sendSignal(const QString& json);   // → networkManager.sendMessage
    void incomingCall(qlonglong fromId);    // UI: показать экран входящего
    void callNotice(const QString& text);   // UI: короткое уведомление (не в сети, нет ответа, сбой)
    void audioActiveChanged(bool active);   // звонку нужны (true) / не нужны (false) микрофон и динамики
    // Декодированный звук собеседника, PCM 16 кГц моно. Испускается из потока сети!
    void remoteAudio(const QByteArray& pcm);

private slots:
    void onVideoFrame(const QByteArray& i420, int w, int h);   // камера → H264 → трек камеры
    void onScreenFrame(const QByteArray& i420, int w, int h);  // экран  → H264 → трек экрана

private:
    // Одна m-line звонка: mid и payload type кодека (Opus у аудио, H264 у видео).
    struct MediaLine {
        bool        present = false;
        std::string mid;
        int         pt = -1;
        std::string fmtp;          // параметры кодека для своей m-line ("" — по умолчанию)
        bool        send = true;   // направление своей m-line (ответ зеркалит offer)
        bool        recv = true;
    };
    struct MediaPlan { MediaLine audio, video, screen; };

    // Звонящий: фиксированные audio/video/screen, Opus 111, H264 96 — как у старых десктопов.
    static MediaPlan callerPlan();
    // Принимающий: mid'ы и PT из offer'а собеседника (браузер — 0/1/2 и свои PT).
    // false — в offer'е нет Opus: звонок невозможен.
    static bool planFromOffer(const std::string& sdp, MediaPlan& plan);

    void   fetchIce();                      // GET /rtc/ice перед каждым звонком
    void   onIceReady();
    void   beginOutgoing();                 // PC + offer → call_invite
    void   beginAnswer();                   // PC по offer'у + answer → call_accept
    void   setupPeer(const MediaPlan& plan, bool asCaller);
    void   setupVideoTrack(const MediaLine& line, uint32_t ssrc, const char* cname,
                           std::shared_ptr<rtc::Track>& track,
                           std::shared_ptr<rtc::RtpPacketizationConfig>& rtp,
                           std::atomic<bool>& forceIdr, bool screen);
    void   onPcState(quint64 gen, int state);
    void   addRemoteCandidate(const QString& candidate, const QString& mid);
    void   flushRemoteCandidates();
    void   armTimeout(int ms);
    void   onTimeout();
    // Завершить звонок: notifyType ("call_end"/"call_reject"/"") уходит собеседнику,
    // notice (если не пустой) — пользователю.
    void   endCall(const QString& notifyType, const QString& notice);
    void   fail(const QString& notice) { endCall(QStringLiteral("call_end"), notice); }
    void   teardown();
    void   setState(const QString& s);
    void   setPeer(qlonglong id, const QString& name);
    void   sendJson(const QJsonObject& o);
    QString peerLabel() const;
    void   onIncomingOpus(const std::byte* data, size_t size, uint32_t timestamp);  // поток сети
    void   onIncomingH264(const QByteArray& au);    // трек камеры: декод → displayRemoteFrame
    void   onIncomingScreenH264(const QByteArray& au); // трек экрана: декод → displayRemoteScreen
    void   setupCtrl(std::shared_ptr<rtc::DataChannel> ch);
    void   sendCtrl();                              // {"video":bool,"screen":bool} собеседнику
    void   setRemoteVideo(bool on);
    void   setRemoteScreen(bool on);
    // Общий энкод кадра I420 → H264 → трек (звать под соответствующим мьютексом)
    void   encodeAndSend(ISVCEncoder*& enc, int& encW, int& encH, std::atomic<bool>& forceIdr,
                         const std::shared_ptr<rtc::Track>& track,
                         const std::shared_ptr<rtc::RtpPacketizationConfig>& rtp,
                         const QByteArray& i420, int w, int h);

    VideoEngine*                              m_video = nullptr;
    std::shared_ptr<rtc::PeerConnection>      m_pc;

    // Аудио: отправка (поток захвата) под m_audioMx, приём (поток сети) под m_adecMx
    std::mutex                                m_audioMx, m_adecMx;
    std::shared_ptr<rtc::Track>               m_track;
    std::shared_ptr<rtc::RtpPacketizationConfig> m_rtp;
    OpusEncoder*                              m_enc = nullptr;
    OpusDecoder*                              m_dec = nullptr;
    QElapsedTimer                             m_txClock;      // пауза в отправке → сдвиг RTP-времени
    qint64                                    m_lastTxMs = -1;
    std::atomic<bool>                         m_sendAudio{false};
    std::atomic<int>                          m_audioPt{-1};  // PT входящего Opus
    bool                                      m_haveRxTs = false;
    uint32_t                                  m_lastRxTs = 0;
    uint32_t                                  m_lastRxDur = 0; // длительность прошлого пакета (48 кГц)

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
    std::atomic<int>  m_videoPt{-1}, m_screenPt{-1};
    QElapsedTimer     m_vClock;               // RTP-таймстемпы видео (90 кГц)
    QElapsedTimer     m_pliTimer, m_sPliTimer;// рейт-лимит своих PLI
    // Показывать ли плитки камеры/экрана собеседника (GUI-поток пишет, поток сети читает)
    std::atomic<bool> m_remoteVideo{false};
    std::atomic<bool> m_remoteScreen{false};
    // Что собеседник сообщил по ctrl в этом звонке: -1 — ещё ничего, 0 — выключил, 1 — включил.
    // Пишет поток сети (коллбек ctrl) — в том же потоке, что и кадры, без очереди GUI.
    std::atomic<int>  m_ctrlVideo{-1};
    std::atomic<int>  m_ctrlScreen{-1};

    QString    m_state   = "idle";
    qlonglong  m_peerId  = 0;
    QString    m_peerName;
    QString    m_selfName;
    quint64    m_gen = 0;                // номер звонка: коллбеки прошлых звонков игнорируются
    QJsonObject m_pendingOffer;          // входящий offer до accept
    QList<QPair<QString,QString>> m_pendingIce;   // ICE-кандидаты до remote description (candidate, mid)
    bool       m_haveRemote = false;     // remote description установлен
    QStringList m_fallbackIce;           // setIceServers()
    QStringList m_iceUrls;               // для текущего звонка (из /rtc/ice или запасные)
    bool       m_iceReady = false;
    QTimer     m_timeout;                // звонок без ответа / соединение не установилось
    QTimer     m_dropTimer;              // PC Disconnected: ждём восстановления
};
