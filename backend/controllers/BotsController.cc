#include "BotsController.h"
#include "../managers/UserRateLimiter.h"
#include "../models/Cascade.h"
#include "../utils/Access.h"
#include "../utils/Bots.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <algorithm>
#include <cctype>

using namespace drogon;
using HttpUtils::error;

namespace {

constexpr int kMaxBotsPerOwner = 10;
constexpr size_t kMaxDescription = 512;

int64_t uid(const HttpRequestPtr& req) { return req->attributes()->get<int64_t>("user_id"); }

// Бот этого владельца; иначе ответ 404
HttpResponsePtr ownBot(const orm::DbClientPtr& db, int64_t botId, int64_t owner) {
    if (db->execSqlSync("SELECT 1 FROM bots WHERE user_id = ? AND owner_id = ?", botId, owner).empty())
        return error("Бот не найден", k404NotFound);
    return nullptr;
}

HttpResponsePtr ownerOnly(const orm::DbClientPtr& db, int64_t serverId, int64_t userId) {
    const int64_t owner = Access::serverOwner(db, serverId);
    if (owner == 0) return error("Сервер не найден", k404NotFound);
    if (owner != userId) return error("Только владелец сервера может это сделать", k403Forbidden);
    return nullptr;
}

void memberEvent(const char* type, int64_t serverId, int64_t userId) {
    Json::Value ev;
    ev["type"]      = type;
    ev["server_id"] = static_cast<Json::Int64>(serverId);
    ev["user_id"]   = static_cast<Json::Int64>(userId);
    Broadcast::toServer(serverId, ev);
}

Json::Value shortBot(const orm::Row& r) {
    Json::Value b;
    b["id"]           = static_cast<Json::Int64>(r["id"].as<int64_t>());
    b["username"]     = r["username"].as<std::string>();
    b["display_name"] = r["display_name"].as<std::string>();
    b["avatar_path"]  = r["avatar_path"].isNull() ? std::string() : r["avatar_path"].as<std::string>();
    b["description"]  = r["description"].isNull() ? std::string() : r["description"].as<std::string>();
    return b;
}

} // namespace

// GET /api/v1/bots — мои боты
void BotsController::list(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto db = app().getDbClient();
    try {
        Json::Value arr(Json::arrayValue);
        for (const auto& r : db->execSqlSync("SELECT user_id FROM bots WHERE owner_id = ? ORDER BY user_id", uid(req)))
            arr.append(Bots::botObject(db, r["user_id"].as<int64_t>()));
        Json::Value resp;
        resp["bots"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/bots {username, display_name} → 201 {bot, token}; токен показывается один раз
void BotsController::create(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = uid(req);
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string username = TextUtils::trim(JsonUtils::getStr(*json, "username"));
    if (!username.empty() && username[0] == '@') username.erase(0, 1);
    std::transform(username.begin(), username.end(), username.begin(), [](unsigned char c) { return std::tolower(c); });
    if (const std::string why = Bots::usernameProblem(username); !why.empty()) { cb(error(why, k400BadRequest)); return; }
    std::string rawName = JsonUtils::getStr(*json, "display_name");
    if (TextUtils::trim(rawName).empty()) rawName = username;
    auto name = TextUtils::cleanName(rawName, Vicinity::MAX_DISPLAY_NAME_LEN);
    if (!name) { cb(error("Имя бота — от 1 до 32 символов", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        if (Bots::isBot(db, self)) { cb(error("Бот не может создавать ботов", k403Forbidden)); return; }
        auto count = db->execSqlSync("SELECT COUNT(*) AS n FROM bots WHERE owner_id = ?", self);
        if (count[0]["n"].as<int>() >= kMaxBotsPerOwner) {
            cb(error("Можно создать не больше 10 ботов — удалите ненужного", k400BadRequest)); return;
        }
        if (!db->execSqlSync("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", username).empty()) {
            cb(error("Имя @" + username + " уже занято", k409Conflict)); return;
        }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::ChannelCreate, self)) {
            cb(HttpUtils::tooManyRequests()); return;
        }
        auto tr = db->newTransaction();
        int64_t botId = 0;
        Bots::Token token;
        try {
            // Пароль '!' не подходит ни под один формат хэша — войти паролем нельзя
            auto ins = tr->execSqlSync(
                "INSERT INTO users(username, password_hash, display_name, is_bot) VALUES(?, '!', ?, 1) RETURNING id",
                username, *name);
            botId = ins[0]["id"].as<int64_t>();
            token = Bots::newToken(botId);
            tr->execSqlSync("INSERT INTO bots(user_id, owner_id, token_hash, token_hint) VALUES(?, ?, ?, ?)",
                            botId, self, token.hash, token.hint);
        } catch (...) {
            tr->rollback();
            throw;
        }
        tr.reset();   // фиксируем транзакцию до чтения через общий клиент
        Json::Value resp;
        resp["bot"]   = Bots::botObject(db, botId);
        resp["token"] = token.token;
        cb(HttpUtils::json(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// PATCH /api/v1/bots/{id} {display_name?, description?, read_all?}
void BotsController::update(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        bool renamed = false;
        if (JsonUtils::has(*json, "display_name")) {
            auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "display_name"), Vicinity::MAX_DISPLAY_NAME_LEN);
            if (!name) { cb(error("Имя бота — от 1 до 32 символов", k400BadRequest)); return; }
            db->execSqlSync("UPDATE users SET display_name = ? WHERE id = ?", *name, id);
            renamed = true;
        }
        if (JsonUtils::has(*json, "description")) {
            std::string d = TextUtils::trim(JsonUtils::getStr(*json, "description"));
            if (!TextUtils::isValidUtf8(d) || TextUtils::utf8Length(d) > kMaxDescription || TextUtils::hasControlChars(d, true)) {
                cb(error("Описание — не длиннее 512 символов", k400BadRequest)); return;
            }
            db->execSqlSync("UPDATE bots SET description = ? WHERE user_id = ?", d, id);
        }
        if (JsonUtils::has(*json, "read_all"))
            db->execSqlSync("UPDATE bots SET read_all = ? WHERE user_id = ?", JsonUtils::getBool(*json, "read_all") ? 1 : 0, id);
        if (renamed) Broadcast::userUpdated(id);
        Json::Value resp;
        resp["bot"] = Bots::botObject(db, id);
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/bots/{id} — бот, его сообщения и очередь удаляются насовсем
void BotsController::remove(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        // Что увидят открытые клиенты: бот уходит с серверов и из бесед, его сообщения пропадают
        auto servers = db->execSqlSync("SELECT server_id FROM server_members WHERE user_id = ?", id);
        auto chats = db->execSqlSync(
            "SELECT m.channel_id FROM channel_members m JOIN channels c ON c.id = m.channel_id "
            "WHERE m.user_id = ? AND c.server_id IS NULL", id);
        auto msgs = db->execSqlSync(
            "SELECT id, channel_id FROM messages WHERE author_id = ? ORDER BY id DESC LIMIT 1000", id);
        Bots::forget(id, Bots::fail(401, "Unauthorized"));
        Cascade::deleteUser(db, id);
        for (const auto& m : msgs) {
            Json::Value ev;
            ev["type"]       = "message_deleted";
            ev["channel_id"] = static_cast<Json::Int64>(m["channel_id"].as<int64_t>());
            ev["id"]         = static_cast<Json::Int64>(m["id"].as<int64_t>());
            Broadcast::toChannel(m["channel_id"].as<int64_t>(), ev);
        }
        for (const auto& r : servers) memberEvent("server_member_left", r["server_id"].as<int64_t>(), id);
        for (const auto& r : chats) {
            Json::Value ev;
            ev["type"]       = "channel_member_left";
            ev["channel_id"] = static_cast<Json::Int64>(r["channel_id"].as<int64_t>());
            ev["user_id"]    = static_cast<Json::Int64>(id);
            Broadcast::toChannel(r["channel_id"].as<int64_t>(), ev);
        }
        Json::Value resp;
        resp["status"] = "deleted";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/bots/{id}/token — новый токен, старый сразу перестаёт работать
void BotsController::regenerate(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        const Bots::Token token = Bots::newToken(id);
        db->execSqlSync("UPDATE bots SET token_hash = ?, token_hint = ? WHERE user_id = ?", token.hash, token.hint, id);
        Bots::cancelWaiter(id, Bots::fail(401, "Unauthorized"));
        Json::Value resp;
        resp["bot"]   = Bots::botObject(db, id);
        resp["token"] = token.token;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/servers/{id}/bots — боты-участники сервера (только владелец)
void BotsController::serverBots(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, uid(req))) { cb(e); return; }
        Json::Value arr(Json::arrayValue);
        for (const auto& r : db->execSqlSync(
                 "SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM server_members m "
                 "JOIN users u ON u.id = m.user_id JOIN bots b ON b.user_id = u.id WHERE m.server_id = ? "
                 "ORDER BY u.username", id))
            arr.append(shortBot(r));
        Json::Value resp;
        resp["bots"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/bots {username} — добавить бота сразу, без приглашения
void BotsController::addToServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string username = TextUtils::trim(JsonUtils::getStr(*json, "username"));
    if (!username.empty() && username[0] == '@') username.erase(0, 1);
    const int64_t botIdParam = JsonUtils::getInt(*json, "bot_id");
    const int64_t self = uid(req);
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Invite, self)) { cb(HttpUtils::tooManyRequests()); return; }
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, self)) { cb(e); return; }
        auto r = botIdParam > 0
            ? db->execSqlSync("SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM users u "
                              "JOIN bots b ON b.user_id = u.id WHERE u.id = ?", botIdParam)
            : db->execSqlSync("SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM users u "
                              "JOIN bots b ON b.user_id = u.id WHERE u.username = ? COLLATE NOCASE", username);
        if (r.empty()) { cb(error("Бот не найден — проверьте @имя", k404NotFound)); return; }
        const int64_t botId = r[0]["id"].as<int64_t>();
        if (Access::isBanned(db, id, botId)) { cb(error("Этот бот заблокирован на сервере", k403Forbidden)); return; }
        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?) RETURNING user_id", id, botId);
        if (!ins.empty()) memberEvent("server_member_joined", id, botId);
        Json::Value resp;
        resp["bot"] = shortBot(r[0]);
        resp["status"] = ins.empty() ? "already_member" : "added";
        cb(HttpUtils::json(std::move(resp), ins.empty() ? k200OK : k201Created));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/servers/{id}/bots/{bid}
void BotsController::removeFromServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                                      int64_t id, int64_t bid) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, uid(req))) { cb(e); return; }
        if (!Bots::isBot(db, bid)) { cb(error("Бот не найден", k404NotFound)); return; }
        auto del = db->execSqlSync("DELETE FROM server_members WHERE server_id = ? AND user_id = ? RETURNING user_id", id, bid);
        if (del.empty()) { cb(error("Этого бота нет на сервере", k404NotFound)); return; }
        memberEvent("server_member_left", id, bid);
        Json::Value resp;
        resp["status"] = "removed";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/channels/{id}/commands — команды ботов канала для подсказок композера
void BotsController::commands(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        const auto acc = Access::channel(db, id, uid(req), &info);
        if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        auto rows = info.serverId
            ? db->execSqlSync("SELECT u.id, u.username, b.commands FROM server_members m JOIN bots b ON b.user_id = m.user_id "
                              "JOIN users u ON u.id = b.user_id WHERE m.server_id = ? ORDER BY u.username", info.serverId)
            : db->execSqlSync("SELECT u.id, u.username, b.commands FROM channel_members m JOIN bots b ON b.user_id = m.user_id "
                              "JOIN users u ON u.id = b.user_id WHERE m.channel_id = ? ORDER BY u.username", id);
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value cmds;
            if (!JsonUtils::parse(r["commands"].as<std::string>(), cmds) || !cmds.isArray()) continue;
            for (const auto& c : cmds) {
                Json::Value item;
                item["bot_id"]       = static_cast<Json::Int64>(r["id"].as<int64_t>());
                item["bot_username"] = r["username"].as<std::string>();
                item["command"]      = JsonUtils::getStr(c, "command");
                item["description"]  = JsonUtils::getStr(c, "description");
                arr.append(item);
            }
        }
        Json::Value resp;
        resp["commands"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/messages/{mid}/callback {data, ephemeral_id?} — нажатие кнопки бота.
// mid = 0 и ephemeral_id — кнопка эфемерного сообщения
void BotsController::press(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id,
                           int64_t mid) {
    const int64_t self = uid(req);
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string data = JsonUtils::getStr(*json, "data");
    if (data.empty() || data.size() > 64) {
        cb(error("Кнопка устарела — попросите бота прислать сообщение снова", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
        const auto acc = Access::channel(db, id, self);
        if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Callback, self)) {
            cb(error("Слишком часто нажимаете — подождите пару секунд", k429TooManyRequests)); return;
        }
        int64_t botId = 0;
        Json::Value msg;
        if (mid == 0) {
            const auto eph = Bots::findEphemeral(JsonUtils::getStr(*json, "ephemeral_id"));
            if (!eph || eph->userId != self || eph->channelId != id) {
                cb(error("Сообщение устарело — попросите бота прислать его снова", k404NotFound)); return;
            }
            botId = eph->botId;
            msg = eph->message;
        } else {
            msg = Messages::load(db, mid);
            if (msg.isNull() || msg["channel_id"].asInt64() != id) { cb(error("Сообщение не найдено", k404NotFound)); return; }
            if (!msg["author_bot"].asBool()) { cb(error("У этого сообщения нет кнопок бота", k400BadRequest)); return; }
            botId = msg["author_id"].asInt64();
        }
        if (!Bots::markupHasCallback(msg["reply_markup"], data)) {
            cb(error("Кнопка устарела — попросите бота прислать сообщение снова", k400BadRequest)); return;
        }
        // Бота убрали с сервера или из беседы — нажатие ему не уходит (и кто нажал, он не узнаёт)
        if (Access::channel(db, id, botId) != Access::Result::Ok) {
            cb(error("Бот больше не в этом чате — кнопка не работает", k400BadRequest)); return;
        }
        std::string queryId = CryptoUtils::randomHex(16);
        db->execSqlSync("INSERT INTO bot_callbacks(id, bot_id, user_id, channel_id, message_id, data) VALUES(?, ?, ?, ?, ?, ?)",
                        queryId, botId, self, id, mid, data);
        Json::Value q;
        q["id"]            = queryId;
        q["from"]          = Bots::tgUser(db, self);
        q["message"]       = Bots::tgMessage(db, msg, botId);
        q["chat_instance"] = std::to_string(id);
        q["data"]          = data;
        if (mid == 0) q["message"]["ephemeral_id"] = msg["ephemeral_id"];
        Json::Value update;
        update["callback_query"] = q;
        Bots::enqueue(db, botId, update);
        Json::Value resp;
        resp["ok"]       = true;
        resp["query_id"] = queryId;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}
