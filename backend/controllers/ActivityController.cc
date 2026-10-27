#include "ActivityController.h"
#include "../managers/UserRateLimiter.h"
#include "../models/User.h"
#include "../utils/Activity.h"
#include "../utils/Broadcast.h"
#include "../utils/Gifts.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Privacy.h"
#include <drogon/drogon.h>

using HttpUtils::error;

// GET /api/v1/activity/me → {activity:{...}, catalog:[...]}
void ActivityController::me(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    Json::Value resp;
    resp["activity"] = Activity::summary(userId);
    resp["catalog"]  = Activity::catalog();
    cb(HttpUtils::json(std::move(resp)));
}

// GET /api/v1/activity/leaderboard → {users:[...]} — друзья и я по убыванию опыта
void ActivityController::leaderboard(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    Json::Value resp;
    resp["users"] = Activity::leaderboard(userId);
    cb(HttpUtils::json(std::move(resp)));
}

// POST /api/v1/activity/equip {title, emblem} — надеть заработанные ("" — снять)
void ActivityController::equip(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string err;
    if (!Activity::equip(userId, JsonUtils::getStr(*json, "title"), JsonUtils::getStr(*json, "emblem"), err)) {
        cb(error(err, k400BadRequest)); return;
    }
    Json::Value resp;
    resp["activity"] = Activity::summary(userId);
    cb(HttpUtils::json(std::move(resp)));
}

// GET /api/v1/settings/privacy → {status, stats, dm, friend_requests}
void ActivityController::getPrivacy(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    cb(HttpUtils::json(Privacy::get(userId)));
}

// PATCH /api/v1/settings/privacy {любые поля} → все поля
void ActivityController::patchPrivacy(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    try {
        Json::Value out;
        std::string err;
        if (!Privacy::patch(userId, *json, out, err)) { cb(error("Некорректное значение: " + err, k400BadRequest)); return; }
        // Статус мог стать скрытым или открытым — контакты узнают новое значение
        Broadcast::presence(userId);
        cb(HttpUtils::json(std::move(out)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/gifts/{code} → {tier, name, days, redeemed} — что внутри подарка (по ссылке /gift/<код>)
void ActivityController::giftInfo(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& code) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, userId)) { cb(HttpUtils::tooManyRequests()); return; }
    Json::Value info;
    if (!Gifts::info(code, info)) { cb(error("Такого подарка нет", k404NotFound)); return; }
    cb(HttpUtils::json(std::move(info)));
}

// POST /api/v1/gifts/redeem {code} → {tier, until, name}
void ActivityController::giftRedeem(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, userId)) { cb(HttpUtils::tooManyRequests()); return; }
    Json::Value out;
    std::string err;
    int status = 0;
    if (!Gifts::redeem(userId, JsonUtils::getStr(*json, "code"), out, err, status)) {
        cb(error(err, status == 404 ? k404NotFound : status == 409 ? k409Conflict : k400BadRequest)); return;
    }
    cb(HttpUtils::json(std::move(out)));
}
