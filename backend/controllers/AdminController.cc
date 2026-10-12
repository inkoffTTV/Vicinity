#include "AdminController.h"
#include "../models/Cascade.h"
#include "../models/User.h"
#include "../managers/SessionManager.h"
#include "../utils/Broadcast.h"
#include "../utils/JsonUtils.h"
#include "../utils/NetUtils.h"
#include "../utils/TextUtils.h"
#include <drogon/drogon.h>

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

// Запрос от разработчика (developer = 1)? Иначе сразу отвечает 403.
static bool requireAdmin(const HttpRequestPtr& req, const std::function<void(const HttpResponsePtr&)>& cb) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    auto me = UserModel::findById(self);
    if (me && me->developer == 1) return true;
    cb(error("Только для администраторов", k403Forbidden));
    return false;
}

static std::string str(const drogon::orm::Field& f) { return f.isNull() ? std::string() : f.as<std::string>(); }

// Заблокировать аккаунт: вход и все запросы отклоняются, открытые сеансы закрываются,
// из чужих серверов он выходит (чтобы не висел в списках участников)
static void banUser(int64_t id) {
    auto db = drogon::app().getDbClient();
    db->execSqlSync("UPDATE users SET banned = 1 WHERE id = ?", id);
    AppSessionManager::instance().deleteAllSessions(id);
    db->execSqlSync("DELETE FROM server_members WHERE user_id = ? AND server_id NOT IN "
                    "(SELECT id FROM servers WHERE owner_id = ?)", id, id);
}

// GET /api/v1/admin/users?q=&limit= — пользователи (новые первыми) и самые частые IP регистраций за неделю
void AdminController::listUsers(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    if (!requireAdmin(req, cb)) return;
    const std::string q = TextUtils::trim(req->getParameter("q"));
    int limit = 200;
    try { if (!req->getParameter("limit").empty()) limit = std::stoi(req->getParameter("limit")); } catch (...) {}
    if (limit < 1 || limit > 1000) limit = 200;
    try {
        auto db = drogon::app().getDbClient();
        // Поиск по логину, имени, почте или IP; % и _ в запросе — обычные символы
        std::string like;
        for (char c : q) { if (c == '%' || c == '_' || c == '\\') like += '\\'; like += c; }
        like = "%" + like + "%";
        auto rows = db->execSqlSync(
            "SELECT id, username, display_name, avatar_path, email, signup_ip, created_at, banned, developer, "
            "subscription_tier FROM users "
            "WHERE ? = '' OR username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' "
            "OR email LIKE ? ESCAPE '\\' OR signup_ip LIKE ? ESCAPE '\\' "
            "ORDER BY id DESC LIMIT ?",
            q, like, like, like, like, limit);
        Json::Value users(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value u;
            u["id"]                = static_cast<Json::Int64>(r["id"].as<int64_t>());
            u["username"]          = str(r["username"]);
            u["display_name"]      = str(r["display_name"]);
            u["avatar_path"]       = str(r["avatar_path"]);
            u["email"]             = str(r["email"]);
            u["signup_ip"]         = str(r["signup_ip"]);
            u["created_at"]        = str(r["created_at"]);
            u["banned"]            = r["banned"].as<int>() != 0;
            u["developer"]         = r["developer"].as<int>() != 0;
            u["subscription_tier"] = r["subscription_tier"].as<int>();
            users.append(u);
        }
        auto totals = db->execSqlSync(
            "SELECT COUNT(*) AS total, "
            "SUM(created_at > datetime('now', '-1 day')) AS day, "
            "SUM(banned) AS banned FROM users");
        auto ips = db->execSqlSync(
            "SELECT signup_ip, COUNT(*) AS n, MAX(created_at) AS last FROM users "
            "WHERE signup_ip IS NOT NULL AND created_at > datetime('now', '-7 days') "
            "GROUP BY signup_ip HAVING n > 1 ORDER BY n DESC LIMIT 10");
        Json::Value top(Json::arrayValue);
        for (const auto& r : ips) {
            Json::Value t;
            t["ip"]    = str(r["signup_ip"]);
            t["count"] = static_cast<Json::Int64>(r["n"].as<int64_t>());
            t["last"]  = str(r["last"]);
            top.append(t);
        }
        Json::Value resp;
        resp["users"]   = users;
        resp["top_ips"] = top;
        resp["total"]   = static_cast<Json::Int64>(totals[0]["total"].as<int64_t>());
        resp["last_day"] = static_cast<Json::Int64>(totals[0]["day"].isNull() ? 0 : totals[0]["day"].as<int64_t>());
        resp["banned"]  = static_cast<Json::Int64>(totals[0]["banned"].isNull() ? 0 : totals[0]["banned"].as<int64_t>());
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/admin/users/{id}/ban {banned: true|false}
void AdminController::setBanned(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                                int64_t id) {
    if (!requireAdmin(req, cb)) return;
    auto json = req->getJsonObject();
    const bool banned = json ? JsonUtils::getBool(*json, "banned", true) : true;
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    auto target = UserModel::findById(id);
    if (!target) { cb(error("Пользователь не найден", k404NotFound)); return; }
    if (banned && (id == self || target->developer == 1)) {
        cb(error("Администратора заблокировать нельзя", k403Forbidden)); return;
    }
    try {
        if (banned) banUser(id);
        else drogon::app().getDbClient()->execSqlSync("UPDATE users SET banned = 0 WHERE id = ?", id);
        Json::Value resp;
        resp["id"]     = static_cast<Json::Int64>(id);
        resp["banned"] = banned;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/admin/users/{id}/tier {tier: 0..3} — выдать или снять подписку (оплаты нет, выдаёт администратор)
void AdminController::setTier(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                              int64_t id) {
    if (!requireAdmin(req, cb)) return;
    auto json = req->getJsonObject();
    if (!json || !json->isObject() || !(*json)["tier"].isIntegral()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const int tier = (*json)["tier"].asInt();
    if (tier < 0 || tier > 3) { cb(error("Уровень подписки — от 0 до 3", k400BadRequest)); return; }
    if (!UserModel::findById(id)) { cb(error("Пользователь не найден", k404NotFound)); return; }
    try {
        drogon::app().getDbClient()->execSqlSync("UPDATE users SET subscription_tier = ? WHERE id = ?", tier, id);
        Json::Value resp;
        resp["id"]   = static_cast<Json::Int64>(id);
        resp["tier"] = tier;
        cb(jsonResp(std::move(resp)));
        Broadcast::userUpdated(id);   // значок у ника обновится у друзей и на общих серверах
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/admin/users/{id} — удалить заблокированный аккаунт со всеми его сообщениями
void AdminController::deleteUser(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t id) {
    if (!requireAdmin(req, cb)) return;
    auto target = UserModel::findById(id);
    if (!target) { cb(error("Пользователь не найден", k404NotFound)); return; }
    // Защита от случайного клика: удалить можно только того, кого уже заблокировали
    if (!target->banned) { cb(error("Сначала заблокируйте аккаунт", k409Conflict)); return; }
    if (target->developer == 1) { cb(error("Администратора удалить нельзя", k403Forbidden)); return; }
    try {
        auto db = drogon::app().getDbClient();
        AppSessionManager::instance().deleteAllSessions(id);
        // Его серверы удаляются вместе с ним (иначе их владелец указывал бы на несуществующий аккаунт)
        auto owned = db->execSqlSync("SELECT id FROM servers WHERE owner_id = ?", id);
        for (const auto& r : owned) Cascade::deleteServer(db, r["id"].as<int64_t>());
        Cascade::deleteUser(db, id);
        Json::Value resp;
        resp["status"] = "ok";
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/admin/blocked-ips
void AdminController::listBlocked(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    if (!requireAdmin(req, cb)) return;
    try {
        auto rows = drogon::app().getDbClient()->execSqlSync(
            "SELECT b.ip, b.note, b.created_at, "
            "(SELECT COUNT(*) FROM users u WHERE u.signup_ip = b.ip) AS accounts "
            "FROM blocked_ips b ORDER BY b.created_at DESC");
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value b;
            b["ip"]         = str(r["ip"]);
            b["note"]       = str(r["note"]);
            b["created_at"] = str(r["created_at"]);
            b["accounts"]   = static_cast<Json::Int64>(r["accounts"].as<int64_t>());
            arr.append(b);
        }
        Json::Value resp;
        resp["blocked"] = arr;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/admin/blocked-ips {ip, note, ban_accounts} — запретить регистрацию с адреса;
// ban_accounts — заодно заблокировать все аккаунты, зарегистрированные с него (кроме администраторов)
void AdminController::blockIp(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    if (!requireAdmin(req, cb)) return;
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string ip = TextUtils::trim(JsonUtils::getStr(*json, "ip"));
    NetUtils::Cidr parsed;
    if (ip.empty() || ip.find('/') != std::string::npos || !NetUtils::parseCidr(ip, parsed)) {
        cb(error("Некорректный IP-адрес", k400BadRequest)); return;
    }
    if (ip == NetUtils::clientIp(req)) { cb(error("Это ваш собственный адрес", k400BadRequest)); return; }
    // Обычная (не const) строка: SqlBinder Drogon не умеет привязывать const-временные строки
    std::string note = TextUtils::cleanName(JsonUtils::getStr(*json, "note"), 200, true).value_or("");
    try {
        auto db = drogon::app().getDbClient();
        db->execSqlSync("INSERT OR REPLACE INTO blocked_ips(ip, note) VALUES(?, NULLIF(?, ''))", ip, note);
        int bannedCount = 0;
        if (JsonUtils::getBool(*json, "ban_accounts")) {
            auto rows = db->execSqlSync(
                "SELECT id FROM users WHERE signup_ip = ? AND developer = 0 AND banned = 0", ip);
            for (const auto& r : rows) { banUser(r["id"].as<int64_t>()); ++bannedCount; }
        }
        Json::Value resp;
        resp["ip"]     = ip;
        resp["banned"] = bannedCount;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/admin/blocked-ips/{ip}
void AdminController::unblockIp(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                                const std::string& ip) {
    if (!requireAdmin(req, cb)) return;
    try {
        drogon::app().getDbClient()->execSqlSync("DELETE FROM blocked_ips WHERE ip = ?", ip);
        Json::Value resp;
        resp["status"] = "ok";
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
