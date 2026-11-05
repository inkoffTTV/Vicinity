#include "TelegramController.h"
#include "../utils/HttpUtils.h"
#include "../utils/Telegram.h"
#include <drogon/drogon.h>

using HttpUtils::error;
using HttpUtils::json;

namespace {

Json::Value statusOf(int64_t userId) {
    Json::Value out;
    out["available"] = Telegram::ready();
    out["bot_username"] = Telegram::botUsername();
    auto rows = app().getDbClient()->execSqlSync(
        "SELECT tg_username, tg_name, enabled, offline_only, servers, linked_at FROM telegram_links WHERE user_id = ?", userId);
    out["linked"] = !rows.empty();
    if (!rows.empty()) {
        out["tg_username"] = rows[0]["tg_username"].as<std::string>();
        out["tg_name"] = rows[0]["tg_name"].as<std::string>();
        out["enabled"] = rows[0]["enabled"].as<int>() != 0;
        out["offline_only"] = rows[0]["offline_only"].as<int>() != 0;
        out["servers"] = rows[0]["servers"].as<std::string>();
        out["linked_at"] = rows[0]["linked_at"].as<std::string>();
    }
    return out;
}

} // namespace

// GET /api/v1/telegram → {available, bot_username, linked, tg_username?, tg_name?, enabled?, offline_only?, servers?}
void TelegramController::status(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        cb(json(statusOf(userId)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/telegram/link → {code, url, expires_in}: ссылка t.me/<бот>?start=<код>, код одноразовый, 10 минут
void TelegramController::link(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    if (!Telegram::ready()) {
        cb(error("Бот Telegram на этом сервере не настроен или ещё подключается — попробуйте через минуту", k503ServiceUnavailable));
        return;
    }
    try {
        const std::string code = Telegram::createLinkCode(userId);
        Json::Value out;
        out["code"] = code;
        out["url"] = "https://t.me/" + Telegram::botUsername() + "?start=" + code;
        out["expires_in"] = 600;
        cb(json(out));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// PATCH /api/v1/telegram {enabled?, offline_only?, servers?: all|mentions|none} → статус
void TelegramController::patch(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto in = req->getJsonObject();
    if (!in || !in->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    try {
        auto db = app().getDbClient();
        if (db->execSqlSync("SELECT 1 FROM telegram_links WHERE user_id = ?", userId).empty()) {
            cb(error("Telegram не подключён", k404NotFound));
            return;
        }
        for (const char* key : {"enabled", "offline_only"}) {
            if (!in->isMember(key)) continue;
            if (!(*in)[key].isBool()) { cb(error(std::string("Некорректное значение: ") + key, k400BadRequest)); return; }
        }
        if (in->isMember("servers")) {
            const std::string v = (*in)["servers"].isString() ? (*in)["servers"].asString() : "";
            if (v != "all" && v != "mentions" && v != "none") { cb(error("Некорректное значение: servers", k400BadRequest)); return; }
            db->execSqlSync("UPDATE telegram_links SET servers = ? WHERE user_id = ?", v, userId);
        }
        if (in->isMember("enabled"))
            db->execSqlSync("UPDATE telegram_links SET enabled = ? WHERE user_id = ?", (*in)["enabled"].asBool() ? 1 : 0, userId);
        if (in->isMember("offline_only"))
            db->execSqlSync("UPDATE telegram_links SET offline_only = ? WHERE user_id = ?", (*in)["offline_only"].asBool() ? 1 : 0, userId);
        cb(json(statusOf(userId)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/telegram → статус (linked: false)
void TelegramController::unlink(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        Telegram::unlink(userId);
        cb(json(statusOf(userId)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}
