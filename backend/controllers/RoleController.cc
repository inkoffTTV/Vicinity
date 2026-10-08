#include "RoleController.h"
#include "../models/User.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
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
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    auto        name      = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), 32);
    std::string color     = JsonUtils::getStr(*json, "color", "#888888");
    int         isPremium = static_cast<int>(JsonUtils::getInt(*json, "is_premium"));
    std::string icon      = JsonUtils::getStr(*json, "icon");

    if (!name)
        { cb(errResp("Role name must be 1-32 characters", k400BadRequest)); return; }
    if (!TextUtils::isHexColor(color))
        { cb(errResp("Color must be #RRGGBB", k400BadRequest)); return; }
    if (isPremium > user->subscriptionTier)
        { cb(errResp("Your subscription tier is insufficient", k403Forbidden)); return; }
    if (!icon.empty() && user->subscriptionTier < 1)
        { cb(errResp("Role icons require Vicinity Basic", k403Forbidden)); return; }

    auto db = app().getDbClient();
    try {
        // id — из того же запроса (last_insert_rowid() отдельным запросом ловит чужие вставки)
        auto res = db->execSqlSync(
            "INSERT INTO roles(name, color, is_premium, icon, created_by) VALUES(?,?,?,?,?) RETURNING id",
            *name, color, isPremium, icon, userId);
        int64_t roleId = res[0]["id"].as<int64_t>();

        Json::Value resp;
        resp["id"] = roleId; resp["name"] = *name;
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

// Роли глобальные (видны во всех серверах), поэтому чужими ролями управляют только
// разработчики (developer = 1, они же создают роли). Себе роль из каталога берёт/снимает
// каждый — это функция «Взять роль» в десктопе, уровень подписки проверяется отдельно.
// Владелец сервера чужие роли не трогает: добавить человека на свой сервер может любой,
// и через это раньше можно было снять/выдать роль кому угодно.
static bool canManageRoles(int64_t self, int64_t target) {
    if (self == target) return true;
    auto me = UserModel::findById(self);
    return me && me->developer == 1;
}

void RoleController::assignRole(const HttpRequestPtr& req,
                                std::function<void(const HttpResponsePtr&)>&& cb,
                                int64_t roleId) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    // Цель: user_id из тела (для управления чужими ролями) либо сам
    int64_t userId = selfId;
    auto json = req->getJsonObject();
    if (json && JsonUtils::getInt(*json, "user_id") > 0) userId = JsonUtils::getInt(*json, "user_id");
    if (!canManageRoles(selfId, userId)) {
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
    if (!canManageRoles(selfId, userId)) {
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
