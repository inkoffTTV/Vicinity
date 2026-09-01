#include "ServerController.h"
#include "../managers/WSManager.h"
#include <drogon/HttpResponse.h>
#include <random>
#include <cctype>
#include <map>

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

// Является ли пользователь участником сервера
static bool isMember(const std::shared_ptr<DbClient>& db, int64_t serverId, int64_t userId) {
    auto r = db->execSqlSync(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        serverId, userId);
    return !r.empty();
}

// POST /api/v1/servers  {name}
void ServerController::createServer(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string name = (*json)["name"].asString();
    if (name.empty() || name.size() > 64) {
        cb(errResp("Server name must be 1-64 characters", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        std::string code = genInviteCode();
        auto ins = db->execSqlSync(
            "INSERT INTO servers(name, owner_id, invite_code) VALUES(?, ?, ?) RETURNING id",
            name, userId, code);
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
        resp["name"]        = name;
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

// POST /api/v1/servers/{id}/join — вступить в сервер (открыто всем)
void ServerController::joinServer(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb,
                                  int64_t serverId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync("SELECT id FROM servers WHERE id = ?", serverId);
        if (s.empty()) { cb(errResp("Server not found", k404NotFound)); return; }
        db->execSqlSync("INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?)",
                        serverId, userId);
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

    std::string code = (*json)["code"].asString();
    // нормализуем: убрать пробелы, в верхний регистр
    std::string norm;
    for (char c : code) if (!isspace((unsigned char)c)) norm += (char)toupper((unsigned char)c);
    if (norm.empty()) { cb(errResp("Введите код приглашения", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync(
            "SELECT id, name FROM servers WHERE invite_code = ? LIMIT 1", norm);
        if (s.empty()) { cb(errResp("Сервер с таким кодом не найден", k404NotFound)); return; }
        int64_t serverId = s[0]["id"].as<int64_t>();
        db->execSqlSync("INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?)",
                        serverId, userId);
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
    int64_t target = (*json)["user_id"].asInt64();
    if (target == 0) { cb(errResp("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", serverId);
        if (s.empty()) { cb(errResp("Сервер не найден", k404NotFound)); return; }
        if (!isMember(db, serverId, self)) {
            cb(errResp("Вы не участник этого сервера", k403Forbidden)); return;
        }
        auto u = db->execSqlSync("SELECT id FROM users WHERE id = ?", target);
        if (u.empty()) { cb(errResp("Пользователь не найден", k404NotFound)); return; }

        db->execSqlSync("INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?)",
                        serverId, target);

        // Живое уведомление добавленному пользователю — обновить список серверов
        Json::Value ev;
        ev["type"]      = "server_added";
        ev["server_id"] = static_cast<Json::Int64>(serverId);
        ev["name"]      = s[0]["name"].as<std::string>();
        Json::FastWriter fw;
        WSManager::instance().sendToUser(target, fw.write(ev));

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

    std::string name    = (*json)["name"].asString();
    int         isVoice = (*json).get("is_voice", 0).asInt() ? 1 : 0;
    if (name.empty() || name.size() > 64) {
        cb(errResp("Channel name must be 1-64 characters", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        if (!isMember(db, serverId, userId)) {
            cb(errResp("Not a member of this server", k403Forbidden)); return;
        }
        auto ins = db->execSqlSync(
            "INSERT INTO channels(type, name, owner_id, server_id, is_voice) "
            "VALUES('channel', ?, ?, ?, ?) RETURNING id",
            name, userId, serverId, isVoice);
        int64_t channelId = ins[0]["id"].as<int64_t>();

        Json::Value resp;
        resp["channel_id"] = channelId;
        resp["name"]       = name;
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
    auto db = app().getDbClient();
    try {
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
        if (!isMember(db, serverId, self)) {
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

        db->execSqlSync("DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
                        serverId, targetId);

        // Уведомить кикнутого — его клиент уберёт сервер из списка
        Json::Value ev;
        ev["type"]      = "server_removed";
        ev["server_id"] = static_cast<Json::Int64>(serverId);
        ev["name"]      = s[0]["name"].as<std::string>();
        Json::FastWriter fw;
        WSManager::instance().sendToUser(targetId, fw.write(ev));

        Json::Value resp; resp["status"] = "removed";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}
