#include "CallEngine.h"
#include "VoiceEngine.h"
#include "VideoEngine.h"
#include <rtc/rtc.hpp>
#include <opus/opus.h>
#include <wels/codec_api.h>
#include <QJsonDocument>
#include <QDebug>
#include <cstring>

// PCM 16кГц моно, кадр 20мс = 320 сэмплов (640 байт) — как в VoiceEngine.
static constexpr int kSampleRate = 16000;
static constexpr int kFrame      = 320;
static constexpr int kRtpClock   = 48000;   // RTP-часы Opus всегда 48кГц (RFC 7587)
static constexpr int kRtpInc     = kRtpClock / 50;  // 20мс → 960

// Видео: H264 (openh264), RTP-часы 90кГц, PT 96.
static constexpr int      kVideoPt    = 96;
static constexpr uint32_t kVideoClock = 90000;

CallEngine::CallEngine(VoiceEngine* voice, VideoEngine* video, QObject* parent)
    : QObject(parent), m_voice(voice), m_video(video) {
    // Логи libdatachannel → qWarning (диагностика ICE/DTLS в stderr-логе клиента)
    static std::once_flag rtcLogOnce;
    std::call_once(rtcLogOnce, [] {
        rtc::InitLogger(rtc::LogLevel::Warning, [](rtc::LogLevel, rtc::string msg) {
            qWarning() << "[rtc]" << QString::fromStdString(msg);
        });
    });
    int err = 0;
    m_enc = opus_encoder_create(kSampleRate, 1, OPUS_APPLICATION_VOIP, &err);
    m_dec = opus_decoder_create(kSampleRate, 1, &err);
    if (m_voice)
        connect(m_voice, &VoiceEngine::frameCaptured, this, &CallEngine::onMicFrame,
                Qt::DirectConnection);   // энкодим прямо в потоке захвата
    if (m_video) {
        connect(m_video, &VideoEngine::frameCaptured, this, &CallEngine::onVideoFrame,
                Qt::DirectConnection);   // видео тоже энкодим в потоке захвата
        connect(m_video, &VideoEngine::screenFrameCaptured, this, &CallEngine::onScreenFrame,
                Qt::DirectConnection);   // экран — свой поток захвата и свой трек
        connect(m_video, &VideoEngine::activeChanged, this, [this] { sendCtrl(); });
    }
}

CallEngine::~CallEngine() {
    teardown();
    if (m_enc) opus_encoder_destroy(m_enc);
    if (m_dec) opus_decoder_destroy(m_dec);
}

void CallEngine::setIceServers(const QStringList& urls) { m_iceUrls = urls; }

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

void CallEngine::setupPeer(bool asCaller) {
    rtc::Configuration config;
    // Всё управление SDP у нас явное (offer в startCall, answer в acceptCall).
    // Иначе libdatachannel сам отвечает на offer, а наш setLocalDescription
    // генерит ВТОРОЙ offer → у собеседника call_busy → звонок рушится.
    config.disableAutoNegotiation = true;
    for (const QString& u : m_iceUrls) {
        try { config.iceServers.emplace_back(u.toStdString()); } catch (...) {}
    }
    m_pc = std::make_shared<rtc::PeerConnection>(config);

    m_pc->onLocalDescription([this](rtc::Description d) {
        std::string sdp = std::string(d);
        std::string type = d.typeString();
        QMetaObject::invokeMethod(this, [this, sdp, type]() {
            QJsonObject o;
            o["type"] = (type == "offer") ? "call_invite" : "call_accept";
            o["to"]   = m_peerId;
            o["sdp"]  = QString::fromStdString(sdp);
            o["sdpType"] = QString::fromStdString(type);
            if (type == "offer") o["name"] = m_selfName;  // адресат увидит, КТО звонит
            sendJson(o);
        }, Qt::QueuedConnection);
    });
    m_pc->onLocalCandidate([this](rtc::Candidate c) {
        std::string cand = std::string(c);
        std::string mid  = c.mid();
        QMetaObject::invokeMethod(this, [this, cand, mid]() {
            QJsonObject o;
            o["type"] = "rtc_ice"; o["to"] = m_peerId;
            o["candidate"] = QString::fromStdString(cand);
            o["mid"] = QString::fromStdString(mid);
            sendJson(o);
        }, Qt::QueuedConnection);
    });
    m_pc->onStateChange([this](rtc::PeerConnection::State s) {
        QMetaObject::invokeMethod(this, [this, s]() {
            using St = rtc::PeerConnection::State;
            qDebug() << "CallEngine: PC state" << static_cast<int>(s);
            if (s == St::Connected) setState("incall");
            else if (s == St::Disconnected || s == St::Failed || s == St::Closed) teardown();
        }, Qt::QueuedConnection);
    });

    // Аудио-трек (SendRecv, Opus PT=111)
    rtc::Description::Audio media("audio", rtc::Description::Direction::SendRecv);
    media.addOpusCodec(111);
    // a=ssrc ОБЯЗАТЕЛЕН: при >1 трека libdatachannel маршрутизирует входящие RTP
    // только по таблице SSRC→трек из SDP; без него весь звук/видео молча дропается.
    media.addSSRC(m_ssrc, "vicinity-audio");
    m_track = m_pc->addTrack(media);

    m_rtp = std::make_shared<rtc::RtpPacketizationConfig>(m_ssrc, "audio", 111, kRtpClock);
    auto packetizer = std::make_shared<rtc::OpusRtpPacketizer>(m_rtp);
    packetizer->addToChain(std::make_shared<rtc::RtpDepacketizer>(static_cast<uint32_t>(kRtpClock)));
    packetizer->addToChain(std::make_shared<rtc::RtcpSrReporter>(m_rtp));
    packetizer->addToChain(std::make_shared<rtc::RtcpNackResponder>());
    m_track->setMediaHandler(packetizer);

    m_track->onFrame([this](rtc::binary data, rtc::FrameInfo) {
        onIncomingOpus(QByteArray(reinterpret_cast<const char*>(data.data()),
                                  static_cast<int>(data.size())));
    });

    // Видео-трек (SendRecv, H264 PT=96). Кадры шлём только когда камера включена;
    // сам трек в SDP есть всегда — камеру можно включать без ренеготиации.
    rtc::Description::Video vmedia("video", rtc::Description::Direction::SendRecv);
    vmedia.addH264Codec(kVideoPt);
    vmedia.addSSRC(m_ssrc + 1, "vicinity-video");
    m_vtrack = m_pc->addTrack(vmedia);

    m_vrtp = std::make_shared<rtc::RtpPacketizationConfig>(m_ssrc + 1, "video", kVideoPt, kVideoClock);
    auto vpack = std::make_shared<rtc::H264RtpPacketizer>(
        rtc::NalUnit::Separator::StartSequence, m_vrtp);
    vpack->addToChain(std::make_shared<rtc::H264RtpDepacketizer>());
    vpack->addToChain(std::make_shared<rtc::RtcpSrReporter>(m_vrtp));
    vpack->addToChain(std::make_shared<rtc::RtcpNackResponder>());
    vpack->addToChain(std::make_shared<rtc::PliHandler>([this] { m_forceIdr = true; }));
    m_vtrack->setMediaHandler(vpack);

    m_vtrack->onFrame([this](rtc::binary data, rtc::FrameInfo) {
        onIncomingH264(QByteArray(reinterpret_cast<const char*>(data.data()),
                                  static_cast<int>(data.size())));
    });

    // Трек демонстрации экрана (Фаза D) — отдельный, чтобы камера и экран шли ОДНОВРЕМЕННО
    rtc::Description::Video smedia("screen", rtc::Description::Direction::SendRecv);
    smedia.addH264Codec(kVideoPt);
    smedia.addSSRC(m_ssrc + 2, "vicinity-screen");
    m_strack = m_pc->addTrack(smedia);

    m_srtp = std::make_shared<rtc::RtpPacketizationConfig>(m_ssrc + 2, "screen", kVideoPt, kVideoClock);
    auto spack = std::make_shared<rtc::H264RtpPacketizer>(
        rtc::NalUnit::Separator::StartSequence, m_srtp);
    spack->addToChain(std::make_shared<rtc::H264RtpDepacketizer>());
    spack->addToChain(std::make_shared<rtc::RtcpSrReporter>(m_srtp));
    spack->addToChain(std::make_shared<rtc::RtcpNackResponder>());
    spack->addToChain(std::make_shared<rtc::PliHandler>([this] { m_sForceIdr = true; }));
    m_strack->setMediaHandler(spack);

    m_strack->onFrame([this](rtc::binary data, rtc::FrameInfo) {
        onIncomingScreenH264(QByteArray(reinterpret_cast<const char*>(data.data()),
                                        static_cast<int>(data.size())));
    });

    // DataChannel «ctrl»: in-call сигналы (вкл/выкл камеры) мимо бэка.
    // Создаёт звонящий; принимающий получает через onDataChannel.
    if (asCaller) {
        setupCtrl(m_pc->createDataChannel("ctrl"));
    } else {
        m_pc->onDataChannel([this](std::shared_ptr<rtc::DataChannel> ch) {
            QMetaObject::invokeMethod(this, [this, ch]() { setupCtrl(ch); },
                                      Qt::QueuedConnection);
        });
    }

    m_vClock.start();
    m_live = true;
    if (m_voice) m_voice->start();   // микрофон + динамики
}

void CallEngine::setupCtrl(std::shared_ptr<rtc::DataChannel> ch) {
    m_ctrl = ch;
    if (!ch) return;
    ch->onOpen([this]() {
        QMetaObject::invokeMethod(this, [this]() { sendCtrl(); }, Qt::QueuedConnection);
    });
    ch->onMessage([this](rtc::message_variant msg) {
        if (!std::holds_alternative<rtc::string>(msg)) return;
        const QByteArray raw = QByteArray::fromStdString(std::get<rtc::string>(msg));
        QMetaObject::invokeMethod(this, [this, raw]() {
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
    } catch (...) {}
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

void CallEngine::startCall(qlonglong peer, const QString& name) {
    if (m_state != "idle" || peer == 0) return;
    setPeer(peer, name);
    setState("outgoing");
    setupPeer(true);
    m_pc->setLocalDescription();   // сгенерит offer → onLocalDescription → call_invite
}

void CallEngine::acceptCall() {
    if (m_state != "incoming" || m_pendingOffer.isEmpty()) return;
    setState("connecting");
    setupPeer(false);
    std::string sdp = m_pendingOffer["sdp"].toString().toStdString();
    try {
        m_pc->setRemoteDescription(rtc::Description(sdp, "offer"));
        // ICE-кандидаты, прилетевшие пока звонок «висел» входящим (до создания PC)
        for (const auto& c : m_pendingIce) {
            try { m_pc->addRemoteCandidate(rtc::Candidate(c.first.toStdString(),
                                                          c.second.toStdString())); }
            catch (...) {}
        }
        m_pendingIce.clear();
        m_pc->setLocalDescription();   // answer → onLocalDescription → call_accept
    } catch (const std::exception& e) {
        qWarning() << "CallEngine: accept failed:" << e.what();
        teardown();
        return;
    }
    m_pendingOffer = QJsonObject();
}

void CallEngine::rejectCall() {
    if (m_peerId) { QJsonObject o; o["type"]="call_reject"; o["to"]=m_peerId; sendJson(o); }
    teardown();
}

void CallEngine::hangup() {
    if (m_peerId) { QJsonObject o; o["type"]="call_end"; o["to"]=m_peerId; sendJson(o); }
    teardown();
}

void CallEngine::handleSignal(const QJsonObject& msg) {
    const QString t = msg["type"].toString();
    const qlonglong from = msg["from"].toVariant().toLongLong();

    if (t == "call_invite") {
        if (m_state != "idle") {   // занят — busy
            QJsonObject o; o["type"]="call_busy"; o["to"]=from; sendJson(o); return;
        }
        m_pendingOffer = msg;
        setPeer(from, msg.value("name").toString());
        setState("incoming");
        emit incomingCall(from);
    }
    else if (t == "call_accept") {
        if (from != m_peerId) return;
        std::string sdp = msg["sdp"].toString().toStdString();
        if (m_pc) m_pc->setRemoteDescription(rtc::Description(sdp, "answer"));
    }
    else if (t == "rtc_ice") {
        if (from != m_peerId) return;
        if (!m_pc) {   // PC ещё не создан (входящий не принят) — копим кандидатов
            if (m_state == "incoming")
                m_pendingIce.append({ msg["candidate"].toString(), msg["mid"].toString() });
            return;
        }
        try {
            m_pc->addRemoteCandidate(rtc::Candidate(msg["candidate"].toString().toStdString(),
                                                    msg["mid"].toString().toStdString()));
        } catch (...) {}
    }
    else if (t == "call_reject" || t == "call_end" || t == "call_busy") {
        qDebug() << "CallEngine: signal" << t << "from" << from;
        if (from == m_peerId) teardown();
    }
}

void CallEngine::onMicFrame(const QByteArray& pcm) {
    if (!m_track || !m_enc || pcm.size() < kFrame * 2) return;
    if (m_state != "incall" && m_state != "connecting") return;
    unsigned char out[4000];
    int n = opus_encode(m_enc, reinterpret_cast<const opus_int16*>(pcm.constData()),
                        kFrame, out, sizeof(out));
    if (n > 0 && m_track->isOpen()) {
        m_rtp->timestamp += kRtpInc;
        try { m_track->send(reinterpret_cast<const std::byte*>(out), static_cast<size_t>(n)); }
        catch (...) {}
        static int txa = 0;
        if ((++txa % 250) == 0) qDebug() << "CallEngine: audio tx" << txa;
    }
}

void CallEngine::onIncomingOpus(const QByteArray& opus) {
    static int rxa = 0;
    if ((++rxa % 250) == 0) qDebug() << "CallEngine: audio rx" << rxa;
    if (!m_dec || !m_voice || opus.isEmpty()) return;
    opus_int16 pcm[kFrame];
    int got = opus_decode(m_dec, reinterpret_cast<const unsigned char*>(opus.constData()),
                          static_cast<int>(opus.size()), pcm, kFrame, 0);
    if (got > 0) m_voice->playFrame(QByteArray(reinterpret_cast<const char*>(pcm), got * 2));
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
            QMetaObject::invokeMethod(this, [this]() { setRemoteVideo(true); },
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
            QMetaObject::invokeMethod(this, [this]() { setRemoteScreen(true); },
                                      Qt::QueuedConnection);
    }
}

void CallEngine::teardown() {
    m_live = false;
    if (m_track) { m_track.reset(); }
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
    if (m_pc) { try { m_pc->close(); } catch (...) {} m_pc.reset(); }
    m_rtp.reset();
    m_pendingOffer = QJsonObject();
    m_pendingIce.clear();
    // Останавливаем аудио только если не в серверном голосовом канале (это отдельный путь).
    if (m_voice && m_voice->isActive()) m_voice->stop();
    if (m_video && m_video->active()) m_video->stop();
    setRemoteVideo(false);
    setRemoteScreen(false);
    if (m_video) m_video->clearRemote();
    setPeer(0, QString());
    setState("idle");
}
