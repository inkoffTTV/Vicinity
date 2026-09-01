#pragma once
#include <QAbstractListModel>
#include <QDateTime>
#include <QList>
#include <cstdint>

struct ChatMessage {
    int64_t   id         = 0;
    int64_t   channelId  = 0;
    int64_t   authorId   = 0;
    QString   authorName;
    QString   text;
    QDateTime timestamp;
};

class ChatMessageModel : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ rowCount NOTIFY countChanged)

public:
    enum Roles {
        IdRole = Qt::UserRole + 1,
        AuthorIdRole,
        AuthorNameRole,
        TextRole,
        TimestampRole,
    };

    explicit ChatMessageModel(QObject* parent = nullptr);

    int rowCount(const QModelIndex& parent = {}) const override;
    QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;

    Q_INVOKABLE void addMessage(int64_t id, int64_t channelId, int64_t authorId,
                                const QString& authorName, const QString& text,
                                const QDateTime& timestamp);
    Q_INVOKABLE void clear();

signals:
    void countChanged();

private:
    QList<ChatMessage> m_messages;
};
