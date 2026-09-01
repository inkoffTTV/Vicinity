#pragma once
#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonObject>
#include <functional>

class ApiClient : public QObject {
    Q_OBJECT
public:
    using Callback = std::function<void(bool ok, const QJsonObject& data)>;

    static ApiClient& instance();

    void setBaseUrl(const QString& url);
    void setToken(const QString& token);
    QString baseUrl() const { return m_baseUrl; }

    void post        (const QString& path, const QJsonObject& body, Callback cb);
    void get         (const QString& path, Callback cb);
    void del         (const QString& path, Callback cb);
    void postMultipart(const QString& path, const QString& localFilePath,
                       const QString& fieldName, Callback cb);

private:
    explicit ApiClient(QObject* parent = nullptr);

    void handleReply(QNetworkReply* reply, Callback cb);
    QNetworkRequest makeRequest(const QString& path) const;

    QNetworkAccessManager m_nam;
    QString m_baseUrl;
    QString m_token;
};
