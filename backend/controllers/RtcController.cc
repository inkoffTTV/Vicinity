#include "RtcController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/Sfu.h"
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

// Срок токена комнаты: на вход; переподключается клиент новым токеном
static constexpr int64_t kSfuTokenTtlSec = 2 * 60 * 60;

// GET /api/v1/rtc/sfu?channel_id=N → {url, room, token, identity} — вход в голосовой канал через SFU
// (docs/VOICE-SFU.md). Те же правила, что у voice_join: голосовой канал сервера, где состоишь, или личка/беседа,
// где участник. SFU не настроен — 404, клиент идёт по-старому (PCM через WebSocket).
void RtcController::sfu(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    if (!Sfu::configured()) { cb(HttpUtils::error("Голос через SFU не настроен", k404NotFound)); return; }
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const int64_t channelId = HttpUtils::intParam(req, "channel_id");
    if (channelId <= 0) { cb(HttpUtils::error("Нужен channel_id", k400BadRequest)); return; }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::VoiceJoin, userId)) {
        cb(HttpUtils::tooManyRequests()); return;
    }
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        if (info.serverId != 0 && !info.isVoice) {
            cb(HttpUtils::error("Это текстовый канал", k400BadRequest)); return;
        }
        auto u = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", userId);
        const std::string name = u.empty() ? "" : u[0]["display_name"].as<std::string>();
        const std::string room = Sfu::roomFor(channelId);
        Json::Value resp;
        resp["url"]      = Sfu::url();
        resp["room"]     = room;
        resp["identity"] = "u" + std::to_string(userId);
        resp["token"]    = Sfu::token(userId, name, room, kSfuTokenTtlSec);
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(HttpUtils::error(HttpUtils::internal(e), k500InternalServerError));
    }
}
