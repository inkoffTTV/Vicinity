#include "AuthController.h"
#include "../models/User.h"
#include "../managers/SessionManager.h"
#include "../managers/SessionManager.h"
#include "../utils/CryptoUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/HttpResponse.h>
#include <drogon/drogon.h>
#include <cctype>

using namespace drogon;

// Разрешённые символы логина: латиница/цифры/._- — чтобы не было пробелов, HTML и т.п.
static bool validUsername(const std::string& u) {
    for (unsigned char c : u)
        if (!std::isalnum(c) && c != '_' && c != '.' && c != '-') return false;
    return true;
}

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

void AuthController::registerUser(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string username    = (*json)["username"].asString();
    std::string password    = (*json)["password"].asString();
    std::string displayName = (*json).get("display_name", username).asString();

    if (username.size() < Vicinity::MIN_USERNAME_LEN ||
        username.size() > Vicinity::MAX_USERNAME_LEN) {
        cb(error("Username must be 3-32 characters", k400BadRequest)); return;
    }
    if (!validUsername(username)) {
        cb(error("Username: only a-z, 0-9, . _ - allowed", k400BadRequest)); return;
    }
    if (password.size() < Vicinity::MIN_PASSWORD_LEN) {
        cb(error("Password must be at least 8 characters", k400BadRequest)); return;
    }
    if (UserModel::findByUsername(username)) {
        cb(error("Username already taken", k409Conflict)); return;
    }

    std::string hash = CryptoUtils::hashPassword(password);
    int64_t id = UserModel::create(username, hash, displayName);
    std::string token = AppSessionManager::instance().createSession(id);

    Json::Value resp;
    resp["token"]        = token;
    resp["user_id"]      = static_cast<Json::Int64>(id);
    resp["display_name"] = displayName;
    cb(jsonResp(std::move(resp), k201Created));
}

void AuthController::login(const HttpRequestPtr& req,
                           std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string username = (*json)["username"].asString();
    std::string password = (*json)["password"].asString();

    auto user = UserModel::findByUsername(username);
    if (!user || !CryptoUtils::verifyPassword(password, user->passwordHash)) {
        cb(error("Invalid credentials", k401Unauthorized)); return;
    }

    // Бесшовный апгрейд старого слабого хэша (SHA-256) на PBKDF2 при успешном входе.
    if (CryptoUtils::needsRehash(user->passwordHash)) {
        try {
            std::string fresh = CryptoUtils::hashPassword(password);
            drogon::app().getDbClient()->execSqlAsync(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                [](const drogon::orm::Result&) {},
                [](const drogon::orm::DrogonDbException&) {},
                fresh, user->id);
        } catch (...) { /* апгрейд best-effort, на вход не влияет */ }
    }

    std::string token = AppSessionManager::instance().createSession(user->id);

    Json::Value resp;
    resp["token"]             = token;
    resp["user_id"]           = static_cast<Json::Int64>(user->id);
    resp["display_name"]      = user->displayName;
    resp["avatar_path"]       = user->avatarPath;
    resp["bio"]               = user->bio;
    resp["accent_color"]      = user->accentColor;
    resp["banner_path"]       = user->bannerPath;
    resp["profile_json"]      = user->profileJson;
    resp["subscription_tier"] = user->subscriptionTier;
    resp["developer"]         = user->developer;
    cb(jsonResp(std::move(resp)));
}

void AuthController::logout(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    std::string token = req->attributes()->get<std::string>("token");
    AppSessionManager::instance().deleteSession(token);
    Json::Value resp;
    resp["status"] = "ok";
    cb(jsonResp(std::move(resp)));
}

void AuthController::me(const HttpRequestPtr& req,
                        std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto user = UserModel::findById(userId);
    if (!user) { cb(error("User not found", k404NotFound)); return; }

    Json::Value resp;
    resp["user_id"]           = static_cast<Json::Int64>(user->id);
    resp["username"]          = user->username;
    resp["display_name"]      = user->displayName;
    resp["avatar_path"]       = user->avatarPath;
    resp["bio"]               = user->bio;
    resp["accent_color"]      = user->accentColor;
    resp["banner_path"]       = user->bannerPath;
    resp["profile_json"]      = user->profileJson;
    resp["pronouns"]          = user->pronouns;
    resp["presence"]          = user->presence;
    resp["created_at"]        = user->createdAt;
    resp["subscription_tier"] = user->subscriptionTier;
    resp["developer"]         = user->developer;
    cb(jsonResp(std::move(resp)));
}
