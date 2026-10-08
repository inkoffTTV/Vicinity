#include "RtcController.h"
#include "../utils/CryptoUtils.h"
#include <drogon/drogon.h>
#include <trantor/utils/Date.h>

using namespace drogon;

// Срок действия временной учётки TURN
static constexpr int64_t kTurnTtlSec = 24 * 60 * 60;

// Строки массива из конфига (остальное пропускаем)
static Json::Value urlList(const Json::Value& arr) {
    Json::Value out(Json::arrayValue);
    if (!arr.isArray()) return out;
    for (const auto& v : arr)
        if (v.isString() && !v.asString().empty()) out.append(v.asString());
    return out;
}

// GET /api/v1/rtc/ice → {ice_servers:[{urls:[stun...]}, {urls:[turn...], username, credential}]}
// Конфиг: custom_config.rtc = {stun:[...], turn:[...], turn_secret:"..."}.
// TURN — временные учётки coturn use-auth-secret: username "<unix_expiry>:<uid>",
// credential = base64(HMAC-SHA1(turn_secret, username)); без секрета отдаётся только STUN.
void RtcController::iceServers(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const Json::Value& custom = app().getCustomConfig();
    const Json::Value rtc = custom.isObject() && custom["rtc"].isObject() ? custom["rtc"] : Json::Value();

    Json::Value servers(Json::arrayValue);
    Json::Value stun(Json::arrayValue);
    if (rtc.isMember("stun")) stun = urlList(rtc["stun"]);
    else stun.append("stun:stun.l.google.com:19302");   // без настройки — тот же STUN, что у десктопа
    if (!stun.empty()) {
        Json::Value stunEntry;
        stunEntry["urls"] = stun;
        servers.append(stunEntry);
    }

    const Json::Value turn = urlList(rtc["turn"]);
    const std::string secret = rtc["turn_secret"].isString() ? rtc["turn_secret"].asString() : "";
    if (!turn.empty() && !secret.empty()) {
        try {
            const int64_t expiry = trantor::Date::now().secondsSinceEpoch() + kTurnTtlSec;
            const std::string username = std::to_string(expiry) + ":" + std::to_string(userId);
            Json::Value turnEntry;
            turnEntry["urls"]       = turn;
            turnEntry["username"]   = username;
            turnEntry["credential"] = CryptoUtils::hmacSha1Base64(secret, username);
            servers.append(turnEntry);
        } catch (const std::exception& e) {
            LOG_ERROR << "TURN credentials: " << e.what();
        }
    }

    Json::Value resp;
    resp["ice_servers"] = servers;
    cb(HttpResponse::newHttpJsonResponse(resp));
}
