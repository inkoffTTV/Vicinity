#include "CallEngine.h"
#include "VideoEngine.h"
#include "../network/ApiClient.h"
#include <rtc/rtc.hpp>
#include <opus/opus.h>
#include <wels/codec_api.h>
#include <QJsonArray>
#include <QJsonDocument>
#include <QPointer>
#include <QUrl>
#include <QDebug>
#include <cctype>
#include <cstring>
#include <exception>
#include <random>
#include <variant>

// PCM 16кГц моно, кадр 20мс = 320 сэмплов (640 байт) — как в VoiceEngine.
static constexpr int kSampleRate = 16000;
static constexpr int kFrame      = 320;
static constexpr int kRtpClock   = 48000;   // RTP-часы Opus всегда 48кГц (RFC 7587)
static constexpr int kRtpInc     = kRtpClock / 50;  // 20мс → 960
static constexpr int kMaxDecodeSamples = kSampleRate * 120 / 1000;   // самый длинный Opus-пакет — 120 мс
static constexpr int kOpusBitrate = 32000;
static constexpr int kTxGapMs    = 500;     // пауза в отправке длиннее (mute) — сдвигаем RTP-время

// Видео: H264 (openh264), RTP-часы 90кГц. PT — 96 у звонящего, у принимающего — из offer'а.
static constexpr int      kVideoPt    = 96;
static constexpr int      kAudioPt    = 111;
static constexpr uint32_t kVideoClock = 90000;
static constexpr unsigned kRembBitrate = 2500000;   // REMB: сколько просим у собеседника на видео

// Таймауты звонка
static constexpr int kRingTimeoutMs      = 45000;   // никто не ответил
static constexpr int kIncomingTimeoutMs  = 60000;   // звонящий пропал, не сняв вызов
static constexpr int kConnectTimeoutMs   = 30000;   // ответили, но ICE/DTLS не сошлись
static constexpr int kDisconnectGraceMs  = 5000;    // Disconnected → ждём восстановления
static constexpr int kIceFetchTimeoutMs  = 4000;    // GET /rtc/ice; дольше — запасные серверы
static constexpr int kMaxPendingIce      = 64;

namespace {

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

// Значение параметра из строки fmtp ("a=1;b=2"), "" — если нет
std::string fmtpParam(const std::string& fmtp, const std::string& key) {
    size_t pos = 0;
    while (pos < fmtp.size()) {
        size_t end = fmtp.find(';', pos);
        if (end == std::string::npos) end = fmtp.size();
        const std::string part = fmtp.substr(pos, end - pos);
        const size_t b = part.find_first_not_of(' ');
        const size_t eq = part.find('=');
        if (b != std::string::npos && eq != std::string::npos && eq > b &&
            lower(part.substr(b, eq - b)) == key)
            return part.substr(eq + 1);
        pos = end + 1;
    }
    return {};
}

rtc::Description::Direction directionOf(bool send, bool recv) {
    using D = rtc::Description::Direction;
    return send && recv ? D::SendRecv : send ? D::SendOnly : recv ? D::RecvOnly : D::Inactive;
}

} // namespace

CallEngine::CallEngine(VideoEngine* video, QObject* parent)
    : QObject(parent), m_video(video) {
    // Логи libdatachannel → qWarning (диагностика ICE/DTLS в stderr-логе клиента)
    static std::once_flag rtcLogOnce;
    std::call_once(rtcLogOnce, [] {
        rtc::InitLogger(rtc::LogLevel::Warning, [](rtc::LogLevel, rtc::string msg) {
            qWarning() << "[rtc]" << QString::fromStdString(msg);
        });
    });
    int err = 0;
    m_enc = opus_encoder_create(kSampleRate, 1, OPUS_APPLICATION_VOIP, &err);
    if (m_enc) {
        opus_encoder_ctl(m_enc, OPUS_SET_BITRATE(kOpusBitrate));
        opus_encoder_ctl(m_enc, OPUS_SET_INBAND_FEC(1));        // браузер восстановит потерянный пакет
        opus_encoder_ctl(m_enc, OPUS_SET_PACKET_LOSS_PERC(5));
    }
    m_dec = opus_decoder_create(kSampleRate, 1, &err);
    if (m_video) {
        connect(m_video, &VideoEngine::frameCaptured, this, &CallEngine::onVideoFrame,
                Qt::DirectConnection);   // видео энкодим в потоке захвата
        connect(m_video, &VideoEngine::screenFrameCaptured, this, &CallEngine::onScreenFrame,
                Qt::DirectConnection);   // экран — свой поток захвата и свой трек
        connect(m_video, &VideoEngine::activeChanged, this, [this] { sendCtrl(); });
    }
    m_timeout.setSingleShot(true);
    connect(&m_timeout, &QTimer::timeout, this, &CallEngine::onTimeout);
    m_dropTimer.setSingleShot(true);
    m_dropTimer.setInterval(kDisconnectGraceMs);
    connect(&m_dropTimer, &QTimer::timeout, this, [this] {
        fail(QString("Связь с %1 прервалась").arg(peerLabel()));
    });
}

CallEngine::~CallEngine() {
    teardown();
    if (m_enc) opus_encoder_destroy(m_enc);
    if (m_dec) opus_decoder_destroy(m_dec);
}

void CallEngine::setIceServers(const QStringList& urls) { m_fallbackIce = urls; }

QStringList CallEngine::iceUrlsFromResponse(const QJsonObject& resp) {
    QStringList out;
    for (const auto& sv : resp.value("ice_servers").toArray()) {
        const QJsonObject s = sv.toObject();
        QStringList urls;
        const QJsonValue u = s.value("urls");
        if (u.isString()) urls << u.toString();
        for (const auto& uv : u.toArray()) urls << uv.toString();
        const QString user = s.value("username").toString();
        const QString cred = s.value("credential").toString();
        for (const QString& url : urls) {
            if (url.startsWith("stun:", Qt::CaseInsensitive)) {
                out << url;
            } else if (url.startsWith("turn:", Qt::CaseInsensitive) ||
                       url.startsWith("turns:", Qt::CaseInsensitive)) {
                if (user.isEmpty()) continue;   // TURN без учётки не пустит
                // libdatachannel: turn:user:pass@host:port?transport=… (user/pass — percent-encoded)
                const int colon = url.indexOf(':');
                out << url.left(colon + 1) + QString::fromLatin1(QUrl::toPercentEncoding(user)) + ':'
                       + QString::fromLatin1(QUrl::toPercentEncoding(cred)) + '@' + url.mid(colon + 1);
            }
        }
    }
    return out;
}

void CallEngine::setState(const QString& s) {
    if (m_state != s) { m_state = s; emit stateChanged(); }
}
void CallEngine::setPeer(qlonglong id, const QString& name) {
    if (m_peerId != id || m_peerName != name) { m_peerId = id; m_peerName = name; emit peerChanged(); }
}
void CallEngine::setRemoteVideo(bool on) {
    if (m_remoteVideo != on) {
        m_remoteVideo = on;
        emit videoStateChanged();
    }
}
void CallEngine::setRemoteScreen(bool on) {
    if (m_remoteScreen != on) {
        m_remoteScreen = on;
        emit videoStateChanged();
    }
}
void CallEngine::sendJson(const QJsonObject& o) {
    emit sendSignal(QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact)));
}
QString CallEngine::peerLabel() const {
    return m_peerName.isEmpty() ? QString("Собеседник") : m_peerName;
}

// ── Медиа-план ───────────────────────────────────────────────────────────────
CallEngine::MediaPlan CallEngine::callerPlan() {
    MediaPlan p;
    p.audio.present  = true; p.audio.mid  = "audio";  p.audio.pt  = kAudioPt;
    p.video.present  = true; p.video.mid  = "video";  p.video.pt  = kVideoPt;
    p.screen.present = true; p.screen.mid = "screen"; p.screen.pt = kVideoPt;
    return p;
}

bool CallEngine::planFromOffer(const std::string& sdp, MediaPlan& plan) {
    plan = MediaPlan{};
    rtc::Description offer(sdp, rtc::Description::Type::Offer);
    int videoLines = 0;
    for (int i = 0; i < offer.mediaCount(); ++i) {
        auto entry = offer.media(i);
        if (!std::holds_alternative<rtc::Description::Media*>(entry)) continue;
        auto* m = std::get<rtc::Description::Media*>(entry);
        const bool isVideo = m->type() == "video";
        if (isVideo) ++videoLines;   // 1-я видео-линия — камера, 2-я — экран
        if (m->isRemoved()) continue;

        MediaLine line;
        line.mid = m->mid();
        // Своя m-line — зеркало offer'а: собеседник только отправляет → мы только принимаем
        using D = rtc::Description::Direction;
        const D dir = m->direction();
        line.send = dir == D::SendRecv || dir == D::RecvOnly || dir == D::Unknown;
        line.recv = dir == D::SendRecv || dir == D::SendOnly || dir == D::Unknown;

        if (m->type() == "audio" && !plan.audio.present) {
            for (int pt : m->payloadTypes()) {
                const auto* map = m->rtpMap(pt);
                if (map && lower(map->format) == "opus" && map->clockRate == kRtpClock) { line.pt = pt; break; }
            }
            if (line.pt < 0) continue;   // аудио без Opus: эту m-line отклонит libdatachannel
            line.present = true;
            plan.audio = line;
        } else if (isVideo && videoLines <= 2) {
            // H264 packetization-mode=1 из Baseline-семейства (openh264 декодирует его надёжно),
            // лучше всего — 42e01f (тот же профиль, что шлём сами)
            int bestScore = 0;
            for (int pt : m->payloadTypes()) {
                const auto* map = m->rtpMap(pt);
                if (!map || lower(map->format) != "h264") continue;
                std::string fmtp;
                for (const auto& f : map->fmtps) { if (!fmtp.empty()) fmtp += ';'; fmtp += f; }
                if (fmtpParam(fmtp, "packetization-mode") != "1") continue;
                std::string profile = lower(fmtpParam(fmtp, "profile-level-id"));
                if (profile.empty()) profile = "420010";   // RFC 6184: значение по умолчанию
                const int score = profile == "42e01f"           ? 3
                                : profile.compare(0, 4, "42e0") == 0 ? 2
                                : profile.compare(0, 2, "42") == 0   ? 1 : 0;
                if (score > bestScore) { bestScore = score; line.pt = pt; line.fmtp = fmtp; }
            }
            if (line.pt < 0) continue;   // без подходящего H264 видео-линию отклоняем, звук работает
            line.present = true;
            (videoLines == 1 ? plan.video : plan.screen) = line;
        }
    }
    return plan.audio.present;
}

// ── Peer connection ──────────────────────────────────────────────────────────
void CallEngine::setupPeer(const MediaPlan& plan, bool asCaller) {
    rtc::Configuration config;
    // Всё управление SDP у нас явное (offer в startCall, answer в acceptCall).
    // Иначе libdatachannel сам отвечает на offer, а наш setLocalDescription
    // генерит ВТОРОЙ offer → у собеседника call_busy → звонок рушится.
    config.disableAutoNegotiation = true;
    for (const QString& u : m_iceUrls) {
        try { config.iceServers.emplace_back(u.toStdString()); }
        catch (const std::exception& e) { qWarning() << "CallEngine: ICE server skipped:" << e.what(); }
    }
    m_pc = std::make_shared<rtc::PeerConnection>(config);
    m_haveRemote = false;
    const quint64 gen = m_gen;

    m_pc->onLocalDescription([this, gen](rtc::Description d) {
        std::string sdp = std::string(d);
        std::string type = d.typeString();
        QMetaObject::invokeMethod(this, [this, gen, sdp, type]() {
            if (gen != m_gen || !m_pc) return;
            QJsonObject o;
            o["type"] = (type == "offer") ? "call_invite" : "call_accept";
            o["to"]   = m_peerId;
            o["sdp"]  = QString::fromStdString(sdp);
            o["sdpType"] = QString::fromStdString(type);
            if (type == "offer") o["name"] = m_selfName;  // адресат увидит, КТО звонит
            sendJson(o);
        }, Qt::QueuedConnection);
    });
    m_pc->onLocalCandidate([this, gen](rtc::Candidate c) {
        std::string cand = std::string(c);
        std::string mid  = c.mid();
        QMetaObject::invokeMethod(this, [this, gen, cand, mid]() {
            if (gen != m_gen || !m_pc) return;
            QJsonObject o;
            o["type"] = "rtc_ice"; o["to"] = m_peerId;
            o["candidate"] = QString::fromStdString(cand);
            o["mid"] = QString::fromStdString(mid);
            sendJson(o);
        }, Qt::QueuedConnection);
    });
    m_pc->onStateChange([this, gen](rtc::PeerConnection::State s) {
        QMetaObject::invokeMethod(this, [this, gen, s]() { onPcState(gen, static_cast<int>(s)); },
                                  Qt::QueuedConnection);
    });
    // Свои m-line'ы создаются до setRemoteDescription, так что сюда (синхронно, внутри него)
    // попадают только чужие: без кодека, который мы умеем, или лишние. Без этого libdatachannel
    // согласился бы на них с кодеками собеседника (VP8 и т.п.) — отклоняем (порт 0 в answer).
    m_pc->onTrack([](std::shared_ptr<rtc::Track> t) {
        auto desc = t->description();
        desc.markRemoved();
        t->setDescription(std::move(desc));
    });

    // Случайные SSRC на каждый звонок (у старых десктопов были фиксированные 42/43/44)
    std::random_device rd;
    std::mt19937 rng(rd());
    std::uniform_int_distribution<uint32_t> dist(1, 0xFFFFFFF0u);
    uint32_t ssrc[3];
    for (int i = 0; i < 3; ++i) {
        do ssrc[i] = dist(rng);
        while ((i > 0 && ssrc[i] == ssrc[0]) || (i > 1 && ssrc[i] == ssrc[1]));
    }

    // Аудио-трек (Opus). a=ssrc ОБЯЗАТЕЛЕН: при >1 трека libdatachannel маршрутизирует
    // входящие RTP только по таблице SSRC→трек из SDP; без него звук молча дропается.
    rtc::Description::Audio media(plan.audio.mid, directionOf(plan.audio.send, plan.audio.recv));
    media.addOpusCodec(plan.audio.pt);
    media.addSSRC(ssrc[0], "vicinity-audio");
    auto track = m_pc->addTrack(media);

    auto rtp = std::make_shared<rtc::RtpPacketizationConfig>(
        ssrc[0], "vicinity-audio", static_cast<uint8_t>(plan.audio.pt), kRtpClock);
    auto packetizer = std::make_shared<rtc::OpusRtpPacketizer>(rtp);
    packetizer->addToChain(std::make_shared<rtc::RtpDepacketizer>(static_cast<uint32_t>(kRtpClock)));
    // RR собеседнику (стоит до SR/NACK-обработчиков: RTCP дальше по цепочке не пропускает)
    packetizer->addToChain(std::make_shared<rtc::RtcpReceivingSession>());
    packetizer->addToChain(std::make_shared<rtc::RtcpSrReporter>(rtp));
    packetizer->addToChain(std::make_shared<rtc::RtcpNackResponder>());
    track->setMediaHandler(packetizer);
    track->onFrame([this](rtc::binary data, rtc::FrameInfo info) {
        if (info.payloadType != m_audioPt.load()) return;
        onIncomingOpus(data.data(), data.size(), info.timestamp);
    });
    {
        std::lock_guard<std::mutex> lk(m_audioMx);
        m_track = track;
        m_rtp   = rtp;
        if (m_enc) opus_encoder_ctl(m_enc, OPUS_RESET_STATE);
        m_lastTxMs = -1;
        m_txClock.start();
    }
    {
        std::lock_guard<std::mutex> lk(m_adecMx);
        if (m_dec) opus_decoder_ctl(m_dec, OPUS_RESET_STATE);
        m_haveRxTs = false;
    }
    m_audioPt   = plan.audio.pt;
    m_sendAudio = plan.audio.send;

    // Видео: камера и экран — отдельные треки, чтобы шли ОДНОВРЕМЕННО. Кадры шлём только
    // когда источник включён; сам трек в SDP есть всегда — включение без ренеготиации.
    setupVideoTrack(plan.video,  ssrc[1], "vicinity-video",  m_vtrack, m_vrtp, m_forceIdr,  false);
    setupVideoTrack(plan.screen, ssrc[2], "vicinity-screen", m_strack, m_srtp, m_sForceIdr, true);

    // DataChannel «ctrl»: in-call сигналы (вкл/выкл камеры) мимо бэка.
    // Создаёт звонящий; принимающий получает через onDataChannel.
    if (asCaller) {
        setupCtrl(m_pc->createDataChannel("ctrl"));
    } else {
        m_pc->onDataChannel([this, gen](std::shared_ptr<rtc::DataChannel> ch) {
            QMetaObject::invokeMethod(this, [this, gen, ch]() {
                if (gen == m_gen && m_pc) setupCtrl(ch);
            }, Qt::QueuedConnection);
        });
    }

    m_vClock.start();
    m_live = true;
    emit audioActiveChanged(true);   // микрофон + динамики
}

void CallEngine::setupVideoTrack(const MediaLine& line, uint32_t ssrc, const char* cname,
                                 std::shared_ptr<rtc::Track>& track,
                                 std::shared_ptr<rtc::RtpPacketizationConfig>& rtp,
                                 std::atomic<bool>& forceIdr, bool screen) {
    std::atomic<int>& pt = screen ? m_screenPt : m_videoPt;
    pt = line.present ? line.pt : -1;
    if (!line.present) return;   // собеседник эту линию не предложил — без трека (её отклонят)

    rtc::Description::Video media(line.mid, directionOf(line.send, line.recv));
    if (line.fmtp.empty()) media.addH264Codec(line.pt);
    else                   media.addH264Codec(line.pt, line.fmtp);
    media.addSSRC(ssrc, cname);
    auto t = m_pc->addTrack(media);

    auto cfg = std::make_shared<rtc::RtpPacketizationConfig>(
        ssrc, cname, static_cast<uint8_t>(line.pt), kVideoClock);
    auto pack = std::make_shared<rtc::H264RtpPacketizer>(rtc::NalUnit::Separator::StartSequence, cfg);
    pack->addToChain(std::make_shared<rtc::H264RtpDepacketizer>());
    // RR + REMB (браузер поднимает оценку полосы) и наши PLI; RTCP дальше не пропускает
    pack->addToChain(std::make_shared<rtc::RtcpReceivingSession>());
    pack->addToChain(std::make_shared<rtc::RtcpSrReporter>(cfg));
    pack->addToChain(std::make_shared<rtc::RtcpNackResponder>());
    pack->addToChain(std::make_shared<rtc::PliHandler>([&forceIdr] { forceIdr = true; }));
    t->setMediaHandler(pack);

    std::weak_ptr<rtc::Track> weak = t;
    t->onOpen([weak] {
        // Без REMB браузер держит стартовые ~300 кбит/с и камера приходит мылом
        if (auto tr = weak.lock()) {
            try { tr->requestBitrate(kRembBitrate); } catch (const std::exception&) {}
        }
    });
    t->onFrame([this, screen, &pt](rtc::binary data, rtc::FrameInfo info) {
        if (info.payloadType != pt.load()) return;
        const QByteArray au(reinterpret_cast<const char*>(data.data()), static_cast<int>(data.size()));
        if (screen) onIncomingScreenH264(au);
        else        onIncomingH264(au);
    });

    std::scoped_lock lk(screen ? m_sencMx : m_encMx, screen ? m_sdecMx : m_decMx);
    track = t;
    rtp   = cfg;
}

void CallEngine::onPcState(quint64 gen, int state) {
    if (gen != m_gen || !m_pc) return;
    using St = rtc::PeerConnection::State;
    qDebug() << "CallEngine: PC state" << state;
    switch (static_cast<St>(state)) {
    case St::Connected:
        m_dropTimer.stop();
        m_timeout.stop();
        setState("incall");
        break;
    case St::Disconnected:   // может восстановиться; не восстановилось — m_dropTimer
        if (!m_dropTimer.isActive()) m_dropTimer.start();
        break;
    case St::Failed:
        fail(m_state == "incall" ? QString("Связь с %1 прервалась").arg(peerLabel())
                                 : QString("Не удалось соединиться с %1").arg(peerLabel()));
        break;
    case St::Closed:
        endCall(QStringLiteral("call_end"), QString());
        break;
    default:
        break;
    }
}

void CallEngine::setupCtrl(std::shared_ptr<rtc::DataChannel> ch) {
    m_ctrl = ch;
    if (!ch) return;
    const quint64 gen = m_gen;
    ch->onOpen([this, gen]() {
        QMetaObject::invokeMethod(this, [this, gen]() { if (gen == m_gen) sendCtrl(); },
                                  Qt::QueuedConnection);
    });
    ch->onMessage([this, gen](rtc::message_variant msg) {
        if (!std::holds_alternative<rtc::string>(msg)) return;
        const QByteArray raw = QByteArray::fromStdString(std::get<rtc::string>(msg));
        QMetaObject::invokeMethod(this, [this, gen, raw]() {
            if (gen != m_gen) return;
            const QJsonObject o = QJsonDocument::fromJson(raw).object();
            if (o.contains("video"))  setRemoteVideo(o["video"].toBool());
            if (o.contains("screen")) setRemoteScreen(o["screen"].toBool());
        }, Qt::QueuedConnection);
    });
    // Канал мог открыться до навешивания onOpen (гонка на приёмной стороне) —
    // тогда шлём состояние сразу.
    if (ch->isOpen()) sendCtrl();
}

void CallEngine::sendCtrl() {
    if (!m_ctrl || !m_video) return;
    QJsonObject o;
    o["video"]  = m_video->cameraActive();
    o["screen"] = m_video->screenActive();
    try {
        if (m_ctrl->isOpen())
            m_ctrl->send(QJsonDocument(o).toJson(QJsonDocument::Compact).toStdString());
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: ctrl send failed:" << e.what();
    }
}

void CallEngine::toggleCamera() {
    if (!m_video || m_state == "idle") return;
    if (m_video->cameraActive()) m_video->stopCamera();
    else                         m_video->start();
    // sendCtrl уйдёт сам по activeChanged
}

void CallEngine::toggleScreen() {
    if (!m_video || m_state == "idle") return;
    if (m_video->screenActive()) m_video->stopScreen();
    else                         m_video->startScreen();
}

// ── Жизненный цикл звонка ────────────────────────────────────────────────────
void CallEngine::armTimeout(int ms) { m_timeout.start(ms); }

void CallEngine::onTimeout() {
    if (m_state == "outgoing")
        endCall(QStringLiteral("call_end"), QString("%1 не отвечает").arg(peerLabel()));
    else if (m_state == "incoming")
        endCall(QStringLiteral("call_reject"), QString());
    else if (m_state == "connecting")
        fail(QString("Не удалось соединиться с %1").arg(peerLabel()));
}

void CallEngine::fetchIce() {
    // Свежие STUN/TURN (временные учётки TURN) перед каждым звонком; старый бэкенд
    // без /rtc/ice или сбой — остаёмся на запасных серверах
    m_iceReady = false;
    m_iceUrls  = m_fallbackIce;
    const quint64 gen = m_gen;
    QPointer<CallEngine> self(this);
    ApiClient::instance().get("/rtc/ice", [self, gen](bool ok, const QJsonObject& data) {
        if (!self || self->m_gen != gen || self->m_state == "idle") return;
        const QStringList urls = ok ? iceUrlsFromResponse(data) : QStringList();
        if (!urls.isEmpty()) self->m_iceUrls = urls;
        self->m_iceReady = true;
        self->onIceReady();
    }, kIceFetchTimeoutMs);
}

void CallEngine::onIceReady() {
    if (m_pc) return;
    if (m_state == "outgoing")        beginOutgoing();
    else if (m_state == "connecting") beginAnswer();   // приняли, пока ждали /rtc/ice
}

void CallEngine::beginOutgoing() {
    try {
        setupPeer(callerPlan(), true);
        m_pc->setLocalDescription();   // offer → onLocalDescription → call_invite
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: call setup failed:" << e.what();
        fail(QString("Не удалось начать звонок"));
    }
}

void CallEngine::beginAnswer() {
    const std::string sdp = m_pendingOffer.value("sdp").toString().toStdString();
    try {
        // Подстраиваемся под offer: mid'ы и PT собеседника (браузер — 0/1/2 и свои номера)
        MediaPlan plan;
        if (!planFromOffer(sdp, plan)) {
            fail(QString("Звонок не поддерживается: нет общего аудиокодека"));
            return;
        }
        setupPeer(plan, false);
        m_pc->setRemoteDescription(rtc::Description(sdp, rtc::Description::Type::Offer));
        m_haveRemote = true;
        // ICE-кандидаты, прилетевшие пока звонок «висел» входящим (до создания PC)
        flushRemoteCandidates();
        m_pc->setLocalDescription();   // answer → onLocalDescription → call_accept
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: accept failed:" << e.what();
        fail(QString("Не удалось принять звонок"));
        return;
    }
    m_pendingOffer = QJsonObject();
}

void CallEngine::addRemoteCandidate(const QString& candidate, const QString& mid) {
    // Один негодный кандидат (например, неразрешимый mDNS) звонок не рвёт: остальные
    // могут сработать, а безнадёжный случай закроют Failed и таймаут соединения
    try {
        if (mid.isEmpty()) m_pc->addRemoteCandidate(rtc::Candidate(candidate.toStdString()));
        else m_pc->addRemoteCandidate(rtc::Candidate(candidate.toStdString(), mid.toStdString()));
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: remote candidate ignored:" << e.what();
    }
}

void CallEngine::flushRemoteCandidates() {
    const auto pending = m_pendingIce;
    m_pendingIce.clear();
    for (const auto& c : pending) addRemoteCandidate(c.first, c.second);
}

void CallEngine::startCall(qlonglong peer, const QString& name) {
    if (m_state != "idle" || peer <= 0) return;
    ++m_gen;
    setPeer(peer, name);
    setState("outgoing");
    armTimeout(kRingTimeoutMs);
    fetchIce();   // дальше beginOutgoing
}

void CallEngine::acceptCall() {
    if (m_state != "incoming" || m_pendingOffer.isEmpty()) return;
    setState("connecting");
    armTimeout(kConnectTimeoutMs);
    if (m_iceReady) beginAnswer();   // иначе — когда придёт /rtc/ice
}

void CallEngine::rejectCall() { endCall(QStringLiteral("call_reject"), QString()); }

void CallEngine::hangup() { endCall(QStringLiteral("call_end"), QString()); }

void CallEngine::endCall(const QString& notifyType, const QString& notice) {
    if (m_state == "idle") return;
    if (!notifyType.isEmpty() && m_peerId) {
        QJsonObject o; o["type"] = notifyType; o["to"] = m_peerId; sendJson(o);
    }
    teardown();
    if (!notice.isEmpty()) emit callNotice(notice);
}

void CallEngine::handleSignal(const QJsonObject& msg) {
    // Сигналинг приходит от собеседника как есть: ничто отсюда не должно уронить UI
    try {
        const QString t = msg.value("type").toString();
        const qlonglong from = msg.value("from").toVariant().toLongLong();

        if (t == "call_invite") {
            if (from <= 0) return;
            if (m_state != "idle") {
                if (from == m_peerId && m_state == "incoming") {
                    m_pendingOffer = msg;   // повторный invite того же собеседника — свежий offer
                    m_pendingIce.clear();
                    return;
                }
                if (from == m_peerId && (m_state == "connecting" || m_state == "incall")) {
                    teardown();   // собеседник начал звонок заново (перезапуск клиента)
                } else {
                    QJsonObject o; o["type"] = "call_busy"; o["to"] = from; sendJson(o);
                    return;
                }
            }
            ++m_gen;
            m_pendingOffer = msg;
            m_pendingIce.clear();
            setPeer(from, msg.value("name").toString());
            setState("incoming");
            armTimeout(kIncomingTimeoutMs);
            fetchIce();   // пока звонит — к accept серверы уже будут
            emit incomingCall(from);
        }
        else if (t == "call_accept") {
            if (from != m_peerId || m_state != "outgoing" || !m_pc || m_haveRemote) return;
            try {
                m_pc->setRemoteDescription(rtc::Description(msg.value("sdp").toString().toStdString(),
                                                            rtc::Description::Type::Answer));
            } catch (const std::exception& e) {
                qWarning() << "CallEngine: bad answer:" << e.what();
                fail(QString("Не удалось установить звонок"));
                return;
            }
            m_haveRemote = true;
            flushRemoteCandidates();
            setState("connecting");
            armTimeout(kConnectTimeoutMs);
        }
        else if (t == "rtc_ice") {
            if (from != m_peerId || m_state == "idle") return;
            const QString cand = msg.value("candidate").toString();
            if (cand.isEmpty()) return;   // end-of-candidates
            const QString mid = msg.value("mid").toString();
            // До remote description кандидат не применить — копим (и у звонящего, и у принимающего)
            if (!m_pc || !m_haveRemote) {
                if (m_pendingIce.size() < kMaxPendingIce) m_pendingIce.append({ cand, mid });
                return;
            }
            addRemoteCandidate(cand, mid);
        }
        else if (t == "call_reject" || t == "call_end" || t == "call_busy") {
            qDebug() << "CallEngine: signal" << t << "from" << from;
            if (from != m_peerId || m_state == "idle") return;
            QString notice;
            if (t == "call_busy") notice = QString("%1: линия занята").arg(peerLabel());
            else if (t == "call_reject" && m_state == "outgoing") notice = QString("Звонок отклонён");
            endCall(QString(), notice);
        }
        else if (t == "call_unavailable") {
            // Сервер: адресат не в сети (сигнал не доставлен)
            const qlonglong uid = msg.value("user_id").toVariant().toLongLong();
            if (uid != m_peerId || (m_state != "outgoing" && m_state != "connecting")) return;
            endCall(QString(), QString("%1 не в сети").arg(peerLabel()));
        }
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: signal failed:" << e.what();
        fail(QString("Не удалось установить звонок"));
    } catch (...) {
        qWarning() << "CallEngine: signal failed";
        fail(QString("Не удалось установить звонок"));
    }
}

// ── Аудио: микрофон → Opus → RTP (поток захвата) ────────────────────────────
void CallEngine::pushMicFrame(const QByteArray& pcm) {
    if (!m_sendAudio.load() || pcm.size() < kFrame * 2) return;
    std::lock_guard<std::mutex> lk(m_audioMx);
    if (!m_track || !m_rtp || !m_enc || !m_track->isOpen()) return;
    unsigned char out[1500];
    const int n = opus_encode(m_enc, reinterpret_cast<const opus_int16*>(pcm.constData()),
                              kFrame, out, sizeof(out));
    if (n <= 0) return;
    // RTP-время — по реальному времени: после паузы (mute) сдвигаем на её длину,
    // иначе у собеседника время «отстаёт» и NetEq спотыкается
    const qint64 now = m_txClock.elapsed();
    uint32_t inc = kRtpInc;
    if (m_lastTxMs >= 0 && now - m_lastTxMs > kTxGapMs)
        inc = static_cast<uint32_t>((now - m_lastTxMs + 10) / 20) * kRtpInc;
    m_lastTxMs = now;
    m_rtp->timestamp += inc;
    try { m_track->send(reinterpret_cast<const std::byte*>(out), static_cast<size_t>(n)); }
    catch (const std::exception& e) { qWarning() << "CallEngine: audio send failed:" << e.what(); }
}

// ── Аудио: RTP → Opus → PCM собеседника (поток сети) ────────────────────────
void CallEngine::onIncomingOpus(const std::byte* data, size_t size, uint32_t timestamp) {
    if (!m_live || size == 0) return;
    const auto* pkt = reinterpret_cast<const unsigned char*>(data);
    const int len = static_cast<int>(size);
    opus_int16 pcm[kMaxDecodeSamples];
    QByteArray out;
    {
        std::lock_guard<std::mutex> lk(m_adecMx);
        if (!m_dec) return;
        const int dur = opus_packet_get_nb_samples(pkt, len, kRtpClock);   // в тиках 48 кГц
        if (dur <= 0) return;   // битый пакет
        if (m_haveRxTs) {
            const int32_t delta = static_cast<int32_t>(timestamp - m_lastRxTs);
            if (delta <= 0) return;   // опоздал или повтор — его место уже проиграно
            // Потерю до 100 мс маскируем (PLC декодера), дольше — собеседник молчал
            const int32_t lost = delta - static_cast<int32_t>(m_lastRxDur);
            if (lost >= kRtpInc && lost <= 5 * kRtpInc) {
                const int n = opus_decode(m_dec, nullptr, 0, pcm, (lost / 120) * 40, 0);  // шаг 2.5 мс
                if (n > 0) out.append(reinterpret_cast<const char*>(pcm), n * 2);
            }
        }
        m_haveRxTs  = true;
        m_lastRxTs  = timestamp;
        m_lastRxDur = static_cast<uint32_t>(dur);
        const int got = opus_decode(m_dec, pkt, len, pcm, kMaxDecodeSamples, 0);
        if (got > 0) out.append(reinterpret_cast<const char*>(pcm), got * 2);
    }
    if (!out.isEmpty()) emit remoteAudio(out);
}

// ── Видео: общий энкод I420 → openh264 → RTP (зовётся под мьютексом источника) ──
void CallEngine::encodeAndSend(ISVCEncoder*& enc, int& encW, int& encH,
                               std::atomic<bool>& forceIdr,
                               const std::shared_ptr<rtc::Track>& track,
                               const std::shared_ptr<rtc::RtpPacketizationConfig>& rtp,
                               const QByteArray& i420, int w, int h) {
    if (!track || !track->isOpen()) return;

    if (!enc || encW != w || encH != h) {                  // (пере)создаём энкодер под размер
        if (enc) { enc->Uninitialize(); WelsDestroySVCEncoder(enc); enc = nullptr; }
        if (WelsCreateSVCEncoder(&enc) != 0 || !enc) { enc = nullptr; return; }
        SEncParamExt p;
        memset(&p, 0, sizeof(p));
        enc->GetDefaultParams(&p);
        p.iUsageType     = CAMERA_VIDEO_REAL_TIME;
        p.iPicWidth      = w;
        p.iPicHeight     = h;
        p.fMaxFrameRate  = 30.f;
        const qint64 area = qint64(w) * h;   // экран крупнее камеры → больше битрейт
        p.iTargetBitrate = area > 1280 * 720 ? 2500000
                         : area > 640 * 480  ? 1800000 : 900000;
        p.iMaxBitrate    = p.iTargetBitrate * 5 / 4;
        p.iRCMode        = RC_BITRATE_MODE;
        p.uiIntraPeriod  = 60;                 // IDR ~каждые 2с; SPS/PPS приходят с каждым IDR
        p.eSpsPpsIdStrategy = CONSTANT_ID;
        p.bEnableFrameSkip  = true;
        p.iMultipleThreadIdc = 1;
        p.iSpatialLayerNum  = 1;
        p.iTemporalLayerNum = 1;
        p.sSpatialLayers[0].iVideoWidth       = w;
        p.sSpatialLayers[0].iVideoHeight      = h;
        p.sSpatialLayers[0].fFrameRate        = 30.f;
        p.sSpatialLayers[0].iSpatialBitrate   = p.iTargetBitrate;
        p.sSpatialLayers[0].iMaxSpatialBitrate = p.iMaxBitrate;
        p.sSpatialLayers[0].uiProfileIdc      = PRO_BASELINE;
        if (enc->InitializeExt(&p) != cmResultSuccess) {
            WelsDestroySVCEncoder(enc); enc = nullptr; return;
        }
        int fmt = videoFormatI420;
        enc->SetOption(ENCODER_OPTION_DATAFORMAT, &fmt);
        encW = w; encH = h;
        forceIdr = false;                      // новый энкодер сам начнёт с IDR
    }

    if (forceIdr.exchange(false)) enc->ForceIntraFrame(true);

    SSourcePicture pic;
    memset(&pic, 0, sizeof(pic));
    pic.iColorFormat = videoFormatI420;
    pic.iPicWidth    = w;
    pic.iPicHeight   = h;
    pic.iStride[0]   = w;
    pic.iStride[1]   = w / 2;
    pic.iStride[2]   = w / 2;
    auto* base = reinterpret_cast<unsigned char*>(const_cast<char*>(i420.constData()));
    pic.pData[0] = base;
    pic.pData[1] = base + w * h;
    pic.pData[2] = pic.pData[1] + (w / 2) * (h / 2);
    pic.uiTimeStamp = m_vClock.elapsed();

    SFrameBSInfo info;
    memset(&info, 0, sizeof(info));
    if (enc->EncodeFrame(&pic, &info) != cmResultSuccess) return;
    if (info.eFrameType == videoFrameTypeSkip) return;

    QByteArray au;   // весь access unit в Annex-B (слои уже со старт-кодами)
    for (int i = 0; i < info.iLayerNum; i++) {
        const SLayerBSInfo& L = info.sLayerInfo[i];
        int sz = 0;
        for (int j = 0; j < L.iNalCount; j++) sz += L.pNalLengthInByte[j];
        au.append(reinterpret_cast<const char*>(L.pBsBuf), sz);
    }
    if (au.isEmpty()) return;

    rtp->timestamp = rtp->startTimestamp
                     + static_cast<uint32_t>(m_vClock.elapsed() * (kVideoClock / 1000));
    try {
        track->send(reinterpret_cast<const std::byte*>(au.constData()),
                    static_cast<size_t>(au.size()));
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: video send failed:" << e.what();
    }
}

void CallEngine::onVideoFrame(const QByteArray& i420, int w, int h) {
    if (!m_live || w <= 0 || h <= 0) return;
    std::lock_guard<std::mutex> lk(m_encMx);
    encodeAndSend(m_venc, m_encW, m_encH, m_forceIdr, m_vtrack, m_vrtp, i420, w, h);
}

void CallEngine::onScreenFrame(const QByteArray& i420, int w, int h) {
    if (!m_live || w <= 0 || h <= 0) return;
    std::lock_guard<std::mutex> lk(m_sencMx);
    encodeAndSend(m_senc, m_sencW, m_sencH, m_sForceIdr, m_strack, m_srtp, i420, w, h);
}

// ── Видео: RTP → openh264 → VideoEngine (поток сети libdatachannel) ─────────
void CallEngine::onIncomingH264(const QByteArray& au) {
    static int rxv = 0;
    if ((++rxv % 500) == 0) qDebug() << "CallEngine: video rx" << rxv << "last AU" << au.size();
    if (!m_live || !m_video || au.isEmpty()) return;
    std::lock_guard<std::mutex> lk(m_decMx);

    if (!m_vdec) {
        if (WelsCreateDecoder(&m_vdec) != 0 || !m_vdec) { m_vdec = nullptr; return; }
        SDecodingParam dp;
        memset(&dp, 0, sizeof(dp));
        dp.sVideoProperty.size        = sizeof(dp.sVideoProperty);
        dp.sVideoProperty.eVideoBsType = VIDEO_BITSTREAM_DEFAULT;
        dp.eEcActiveIdc  = ERROR_CON_DISABLE;   // без «зелёной каши»: потеря → PLI → свежий IDR
        dp.uiTargetDqLayer = static_cast<unsigned char>(-1);
        if (m_vdec->Initialize(&dp) != 0) { WelsDestroyDecoder(m_vdec); m_vdec = nullptr; return; }
    }

    unsigned char* dst[3] = { nullptr, nullptr, nullptr };
    SBufferInfo bi;
    memset(&bi, 0, sizeof(bi));
    const DECODING_STATE st = m_vdec->DecodeFrameNoDelay(
        reinterpret_cast<const unsigned char*>(au.constData()),
        static_cast<int>(au.size()), dst, &bi);

    if (st != dsErrorFree) {
        // Потеряли референс — просим ключевой кадр (PLI), не чаще раза в секунду
        if (m_vtrack && (!m_pliTimer.isValid() || m_pliTimer.elapsed() > 1000)) {
            m_pliTimer.restart();
            try { m_vtrack->requestKeyframe(); } catch (...) {}
        }
    }

    if (bi.iBufferStatus == 1 && dst[0] && dst[1] && dst[2]) {
        const int w  = bi.UsrData.sSystemBuffer.iWidth  & ~1;
        const int h  = bi.UsrData.sSystemBuffer.iHeight & ~1;
        const int sy = bi.UsrData.sSystemBuffer.iStride[0];
        const int sc = bi.UsrData.sSystemBuffer.iStride[1];
        if (w <= 0 || h <= 0) return;
        QByteArray i420;
        i420.resize(w * h * 3 / 2);
        uint8_t* dy = reinterpret_cast<uint8_t*>(i420.data());
        uint8_t* du = dy + w * h;
        uint8_t* dv = du + (w / 2) * (h / 2);
        for (int y = 0; y < h;     y++) memcpy(dy + y * w,       dst[0] + y * sy, w);
        for (int y = 0; y < h / 2; y++) memcpy(du + y * (w / 2), dst[1] + y * sc, w / 2);
        for (int y = 0; y < h / 2; y++) memcpy(dv + y * (w / 2), dst[2] + y * sc, w / 2);
        m_video->displayRemoteFrame(i420, w, h);
        // Страховка: кадры идут, а ctrl-сообщение могло потеряться
        if (!m_remoteVideo)
            QMetaObject::invokeMethod(this, [this]() { if (m_live) setRemoteVideo(true); },
                                      Qt::QueuedConnection);
    }
}

// ── Экран собеседника: RTP → openh264 → VideoEngine (поток сети) ────────────
void CallEngine::onIncomingScreenH264(const QByteArray& au) {
    if (!m_live || !m_video || au.isEmpty()) return;
    std::lock_guard<std::mutex> lk(m_sdecMx);

    if (!m_sdec) {
        if (WelsCreateDecoder(&m_sdec) != 0 || !m_sdec) { m_sdec = nullptr; return; }
        SDecodingParam dp;
        memset(&dp, 0, sizeof(dp));
        dp.sVideoProperty.size         = sizeof(dp.sVideoProperty);
        dp.sVideoProperty.eVideoBsType = VIDEO_BITSTREAM_DEFAULT;
        dp.eEcActiveIdc    = ERROR_CON_DISABLE;
        dp.uiTargetDqLayer = static_cast<unsigned char>(-1);
        if (m_sdec->Initialize(&dp) != 0) { WelsDestroyDecoder(m_sdec); m_sdec = nullptr; return; }
    }

    unsigned char* dst[3] = { nullptr, nullptr, nullptr };
    SBufferInfo bi;
    memset(&bi, 0, sizeof(bi));
    const DECODING_STATE st = m_sdec->DecodeFrameNoDelay(
        reinterpret_cast<const unsigned char*>(au.constData()),
        static_cast<int>(au.size()), dst, &bi);

    if (st != dsErrorFree) {
        if (m_strack && (!m_sPliTimer.isValid() || m_sPliTimer.elapsed() > 1000)) {
            m_sPliTimer.restart();
            try { m_strack->requestKeyframe(); } catch (...) {}
        }
    }

    if (bi.iBufferStatus == 1 && dst[0] && dst[1] && dst[2]) {
        const int w  = bi.UsrData.sSystemBuffer.iWidth  & ~1;
        const int h  = bi.UsrData.sSystemBuffer.iHeight & ~1;
        const int sy = bi.UsrData.sSystemBuffer.iStride[0];
        const int sc = bi.UsrData.sSystemBuffer.iStride[1];
        if (w <= 0 || h <= 0) return;
        QByteArray i420;
        i420.resize(w * h * 3 / 2);
        uint8_t* dy = reinterpret_cast<uint8_t*>(i420.data());
        uint8_t* du = dy + w * h;
        uint8_t* dv = du + (w / 2) * (h / 2);
        for (int y = 0; y < h;     y++) memcpy(dy + y * w,       dst[0] + y * sy, w);
        for (int y = 0; y < h / 2; y++) memcpy(du + y * (w / 2), dst[1] + y * sc, w / 2);
        for (int y = 0; y < h / 2; y++) memcpy(dv + y * (w / 2), dst[2] + y * sc, w / 2);
        m_video->displayRemoteScreen(i420, w, h);
        if (!m_remoteScreen)
            QMetaObject::invokeMethod(this, [this]() { if (m_live) setRemoteScreen(true); },
                                      Qt::QueuedConnection);
    }
}


void CallEngine::teardown() {
    const bool hadPeer = m_live.exchange(false);
    m_sendAudio = false;
    ++m_gen;   // всё, что ещё в очереди от этого звонка (и ответ /rtc/ice), — мимо
    m_timeout.stop();
    m_dropTimer.stop();
    // Сначала отцепляем коллбеки libdatachannel: после этого они не придут
    // (reset ждёт уже идущий коллбек, а наши мьютексы здесь ещё не захвачены)
    for (const auto& t : { m_track, m_vtrack, m_strack })
        if (t) t->resetCallbacks();
    if (m_ctrl) m_ctrl->resetCallbacks();
    if (m_pc)   m_pc->resetCallbacks();
    {
        std::lock_guard<std::mutex> lk(m_audioMx);
        m_track.reset();
        m_rtp.reset();
    }
    {   // видео-часть: блокируем все кодек-потоки (захваты и сеть)
        std::scoped_lock lk(m_encMx, m_decMx, m_sencMx, m_sdecMx);
        m_vtrack.reset();
        m_vrtp.reset();
        m_strack.reset();
        m_srtp.reset();
        if (m_venc) { m_venc->Uninitialize(); WelsDestroySVCEncoder(m_venc);
                      m_venc = nullptr; m_encW = m_encH = 0; }
        if (m_vdec) { m_vdec->Uninitialize(); WelsDestroyDecoder(m_vdec); m_vdec = nullptr; }
        if (m_senc) { m_senc->Uninitialize(); WelsDestroySVCEncoder(m_senc);
                      m_senc = nullptr; m_sencW = m_sencH = 0; }
        if (m_sdec) { m_sdec->Uninitialize(); WelsDestroyDecoder(m_sdec); m_sdec = nullptr; }
    }
    m_ctrl.reset();
    if (m_pc) {
        try { m_pc->close(); }
        catch (const std::exception& e) { qWarning() << "CallEngine: close failed:" << e.what(); }
        m_pc.reset();
    }
    m_pendingOffer = QJsonObject();
    m_pendingIce.clear();
    m_haveRemote = false;
    m_iceReady   = false;
    // Голосовой канал (если я в нём) звонок не трогает: VoiceEngine сам решает, закрывать ли устройства
    if (hadPeer) emit audioActiveChanged(false);
    if (m_video && m_video->active()) m_video->stop();
    setRemoteVideo(false);
    setRemoteScreen(false);
    if (m_video) m_video->clearRemote();
    setPeer(0, QString());
    setState("idle");
}
