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
    connect(&m_reconnectTimer, &QTimer::timeout, this, &NetworkManager::attemptReconnect);
    m_reconnectTimer.setSingleShot(true);
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

    m_webSocket.abort();
    QNetworkRequest req((QUrl(url)));
    if (!token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + token).toUtf8());
    m_webSocket.open(req);
}

void NetworkManager::disconnectFromServer() {
    m_wantConnected = false;
    m_reconnectTimer.stop();
    m_webSocket.close();
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
    m_reconnectDelay = 1000;
    emit connected();
}

void NetworkManager::onDisconnected() {
    emit disconnected();
    if (m_wantConnected) {
        m_reconnectTimer.start(m_reconnectDelay);
        m_reconnectDelay = qMin(m_reconnectDelay * 2, 30000);
    }
}

void NetworkManager::onTextMessageReceived(const QString& message) {
    auto doc = QJsonDocument::fromJson(message.toUtf8());
    if (doc.isObject())
        emit messageReceived(doc.object());
}

void NetworkManager::attemptReconnect() {
    if (!m_wantConnected) return;
    if (m_webSocket.state() == QAbstractSocket::UnconnectedState) {
        QNetworkRequest req((QUrl(m_serverUrl)));
        if (!m_token.isEmpty())
            req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
        m_webSocket.open(req);
    }
}
