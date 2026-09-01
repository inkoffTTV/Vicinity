#include "FriendsController.h"
#include "../managers/WSManager.h"
#include "../utils/PresenceUtil.h"
#include <drogon/HttpResponse.h>

using namespace drogon;
using namespace drogon::orm;

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto r = HttpResponse::newHttpJsonResponse(std::move(body));
    r->setStatusCode(code);
    return r;
}
static HttpResponsePtr errResp(const std::string& msg, HttpStatusCode code) {
    Json::Value v; v["error"] = msg;
    return jsonResp(std::move(v), code);
}

static void notify(int64_t userId, const std::string& action, int64_t fromId) {
    Json::Value ev;
    ev["type"]    = "friend_event";
    ev["action"]  = action;
    ev["user_id"] = static_cast<Json::Int64>(fromId);
    Json::FastWriter fw;
    WSManager::instance().sendToUser(userId, fw.write(ev));
}

static Json::Value userSummary(const Row& row) {
    Json::Value u;
    int64_t id = row["id"].as<int64_t>();
    u["id"]           = id;
    u["username"]     = row["username"].as<std::string>();
    u["display_name"] = row["display_name"].as<std::string>();
    u["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
    u["presence"]     = effectivePresence(id);
    return u;
}

// GET /api/v1/friends — принятые друзья
void FriendsController::listFriends(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto r = db->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path FROM users u "
            "JOIN friendships f ON ((f.requester_id=? AND f.addressee_id=u.id) "
            "                    OR (f.addressee_id=? AND f.requester_id=u.id)) "
            "WHERE f.status='accepted' ORDER BY u.display_name COLLATE NOCASE", self, self);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : r) arr.append(userSummary(row));
        Json::Value resp; resp["friends"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) { cb(errResp(e.what(), k500InternalServerError)); }
}

// GET /api/v1/friends/pending — входящие/исходящие заявки
void FriendsController::pending(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto inc = db->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path FROM users u "
            "JOIN friendships f ON f.requester_id=u.id "
            "WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.created_at DESC", self);
        auto out = db->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path FROM users u "
            "JOIN friendships f ON f.addressee_id=u.id "
            "WHERE f.requester_id=? AND f.status='pending' ORDER BY f.created_at DESC", self);
        Json::Value incoming(Json::arrayValue), outgoing(Json::arrayValue);
        for (const auto& row : inc) incoming.append(userSummary(row));
        for (const auto& row : out) outgoing.append(userSummary(row));
        Json::Value resp; resp["incoming"] = incoming; resp["outgoing"] = outgoing;
        cb(jsonResp(resp));
    } catch (const std::exception& e) { cb(errResp(e.what(), k500InternalServerError)); }
}

// POST /api/v1/friends/request {user_id}
void FriendsController::request(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    int64_t target = (*json)["user_id"].asInt64();
    if (target == 0 || target == self) { cb(errResp("Неверный пользователь", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        auto u = db->execSqlSync("SELECT id FROM users WHERE id=?", target);
        if (u.empty()) { cb(errResp("Пользователь не найден", k404NotFound)); return; }

        auto ex = db->execSqlSync(
            "SELECT requester_id, status FROM friendships "
            "WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) LIMIT 1",
            self, target, target, self);
        if (!ex.empty()) {
            std::string st = ex[0]["status"].as<std::string>();
            int64_t reqr   = ex[0]["requester_id"].as<int64_t>();
            if (st == "accepted") { cb(errResp("Вы уже друзья", k409Conflict)); return; }
            if (st == "declined") {
                // Ранее отклонённая заявка — отправляем заново от себя
                db->execSqlSync("DELETE FROM friendships "
                                "WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
                                self, target, target, self);
            } else if (reqr == target) {
                // встречная заявка → принимаем
                db->execSqlSync("UPDATE friendships SET status='accepted' "
                                "WHERE requester_id=? AND addressee_id=?", target, self);
                notify(target, "accept", self);
                Json::Value resp; resp["status"] = "friends"; cb(jsonResp(resp)); return;
            } else {
                Json::Value resp; resp["status"] = "pending_out"; cb(jsonResp(resp)); return; // уже отправлена
            }
        }
        db->execSqlSync("INSERT INTO friendships(requester_id, addressee_id, status) "
                        "VALUES(?,?, 'pending')", self, target);
        notify(target, "request", self);
        Json::Value resp; resp["status"] = "pending_out";
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) { cb(errResp(e.what(), k500InternalServerError)); }
}

// POST /api/v1/friends/respond {user_id, accept}
void FriendsController::respond(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    int64_t other  = (*json)["user_id"].asInt64();
    bool    accept = (*json).get("accept", false).asBool();

    auto db = app().getDbClient();
    try {
        auto ex = db->execSqlSync(
            "SELECT 1 FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'",
            other, self);
        if (ex.empty()) { cb(errResp("Заявка не найдена", k404NotFound)); return; }
        if (accept) {
            db->execSqlSync("UPDATE friendships SET status='accepted' "
                            "WHERE requester_id=? AND addressee_id=?", other, self);
            notify(other, "accept", self);
            Json::Value resp; resp["status"] = "friends"; cb(jsonResp(resp));
        } else {
            // Отклонено: сохраняем запись со статусом 'declined' (friends=1)
            db->execSqlSync("UPDATE friendships SET status='declined' "
                            "WHERE requester_id=? AND addressee_id=?", other, self);
            notify(other, "decline", self);
            Json::Value resp; resp["status"] = "none"; cb(jsonResp(resp));
        }
    } catch (const std::exception& e) { cb(errResp(e.what(), k500InternalServerError)); }
}

// DELETE /api/v1/friends/{id} — удалить друга / отменить заявку / отклонить
void FriendsController::remove(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb, int64_t other) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        db->execSqlSync(
            "DELETE FROM friendships "
            "WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
            self, other, other, self);
        notify(other, "remove", self);
        Json::Value resp; resp["status"] = "none";
        cb(jsonResp(resp));
    } catch (const std::exception& e) { cb(errResp(e.what(), k500InternalServerError)); }
}
