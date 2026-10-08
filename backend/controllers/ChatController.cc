#include "ChatController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../utils/Tiers.h"
#include "../utils/Uploads.h"
#include "../models/User.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <algorithm>
#include <optional>

using namespace drogon;
using HttpUtils::error;
using HttpUtils::accessError;
using HttpUtils::tooManyRequests;

// История канала: страница по умолчанию и максимум (docs/API.md §2)
static constexpr int64_t kPageDefault = 50;
static constexpr int64_t kPageMax     = 100;

// Текст сообщения: корректная UTF-8 и не длиннее MAX_MESSAGE_LEN символов (не байт)
static bool validText(const std::string& text) {
    return TextUtils::isValidUtf8(text) && TextUtils::utf8Length(text) <= Vicinity::MAX_MESSAGE_LEN;
}

void ChatController::listChannels(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    db->execSqlAsync(
        "SELECT c.id, c.type, c.name, c.created_at, c.owner_id, " + Messages::kLastColumns + " "
        "FROM channels c JOIN channel_members m ON c.id = m.channel_id " + Messages::kLastJoin + " "
        "WHERE m.user_id = ? AND c.type != 'dm' AND c.server_id IS NULL",
        [cb](const drogon::orm::Result& r) {
            Json::Value arr(Json::arrayValue);
            for (const auto& row : r) {
                Json::Value item;
                item["id"]           = static_cast<Json::Int64>(row["id"].as<int64_t>());
                item["type"]         = row["type"].as<std::string>();
                item["name"]         = row["name"].isNull() ? "" : row["name"].as<std::string>();
                item["created_at"]   = row["created_at"].as<std::string>();
                item["owner_id"]     = static_cast<Json::Int64>(row["owner_id"].isNull() ? 0 : row["owner_id"].as<int64_t>());
                item["last_message"] = Messages::lastFromRow(row);
                arr.append(item);
            }
            Json::Value resp;
            resp["channels"] = arr;
            cb(HttpUtils::json(std::move(resp)));
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
        cb(HttpUtils::json(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/channels/{id}/messages?limit=&before=|around= — страница истории, новые первыми
void ChatController::getMessages(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const int64_t limit  = std::clamp(HttpUtils::intParam(req, "limit", kPageDefault), int64_t{1}, kPageMax);
    const int64_t before = HttpUtils::intParam(req, "before");
    const int64_t around = HttpUtils::intParam(req, "around");
    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }

        // Порядок — по id (он монотонный); created_at с точностью до секунды путает соседние сообщения.
        // Каждой части берём на одно сообщение больше: так видно, есть ли за ней ещё.
        const std::string select =
            "SELECT " + Messages::kColumns + " FROM " + Messages::kFrom + " WHERE m.channel_id = ? ";
        Json::Value arr(Json::arrayValue);
        Json::Value resp;
        if (around > 0) {
            // Окно вокруг сообщения: до limit/2 новее, само сообщение, до limit/2 старше
            const int64_t half = limit / 2;
            auto newer  = db->execSqlSync(select + "AND m.id > ? ORDER BY m.id ASC LIMIT ?",
                                          channelId, around, half + 1);
            auto target = db->execSqlSync(select + "AND m.id = ?", channelId, around);
            auto older  = db->execSqlSync(select + "AND m.id < ? ORDER BY m.id DESC LIMIT ?",
                                          channelId, around, half + 1);
            const auto newerCount = std::min(newer.size(), static_cast<size_t>(half));
            for (size_t i = newerCount; i-- > 0;) arr.append(Messages::fromRow(newer[i]));
            for (const auto& row : target) arr.append(Messages::fromRow(row));
            for (size_t i = 0; i < older.size() && i < static_cast<size_t>(half); ++i)
                arr.append(Messages::fromRow(older[i]));
            resp["has_more"]  = older.size() > static_cast<size_t>(half);
            resp["has_newer"] = newer.size() > static_cast<size_t>(half);
        } else {
            auto rows = before > 0
                ? db->execSqlSync(select + "AND m.id < ? ORDER BY m.id DESC LIMIT ?", channelId, before, limit + 1)
                : db->execSqlSync(select + "ORDER BY m.id DESC LIMIT ?", channelId, limit + 1);
            for (size_t i = 0; i < rows.size() && i < static_cast<size_t>(limit); ++i)
                arr.append(Messages::fromRow(rows[i]));
            resp["has_more"] = rows.size() > static_cast<size_t>(limit);
        }
        Messages::attachReactions(db, arr);
        resp["messages"] = arr;
        cb(HttpUtils::json(std::move(resp)));
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
    int64_t     replyTo    = JsonUtils::getInt(*json, "reply_to");
    // Вложение — только файл, загруженный через /attachments, никакие внешние пути
    const std::string attachmentType = Uploads::attachmentType(attachment);
    if (!attachment.empty() && attachmentType.empty()) {
        cb(error("Invalid attachment", k400BadRequest)); return;
    }
    if ((text.empty() && attachment.empty()) || !validText(text)) {
        cb(error("Invalid message length", k400BadRequest)); return;
    }
    if (!TextUtils::isValidUtf8(nonce) || TextUtils::utf8Length(nonce) > Vicinity::MAX_NONCE_LEN) {
        cb(error("Invalid nonce", k400BadRequest)); return;
    }
    if (replyTo < 0) { cb(error("Invalid reply_to", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Message, userId)) {
            cb(tooManyRequests()); return;
        }
        // Отвечать можно только на сообщение этого же канала
        if (replyTo > 0 &&
            db->execSqlSync("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?", replyTo, channelId).empty()) {
            cb(error("Сообщение, на которое вы отвечаете, не найдено в этом канале", k400BadRequest)); return;
        }

        // Метаданные вложения: имя — от клиента, размер и тип — по самому загруженному файлу
        std::optional<std::string> attName, attType;
        std::optional<int64_t>     attSize, reply;
        if (!attachment.empty()) {
            attName = Uploads::cleanFileName(JsonUtils::getStr(*json, "attachment_name"));
            if (attName->empty()) attName = Uploads::downloadName(attachment);   // имя, запомненное при загрузке
            attSize = Uploads::fileSize(attachment);
            attType = attachmentType;
        }
        if (replyTo > 0) reply = replyTo;

        auto ins = db->execSqlSync(
            "INSERT INTO messages(channel_id, author_id, text, attachment, "
            "attachment_name, attachment_size, attachment_type, reply_to) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            channelId, userId, text, attachment, attName, attSize, attType, reply);
        Json::Value msg = Messages::load(db, ins[0]["id"].as<int64_t>());
        msg["nonce"] = nonce;

        // Рассылаем по WebSocket только тем, кто видит канал
        Json::Value ws = msg;
        ws["type"] = "new_message";
        Broadcast::toChannel(channelId, ws);

        Json::Value resp;
        resp["id"]         = msg["id"];
        resp["created_at"] = msg["created_at"];
        resp["status"]     = "sent";
        resp["nonce"]      = nonce;
        for (const char* key : {"reply_to", "reply", "attachment_url", "attachment_name", "attachment_size", "attachment_type"})
            resp[key] = msg[key];
        cb(HttpUtils::json(std::move(resp), k201Created));
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

        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?) RETURNING user_id",
            channelId, target);
        // Остальным участникам — новый состав; самому добавленному — беседа в списке
        if (!ins.empty()) {
            Json::Value joined;
            joined["type"]       = "channel_member_joined";
            joined["channel_id"] = static_cast<Json::Int64>(channelId);
            joined["user_id"]    = static_cast<Json::Int64>(target);
            Broadcast::toChannel(channelId, joined, target);
        }

        Json::Value ev;
        ev["type"]       = "channel_added";
        ev["channel_id"] = static_cast<Json::Int64>(channelId);
        ev["name"]       = ch[0]["name"].isNull() ? "" : ch[0]["name"].as<std::string>();
        Broadcast::toUser(target, ev);

        Json::Value resp; resp["status"] = "added"; resp["channel_id"] = static_cast<Json::Int64>(channelId);
        cb(HttpUtils::json(std::move(resp)));
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
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/channels/{id}/messages/{mid} — удалить своё сообщение
// (владелец сервера — любое сообщение в каналах своего сервера)
void ChatController::deleteMessage(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   int64_t channelId, int64_t msgId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        const bool serverOwner = info.serverId != 0 && Access::serverOwner(db, info.serverId) == userId;
        const bool pinned = !db->execSqlSync("SELECT 1 FROM pins WHERE message_id = ? AND channel_id = ?",
                                             msgId, channelId).empty();
        auto r = db->execSqlSync(
            "DELETE FROM messages WHERE id = ? AND channel_id = ? AND (author_id = ? OR ?) RETURNING id",
            msgId, channelId, userId, serverOwner ? 1 : 0);
        if (r.empty()) { cb(error("Можно удалять только свои сообщения", k403Forbidden)); return; }
        db->execSqlSync("DELETE FROM reactions WHERE message_id = ?", msgId);
        db->execSqlSync("DELETE FROM pins WHERE message_id = ?", msgId);

        Json::Value ws;
        ws["type"]       = "message_deleted";
        ws["channel_id"] = static_cast<Json::Int64>(channelId);
        ws["id"]         = static_cast<Json::Int64>(msgId);
        Broadcast::toChannel(channelId, ws);
        if (pinned) {
            Json::Value pins;
            pins["type"]       = "pins_updated";
            pins["channel_id"] = static_cast<Json::Int64>(channelId);
            Broadcast::toChannel(channelId, pins);
        }

        Json::Value resp; resp["status"] = "deleted";
        cb(HttpUtils::json(std::move(resp)));
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
        ws["reactions"]  = Messages::reactions(db, msgId);
        Broadcast::toChannel(channelId, ws);

        Json::Value resp;
        resp["status"]    = "ok";
        resp["reactions"] = ws["reactions"];
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/attachments (multipart, поле file) — картинка или файл
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
        const auto me = UserModel::findById(userId);
        auto saved = Uploads::saveAttachment(fileUpload.getFiles()[0],
                                             Tiers::uploadLimitBytes(me ? me->subscriptionTier : 0));
        if (!saved.error.empty()) { cb(error(saved.error, saved.code)); return; }

        Json::Value resp;
        resp["url"]  = saved.url;
        resp["name"] = saved.name;
        resp["size"] = static_cast<Json::Int64>(saved.size);
        resp["type"] = saved.type;
        cb(HttpUtils::json(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        LOG_ERROR << "uploadAttachment exception: " << e.what();
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    } catch (...) {
        LOG_ERROR << "uploadAttachment unknown exception";
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    }
}
