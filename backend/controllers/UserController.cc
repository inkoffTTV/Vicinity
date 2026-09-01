#include "UserController.h"
#include "../models/User.h"
#include "../utils/PresenceUtil.h"
#include <drogon/HttpResponse.h>

using namespace drogon;
using namespace drogon::orm;

// Бейджи выводятся из существующих полей (developer / подписка)
static Json::Value computeBadges(const User& u) {
    Json::Value arr(Json::arrayValue);
    if (u.developer) {
        Json::Value b; b["id"] = "dev"; b["label"] = "Разработчик"; b["color"] = "#5865f2"; arr.append(b);
    }
    if (u.subscriptionTier == 1) { Json::Value b; b["id"]="basic";    b["label"]="Basic";    b["color"]="#9e9e9e"; arr.append(b); }
    if (u.subscriptionTier == 2) { Json::Value b; b["id"]="standard"; b["label"]="Standard"; b["color"]="#42a5f5"; arr.append(b); }
    if (u.subscriptionTier == 3) { Json::Value b; b["id"]="ultra";    b["label"]="Ultra";    b["color"]="#ce93d8"; arr.append(b); }
    return arr;
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

// GET /api/v1/users/search?q=tag
void UserController::search(const HttpRequestPtr& req,
                           std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    std::string q = req->getParameter("q");
    if (q.empty()) { cb(errResp("query required", k400BadRequest)); return; }

    // Strip leading @ if present
    if (q[0] == '@') q.erase(0, 1);

    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT id, username, display_name, avatar_path FROM users "
            "WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20",
            "%" + q + "%", "%" + q + "%", selfId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value u;
            u["id"]           = row["id"].as<int64_t>();
            u["username"]     = row["username"].as<std::string>();
            u["display_name"] = row["display_name"].as<std::string>();
            u["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            arr.append(u);
        }
        Json::Value resp; resp["users"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/users/{id} — полный профиль пользователя
void UserController::profile(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto u = UserModel::findById(id);
    if (!u) { cb(errResp("Пользователь не найден", k404NotFound)); return; }

    Json::Value resp;
    resp["id"]                = u->id;
    resp["username"]          = u->username;
    resp["display_name"]      = u->displayName;
    resp["avatar_path"]       = u->avatarPath;
    resp["banner_path"]       = u->bannerPath;
    resp["bio"]               = u->bio;
    resp["accent_color"]      = u->accentColor;
    resp["pronouns"]          = u->pronouns;
    resp["profile_json"]      = u->profileJson;
    resp["created_at"]        = u->createdAt;
    resp["subscription_tier"] = u->subscriptionTier;
    resp["developer"]         = u->developer;
    resp["badges"]            = computeBadges(*u);
    resp["presence"]          = (id == self) ? u->presence : effectivePresence(id);
    resp["friendship_status"] = (id == self) ? "self" : friendshipStatus(self, id);

    auto db = app().getDbClient();
    // Общие серверы
    Json::Value servers(Json::arrayValue);
    try {
        auto r = db->execSqlSync(
            "SELECT s.id, s.name FROM servers s "
            "JOIN server_members a ON a.server_id=s.id AND a.user_id=? "
            "JOIN server_members b ON b.server_id=s.id AND b.user_id=? "
            "ORDER BY s.name COLLATE NOCASE", self, id);
        for (const auto& row : r) {
            Json::Value s; s["id"]=row["id"].as<int64_t>(); s["name"]=row["name"].as<std::string>();
            servers.append(s);
        }
    } catch (...) {}
    resp["mutual_servers"] = servers;

    // Общие друзья
    Json::Value mfriends(Json::arrayValue);
    if (id != self) {
        try {
            auto r = db->execSqlSync(
                "SELECT u.id, u.username, u.display_name, u.avatar_path FROM users u WHERE u.id IN ("
                "  SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END "
                "  FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted') "
                "AND u.id IN ("
                "  SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END "
                "  FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted') "
                "ORDER BY u.display_name COLLATE NOCASE",
                self, self, self, id, id, id);
            for (const auto& row : r) {
                Json::Value m;
                m["id"]=row["id"].as<int64_t>();
                m["username"]=row["username"].as<std::string>();
                m["display_name"]=row["display_name"].as<std::string>();
                m["avatar_path"]=row["avatar_path"].isNull()?"":row["avatar_path"].as<std::string>();
                mfriends.append(m);
            }
        } catch (...) {}
    }
    resp["mutual_friends"] = mfriends;

    cb(jsonResp(resp));
}

// POST /api/v1/dms  { user_id: <target> }
// Creates (or returns existing) 1-on-1 DM channel between caller and target.
void UserController::startDm(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    int64_t targetId = (*json)["user_id"].asInt64();
    if (targetId == 0 || targetId == selfId) {
        cb(errResp("Invalid target user", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        auto target = UserModel::findById(targetId);
        if (!target) { cb(errResp("User not found", k404NotFound)); return; }

        // Find an existing dm channel shared by exactly these two users
        auto existing = db->execSqlSync(
            "SELECT c.id FROM channels c "
            "JOIN channel_members m1 ON c.id = m1.channel_id AND m1.user_id = ? "
            "JOIN channel_members m2 ON c.id = m2.channel_id AND m2.user_id = ? "
            "WHERE c.type = 'dm' LIMIT 1",
            selfId, targetId);

        int64_t channelId;
        if (!existing.empty()) {
            channelId = existing[0]["id"].as<int64_t>();
        } else {
            auto ins = db->execSqlSync(
                "INSERT INTO channels(type, name, owner_id) VALUES('dm', ?, ?) RETURNING id",
                target->displayName, selfId);
            channelId = ins[0]["id"].as<int64_t>();
            db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                            channelId, selfId);
            db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                            channelId, targetId);
        }

        Json::Value resp;
        resp["channel_id"]   = channelId;
        resp["display_name"] = target->displayName;
        resp["username"]     = target->username;
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/dms — list the caller's DM channels with the other participant's info
void UserController::listDms(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT c.id AS channel_id, u.id AS user_id, u.username, u.display_name, u.avatar_path, "
            "       (SELECT MAX(created_at) FROM messages WHERE channel_id = c.id) AS last_msg "
            "FROM channels c "
            "JOIN channel_members me    ON c.id = me.channel_id    AND me.user_id = ? "
            "JOIN channel_members other ON c.id = other.channel_id AND other.user_id != ? "
            "JOIN users u ON u.id = other.user_id "
            "WHERE c.type = 'dm' "
            "ORDER BY last_msg DESC, c.created_at DESC",   // самые свежие беседы — сверху
            selfId, selfId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value d;
            d["channel_id"]   = row["channel_id"].as<int64_t>();
            d["user_id"]      = row["user_id"].as<int64_t>();
            d["username"]     = row["username"].as<std::string>();
            d["display_name"] = row["display_name"].as<std::string>();
            d["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            arr.append(d);
        }
        Json::Value resp; resp["dms"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}
