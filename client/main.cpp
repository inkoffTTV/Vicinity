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

    // Голос (серверные каналы): микрофон → WebSocket (только пока в канале), и WebSocket → динамики
    QObject::connect(&voiceEngine,    &VoiceEngine::channelFrame,
                     &networkManager, &NetworkManager::sendBinary);
    QObject::connect(&networkManager, &NetworkManager::binaryReceived,
                     &voiceEngine,    &VoiceEngine::playChannelPacket);   // v2: id отправителя + PCM

    // Звонки (WebRTC): сигналинг движка → WS. ICE-серверы — GET /rtc/ice перед каждым звонком,
    // этот STUN — запасной (старый бэкенд или сбой запроса).
    VideoEngine videoEngine;   // камера (Фаза C)
    CallEngine callEngine(&videoEngine);
    callEngine.setIceServers({ "stun:stun.l.google.com:19302" });
    QObject::connect(&callEngine, &CallEngine::sendSignal,
                     &networkManager, &NetworkManager::sendMessage);
    // Звук звонка: микрофон → Opus (в потоке захвата), собеседник → динамики
    QObject::connect(&voiceEngine, &VoiceEngine::frameCaptured,
                     &callEngine,  &CallEngine::pushMicFrame, Qt::DirectConnection);
    QObject::connect(&callEngine,  &CallEngine::remoteAudio,
                     &voiceEngine, &VoiceEngine::playCallFrame, Qt::DirectConnection);   // из потока сети
    QObject::connect(&callEngine,  &CallEngine::audioActiveChanged,
                     &voiceEngine, &VoiceEngine::setCallActive);

    // Выход из аккаунта (кнопка или отозванная сессия): звонок и голосовой канал не живут без него
    QObject::connect(&AppState::instance(), &AppState::authChanged, &callEngine, [&] {
        if (AppState::instance().authenticated()) return;
        callEngine.hangup();
        voiceEngine.setChannelActive(false);
    });

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