#include "ServerController.h"
#include "../managers/WSManager.h"
#include "../managers/VoiceManager.h"
#include "../managers/UserRateLimiter.h"
#include "../models/Cascade.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include "../utils/Uploads.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/HttpResponse.h>
#include <drogon/drogon.h>
#include <random>
#include <cctype>
#include <map>
#include <vector>

using namespace drogon;
using namespace drogon::orm;

// Короткий инвайт-код без похожих символов (без 0/O/1/I)
static std::string genInviteCode() {
    static const char* cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    std::random_device rd; std::mt19937 g(rd());
    std::uniform_int_distribution<> d(0, 31);
    std::string s; for (int i = 0; i < 6; ++i) s += cs[d(g)];
    return s;
}

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto r = HttpResponse::newHttpJsonResponse(std::move(body));
    r->setStatusCode(code);
    return r;
}
static HttpResponsePtr errResp(const std::string& msg, HttpStatusCode code) {
    Json::Value v; v["error"] = msg;
    return jsonResp(std::move(v), code);
}

static HttpResponsePtr tooManyRequests() {
    return errResp("Слишком часто, попробуйте позже", k429TooManyRequests);
}

// Состав сервера изменился: {type: server_member_joined|server_member_left, server_id, user_id}
static Json::Value memberEventJson(const char* type, int64_t serverId, int64_t userId) {
    Json::Value ev;
    ev["type"]      = type;
    ev["server_id"] = static_cast<Json::Int64>(serverId);
    ev["user_id"]   = static_cast<Json::Int64>(userId);
    return ev;
}

static void memberEvent(const char* type, int64_t serverId, int64_t userId) {
    Broadcast::toServer(serverId, memberEventJson(type, serverId, userId));
}

static std::vector<int64_t> serverChannels(const DbClientPtr& db, int64_t serverId) {
    std::vector<int64_t> out;
    for (const auto& row : db->execSqlSync("SELECT id FROM channels WHERE server_id = ?", serverId))
        out.push_back(row["id"].as<int64_t>());
    return out;
}

// Убрать пользователя с сервера: членство и голос в каналах сервера; оставшимся — server_member_left.
// true — он был участником.
static bool dropMember(const DbClientPtr& db, int64_t serverId, int64_t userId) {
    auto del = db->execSqlSync(
        "DELETE FROM server_members WHERE server_id = ? AND user_id = ? RETURNING user_id",
        serverId, userId);
    // Без членства нет и голоса
    Broadcast::evictFromVoice(userId, serverChannels(db, serverId));
    if (del.empty()) return false;
    memberEvent("server_member_left", serverId, userId);
    return true;
}

// {type:"server_removed"} — клиент уберёт сервер из списка (кик, бан, удаление сервера)
static void serverRemoved(int64_t userId, int64_t serverId, const std::string& name) {
    Json::Value ev;
    ev["type"]      = "server_removed";
    ev["server_id"] = static_cast<Json::Int64>(serverId);
    ev["name"]      = name;
    Broadcast::toUser(userId, ev);
}

// Действие только для владельца: ошибка (сервера нет — 404, не владелец — 403) или nullptr
static HttpResponsePtr ownerOnly(const DbClientPtr& db, int64_t serverId, int64_t userId) {
    const int64_t owner = Access::serverOwner(db, serverId);
    if (owner == 0)      return errResp("Сервер не найден", k404NotFound);
    if (owner != userId) return errResp("Только владелец сервера может это сделать", k403Forbidden);
    return nullptr;
}

// {server_id, name, icon} сервера; с type — событие server_updated участникам
static Json::Value serverInfo(const DbClientPtr& db, int64_t serverId) {
    auto r = db->execSqlSync("SELECT name, icon FROM servers WHERE id = ?", serverId);
    Json::Value v;
    v["server_id"] = static_cast<Json::Int64>(serverId);
    v["name"]      = r.empty() ? "" : r[0]["name"].as<std::string>();
    v["icon"]      = r.empty() || r[0]["icon"].isNull() ? "" : r[0]["icon"].as<std::string>();
    return v;
}

static void serverUpdated(const Json::Value& info) {
    Json::Value ev = info;
    ev["type"] = "server_updated";
    Broadcast::toServer(info["server_id"].asInt64(), ev);
}

// POST /api/v1/servers  {name}
void ServerController::createServer(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), Vicinity::MAX_NAME_LEN);
    if (!name) {
        cb(errResp("Server name must be 1-64 characters", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        std::string code = genInviteCode();
        auto ins = db->execSqlSync(
            "INSERT INTO servers(name, owner_id, invite_code) VALUES(?, ?, ?) RETURNING id",
            *name, userId, code);
        int64_t serverId = ins[0]["id"].as<int64_t>();
        db->execSqlSync("INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?)",
                        serverId, userId);
        // Каналы по умолчанию: текстовый + голосовой
        db->execSqlSync(
            "INSERT INTO channels(type, name, owner_id, server_id, is_voice) "
            "VALUES('channel', 'общий', ?, ?, 0)", userId, serverId);
        db->execSqlSync(
            "INSERT INTO channels(type, name, owner_id, server_id, is_voice) "
            "VALUES('channel', 'Голосовой', ?, ?, 1)", userId, serverId);

        Json::Value resp;
        resp["server_id"]   = serverId;
        resp["name"]        = *name;
        resp["invite_code"] = code;
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/servers — серверы, в которых состоит пользователь
void ServerController::listServers(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT s.id, s.name, s.icon, s.owner_id, s.invite_code FROM servers s "
            "JOIN server_members m ON s.id = m.server_id "
            "WHERE m.user_id = ? ORDER BY s.id ASC", userId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value s;
            s["id"]          = row["id"].as<int64_t>();
            s["name"]        = row["name"].as<std::string>();
            s["icon"]        = row["icon"].isNull() ? "" : row["icon"].as<std::string>();
            s["owner_id"]    = row["owner_id"].as<int64_t>();
            s["invite_code"] = row["invite_code"].isNull() ? "" : row["invite_code"].as<std::string>();
            arr.append(s);
        }
        Json::Value resp; resp["servers"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/join — раньше пускал в любой сервер по id в обход кода приглашения.
// Маршрут оставлен для старых десктопов (AppState::joinServer): участнику отвечает «joined»,
// остальным — 403, вступить можно только по коду (/servers/join).
void ServerController::joinServer(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb,
                                  int64_t serverId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync("SELECT id FROM servers WHERE id = ?", serverId);
        if (s.empty()) { cb(errResp("Server not found", k404NotFound)); return; }
        if (!Access::isServerMember(db, serverId, userId)) {
            cb(errResp("Вступить можно только по коду приглашения", k403Forbidden)); return;
        }
        Json::Value resp; resp["status"] = "joined"; resp["server_id"] = serverId;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/join  {code}
void ServerController::joinByCode(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string code = JsonUtils::getStr(*json, "code");
    // нормализуем: убрать пробелы, в верхний регистр
    std::string norm;
    for (char c : code) if (!isspace((unsigned char)c)) norm += (char)toupper((unsigned char)c);
    if (norm.empty()) { cb(errResp("Введите код приглашения", k400BadRequest)); return; }
    // Лимит попыток — против перебора кодов
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::JoinByCode, userId)) {
        cb(tooManyRequests()); return;
    }

    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync(
            "SELECT id, name FROM servers WHERE invite_code = ? LIMIT 1", norm);
        if (s.empty()) { cb(errResp("Сервер с таким кодом не найден", k404NotFound)); return; }
        int64_t serverId = s[0]["id"].as<int64_t>();
        if (Access::isBanned(db, serverId, userId)) {
            cb(errResp("Вы заблокированы на этом сервере", k403Forbidden)); return;
        }
        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?) RETURNING user_id",
            serverId, userId);
        if (!ins.empty()) memberEvent("server_member_joined", serverId, userId);
        Json::Value resp;
        resp["server_id"] = serverId;
        resp["name"]      = s[0]["name"].as<std::string>();
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/members  {user_id} — добавить пользователя на сервер
void ServerController::addMember(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    int64_t target = JsonUtils::getInt(*json, "user_id");
    if (target <= 0) { cb(errResp("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", serverId);
        if (s.empty()) { cb(errResp("Сервер не найден", k404NotFound)); return; }
        if (!Access::isServerMember(db, serverId, self)) {
            cb(errResp("Вы не участник этого сервера", k403Forbidden)); return;
        }
        auto u = db->execSqlSync("SELECT id FROM users WHERE id = ?", target);
        if (u.empty()) { cb(errResp("Пользователь не найден", k404NotFound)); return; }
        if (Access::isBanned(db, serverId, target)) {
            cb(errResp("Пользователь заблокирован на этом сервере", k403Forbidden)); return;
        }

        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?) RETURNING user_id",
            serverId, target);
        if (!ins.empty()) memberEvent("server_member_joined", serverId, target);

        // Живое уведомление добавленному пользователю — обновить список серверов
        Json::Value ev;
        ev["type"]      = "server_added";
        ev["server_id"] = static_cast<Json::Int64>(serverId);
        ev["name"]      = s[0]["name"].as<std::string>();
        Broadcast::toUser(target, ev);

        Json::Value resp; resp["status"] = "added"; resp["server_id"] = static_cast<Json::Int64>(serverId);
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/channels  {name, is_voice}
void ServerController::createServerChannel(const HttpRequestPtr& req,
                                           std::function<void(const HttpResponsePtr&)>&& cb,
                                           int64_t serverId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    auto name    = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), Vicinity::MAX_NAME_LEN);
    int  isVoice = JsonUtils::getBool(*json, "is_voice") ? 1 : 0;
    if (!name) {
        cb(errResp("Channel name must be 1-64 characters", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        if (!Access::isServerMember(db, serverId, userId)) {
            cb(errResp("Not a member of this server", k403Forbidden)); return;
        }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::ChannelCreate, userId)) {
            cb(tooManyRequests()); return;
        }
        auto ins = db->execSqlSync(
            "INSERT INTO channels(type, name, owner_id, server_id, is_voice) "
            "VALUES('channel', ?, ?, ?, ?) RETURNING id",
            *name, userId, serverId, isVoice);
        int64_t channelId = ins[0]["id"].as<int64_t>();

        Json::Value ev;
        ev["type"]      = "server_channels_changed";
        ev["server_id"] = static_cast<Json::Int64>(serverId);
        Broadcast::toServer(serverId, ev);

        Json::Value resp;
        resp["channel_id"] = channelId;
        resp["name"]       = *name;
        resp["is_voice"]   = isVoice;
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/servers/{id}/channels
void ServerController::listServerChannels(const HttpRequestPtr& req,
                                          std::function<void(const HttpResponsePtr&)>&& cb,
                                          int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (!Access::isServerMember(db, serverId, self)) {
            cb(errResp("Вы не участник этого сервера", k403Forbidden)); return;
        }
        auto result = db->execSqlSync(
            "SELECT id, name, is_voice FROM channels WHERE server_id = ? "
            "ORDER BY is_voice ASC, id ASC", serverId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value c;
            c["id"]       = row["id"].as<int64_t>();
            c["name"]     = row["name"].as<std::string>();
            c["is_voice"] = row["is_voice"].as<int>();
            arr.append(c);
        }
        Json::Value resp; resp["channels"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

void ServerController::listMembers(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb,
                                  int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (!Access::isServerMember(db, serverId, self)) {
            cb(errResp("Вы не участник этого сервера", k403Forbidden)); return;
        }
        auto rows = db->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path, u.presence, "
            "       u.developer, u.subscription_tier, s.owner_id "
            "FROM server_members sm "
            "JOIN users u   ON u.id = sm.user_id "
            "JOIN servers s ON s.id = sm.server_id "
            "WHERE sm.server_id = ? "
            "ORDER BY u.display_name COLLATE NOCASE",
            serverId);

        // Роли всех участников одним запросом → map<user_id, [{name,color}]>
        auto roleRows = db->execSqlSync(
            "SELECT ur.user_id, r.name, r.color FROM user_roles ur "
            "JOIN roles r ON r.id = ur.role_id "
            "JOIN server_members sm ON sm.user_id = ur.user_id AND sm.server_id = ? "
            "ORDER BY r.position DESC, r.id ASC",
            serverId);
        std::map<int64_t, Json::Value> rolesByUser;
        for (const auto& rr : roleRows) {
            Json::Value role;
            role["name"]  = rr["name"].as<std::string>();
            role["color"] = rr["color"].as<std::string>();
            int64_t uid = rr["user_id"].as<int64_t>();
            if (!rolesByUser.count(uid)) rolesByUser[uid] = Json::Value(Json::arrayValue);
            rolesByUser[uid].append(role);
        }

        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            int64_t uid = r["id"].as<int64_t>();
            std::string pres = r["presence"].isNull() ? "online" : r["presence"].as<std::string>();
            // Эффективное присутствие: онлайн только при активном WS и не «невидимке»
            bool online = WSManager::instance().isOnline(uid) && pres != "invisible";
            Json::Value m;
            m["id"]           = static_cast<Json::Int64>(uid);
            m["username"]     = r["username"].as<std::string>();
            m["display_name"] = r["display_name"].as<std::string>();
            m["avatar_path"]  = r["avatar_path"].isNull() ? "" : r["avatar_path"].as<std::string>();
            m["presence"]     = online ? pres : "offline";
            m["is_owner"]     = (r["owner_id"].as<int64_t>() == uid);
            m["developer"]    = r["developer"].isNull() ? 0 : r["developer"].as<int>();
            m["tier"]         = r["subscription_tier"].isNull() ? 0 : r["subscription_tier"].as<int>();
            m["roles"]        = rolesByUser.count(uid) ? rolesByUser[uid] : Json::Value(Json::arrayValue);
            arr.append(m);
        }
        Json::Value resp; resp["members"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

void ServerController::removeMember(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   int64_t serverId, int64_t targetId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync("SELECT owner_id, name FROM servers WHERE id = ?", serverId);
        if (s.empty()) { cb(errResp("Сервер не найден", k404NotFound)); return; }
        int64_t ownerId = s[0]["owner_id"].as<int64_t>();
        // Кикать может только владелец; владельца кикнуть нельзя
        if (self != ownerId)     { cb(errResp("Только владелец может удалять участников", k403Forbidden)); return; }
        if (targetId == ownerId) { cb(errResp("Нельзя удалить владельца сервера", k400BadRequest)); return; }

        dropMember(db, serverId, targetId);
        // Уведомить кикнутого — его клиент уберёт сервер из списка
        serverRemoved(targetId, serverId, s[0]["name"].as<std::string>());

        Json::Value resp; resp["status"] = "removed";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/leave — выйти с сервера (владельцу нельзя)
void ServerController::leaveServer(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        const int64_t owner = Access::serverOwner(db, serverId);
        if (owner == 0) { cb(errResp("Сервер не найден", k404NotFound)); return; }
        if (owner == self) {
            cb(errResp("Владелец не может выйти с сервера — его можно только удалить", k400BadRequest)); return;
        }
        if (!dropMember(db, serverId, self)) {
            cb(errResp("Вы не участник этого сервера", k403Forbidden)); return;
        }
        // Другие вкладки и устройства ушедшего уберут сервер из списка
        Broadcast::toUser(self, memberEventJson("server_member_left", serverId, self));
        Json::Value resp; resp["status"] = "left";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/servers/{id} — удалить сервер со всеми каналами и сообщениями (владелец)
void ServerController::deleteServer(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb,
                                    int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        const Json::Value info = serverInfo(db, serverId);
        std::vector<int64_t> members;
        for (const auto& row : db->execSqlSync("SELECT user_id FROM server_members WHERE server_id = ?", serverId))
            members.push_back(row["user_id"].as<int64_t>());
        // Голосовые каналы пустеют, пока участники сервера ещё видят их
        for (int64_t ch : serverChannels(db, serverId))
            for (int64_t uid : VoiceManager::instance().usersIn(ch)) Broadcast::evictFromVoice(uid, {ch});

        Cascade::deleteServer(db, serverId);
        Uploads::removeByUrl(info["icon"].asString());
        for (int64_t uid : members) serverRemoved(uid, serverId, info["name"].asString());

        Json::Value resp; resp["status"] = "deleted";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/update {name} — переименовать сервер (владелец)
void ServerController::updateServer(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb,
                                    int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), Vicinity::MAX_NAME_LEN);
    if (!name) { cb(errResp("Server name must be 1-64 characters", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        db->execSqlSync("UPDATE servers SET name = ? WHERE id = ?", *name, serverId);
        const Json::Value info = serverInfo(db, serverId);
        serverUpdated(info);
        cb(jsonResp(info));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/icon (multipart, поле file) — иконка сервера (владелец)
void ServerController::uploadIcon(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb,
                                  int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    try {   // защита от падения сервера на кривом файле/диске
        auto db = app().getDbClient();
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Upload, self)) {
            cb(tooManyRequests()); return;
        }
        MultiPartParser fileUpload;
        if (fileUpload.parse(req) != 0 || fileUpload.getFiles().empty()) {
            cb(errResp("Invalid file upload", k400BadRequest)); return;
        }
        auto saved = Uploads::saveImage(fileUpload.getFiles()[0], "icons");
        if (!saved.error.empty()) { cb(errResp(saved.error, saved.code)); return; }

        const std::string prev = serverInfo(db, serverId)["icon"].asString();
        db->execSqlSync("UPDATE servers SET icon = ? WHERE id = ?", saved.url, serverId);
        // Старая иконка больше никому не нужна
        Uploads::removeByUrl(prev);
        const Json::Value info = serverInfo(db, serverId);
        serverUpdated(info);
        cb(jsonResp(info));
    } catch (const std::exception& e) {
        LOG_ERROR << "uploadIcon exception: " << e.what();
        cb(errResp("Не удалось загрузить файл", k500InternalServerError));
    } catch (...) {
        LOG_ERROR << "uploadIcon unknown exception";
        cb(errResp("Не удалось загрузить файл", k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/invite — новый код приглашения, старый перестаёт работать (владелец)
void ServerController::regenerateInvite(const HttpRequestPtr& req,
                                        std::function<void(const HttpResponsePtr&)>&& cb,
                                        int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        const std::string code = genInviteCode();
        db->execSqlSync("UPDATE servers SET invite_code = ? WHERE id = ?", code, serverId);
        Json::Value resp; resp["invite_code"] = code;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/servers/{id}/bans — забаненные пользователи (владелец)
void ServerController::listBans(const HttpRequestPtr& req,
                                std::function<void(const HttpResponsePtr&)>&& cb,
                                int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        auto rows = db->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path FROM server_bans b "
            "JOIN users u ON u.id = b.user_id WHERE b.server_id = ? ORDER BY b.created_at DESC",
            serverId);
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value u;
            u["id"]           = static_cast<Json::Int64>(r["id"].as<int64_t>());
            u["username"]     = r["username"].as<std::string>();
            u["display_name"] = r["display_name"].as<std::string>();
            u["avatar_path"]  = r["avatar_path"].isNull() ? "" : r["avatar_path"].as<std::string>();
            arr.append(u);
        }
        Json::Value resp; resp["bans"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/bans {user_id} — забанить (и исключить, если участник) — владелец
void ServerController::banMember(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t serverId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    int64_t target = JsonUtils::getInt(*json, "user_id");
    if (target <= 0) { cb(errResp("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        if (target == self) { cb(errResp("Нельзя забанить владельца сервера", k400BadRequest)); return; }
        if (db->execSqlSync("SELECT 1 FROM users WHERE id = ?", target).empty()) {
            cb(errResp("Пользователь не найден", k404NotFound)); return;
        }
        db->execSqlSync("INSERT OR IGNORE INTO server_bans(server_id, user_id) VALUES(?, ?)", serverId, target);
        if (dropMember(db, serverId, target))
            serverRemoved(target, serverId, serverInfo(db, serverId)["name"].asString());

        Json::Value resp; resp["status"] = "banned";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/servers/{id}/bans/{uid} — снять бан (владелец)
void ServerController::unbanMember(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   int64_t serverId, int64_t targetId) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        if (auto err = ownerOnly(db, serverId, self)) { cb(err); return; }
        db->execSqlSync("DELETE FROM server_bans WHERE server_id = ? AND user_id = ?", serverId, targetId);
        Json::Value resp; resp["status"] = "unbanned";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}
