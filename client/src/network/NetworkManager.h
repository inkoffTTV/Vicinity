// NetworkManager.h
#pragma once
#include <QObject>
#include <QWebSocket>
#include <QTimer>
#include <QJsonDocument>
#include <QNetworkRequest>

class NetworkManager : public QObject {
    Q_OBJECT
public:
    explicit NetworkManager(QObject* parent = nullptr);
    Q_INVOKABLE void connectToServer(const QString& url, const QString& token = QString());
    Q_INVOKABLE void disconnectFromServer();
    Q_INVOKABLE void sendMessage(const QString& jsonMessage);

public slots:
    void sendBinary(const QByteArray& data);   // аудио-кадры голоса

signals:
    void connected();
    void disconnected();
    void messageReceived(const QJsonObject& message);
    void binaryReceived(const QByteArray& data);

private slots:
    void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString& message);
    void attemptReconnect();

private:
    QWebSocket m_webSocket;
    QTimer m_reconnectTimer;
    QString m_serverUrl;
    QString m_token;
    bool m_wantConnected = false;
    int m_reconnectDelay = 1000;
};