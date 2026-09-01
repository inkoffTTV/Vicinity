#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include "src/core/ThemeManager.h"
#include "src/core/AppState.h"
#include "src/core/VoiceEngine.h"
#include "src/core/VideoEngine.h"
#include "src/core/CallEngine.h"
#include "src/network/NetworkManager.h"
#include "src/network/ApiClient.h"

int main(int argc, char *argv[]) {
    QGuiApplication app(argc, argv);
    QGuiApplication::setOrganizationName("Vicinity");
    QGuiApplication::setApplicationName("Vicinity");
    // Базовый стиль Controls — позволяет кастомизировать фон/цвета по токенам
    // (нативный стиль Windows игнорирует кастомизацию).
    QQuickStyle::setStyle("Basic");

    // Загружаем сохранённый адрес сервера (по умолчанию 127.0.0.1:8080)
    AppState::instance().loadServerAddress();

    ThemeManager   themeManager;
    NetworkManager networkManager;
    VoiceEngine    voiceEngine;

    // Голос (серверные каналы): микрофон → WebSocket, и WebSocket → динамики
    QObject::connect(&voiceEngine,    &VoiceEngine::frameCaptured,
                     &networkManager, &NetworkManager::sendBinary);
    QObject::connect(&networkManager, &NetworkManager::binaryReceived,
                     &voiceEngine,    &VoiceEngine::playFrame);

    // Звонки (WebRTC): сигналинг движка → WS. ICE-серверы (пока публичные; позже свой coturn).
    VideoEngine videoEngine;   // камера (Фаза C)
    CallEngine callEngine(&voiceEngine, &videoEngine);
    callEngine.setIceServers({ "stun:stun.l.google.com:19302" });
    QObject::connect(&callEngine, &CallEngine::sendSignal,
                     &networkManager, &NetworkManager::sendMessage);

    QQmlApplicationEngine engine;
    engine.addImportPath("qrc:/qml");

    qmlRegisterType<ThemeManager>("Vicinity.Core", 1, 0, "ThemeManager");

    engine.rootContext()->setContextProperty("themeManager",   &themeManager);
    engine.rootContext()->setContextProperty("networkManager", &networkManager);
    engine.rootContext()->setContextProperty("voiceEngine",    &voiceEngine);
    engine.rootContext()->setContextProperty("videoEngine",    &videoEngine);
    engine.rootContext()->setContextProperty("callEngine",     &callEngine);
    engine.rootContext()->setContextProperty("appState",       &AppState::instance());

    const QUrl url(u"qrc:/qml/main.qml"_qs);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreated,
                     &app, [url](QObject *obj, const QUrl &objUrl) {
        if (!obj && url == objUrl)
            QCoreApplication::exit(-1);
    }, Qt::QueuedConnection);
    
    engine.load(url);

    // Восстанавливаем сессию после загрузки QML
    AppState::instance().tryAutoLogin();

    return app.exec();
}