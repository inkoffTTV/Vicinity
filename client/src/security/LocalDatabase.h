#pragma once
#include <QObject>
#include <QSqlDatabase>
#include <QString>
#include <QList>
#include <cstdint>

struct CachedMessage {
    int64_t id        = 0;
    int64_t channelId = 0;
    int64_t authorId  = 0;
    QString authorName;
    QString text;
    QString timestamp;
};

class LocalDatabase : public QObject {
    Q_OBJECT
public:
    static LocalDatabase& instance();

    bool open(const QString& path);
    void close();

    bool saveMessage(const CachedMessage& msg);
    QList<CachedMessage> getMessages(int64_t channelId, int limit = 50);
    void clearChannel(int64_t channelId);

private:
    explicit LocalDatabase(QObject* parent = nullptr) : QObject(parent) {}
    bool createTables();
    QSqlDatabase m_db;
};
