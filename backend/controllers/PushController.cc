#include "PushController.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/WebPush.h"
#include <drogon/drogon.h>

using HttpUtils::error;

static constexpr size_t kMaxEndpoint = 2048;
static constexpr size_t kMaxKey      = 256;
static constexpr size_t kMaxPrefs    = 8 * 1024;

// GET /api/v1/push/vapid → {key} — пустой, если сервер не умеет отправлять
void PushController::vapid(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb) {
    Json::Value resp;
    resp["key"] = WebPush::publicKey();
    cb(HttpUtils::json(std::move(resp)));
}

// POST /api/v1/push/subscribe {endpoint, keys:{p256dh, auth}, prefs:{muted:[...], servers:{id:level}}}
// Подписка принадлежит браузеру: тот же endpoint от другого аккаунта переписывается на него
void PushController::subscribe(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string endpoint = JsonUtils::getStr(*json, "endpoint");
    const Json::Value& keys = (*json)["keys"];
    const std::string p256dh = keys.isObject() ? JsonUtils::getStr(keys, "p256dh") : "";
    const std::string auth   = keys.isObject() ? JsonUtils::getStr(keys, "auth") : "";
    // Только https; loopback по http — для автотестов на той же машине
    const bool secure = endpoint.compare(0, 8, "https://") == 0 ||
                        endpoint.compare(0, 17, "http://127.0.0.1:") == 0 || endpoint.compare(0, 17, "http://localhost:") == 0;
    if (!secure || endpoint.size() > kMaxEndpoint ||
        p256dh.empty() || p256dh.size() > kMaxKey || auth.empty() || auth.size() > kMaxKey) {
        cb(error("Некорректная подписка", k400BadRequest)); return;
    }
    Json::Value prefs(Json::objectValue);
    if ((*json)["prefs"].isObject()) {
        prefs["muted"]   = (*json)["prefs"]["muted"].isArray() ? (*json)["prefs"]["muted"] : Json::Value(Json::arrayValue);
        prefs["servers"] = (*json)["prefs"]["servers"].isObject() ? (*json)["prefs"]["servers"] : Json::Value(Json::objectValue);
    }
    const std::string prefsText = JsonUtils::write(prefs);
    if (prefsText.size() > kMaxPrefs) { cb(error("Слишком много настроек", k400BadRequest)); return; }
    try {
        auto owner = app().getDbClient()->execSqlSync("SELECT user_id FROM push_subscriptions WHERE endpoint = ?", endpoint);
        if (!owner.empty() && owner[0]["user_id"].as<int64_t>() != userId) {
            cb(error("Эта подписка принадлежит другому аккаунту", k409Conflict)); return;
        }
        app().getDbClient()->execSqlSync(
            "INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, prefs) VALUES(?, ?, ?, ?, ?) "
            "ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, "
            "auth = excluded.auth, prefs = excluded.prefs",
            userId, endpoint, p256dh, auth, prefsText);
        Json::Value resp;
        resp["ok"] = true;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/push/subscribe {endpoint} — выход или отключение уведомлений на устройстве
void PushController::unsubscribe(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    const std::string endpoint = json && json->isObject() ? JsonUtils::getStr(*json, "endpoint") : "";
    if (endpoint.empty() || endpoint.size() > kMaxEndpoint) { cb(error("Нет endpoint", k400BadRequest)); return; }
    try {
        app().getDbClient()->execSqlSync("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", endpoint, userId);
        Json::Value resp;
        resp["ok"] = true;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}
