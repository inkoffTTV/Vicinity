#include "ChatController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include "../utils/Uploads.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <sstream>
#include <map>

using namespace drogon;

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto resp = HttpResponse::newHttpJsonResponse(std::move(body));
    resp->setStatusCode(code);
    return resp;
}

static HttpResponsePtr error(const std::string& msg, HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    return jsonResp(std::move(v), code);
}

// Нет доступа к каналу (docs/API.md §1): канала нет — 404, чужой канал — 403
static HttpResponsePtr accessError(Access::Result r) {
    return r == Access::Result::NotFound ? error("Канал не найден", k404NotFound)
                                         : error("Нет доступа к каналу", k403Forbidden);
}

static HttpResponsePtr tooManyRequests() {
    return error("Слишком часто, попробуйте позже", k429TooManyRequests);
}

// Текст сообщения: корректная UTF-8 и не длиннее MAX_MESSAGE_LEN символов (не байт)
static bool validText(const std::string& text) {
    return TextUtils::isValidUtf8(text) && TextUtils::utf8Length(text) <= Vicinity::MAX_MESSAGE_LEN;
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

// Агрегат реакций одного сообщения: [{emoji, count, users:[ids]}]
static Json::Value reactionsJson(const drogon::orm::DbClientPtr& db, int64_t msgId) {
    Json::Value arr(Json::arrayValue);
    auto rows = db->execSqlSync(
        "SELECT emoji, COUNT(*) AS cnt, GROUP_CONCAT(user_id) AS uids "
        "FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY MIN(rowid)", msgId);
    for (const auto& row : rows) arr.append(reactionEntry(row));
    return arr;
}

// Реакции сообщений канала с id в [minId, maxId] — одним запросом: message_id -> массив
static std::map<int64_t, Json::Value> reactionsInRange(const drogon::orm::DbClientPtr& db,
                                                       int64_t channelId, int64_t minId, int64_t maxId) {
    std::map<int64_t, Json::Value> out;
    auto rows = db->execSqlSync(
        "SELECT r.message_id, r.emoji, COUNT(*) AS cnt, GROUP_CONCAT(r.user_id) AS uids "
        "FROM reactions r JOIN messages m ON m.id = r.message_id "
        "WHERE m.channel_id = ? AND m.id BETWEEN ? AND ? "
        "GROUP BY r.message_id, r.emoji ORDER BY MIN(r.rowid)",
        channelId, minId, maxId);
    for (const auto& row : rows) {
        auto& arr = out[row["message_id"].as<int64_t>()];
        if (arr.isNull()) arr = Json::Value(Json::arrayValue);
        arr.append(reactionEntry(row));
    }
    return out;
}

void ChatController::listChannels(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    db->execSqlAsync(
        "SELECT c.id, c.type, c.name, c.created_at FROM channels c "
        "JOIN channel_members m ON c.id = m.channel_id "
        "WHERE m.user_id = ? AND c.type != 'dm' AND c.server_id IS NULL",
        [cb](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value item;
                item["id"]         = static_cast<Json::Int64>(row["id"].as<int64_t>());
                item["type"]       = row["type"].as<std::string>();
                item["name"]       = row["name"].isNull() ? "" : row["name"].as<std::string>();
                item["created_at"] = row["created_at"].as<std::string>();
                arr.append(item);
            }
            Json::Value resp;
            resp["channels"] = arr;
            cb(jsonResp(std::move(resp)));
        },
        [cb](const drogon::orm::DrogonDbException& e) {
            cb(error(e.base().what(), k500InternalServerError));
        },
        userId);
}

void ChatController::createChannel(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string type = JsonUtils::getStr(*json, "type", "group");
    // Лички создаёт только POST /dms: иначе можно подсунуть «личку» двум людям и читать её
    if (type == "dm") {
        cb(error("Личная переписка создаётся через /dms", k400BadRequest)); return;
    }
    if (type != "group" && type != "channel") {
        cb(error("type must be group or channel", k400BadRequest)); return;
    }
    auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), Vicinity::MAX_NAME_LEN);
    if (!name) {
        cb(error("Название беседы — от 1 до 64 символов", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        auto ins = db->execSqlSync(
            "INSERT INTO channels(type, name, owner_id) VALUES(?, ?, ?) RETURNING id",
            type, *name, userId);
        int64_t channelId = ins[0]["id"].as<int64_t>();
        db->execSqlSync("INSERT INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                        channelId, userId);
        Json::Value resp;
        resp["channel_id"] = static_cast<Json::Int64>(channelId);
        resp["status"] = "created";
        cb(jsonResp(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

void ChatController::getMessages(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }

        // Порядок — по id (он монотонный); created_at с точностью до секунды путает соседние сообщения
        auto r = db->execSqlSync(
            "SELECT m.id, m.author_id, u.display_name, u.avatar_path, m.text, m.created_at, "
            "m.edited, m.attachment "
            "FROM messages m JOIN users u ON m.author_id = u.id "
            "WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT 50", channelId);
        std::map<int64_t, Json::Value> reactions;
        if (!r.empty())
            reactions = reactionsInRange(db, channelId, r[r.size() - 1]["id"].as<int64_t>(),
                                         r[0]["id"].as<int64_t>());
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) {
            const int64_t id = row["id"].as<int64_t>();
            Json::Value msg;
            msg["id"]            = static_cast<Json::Int64>(id);
            msg["channel_id"]    = static_cast<Json::Int64>(channelId);
            msg["author_id"]     = static_cast<Json::Int64>(row["author_id"].as<int64_t>());
            msg["author_name"]   = row["display_name"].as<std::string>();
            msg["author_avatar"] = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            msg["text"]          = row["text"].as<std::string>();
            msg["created_at"]    = row["created_at"].as<std::string>();
            msg["edited"]        = row["edited"].as<int>() != 0;
            msg["attachment"]    = row["attachment"].isNull() ? "" : row["attachment"].as<std::string>();
            auto rx = reactions.find(id);
            msg["reactions"]     = rx != reactions.end() ? rx->second : Json::Value(Json::arrayValue);
            arr.append(msg);
        }
        Json::Value resp;
        resp["messages"] = arr;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

void ChatController::sendMessage(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string text       = JsonUtils::getStr(*json, "text");
    std::string attachment = JsonUtils::getStr(*json, "attachment");
    // nonce — метка клиента для сопоставления своего сообщения с WS-событием, возвращается как есть
    std::string nonce      = JsonUtils::getStr(*json, "nonce");
    // Вложение — только файл, загруженный через /attachments, никакие внешние пути
    if (!attachment.empty() && !Uploads::isUploadUrl(attachment, "attachments")) {
        cb(error("Invalid attachment", k400BadRequest)); return;
    }
    if ((text.empty() && attachment.empty()) || !validText(text)) {
        cb(error("Invalid message length", k400BadRequest)); return;
    }
    if (!TextUtils::isValidUtf8(nonce) || TextUtils::utf8Length(nonce) > Vicinity::MAX_NONCE_LEN) {
        cb(error("Invalid nonce", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Message, userId)) {
            cb(tooManyRequests()); return;
        }

        auto ins = db->execSqlSync(
            "INSERT INTO messages(channel_id, author_id, text, attachment) VALUES(?, ?, ?, ?) "
            "RETURNING id, created_at",
            channelId, userId, text, attachment);
        int64_t     msgId     = ins[0]["id"].as<int64_t>();
        std::string createdAt = ins[0]["created_at"].as<std::string>();

        // Имя + аватар автора для отображения у получателей
        std::string authorName, authorAvatar;
        auto urow = db->execSqlSync("SELECT display_name, avatar_path FROM users WHERE id = ?", userId);
        if (!urow.empty()) {
            authorName = urow[0]["display_name"].as<std::string>();
            if (!urow[0]["avatar_path"].isNull()) authorAvatar = urow[0]["avatar_path"].as<std::string>();
        }

        // Рассылаем по WebSocket только участникам канала
        Json::Value ws;
        ws["type"]          = "new_message";
        ws["id"]            = static_cast<Json::Int64>(msgId);
        ws["channel_id"]    = static_cast<Json::Int64>(channelId);
        ws["author_id"]     = static_cast<Json::Int64>(userId);
        ws["author_name"]   = authorName;
        ws["author_avatar"] = authorAvatar;
        ws["text"]          = text;
        ws["attachment"]    = attachment;
        ws["created_at"]    = createdAt;
        ws["nonce"]         = nonce;
        Broadcast::toChannel(channelId, ws);

        Json::Value resp;
        resp["id"]         = static_cast<Json::Int64>(msgId);
        resp["created_at"] = createdAt;
        resp["status"]     = "sent";
        resp["nonce"]      = nonce;
        cb(jsonResp(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/members  {user_id} — добавить пользователя в беседу
void ChatController::addMember(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb,
                               int64_t channelId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    int64_t target = JsonUtils::getInt(*json, "user_id");
    if (target <= 0) { cb(error("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto ch = db->execSqlSync("SELECT type, name, server_id FROM channels WHERE id = ?", channelId);
        if (ch.empty()) { cb(error("Канал не найден", k404NotFound)); return; }
        // Серверные каналы — доступ через участие в сервере, не через channel_members
        if (!ch[0]["server_id"].isNull()) {
            cb(error("Это канал сервера — добавляйте людей на сервер", k400BadRequest)); return;
        }
        // Личка — только для двоих: третий увидел бы чужую переписку
        if (ch[0]["type"].as<std::string>() == "dm") {
            cb(error("В личную переписку нельзя добавить участника", k400BadRequest)); return;
        }
        // Только участник беседы может добавлять
        auto mem = db->execSqlSync(
            "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1", channelId, self);
        if (mem.empty()) { cb(error("Вы не участник этой беседы", k403Forbidden)); return; }
        auto u = db->execSqlSync("SELECT id FROM users WHERE id = ?", target);
        if (u.empty()) { cb(error("Пользователь не найден", k404NotFound)); return; }

        db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                        channelId, target);

        Json::Value ev;
        ev["type"]       = "channel_added";
        ev["channel_id"] = static_cast<Json::Int64>(channelId);
        ev["name"]       = ch[0]["name"].isNull() ? "" : ch[0]["name"].as<std::string>();
        Broadcast::toUser(target, ev);

        Json::Value resp; resp["status"] = "added"; resp["channel_id"] = static_cast<Json::Int64>(channelId);
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/messages/{mid}/edit {text} — редактировать СВОЁ сообщение
void ChatController::editMessage(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId, int64_t msgId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string text = JsonUtils::getStr(*json, "text");
    if (text.empty() || !validText(text)) {
        cb(error("Invalid message length", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
        // Исключённый с сервера не правит сообщения в его каналах
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        auto r = db->execSqlSync(
            "UPDATE messages SET text = ?, edited = 1 "
            "WHERE id = ? AND channel_id = ? AND author_id = ? RETURNING id",
            text, msgId, channelId, userId);
        if (r.empty()) { cb(error("Можно редактировать только свои сообщения", k403Forbidden)); return; }

        Json::Value ws;
        ws["type"]       = "message_edited";
        ws["channel_id"] = static_cast<Json::Int64>(channelId);
        ws["id"]         = static_cast<Json::Int64>(msgId);
        ws["text"]       = text;
        Broadcast::toChannel(channelId, ws);

        Json::Value resp; resp["status"] = "edited";
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/channels/{id}/messages/{mid} — удалить СВОЁ сообщение
void ChatController::deleteMessage(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   int64_t channelId, int64_t msgId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        auto r = db->execSqlSync(
            "DELETE FROM messages WHERE id = ? AND channel_id = ? AND author_id = ? RETURNING id",
            msgId, channelId, userId);
        if (r.empty()) { cb(error("Можно удалять только свои сообщения", k403Forbidden)); return; }
        db->execSqlSync("DELETE FROM reactions WHERE message_id = ?", msgId);

        Json::Value ws;
        ws["type"]       = "message_deleted";
        ws["channel_id"] = static_cast<Json::Int64>(channelId);
        ws["id"]         = static_cast<Json::Int64>(msgId);
        Broadcast::toChannel(channelId, ws);

        Json::Value resp; resp["status"] = "deleted";
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/messages/{mid}/react {emoji} — переключить свою реакцию
void ChatController::toggleReaction(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb,
                                    int64_t channelId, int64_t msgId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string emoji = JsonUtils::getStr(*json, "emoji");
    // Эмодзи может состоять из нескольких символов (ZWJ-последовательности, флаги, оттенки кожи)
    if (emoji.empty() || emoji.size() > 64 || !TextUtils::isValidUtf8(emoji) ||
        TextUtils::utf8Length(emoji) > 16 || TextUtils::hasControlChars(emoji)) {
        cb(error("Invalid emoji", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        auto m = db->execSqlSync("SELECT id FROM messages WHERE id = ? AND channel_id = ?",
                                 msgId, channelId);
        if (m.empty()) { cb(error("Сообщение не найдено", k404NotFound)); return; }

        // Toggle: было — снять, не было — поставить
        auto del = db->execSqlSync(
            "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ? RETURNING rowid",
            msgId, userId, emoji);
        if (del.empty())
            db->execSqlSync("INSERT OR IGNORE INTO reactions(message_id, user_id, emoji) VALUES(?, ?, ?)",
                            msgId, userId, emoji);

        Json::Value ws;
        ws["type"]       = "reaction_update";
        ws["channel_id"] = static_cast<Json::Int64>(channelId);
        ws["message_id"] = static_cast<Json::Int64>(msgId);
        ws["reactions"]  = reactionsJson(db, msgId);
        Broadcast::toChannel(channelId, ws);

        Json::Value resp;
        resp["status"]    = "ok";
        resp["reactions"] = ws["reactions"];
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/attachments (multipart, поле file) — картинка-вложение
void ChatController::uploadAttachment(const HttpRequestPtr& req,
                                      std::function<void(const HttpResponsePtr&)>&& cb,
                                      int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {   // защита от падения сервера на кривом файле/диске
        auto acc = Access::channel(app().getDbClient(), channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Upload, userId)) {
            cb(tooManyRequests()); return;
        }

        MultiPartParser fileUpload;
        if (fileUpload.parse(req) != 0 || fileUpload.getFiles().empty()) {
            cb(error("Invalid file upload", k400BadRequest)); return;
        }
        auto saved = Uploads::saveImage(fileUpload.getFiles()[0], "attachments");
        if (!saved.error.empty()) { cb(error(saved.error, saved.code)); return; }

        Json::Value resp;
        resp["url"] = saved.url;
        cb(jsonResp(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        LOG_ERROR << "uploadAttachment exception: " << e.what();
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    } catch (...) {
        LOG_ERROR << "uploadAttachment unknown exception";
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    }
}
