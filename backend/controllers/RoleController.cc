#include "RoleController.h"
#include "../models/User.h"
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

void RoleController::listRoles(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb) {
    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT r.id, r.name, r.color, r.is_premium, r.icon, r.position,"
            " COUNT(ur.user_id) AS member_count"
            " FROM roles r LEFT JOIN user_roles ur ON r.id = ur.role_id"
            " GROUP BY r.id ORDER BY r.position ASC");
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value role;
            role["id"]           = row["id"].as<int64_t>();
            role["name"]         = row["name"].as<std::string>();
            role["color"]        = row["color"].as<std::string>();
            role["is_premium"]   = row["is_premium"].as<int>();
            role["icon"]         = row["icon"].isNull() ? "" : row["icon"].as<std::string>();
            role["member_count"] = row["member_count"].as<int>();
            arr.append(role);
        }
        Json::Value resp; resp["roles"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

void RoleController::createRole(const HttpRequestPtr& req,
                                std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto user = UserModel::findById(userId);
    if (!user) { cb(errResp("User not found", k404NotFound)); return; }

    if (user->developer != 1)
        { cb(errResp("Only developers can create roles", k403Forbidden)); return; }

    auto json = req->getJsonObject();
    if (!json) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string name      = (*json)["name"].asString();
    std::string color     = (*json).get("color",      "#888888").asString();
    int         isPremium = (*json).get("is_premium", 0).asInt();
    std::string icon      = (*json).get("icon",       "").asString();

    if (name.empty() || name.size() > 32)
        { cb(errResp("Role name must be 1-32 characters", k400BadRequest)); return; }
    if (isPremium > user->subscriptionTier)
        { cb(errResp("Your subscription tier is insufficient", k403Forbidden)); return; }
    if (!icon.empty() && user->subscriptionTier < 1)
        { cb(errResp("Role icons require Vicinity Basic", k403Forbidden)); return; }

    auto db = app().getDbClient();
    try {
        db->execSqlSync(
            "INSERT INTO roles(name, color, is_premium, icon, created_by) VALUES(?,?,?,?,?)",
            name, color, isPremium, icon, userId);
        auto res = db->execSqlSync("SELECT last_insert_rowid() AS id");
        int64_t roleId = res[0]["id"].as<int64_t>();

        Json::Value resp;
        resp["id"] = roleId; resp["name"] = name;
        resp["color"] = color; resp["is_premium"] = isPremium; resp["icon"] = icon;
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

void RoleController::myRoles(const HttpRequestPtr& req,
                             std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT r.* FROM roles r"
            " JOIN user_roles ur ON r.id = ur.role_id"
            " WHERE ur.user_id = ? ORDER BY r.position ASC", userId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value role;
            role["id"]         = row["id"].as<int64_t>();
            role["name"]       = row["name"].as<std::string>();
            role["color"]      = row["color"].as<std::string>();
            role["is_premium"] = row["is_premium"].as<int>();
            role["icon"]       = row["icon"].isNull() ? "" : row["icon"].as<std::string>();
            arr.append(role);
        }
        Json::Value resp; resp["roles"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// Можно управлять ролями другого, если ты владелец сервера, где он состоит (или это ты сам).
static bool canManageRoles(const std::shared_ptr<drogon::orm::DbClient>& db,
                           int64_t self, int64_t target) {
    if (self == target) return true;
    auto r = db->execSqlSync(
        "SELECT 1 FROM servers s JOIN server_members sm ON sm.server_id = s.id "
        "WHERE s.owner_id = ? AND sm.user_id = ? LIMIT 1", self, target);
    return !r.empty();
}

void RoleController::assignRole(const HttpRequestPtr& req,
                                std::function<void(const HttpResponsePtr&)>&& cb,
                                int64_t roleId) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    // Цель: user_id из тела (для управления чужими ролями) либо сам
    int64_t userId = selfId;
    auto json = req->getJsonObject();
    if (json && (*json).isMember("user_id") && (*json)["user_id"].asInt64() != 0)
        userId = (*json)["user_id"].asInt64();
    if (!canManageRoles(db, selfId, userId)) {
        cb(errResp("Нет прав назначать роль этому пользователю", k403Forbidden)); return;
    }
    auto user = UserModel::findById(userId);
    if (!user) { cb(errResp("User not found", k404NotFound)); return; }

    try {
        auto roleRes = db->execSqlSync("SELECT is_premium FROM roles WHERE id = ?", roleId);
        if (roleRes.empty()) { cb(errResp("Role not found", k404NotFound)); return; }

        int isPremium = roleRes[0]["is_premium"].as<int>();
        if (isPremium > user->subscriptionTier)
            { cb(errResp("This role requires a higher subscription tier", k403Forbidden)); return; }

        db->execSqlSync(
            "INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?,?)", userId, roleId);
        Json::Value resp; resp["status"] = "assigned";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

void RoleController::unassignRole(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb,
                                  int64_t roleId) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    int64_t userId = selfId;
    std::string qp = req->getParameter("user_id");   // DELETE: цель через query-параметр
    if (!qp.empty()) { try { userId = std::stoll(qp); } catch (...) {} }
    if (!canManageRoles(db, selfId, userId)) {
        cb(errResp("Нет прав снимать роль у этого пользователя", k403Forbidden)); return;
    }
    try {
        db->execSqlSync("DELETE FROM user_roles WHERE user_id=? AND role_id=?", userId, roleId);
        Json::Value resp; resp["status"] = "unassigned";
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}
