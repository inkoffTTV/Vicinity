#include "NetworkManager.h"
#include <QJsonDocument>
#include <QJsonObject>

NetworkManager::NetworkManager(QObject* parent) : QObject(parent) {
    connect(&m_webSocket, &QWebSocket::connected,    this, &NetworkManager::onConnected);
    connect(&m_webSocket, &QWebSocket::disconnected, this, &NetworkManager::onDisconnected);
    connect(&m_webSocket, &QWebSocket::textMessageReceived,
            this, &NetworkManager::onTextMessageReceived);
    connect(&m_webSocket, &QWebSocket::binaryMessageReceived,
            this, [this](const QByteArray& data) { emit binaryReceived(data); });
    // Не удалось подключиться (сервер не ответил или отказал в рукопожатии) — тоже конец попытки
    connect(&m_webSocket, &QWebSocket::errorOccurred, this, [this](QAbstractSocket::SocketError) {
        QTimer::singleShot(0, this, [this] {
            if (m_webSocket.state() == QAbstractSocket::UnconnectedState) handleClosed();
        });
    });
    connect(&m_reconnectTimer, &QTimer::timeout, this, &NetworkManager::attemptReconnect);
    m_reconnectTimer.setSingleShot(true);
}

void NetworkManager::openSocket() {
    m_wasOpen      = false;
    m_closeHandled = false;
    QNetworkRequest req((QUrl(m_serverUrl)));
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    m_webSocket.open(req);
}

void NetworkManager::connectToServer(const QString& url, const QString& token) {
    // Если уже подключены к этому же адресу — не пересоздаём
    if (m_wantConnected && m_serverUrl == url && m_token == token &&
        m_webSocket.state() == QAbstractSocket::ConnectedState)
        return;

    m_serverUrl      = url;
    m_token          = token;
    m_wantConnected  = true;
    m_reconnectDelay = 1000;

    m_reconnectTimer.stop();
    m_closeHandled = true;     // закрытие прежнего сокета ниже — не повод переподключаться
    m_webSocket.abort();
    openSocket();
}

void NetworkManager::disconnectFromServer() {
    m_wantConnected = false;
    m_reconnectTimer.stop();
    m_webSocket.close();
    m_webSocket.abort();   // в состоянии подключения close() ничего не прерывает
}

void NetworkManager::sendMessage(const QString& jsonMessage) {
    if (m_webSocket.state() == QAbstractSocket::ConnectedState)
        m_webSocket.sendTextMessage(jsonMessage);
}

void NetworkManager::sendBinary(const QByteArray& data) {
    if (m_webSocket.state() == QAbstractSocket::ConnectedState)
        m_webSocket.sendBinaryMessage(data);
}

void NetworkManager::onConnected() {
    m_wasOpen        = true;
    m_reconnectDelay = 1000;
    emit connected();
}

void NetworkManager::onDisconnected() {
    handleClosed();
}

void NetworkManager::handleClosed() {
    if (m_closeHandled) return;
    m_closeHandled = true;
    // Сервер завершил сессию (выход, смена пароля, «выйти на других устройствах») — Close 1008
    // «session ended»; либо соединение так и не открылось — например, 401 на рукопожатии
    const bool sessionEnded = m_wasOpen &&
        m_webSocket.closeCode() == QWebSocketProtocol::CloseCodePolicyViolated &&
        m_webSocket.closeReason() == QLatin1String("session ended");
    const bool neverOpened = !m_wasOpen;
    emit disconnected();
    if (!m_wantConnected) return;
    if (sessionEnded || neverOpened) emit sessionCheckRequested();
    if (!m_wantConnected) return;   // проверка уже вывела на экран входа
    m_reconnectTimer.start(m_reconnectDelay);
    m_reconnectDelay = qMin(m_reconnectDelay * 2, 30000);
}

void NetworkManager::onTextMessageReceived(const QString& message) {
    auto doc = QJsonDocument::fromJson(message.toUtf8());
    if (doc.isObject())
        emit messageReceived(doc.object());
}

void NetworkManager::attemptReconnect() {
    if (!m_wantConnected) return;
    if (m_webSocket.state() == QAbstractSocket::UnconnectedState) openSocket();
}
