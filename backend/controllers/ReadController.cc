#include "ReadController.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include <drogon/drogon.h>
#include <algorithm>
#include <cctype>

using namespace drogon;
using HttpUtils::error;
using HttpUtils::accessError;

// Счётчики непрочитанного не больше этого числа (клиент показывает «999+»)
static constexpr int64_t kMaxUnread = 999;

static bool isLoginChar(unsigned char c) {
    return std::isalnum(c) || c == '_' || c == '.' || c == '-';
}

// Есть ли в тексте упоминание @login (без учёта регистра): не часть e-mail (перед @ нет букв)
// и не начало более длинного логина (@bob не упоминает bob.smith, а «@bob.» в конце фразы — упоминает)
static bool mentions(const std::string& text, const std::string& login) {
    std::string lower(text);
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const std::string needle = "@" + login;
    for (size_t pos = lower.find(needle); pos != std::string::npos; pos = lower.find(needle, pos + 1)) {
        if (pos > 0 && std::isalnum(static_cast<unsigned char>(lower[pos - 1]))) continue;
        const size_t end = pos + needle.size();
        if (end == lower.size()) return true;
        const auto next = static_cast<unsigned char>(lower[end]);
        if (!isLoginChar(next)) return true;
        const bool joiner = next == '.' || next == '-';
        if (joiner && (end + 1 == lower.size() || !isLoginChar(static_cast<unsigned char>(lower[end + 1]))))
            return true;
    }
    return false;
}

// POST /api/v1/channels/{id}/read {message_id} — прочитано до этого сообщения (только вперёд)
void ReadController::markRead(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb,
                              int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    int64_t msgId = JsonUtils::getInt(*json, "message_id");
    if (msgId <= 0) { cb(error("Неверное сообщение", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        // Не дальше последнего сообщения канала — иначе будущие сообщения сразу оказались бы прочитанными
        auto mx = db->execSqlSync("SELECT MAX(id) AS max_id FROM messages WHERE channel_id = ?", channelId);
        const int64_t maxId = mx.empty() || mx[0]["max_id"].isNull() ? 0 : mx[0]["max_id"].as<int64_t>();
        const int64_t target = std::min(msgId, maxId);

        bool advanced = false;
        if (target > 0) {
            auto up = db->execSqlSync(
                "INSERT INTO channel_reads(user_id, channel_id, last_read_id) VALUES(?, ?, ?) "
                "ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id "
                "WHERE excluded.last_read_id > channel_reads.last_read_id RETURNING last_read_id",
                userId, channelId, target);
            advanced = !up.empty();
        }
        auto cur = db->execSqlSync("SELECT last_read_id FROM channel_reads WHERE user_id = ? AND channel_id = ?",
                                   userId, channelId);
        const int64_t lastRead = cur.empty() ? 0 : cur[0]["last_read_id"].as<int64_t>();

        Json::Value resp;
        resp["channel_id"]   = static_cast<Json::Int64>(channelId);
        resp["last_read_id"] = static_cast<Json::Int64>(lastRead);
        if (advanced) {
            // Остальные вкладки и устройства пользователя снимают отметку непрочитанного
            Json::Value ev = resp;
            ev["type"] = "read_state";
            Broadcast::toUser(userId, ev);
        }
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/unread — каналы с непрочитанными сообщениями других пользователей
void ReadController::unread(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto me = db->execSqlSync("SELECT username FROM users WHERE id = ?", userId);
        if (me.empty()) { cb(error("User not found", k404NotFound)); return; }
        std::string login = me[0]["username"].as<std::string>();
        std::transform(login.begin(), login.end(), login.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        const std::string mentionLike = "%@" + TextUtils::escapeLike(login) + "%";

        auto chans = db->execSqlSync(
            "SELECT a.channel_id, COALESCE(r.last_read_id, 0) AS last_read, "
            "       (SELECT MAX(id) FROM messages WHERE channel_id = a.channel_id) AS last_id "
            "FROM (" + std::string(Access::kAccessibleChannels) + ") a "
            "LEFT JOIN channel_reads r ON r.user_id = ? AND r.channel_id = a.channel_id",
            userId, userId, userId);

        Json::Value arr(Json::arrayValue);
        for (const auto& ch : chans) {
            if (ch["last_id"].isNull()) continue;
            const int64_t channelId = ch["channel_id"].as<int64_t>();
            const int64_t lastRead  = ch["last_read"].as<int64_t>();
            const int64_t lastId    = ch["last_id"].as<int64_t>();
            if (lastId <= lastRead) continue;

            auto cnt = db->execSqlSync(
                "SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages "
                "WHERE channel_id = ? AND id > ? AND author_id != ? LIMIT ?)",
                channelId, lastRead, userId, kMaxUnread);
            const int64_t unreadCount = cnt[0]["n"].as<int64_t>();
            if (unreadCount == 0) continue;   // новое — только своё

            // LIKE отбирает кандидатов, границы упоминания проверяются здесь
            auto texts = db->execSqlSync(
                "SELECT text FROM messages WHERE channel_id = ? AND id > ? AND author_id != ? "
                "AND text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?",
                channelId, lastRead, userId, mentionLike, kMaxUnread);
            int64_t mentionCount = 0;
            for (const auto& t : texts)
                if (mentions(t["text"].as<std::string>(), login)) ++mentionCount;

            Json::Value item;
            item["channel_id"]      = static_cast<Json::Int64>(channelId);
            item["unread"]          = static_cast<Json::Int64>(unreadCount);
            item["mentions"]        = static_cast<Json::Int64>(mentionCount);
            item["last_message_id"] = static_cast<Json::Int64>(lastId);
            arr.append(item);
        }
        Json::Value resp;
        resp["channels"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
