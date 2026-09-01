#include "ChatMessageModel.h"

ChatMessageModel::ChatMessageModel(QObject* parent) : QAbstractListModel(parent) {}

int ChatMessageModel::rowCount(const QModelIndex& parent) const {
    if (parent.isValid()) return 0;
    return static_cast<int>(m_messages.size());
}

QVariant ChatMessageModel::data(const QModelIndex& index, int role) const {
    if (!index.isValid() || index.row() >= m_messages.size()) return {};
    const auto& msg = m_messages[index.row()];
    switch (role) {
        case IdRole:         return static_cast<qlonglong>(msg.id);
        case AuthorIdRole:   return static_cast<qlonglong>(msg.authorId);
        case AuthorNameRole: return msg.authorName;
        case TextRole:       return msg.text;
        case TimestampRole:  return msg.timestamp;
        default:             return {};
    }
}

QHash<int, QByteArray> ChatMessageModel::roleNames() const {
    return {
        {IdRole,         "msgId"},
        {AuthorIdRole,   "authorId"},
        {AuthorNameRole, "authorName"},
        {TextRole,       "text"},
        {TimestampRole,  "timestamp"},
    };
}

void ChatMessageModel::addMessage(int64_t id, int64_t channelId, int64_t authorId,
                                  const QString& authorName, const QString& text,
                                  const QDateTime& timestamp) {
    beginInsertRows({}, m_messages.size(), m_messages.size());
    m_messages.append({id, channelId, authorId, authorName, text, timestamp});
    endInsertRows();
    emit countChanged();
}

void ChatMessageModel::clear() {
    beginResetModel();
    m_messages.clear();
    endResetModel();
    emit countChanged();
}
