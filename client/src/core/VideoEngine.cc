#include "VideoEngine.h"
#include <QCamera>
#include <QCameraDevice>
#include <QScreenCapture>
#include <QMediaCaptureSession>
#include <QMediaDevices>
#include <QVideoFrame>
#include <QVideoFrameFormat>
#include <QImage>
#include <QGuiApplication>
#include <QScreen>
#include <QSettings>
#include <QDebug>
#include <cstring>
#if QT_CONFIG(permissions)
  #include <QPermissions>
#endif

VideoEngine::VideoEngine(QObject* parent) : QObject(parent) {}

VideoEngine::~VideoEngine() { stop(); }

bool VideoEngine::hasCamera() const {
    return !QMediaDevices::videoInputs().isEmpty();
}

QStringList VideoEngine::cameras() const {
    QStringList names;
    const auto all = QMediaDevices::videoInputs();
    for (const QCameraDevice& d : all) names << d.description();
    return names;
}

int VideoEngine::cameraIndex() const {
    const auto all = QMediaDevices::videoInputs();
    if (all.isEmpty()) return -1;
    const QByteArray saved = QSettings().value("video/cameraId").toByteArray();
    for (int i = 0; i < all.size(); ++i)
        if (all[i].id() == saved) return i;
    return 0;   // дефолтная
}

void VideoEngine::setCameraIndex(int idx) {
    const auto all = QMediaDevices::videoInputs();
    if (idx < 0 || idx >= all.size()) return;
    QSettings().setValue("video/cameraId", all[idx].id());
    if (m_camOn) { stopCamera(); start(); }   // перезапуск на новую камеру прямо в звонке
}

// ── КАМЕРА ───────────────────────────────────────────────────────────────────
void VideoEngine::start() {
    if (m_camOn) return;
#if QT_CONFIG(permissions)
    QCameraPermission perm;
    switch (qApp->checkPermission(perm)) {
    case Qt::PermissionStatus::Undetermined:
        qApp->requestPermission(perm, this, [this](const QPermission& p) {
            if (p.status() == Qt::PermissionStatus::Granted) startCamera();
        });
        return;
    case Qt::PermissionStatus::Denied:
        qWarning() << "VideoEngine: доступ к камере запрещён системой";
        return;
    default: break;
    }
#endif
    startCamera();
}

void VideoEngine::startCamera() {
    if (m_camOn) return;
    // Камера из настроек (video/cameraId), иначе дефолтная
    QCameraDevice dev;
    const QByteArray saved = QSettings().value("video/cameraId").toByteArray();
    const auto all = QMediaDevices::videoInputs();
    if (!saved.isEmpty())
        for (const QCameraDevice& d : all)
            if (d.id() == saved) { dev = d; break; }
    if (dev.isNull()) dev = QMediaDevices::defaultVideoInput();
    if (dev.isNull() && !all.isEmpty()) dev = all.first();
    if (dev.isNull()) { qWarning() << "VideoEngine: камера не найдена"; return; }

    m_camera = new QCamera(dev, this);

    // Выбор формата: максимум 720p (реалтайм-энкод на CPU), крупнее площадь — лучше;
    // предпочитаем YUV-форматы (дешёвая конвертация) и вменяемый fps.
    QCameraFormat best;
    qint64 bestScore = -1;
    for (const QCameraFormat& fmt : dev.videoFormats()) {
        const QSize r = fmt.resolution();
        if (r.width() <= 0 || r.height() <= 0) continue;
        const qint64 area = qint64(r.width()) * r.height();
        if (area > qint64(1280) * 720) continue;
        qint64 score = area * 10;
        const auto pf = fmt.pixelFormat();
        if (pf == QVideoFrameFormat::Format_NV12 ||
            pf == QVideoFrameFormat::Format_YUV420P)     score += 5;
        else if (pf == QVideoFrameFormat::Format_YUYV ||
                 pf == QVideoFrameFormat::Format_UYVY)   score += 3;
        if (fmt.maxFrameRate() >= 24 && fmt.maxFrameRate() <= 61) score += 2;
        if (score > bestScore) { bestScore = score; best = fmt; }
    }
    if (!best.isNull()) m_camera->setCameraFormat(best);

    m_camSession = new QMediaCaptureSession(this);
    m_camSink    = new QVideoSink(this);
    m_camSession->setCamera(m_camera);
    m_camSession->setVideoSink(m_camSink);
    // DirectConnection: конвертация I420 идёт в потоке захвата, не грузит GUI
    connect(m_camSink, &QVideoSink::videoFrameChanged, this, &VideoEngine::onCamFrame,
            Qt::DirectConnection);
    m_camera->start();
    m_camOn = true;
    emit activeChanged();
}

void VideoEngine::stopCamera() {
    if (!m_camOn) return;
    m_camOn = false;
    if (m_camera)     m_camera->stop();
    if (m_camSession) { m_camSession->setCamera(nullptr); m_camSession->setVideoSink(nullptr); }
    if (m_camSink)    { disconnect(m_camSink, nullptr, this, nullptr);
                        m_camSink->deleteLater(); m_camSink = nullptr; }
    if (m_camera)     { m_camera->deleteLater();     m_camera = nullptr; }
    if (m_camSession) { m_camSession->deleteLater(); m_camSession = nullptr; }
    if (QVideoSink* p = m_preview) if (!m_scrOn) p->setVideoFrame(QVideoFrame());  // погасить PiP
    emit activeChanged();
}

// ── ЭКРАН (Фаза D) ───────────────────────────────────────────────────────────
void VideoEngine::startScreen() {
    if (m_scrOn) return;
    QScreen* scr = QGuiApplication::primaryScreen();
    if (!scr) { qWarning() << "VideoEngine: экран не найден"; return; }

    m_screen = new QScreenCapture(this);
    m_screen->setScreen(scr);
    m_scrSession = new QMediaCaptureSession(this);
    m_scrSink    = new QVideoSink(this);
    m_scrSession->setScreenCapture(m_screen);
    m_scrSession->setVideoSink(m_scrSink);
    connect(m_scrSink, &QVideoSink::videoFrameChanged, this, &VideoEngine::onScrFrame,
            Qt::DirectConnection);
    m_scrThrottle.start();
    m_screen->start();
    m_scrOn = true;
    emit activeChanged();
}

void VideoEngine::stopScreen() {
    if (!m_scrOn) return;
    m_scrOn = false;
    if (m_screen)     m_screen->stop();
    if (m_scrSession) { m_scrSession->setScreenCapture(nullptr); m_scrSession->setVideoSink(nullptr); }
    if (m_scrSink)    { disconnect(m_scrSink, nullptr, this, nullptr);
                        m_scrSink->deleteLater(); m_scrSink = nullptr; }
    if (m_screen)     { m_screen->deleteLater();     m_screen = nullptr; }
    if (m_scrSession) { m_scrSession->deleteLater(); m_scrSession = nullptr; }
    if (QVideoSink* p = m_preview) if (!m_camOn) p->setVideoFrame(QVideoFrame());
    emit activeChanged();
}

void VideoEngine::stop() {
    stopCamera();
    stopScreen();
}

// ── Кадры (потоки захвата) ───────────────────────────────────────────────────
void VideoEngine::onCamFrame(const QVideoFrame& f) {
    if (!m_camOn || !f.isValid()) return;
    if (QVideoSink* p = m_preview) p->setVideoFrame(f);   // PiP: камера в приоритете
    int w = 0, h = 0;
    const QByteArray i420 = toI420(f, w, h);
    if (!i420.isEmpty()) emit frameCaptured(i420, w, h);
}

void VideoEngine::onScrFrame(const QVideoFrame& f) {
    if (!m_scrOn || !f.isValid()) return;
    if (!m_camOn) if (QVideoSink* p = m_preview) p->setVideoFrame(f);  // PiP если камеры нет
    // Экран: не чаще ~15 fps и даунскейл до 1600 по ширине (реалтайм-энкод на CPU)
    if (m_scrThrottle.isValid() && m_scrThrottle.elapsed() < 66) return;
    m_scrThrottle.restart();
    QImage img = f.toImage();
    if (img.isNull()) return;
    if (img.width() > 1600) img = img.scaledToWidth(1600, Qt::FastTransformation);
    int w = 0, h = 0;
    const QByteArray i420 = imageToI420(img.convertToFormat(QImage::Format_RGB32), w, h);
    if (!i420.isEmpty()) emit screenFrameCaptured(i420, w, h);
}

// ── Конвертация captured-кадра в тугой I420 ─────────────────────────────────
// Быстрые ветки для типовых форматов камер (NV12/YUV420P/YUYV/UYVY, с учётом stride),
// остальное — через QImage (медленнее, зато принимает всё).
QByteArray VideoEngine::toI420(const QVideoFrame& in, int& w, int& h) {
    QVideoFrame f(in);
    if (f.map(QVideoFrame::ReadOnly)) {
        w = f.width()  & ~1;
        h = f.height() & ~1;
        const int cw = w / 2, ch = h / 2;
        if (w > 0 && h > 0) {
            QByteArray out;
            out.resize(w * h + cw * ch * 2);
            uint8_t* dy = reinterpret_cast<uint8_t*>(out.data());
            uint8_t* du = dy + w * h;
            uint8_t* dv = du + cw * ch;
            const auto pf = f.pixelFormat();
            bool ok = true;

            if (pf == QVideoFrameFormat::Format_YUV420P) {
                for (int y = 0; y < h;  y++) memcpy(dy + y * w,  f.bits(0) + y * f.bytesPerLine(0), w);
                for (int y = 0; y < ch; y++) memcpy(du + y * cw, f.bits(1) + y * f.bytesPerLine(1), cw);
                for (int y = 0; y < ch; y++) memcpy(dv + y * cw, f.bits(2) + y * f.bytesPerLine(2), cw);
            }
            else if (pf == QVideoFrameFormat::Format_NV12) {
                for (int y = 0; y < h; y++) memcpy(dy + y * w, f.bits(0) + y * f.bytesPerLine(0), w);
                for (int y = 0; y < ch; y++) {
                    const uint8_t* uv = f.bits(1) + y * f.bytesPerLine(1);
                    for (int x = 0; x < cw; x++) { du[y*cw+x] = uv[2*x]; dv[y*cw+x] = uv[2*x+1]; }
                }
            }
            else if (pf == QVideoFrameFormat::Format_YUYV || pf == QVideoFrameFormat::Format_UYVY) {
                const bool yuyv = (pf == QVideoFrameFormat::Format_YUYV);
                for (int y = 0; y < h; y++) {
                    const uint8_t* s = f.bits(0) + y * f.bytesPerLine(0);
                    uint8_t* line = dy + y * w;
                    for (int x = 0; x < w; x++) line[x] = yuyv ? s[2*x] : s[2*x+1];
                    if ((y & 1) == 0) {
                        const int cy = y / 2;
                        for (int x = 0; x < cw; x++) {
                            const uint8_t* p = s + 4 * x;
                            du[cy*cw+x] = yuyv ? p[1] : p[0];
                            dv[cy*cw+x] = yuyv ? p[3] : p[2];
                        }
                    }
                }
            }
            else ok = false;

            f.unmap();
            if (ok) return out;
        } else {
            f.unmap();
        }
    }

    // Фолбэк: любой формат → RGB32 → I420
    const QImage img = in.toImage().convertToFormat(QImage::Format_RGB32);
    return imageToI420(img, w, h);
}

// RGB32 → тугой I420 (BT.601, среднее 2x2 для хромы). Общий код камеры-фолбэка и экрана.
QByteArray VideoEngine::imageToI420(const QImage& img, int& w, int& h) {
    if (img.isNull()) return {};
    w = img.width()  & ~1;
    h = img.height() & ~1;
    if (w <= 0 || h <= 0) return {};
    const int cw = w / 2, ch = h / 2;
    QByteArray out;
    out.resize(w * h + cw * ch * 2);
    uint8_t* dy = reinterpret_cast<uint8_t*>(out.data());
    uint8_t* du = dy + w * h;
    uint8_t* dv = du + cw * ch;
    for (int y = 0; y < h; y++) {
        const QRgb* s = reinterpret_cast<const QRgb*>(img.constScanLine(y));
        uint8_t* line = dy + y * w;
        for (int x = 0; x < w; x++) {
            const int r = qRed(s[x]), g = qGreen(s[x]), b = qBlue(s[x]);
            line[x] = uint8_t(((66*r + 129*g + 25*b + 128) >> 8) + 16);
        }
    }
    for (int cy = 0; cy < ch; cy++) {
        const QRgb* s0 = reinterpret_cast<const QRgb*>(img.constScanLine(cy*2));
        const QRgb* s1 = reinterpret_cast<const QRgb*>(img.constScanLine(cy*2 + 1));
        for (int cx = 0; cx < cw; cx++) {
            const QRgb p[4] = { s0[cx*2], s0[cx*2+1], s1[cx*2], s1[cx*2+1] };
            int r = 0, g = 0, b = 0;
            for (const QRgb c : p) { r += qRed(c); g += qGreen(c); b += qBlue(c); }
            r /= 4; g /= 4; b /= 4;
            du[cy*cw+cx] = uint8_t(((-38*r - 74*g + 112*b + 128) >> 8) + 128);
            dv[cy*cw+cx] = uint8_t(((112*r - 94*g - 18*b + 128) >> 8) + 128);
        }
    }
    return out;
}

// ── Вывод кадров собеседника (зовётся из потоков сети CallEngine) ────────────
void VideoEngine::pushToSink(QVideoSink* sink, const QByteArray& i420, int w, int h) {
    if (!sink || w <= 0 || h <= 0 || i420.size() < w * h * 3 / 2) return;
    QVideoFrame frame(QVideoFrameFormat(QSize(w, h), QVideoFrameFormat::Format_YUV420P));
    if (!frame.map(QVideoFrame::WriteOnly)) return;
    const uint8_t* sy = reinterpret_cast<const uint8_t*>(i420.constData());
    const uint8_t* su = sy + w * h;
    const uint8_t* sv = su + (w/2) * (h/2);
    for (int y = 0; y < h;   y++) memcpy(frame.bits(0) + y * frame.bytesPerLine(0), sy + y * w,     w);
    for (int y = 0; y < h/2; y++) memcpy(frame.bits(1) + y * frame.bytesPerLine(1), su + y * (w/2), w/2);
    for (int y = 0; y < h/2; y++) memcpy(frame.bits(2) + y * frame.bytesPerLine(2), sv + y * (w/2), w/2);
    frame.unmap();
    sink->setVideoFrame(frame);
}

void VideoEngine::displayRemoteFrame(const QByteArray& i420, int w, int h) {
    pushToSink(m_remote, i420, w, h);
}

void VideoEngine::displayRemoteScreen(const QByteArray& i420, int w, int h) {
    pushToSink(m_remoteScreen, i420, w, h);
}

void VideoEngine::clearRemote() {
    if (QVideoSink* s = m_remote)       s->setVideoFrame(QVideoFrame());
    if (QVideoSink* s = m_remoteScreen) s->setVideoFrame(QVideoFrame());
}
