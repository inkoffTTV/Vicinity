#include "Messages.h"
#include "TextUtils.h"
#include <map>
#include <sstream>

namespace Messages {

// Текст цитаты ответа и последнего сообщения в списке чатов — не длиннее 200 символов
static constexpr size_t kPreviewLen = 200;

const std::string kColumns =
    "m.id, m.channel_id, m.author_id, u.display_name AS author_name, u.avatar_path AS author_avatar, "
    "m.text, m.created_at, m.edited, m.attachment, m.attachment_name, m.attachment_size, "
    "m.attachment_type, m.reply_to, "
    "rm.id AS reply_id, rm.author_id AS reply_author_id, ru.display_name AS reply_author_name, "
    "rm.text AS reply_text, rm.attachment AS reply_attachment";

const std::string kFrom =
    "messages m JOIN users u ON u.id = m.author_id "
    "LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id "
    "LEFT JOIN users ru ON ru.id = rm.author_id";

const std::string kLastColumns =
    "lm.id AS lm_id, lm.author_id AS lm_author_id, lu.display_name AS lm_author_name, "
    "lm.text AS lm_text, lm.attachment AS lm_attachment, lm.created_at AS lm_created_at";

const std::string kLastJoin =
    "LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE channel_id = c.id) "
    "LEFT JOIN users lu ON lu.id = lm.author_id";

static std::string str(const drogon::orm::Row& row, const char* col) {
    return row[col].isNull() ? std::string() : row[col].as<std::string>();
}

static Json::Int64 int64(const drogon::orm::Row& row, const char* col) {
    return row[col].isNull() ? 0 : static_cast<Json::Int64>(row[col].as<int64_t>());
}

Json::Value fromRow(const drogon::orm::Row& row) {
    Json::Value msg;
    msg["id"]            = int64(row, "id");
    msg["channel_id"]    = int64(row, "channel_id");
    msg["author_id"]     = int64(row, "author_id");
    msg["author_name"]   = str(row, "author_name");
    msg["author_avatar"] = str(row, "author_avatar");
    msg["text"]          = str(row, "text");
    msg["created_at"]    = str(row, "created_at");
    msg["edited"]        = row["edited"].as<int>() != 0;
    const std::string attachment = str(row, "attachment");
    msg["attachment"]      = attachment;
    msg["attachment_name"] = str(row, "attachment_name");
    msg["attachment_size"] = int64(row, "attachment_size");
    // Сообщения до появления метаданных: вложением могла быть только картинка
    msg["attachment_type"] = attachment.empty() ? std::string()
                             : row["attachment_type"].isNull() ? std::string("image")
                                                               : row["attachment_type"].as<std::string>();
    msg["reactions"] = Json::Value(Json::arrayValue);
    msg["reply_to"]  = int64(row, "reply_to");
    if (row["reply_id"].isNull()) {
        msg["reply"] = Json::Value(Json::nullValue);   // ответа нет или исходное удалено
    } else {
        Json::Value reply;
        reply["id"]          = int64(row, "reply_id");
        reply["author_id"]   = int64(row, "reply_author_id");
        reply["author_name"] = str(row, "reply_author_name");
        reply["text"]        = TextUtils::utf8Truncate(str(row, "reply_text"), kPreviewLen);
        reply["attachment"]  = str(row, "reply_attachment");
        msg["reply"] = reply;
    }
    return msg;
}

Json::Value lastFromRow(const drogon::orm::Row& row) {
    if (row["lm_id"].isNull()) return Json::Value(Json::nullValue);
    Json::Value last;
    last["id"]          = int64(row, "lm_id");
    last["author_id"]   = int64(row, "lm_author_id");
    last["author_name"] = str(row, "lm_author_name");
    last["text"]        = TextUtils::utf8Truncate(str(row, "lm_text"), kPreviewLen);
    last["attachment"]  = str(row, "lm_attachment");
    last["created_at"]  = str(row, "lm_created_at");
    return last;
}

// Одна строка агрегата реакций: {emoji, count, users:[ids]}
static Json::Value reactionEntry(const drogon::orm::Row& row) {
    Json::Value r;
    r["emoji"] = row["emoji"].as<std::string>();
    r["count"] = row["cnt"].as<int>();
    Json::Value users(Json::arrayValue);
    std::stringstream ss(row["uids"].as<std::string>());
    std::string tok;
    while (std::getline(ss, tok, ','))
        if (!tok.empty()) users.append(static_cast<Json::Int64>(std::stoll(tok)));
    r["users"] = users;
    return r;
}

Json::Value reactions(const drogon::orm::DbClientPtr& db, int64_t messageId) {
    Json::Value arr(Json::arrayValue);
    auto rows = db->execSqlSync(
        "SELECT emoji, COUNT(*) AS cnt, GROUP_CONCAT(user_id) AS uids "
        "FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY MIN(rowid)", messageId);
    for (const auto& row : rows) arr.append(reactionEntry(row));
    return arr;
}

void attachReactions(const drogon::orm::DbClientPtr& db, Json::Value& messages) {
    if (!messages.isArray() || messages.empty()) return;
    // Список id собираем из своих же целых чисел — подстановка в SQL безопасна
    std::string ids;
    for (const auto& m : messages) {
        if (!ids.empty()) ids += ',';
        ids += std::to_string(m["id"].asInt64());
    }
    auto rows = db->execSqlSync(
        "SELECT message_id, emoji, COUNT(*) AS cnt, GROUP_CONCAT(user_id) AS uids "
        "FROM reactions WHERE message_id IN (" + ids + ") "
        "GROUP BY message_id, emoji ORDER BY MIN(rowid)");
    std::map<int64_t, Json::Value> byMessage;
    for (const auto& row : rows) {
        auto& arr = byMessage[row["message_id"].as<int64_t>()];
        if (arr.isNull()) arr = Json::Value(Json::arrayValue);
        arr.append(reactionEntry(row));
    }
    for (auto& m : messages) {
        auto it = byMessage.find(m["id"].asInt64());
        if (it != byMessage.end()) m["reactions"] = it->second;
    }
}

Json::Value load(const drogon::orm::DbClientPtr& db, int64_t messageId) {
    auto rows = db->execSqlSync("SELECT " + kColumns + " FROM " + kFrom + " WHERE m.id = ?", messageId);
    if (rows.empty()) return Json::Value(Json::nullValue);
    Json::Value msg = fromRow(rows[0]);
    msg["reactions"] = reactions(db, messageId);
    return msg;
}

} // namespace Messages
