#include "ApiClient.h"
#include <QNetworkRequest>
#include <QJsonDocument>
#include <QHttpMultiPart>
#include <QFile>
#include <QFileInfo>
#include <QUrl>

ApiClient& ApiClient::instance() {
    static ApiClient inst;
    return inst;
}

ApiClient::ApiClient(QObject* parent) : QObject(parent) {}

void ApiClient::setBaseUrl(const QString& url) { m_baseUrl = url; }
void ApiClient::setToken(const QString& token)  { m_token  = token; }

QNetworkRequest ApiClient::makeRequest(const QString& path) const {
    QNetworkRequest req(QUrl(m_baseUrl + path));
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    // Таймаут: если сервер/туннель не отвечает — запрос не виснет вечно,
    // reply завершится с ошибкой и UI покажет ошибку вместо "бесконечной загрузки".
    req.setTransferTimeout(15000);
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    return req;
}

void ApiClient::handleReply(QNetworkReply* reply, Callback cb) {
    connect(reply, &QNetworkReply::finished, this, [reply, cb]() {
        bool ok = (reply->error() == QNetworkReply::NoError);
        QJsonObject data;
        auto doc = QJsonDocument::fromJson(reply->readAll());
        if (doc.isObject()) data = doc.object();
        cb(ok, data);
        reply->deleteLater();
    });
}

void ApiClient::post(const QString& path, const QJsonObject& body, Callback cb) {
    auto* reply = m_nam.post(makeRequest(path), QJsonDocument(body).toJson());
    handleReply(reply, std::move(cb));
}

void ApiClient::get(const QString& path, Callback cb) {
    auto* reply = m_nam.get(makeRequest(path));
    handleReply(reply, std::move(cb));
}

void ApiClient::del(const QString& path, Callback cb) {
    auto* reply = m_nam.deleteResource(makeRequest(path));
    handleReply(reply, std::move(cb));
}

void ApiClient::postMultipart(const QString& path, const QString& localFilePath,
                               const QString& fieldName, Callback cb) {
    QString filePath = QUrl(localFilePath).toLocalFile();
    if (filePath.isEmpty()) filePath = localFilePath;

    QFile* file = new QFile(filePath);
    if (!file->open(QIODevice::ReadOnly)) {
        delete file;
        cb(false, {});
        return;
    }

    auto* multiPart = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    QHttpPart filePart;
    filePart.setHeader(QNetworkRequest::ContentDispositionHeader,
        QVariant(QString(R"(form-data; name="%1"; filename="%2")")
            .arg(fieldName)
            .arg(QFileInfo(filePath).fileName())));
    filePart.setBodyDevice(file);
    file->setParent(multiPart);
    multiPart->append(filePart);

    QNetworkRequest req(QUrl(m_baseUrl + path));
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());

    auto* reply = m_nam.post(req, multiPart);
    multiPart->setParent(reply);
    handleReply(reply, std::move(cb));
}
