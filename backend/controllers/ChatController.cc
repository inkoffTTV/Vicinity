#include "ChatController.h"
#include "../managers/WSManager.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <sstream>
#include <filesystem>
#include <algorithm>
#include <cctype>

namespace fs = std::filesystem;

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

// Рассылка WS-события всем получателям канала:
// участникам сервера (серверные каналы) или участникам беседы (лички/группы).
static void broadcastToChannel(int64_t channelId, const Json::Value& ws) {
    auto db = app().getDbClient();
    Json::FastWriter fw;
    const std::string payload = fw.write(ws);
    auto chRow = db->execSqlSync("SELECT server_id FROM channels WHERE id = ?", channelId);
    bool hasServer = !chRow.empty() && !chRow[0]["server_id"].isNull();
    auto members = hasServer
        ? db->execSqlSync("SELECT user_id FROM server_members WHERE server_id = ?",
                          chRow[0]["server_id"].as<int64_t>())
        : db->execSqlSync("SELECT user_id FROM channel_members WHERE channel_id = ?", channelId);
    for (const auto& m : members)
        WSManager::instance().sendToUser(m["user_id"].as<int64_t>(), payload);
}

// Агрегат реакций одного сообщения: [{emoji, count, users:[ids]}]
static Json::Value reactionsJson(const drogon::orm::DbClientPtr& db, int64_t msgId) {
    Json::Value arr(Json::arrayValue);
    auto rows = db->execSqlSync(
        "SELECT emoji, COUNT(*) AS cnt, GROUP_CONCAT(user_id) AS uids "
        "FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY MIN(rowid)", msgId);
    for (const auto& row : rows) {
        Json::Value r;
        r["emoji"] = row["emoji"].as<std::string>();
        r["count"] = row["cnt"].as<int>();
        Json::Value users(Json::arrayValue);
        std::stringstream ss(row["uids"].as<std::string>());
        std::string tok;
        while (std::getline(ss, tok, ','))
            if (!tok.empty()) users.append(static_cast<Json::Int64>(std::stoll(tok)));
        r["users"] = users;
        arr.append(r);
    }
    return arr;
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
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string type = (*json).get("type", "group").asString();
    std::string name = (*json).get("name", "").asString();

    if (type != "dm" && type != "group" && type != "channel") {
        cb(error("type must be dm, group, or channel", k400BadRequest)); return;
    }
    if (name.empty()) {
        cb(error("name is required", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    db->execSqlAsync(
        "INSERT INTO channels(type, name, owner_id) VALUES(?, ?, ?) RETURNING id",
        [cb, db, userId](const drogon::orm::Result& r) {
            int64_t channelId = r[0]["id"].as<int64_t>();
            db->execSqlAsync(
                "INSERT INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                [cb, channelId](const drogon::orm::Result&) {
                    Json::Value resp;
                    resp["channel_id"] = static_cast<Json::Int64>(channelId);
                    resp["status"] = "created";
                    cb(jsonResp(std::move(resp), k201Created));
                },
                [cb](const drogon::orm::DrogonDbException& e) {
                    cb(error(e.base().what(), k500InternalServerError));
                },
                channelId, userId);
        },
        [cb](const drogon::orm::DrogonDbException& e) {
            cb(error(e.base().what(), k500InternalServerError));
        },
        type, name, userId);
}

void ChatController::getMessages(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId) {
    auto db = app().getDbClient();
    try {
        auto r = db->execSqlSync(
            "SELECT m.id, m.author_id, u.display_name, u.avatar_path, m.text, m.created_at, "
            "m.edited, m.attachment "
            "FROM messages m JOIN users u ON m.author_id = u.id "
            "WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT 50", channelId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) {
            Json::Value msg;
            msg["id"]            = static_cast<Json::Int64>(row["id"].as<int64_t>());
            msg["author_id"]     = static_cast<Json::Int64>(row["author_id"].as<int64_t>());
            msg["author_name"]   = row["display_name"].as<std::string>();
            msg["author_avatar"] = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            msg["text"]          = row["text"].as<std::string>();
            msg["created_at"]    = row["created_at"].as<std::string>();
            msg["edited"]        = row["edited"].as<int>() != 0;
            msg["attachment"]    = row["attachment"].isNull() ? "" : row["attachment"].as<std::string>();
            msg["reactions"]     = reactionsJson(db, row["id"].as<int64_t>());
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
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string text       = (*json)["text"].asString();
    std::string attachment = (*json).get("attachment", "").asString();
    // Вложение — только наш загруженный файл, никакие внешние пути
    if (!attachment.empty() && attachment.rfind("/uploads/attachments/", 0) != 0) {
        cb(error("Invalid attachment", k400BadRequest)); return;
    }
    if ((text.empty() && attachment.empty()) || text.size() > Vicinity::MAX_MESSAGE_LEN) {
        cb(error("Invalid message length", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
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
        broadcastToChannel(channelId, ws);

        Json::Value resp;
        resp["id"]         = static_cast<Json::Int64>(msgId);
        resp["created_at"] = createdAt;
        resp["status"]     = "sent";
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
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }
    int64_t target = (*json)["user_id"].asInt64();
    if (target == 0) { cb(error("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto ch = db->execSqlSync("SELECT type, name, server_id FROM channels WHERE id = ?", channelId);
        if (ch.empty()) { cb(error("Канал не найден", k404NotFound)); return; }
        // Серверные каналы — доступ через участие в сервере, не через channel_members
        if (!ch[0]["server_id"].isNull()) {
            cb(error("Это канал сервера — добавляйте людей на сервер", k400BadRequest)); return;
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
        Json::FastWriter fw;
        WSManager::instance().sendToUser(target, fw.write(ev));

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
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string text = (*json)["text"].asString();
    if (text.empty() || text.size() > Vicinity::MAX_MESSAGE_LEN) {
        cb(error("Invalid message length", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
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
        broadcastToChannel(channelId, ws);

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
        auto r = db->execSqlSync(
            "DELETE FROM messages WHERE id = ? AND channel_id = ? AND author_id = ? RETURNING id",
            msgId, channelId, userId);
        if (r.empty()) { cb(error("Можно удалять только свои сообщения", k403Forbidden)); return; }
        db->execSqlSync("DELETE FROM reactions WHERE message_id = ?", msgId);

        Json::Value ws;
        ws["type"]       = "message_deleted";
        ws["channel_id"] = static_cast<Json::Int64>(channelId);
        ws["id"]         = static_cast<Json::Int64>(msgId);
        broadcastToChannel(channelId, ws);

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
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string emoji = (*json)["emoji"].asString();
    if (emoji.empty() || emoji.size() > 16) { cb(error("Invalid emoji", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
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
        broadcastToChannel(channelId, ws);

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
                                      int64_t /*channelId*/) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {   // защита от падения сервера на кривом файле/диске
        MultiPartParser fileUpload;
        if (fileUpload.parse(req) != 0 || fileUpload.getFiles().empty()) {
            cb(error("Invalid file upload", k400BadRequest)); return;
        }
        const auto& file = fileUpload.getFiles()[0];

        // getFileExtension() возвращает расширение БЕЗ точки
        std::string ext = std::string(file.getFileExtension());
        std::transform(ext.begin(), ext.end(), ext.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        if (ext != "gif" && ext != "png" && ext != "jpg" && ext != "jpeg") {
            cb(error("Only GIF, PNG, JPG allowed", k415UnsupportedMediaType)); return;
        }
        if (file.fileLength() > 15 * 1024 * 1024) {
            cb(error("Файл слишком большой (макс 15 МБ)", k413RequestEntityTooLarge)); return;
        }
        // Сигнатура файла (magic bytes), а не только расширение
        {
            std::string_view content = file.fileContent();
            bool okSig = false;
            if (content.size() >= 4) {
                const auto* b = reinterpret_cast<const unsigned char*>(content.data());
                bool isPng  = (b[0]==0x89 && b[1]==0x50 && b[2]==0x4E && b[3]==0x47);
                bool isGif  = (b[0]==0x47 && b[1]==0x49 && b[2]==0x46 && b[3]==0x38);
                bool isJpeg = (b[0]==0xFF && b[1]==0xD8 && b[2]==0xFF);
                okSig = isPng || isGif || isJpeg;
            }
            if (!okSig) { cb(error("File is not a valid image", k415UnsupportedMediaType)); return; }
        }

        fs::create_directories("uploads/attachments");
        std::string fileName = "msg_" + std::to_string(userId) + "_" +
                               std::to_string(trantor::Date::now().microSecondsSinceEpoch()) +
                               "." + ext;
        // saveAs() пишет относительно upload_path (./uploads) — только под-путь!
        file.saveAs("attachments/" + fileName);

        Json::Value resp;
        resp["url"] = "/uploads/attachments/" + fileName;
        cb(jsonResp(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        LOG_ERROR << "uploadAttachment exception: " << e.what();
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    } catch (...) {
        LOG_ERROR << "uploadAttachment unknown exception";
        cb(error("Не удалось загрузить файл", k500InternalServerError));
    }
}
