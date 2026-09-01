#pragma once
#include <QObject>
#include <QByteArray>
#include <QPointer>
#include <QVideoSink>
#include <QElapsedTimer>

class QCamera;
class QScreenCapture;
class QMediaCaptureSession;

// Видео-движок звонков (Фазы C+D): камера И/ИЛИ экран ОДНОВРЕМЕННО (два конвейера).
// Каждый источник → свой QVideoSink → I420-кадр → CallEngine (свой H264-трек).
// Обратно: CallEngine отдаёт декодированные кадры собеседника:
//   displayRemoteFrame (камера) → remoteSink, displayRemoteScreen (экран) → remoteScreenSink.
// Синки берутся из QML: VideoOutput.videoSink → setPreviewSink()/setRemoteSink()/setRemoteScreenSink().
class VideoEngine : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool active       READ active       NOTIFY activeChanged)   // хоть один источник
    Q_PROPERTY(bool cameraActive READ cameraActive NOTIFY activeChanged)
    Q_PROPERTY(bool screenActive READ screenActive NOTIFY activeChanged)
public:
    explicit VideoEngine(QObject* parent = nullptr);
    ~VideoEngine();

    bool active()       const { return m_camOn || m_scrOn; }
    bool cameraActive() const { return m_camOn; }
    bool screenActive() const { return m_scrOn; }
    Q_INVOKABLE bool hasCamera() const;

    // Выбор камеры (Настройки → Голос и видео). Выбор хранится в QSettings (video/cameraId).
    Q_INVOKABLE QStringList cameras() const;
    Q_INVOKABLE int  cameraIndex() const;
    Q_INVOKABLE void setCameraIndex(int idx);

    Q_INVOKABLE void start();        // включить камеру (спросит разрешение ОС, если нужно)
    Q_INVOKABLE void stopCamera();
    Q_INVOKABLE void startScreen();  // демонстрация экрана (~15 fps, даунскейл до 1600)
    Q_INVOKABLE void stopScreen();
    Q_INVOKABLE void stop();         // выключить всё

    // QML: CallOverlay отдаёт сюда videoSink своих VideoOutput
    Q_INVOKABLE void setPreviewSink(QVideoSink* sink)      { m_preview = sink; }
    Q_INVOKABLE void setRemoteSink(QVideoSink* sink)       { m_remote = sink; }
    Q_INVOKABLE void setRemoteScreenSink(QVideoSink* sink) { m_remoteScreen = sink; }

    // CallEngine (из потока сети): декодированные кадры собеседника (тугой I420)
    void displayRemoteFrame(const QByteArray& i420, int w, int h);    // камера
    void displayRemoteScreen(const QByteArray& i420, int w, int h);   // экран
    void clearRemote();   // убрать последние кадры (конец видео/звонка)

signals:
    void activeChanged();
    // Захваченные кадры в I420 (тугая укладка) — CallEngine энкодит в потоках захвата
    void frameCaptured(const QByteArray& i420, int w, int h);         // камера
    void screenFrameCaptured(const QByteArray& i420, int w, int h);   // экран

private:
    void startCamera();
    void onCamFrame(const QVideoFrame& f);                    // поток захвата камеры!
    void onScrFrame(const QVideoFrame& f);                    // поток захвата экрана!
    static void pushToSink(QVideoSink* sink, const QByteArray& i420, int w, int h);
    static QByteArray toI420(const QVideoFrame& f, int& w, int& h);
    static QByteArray imageToI420(const QImage& img, int& w, int& h);

    bool m_camOn = false;
    bool m_scrOn = false;

    // Конвейер камеры
    QCamera*              m_camera     = nullptr;
    QMediaCaptureSession* m_camSession = nullptr;
    QVideoSink*           m_camSink    = nullptr;

    // Конвейер экрана
    QScreenCapture*       m_screen     = nullptr;
    QMediaCaptureSession* m_scrSession = nullptr;
    QVideoSink*           m_scrSink    = nullptr;
    QElapsedTimer         m_scrThrottle;   // экран: не чаще ~15 кадров/с

    QPointer<QVideoSink>  m_preview;       // PiP: своя камера (или экран, если камеры нет)
    QPointer<QVideoSink>  m_remote;        // камера собеседника
    QPointer<QVideoSink>  m_remoteScreen;  // экран собеседника
};
