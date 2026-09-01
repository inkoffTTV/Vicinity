#include "LocalDatabase.h"
#include <QSqlQuery>
#include <QSqlError>
#include <QDebug>

LocalDatabase& LocalDatabase::instance() {
    static LocalDatabase inst;
    return inst;
}

bool LocalDatabase::open(const QString& path) {
    m_db = QSqlDatabase::addDatabase("QSQLITE", "local");
    m_db.setDatabaseName(path);
    if (!m_db.open()) {
        qWarning() << "LocalDatabase open error:" << m_db.lastError().text();
        return false;
    }
    return createTables();
}

void LocalDatabase::close() {
    if (m_db.isOpen()) m_db.close();
}

bool LocalDatabase::createTables() {
    QSqlQuery q(m_db);
    return q.exec(
        "CREATE TABLE IF NOT EXISTS messages ("
        "id INTEGER PRIMARY KEY,"
        "channel_id INTEGER NOT NULL,"
        "author_id INTEGER NOT NULL,"
        "author_name TEXT NOT NULL,"
        "text TEXT NOT NULL,"
        "timestamp TEXT NOT NULL)"
    );
}

bool LocalDatabase::saveMessage(const CachedMessage& msg) {
    QSqlQuery q(m_db);
    q.prepare("INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)");
    q.addBindValue(static_cast<qlonglong>(msg.id));
    q.addBindValue(static_cast<qlonglong>(msg.channelId));
    q.addBindValue(static_cast<qlonglong>(msg.authorId));
    q.addBindValue(msg.authorName);
    q.addBindValue(msg.text);
    q.addBindValue(msg.timestamp);
    return q.exec();
}

QList<CachedMessage> LocalDatabase::getMessages(int64_t channelId, int limit) {
    QSqlQuery q(m_db);
    q.prepare("SELECT id,channel_id,author_id,author_name,text,timestamp "
              "FROM messages WHERE channel_id=? ORDER BY timestamp DESC LIMIT ?");
    q.addBindValue(static_cast<qlonglong>(channelId));
    q.addBindValue(limit);
    q.exec();

    QList<CachedMessage> result;
    while (q.next()) {
        CachedMessage msg;
        msg.id         = q.value(0).toLongLong();
        msg.channelId  = q.value(1).toLongLong();
        msg.authorId   = q.value(2).toLongLong();
        msg.authorName = q.value(3).toString();
        msg.text       = q.value(4).toString();
        msg.timestamp  = q.value(5).toString();
        result.append(msg);
    }
    return result;
}

void LocalDatabase::clearChannel(int64_t channelId) {
    QSqlQuery q(m_db);
    q.prepare("DELETE FROM messages WHERE channel_id=?");
    q.addBindValue(static_cast<qlonglong>(channelId));
    q.exec();
}
