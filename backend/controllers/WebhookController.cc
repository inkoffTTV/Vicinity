#include "WebhookController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Bots.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>

using namespace drogon;
using HttpUtils::error;

namespace {

constexpr int kMaxPerServer = 25;
constexpr size_t kMaxName = 32;

HttpResponsePtr ownerOnly(const orm::DbClientPtr& db, int64_t serverId, int64_t userId) {
    const int64_t owner = Access::serverOwner(db, serverId);
    if (owner == 0) return error("Сервер не найден", k404NotFound);
    if (owner != userId) return error("Только владелец сервера может это сделать", k403Forbidden);
    return nullptr;
}

Json::Value hookJson(const orm::Row& r) {
    Json::Value w;
    w["id"]           = static_cast<Json::Int64>(r["id"].as<int64_t>());
    w["channel_id"]   = static_cast<Json::Int64>(r["channel_id"].as<int64_t>());
    w["channel_name"] = r["channel_name"].isNull() ? std::string() : r["channel_name"].as<std::string>();
    w["name"]         = r["name"].as<std::string>();
    w["created_by"]   = static_cast<Json::Int64>(r["created_by"].as<int64_t>());
    w["created_at"]   = r["created_at"].isNull() ? std::string() : r["created_at"].as<std::string>();
    return w;
}

const char* kSelect =
    "SELECT w.id, w.channel_id, c.name AS channel_name, w.name, w.created_by, w.created_at FROM webhooks w "
    "LEFT JOIN channels c ON c.id = w.channel_id ";

// Текст из вложений в стиле Discord (embeds): заголовок (ссылкой, если есть url) и описание
std::string embedsText(const Json::Value& embeds) {
    std::string out;
    if (!embeds.isArray()) return out;
    for (const auto& e : embeds) {
        if (!e.isObject()) continue;
        const std::string title = JsonUtils::getStr(e, "title"), url = JsonUtils::getStr(e, "url"),
                          desc = JsonUtils::getStr(e, "description");
        std::string part;
        if (!title.empty())
            part = "**" + (url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0 ? "[" + title + "](" + url + ")"
                                                                                         : title) + "**";
        if (!desc.empty()) part += (part.empty() ? "" : "\n") + desc;
        if (part.empty()) continue;
        out += (out.empty() ? "" : "\n\n") + part;
    }
    return out;
}

} // namespace

// GET /api/v1/servers/{id}/webhooks
void WebhookController::list(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, req->attributes()->get<int64_t>("user_id"))) { cb(e); return; }
        Json::Value arr(Json::arrayValue);
        for (const auto& r : db->execSqlSync(std::string(kSelect) + "WHERE w.server_id = ? ORDER BY w.id", id))
            arr.append(hookJson(r));
        Json::Value resp;
        resp["webhooks"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/webhooks {channel_id, name} → 201 {webhook, url}; url (с секретом) — один раз
void WebhookController::create(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const int64_t channelId = JsonUtils::getInt(*json, "channel_id");
    auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), kMaxName);
    if (!name) { cb(error("Название вебхука — от 1 до 32 символов", k400BadRequest)); return; }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::ChannelCreate, self)) {
        cb(HttpUtils::tooManyRequests()); return;
    }
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, self)) { cb(e); return; }
        auto ch = db->execSqlSync("SELECT is_voice FROM channels WHERE id = ? AND server_id = ?", channelId, id);
        if (ch.empty()) { cb(error("Канал не найден на этом сервере", k404NotFound)); return; }
        if (!ch[0]["is_voice"].isNull() && ch[0]["is_voice"].as<int>() != 0) {
            cb(error("Вебхук пишет только в текстовый канал", k400BadRequest)); return;
        }
        auto n = db->execSqlSync("SELECT COUNT(*) AS n FROM webhooks WHERE server_id = ?", id);
        if (n[0]["n"].as<int>() >= kMaxPerServer) {
            cb(error("На сервере уже 25 вебхуков — удалите ненужные", k400BadRequest)); return;
        }
        const std::string token = CryptoUtils::randomHex(24);
        std::string hash = CryptoUtils::sha256Hex(token);
        auto ins = db->execSqlSync(
            "INSERT INTO webhooks(server_id, channel_id, name, token_hash, created_by) VALUES(?, ?, ?, ?, ?) RETURNING id",
            id, channelId, *name, hash, self);
        const int64_t wid = ins[0]["id"].as<int64_t>();
        auto row = db->execSqlSync(std::string(kSelect) + "WHERE w.id = ?", wid);
        Json::Value resp;
        resp["webhook"] = hookJson(row[0]);
        resp["url"] = "/api/v1/webhooks/" + std::to_string(wid) + "/" + token;
        cb(HttpUtils::json(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/servers/{id}/webhooks/{wid}
void WebhookController::remove(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id,
                               int64_t wid) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, req->attributes()->get<int64_t>("user_id"))) { cb(e); return; }
        auto del = db->execSqlSync("DELETE FROM webhooks WHERE id = ? AND server_id = ? RETURNING id", wid, id);
        if (del.empty()) { cb(error("Вебхук не найден", k404NotFound)); return; }
        Json::Value resp;
        resp["status"] = "deleted";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/webhooks/{id}/{token} {content|text, username?, embeds?, reply_markup?} → 204
// (?wait=true → 200 и объект сообщения, как в Discord)
void WebhookController::execute(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id,
                                const std::string& token) {
    auto db = app().getDbClient();
    try {
        // Создатель вебхука должен оставаться владельцем сервера и не быть заблокирован на сайте
        auto hook = db->execSqlSync(
            "SELECT w.channel_id, w.name, w.token_hash, w.created_by, "
            "(s.owner_id = w.created_by AND u.banned = 0) AS live FROM webhooks w "
            "LEFT JOIN servers s ON s.id = w.server_id LEFT JOIN users u ON u.id = w.created_by WHERE w.id = ?", id);
        if (hook.empty() || token.size() > 128 ||
            !CryptoUtils::constTimeEquals(CryptoUtils::sha256Hex(token), hook[0]["token_hash"].as<std::string>())) {
            cb(error("Неверный адрес вебхука", k401Unauthorized)); return;
        }
        if (hook[0]["live"].isNull() || hook[0]["live"].as<int>() == 0) {
            cb(error("Вебхук отключён: его создатель больше не владеет сервером", k403Forbidden)); return;
        }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Webhook, id)) {
            auto resp = error("Слишком часто: не больше 30 сообщений в минуту", k429TooManyRequests);
            resp->addHeader("Retry-After", "2");
            cb(resp); return;
        }
        Json::Value body;
        if (auto j = req->getJsonObject(); j && j->isObject()) body = *j;
        else if (!JsonUtils::parse(std::string(req->body()), body) || !body.isObject()) {
            cb(error("Ожидается JSON {\"content\": \"текст\"}", k400BadRequest)); return;
        }
        std::string text = JsonUtils::getStr(body, "content");
        if (text.empty()) text = JsonUtils::getStr(body, "text");
        if (text.empty()) text = embedsText(body["embeds"]);
        if (TextUtils::trim(text).empty() || !TextUtils::isValidUtf8(text) ||
            static_cast<int>(TextUtils::utf8Length(text)) > Vicinity::MAX_MESSAGE_LEN) {
            cb(error("Текст сообщения — от 1 до 4096 символов (поле content)", k400BadRequest)); return;
        }
        std::string name = hook[0]["name"].as<std::string>();
        if (const std::string u = JsonUtils::getStr(body, "username"); !u.empty())
            if (auto clean = TextUtils::cleanName(u, kMaxName, true)) name = *clean;
        Json::Value markup;
        std::string err;
        if (!Bots::parseMarkup(body["reply_markup"], markup, err, true)) { cb(error(err, k400BadRequest)); return; }

        Messages::Post post;
        post.text = text;
        post.webhookId = id;
        post.webhookName = name;
        if (!markup.isNull()) {
            std::string m = JsonUtils::write(markup);
            while (!m.empty() && m.back() == '\n') m.pop_back();
            post.replyMarkup = m;
        }
        post.push = false;
        post.activity = false;
        const Json::Value msg = Messages::post(db, hook[0]["channel_id"].as<int64_t>(), hook[0]["created_by"].as<int64_t>(), post);
        if (req->getParameter("wait") == "true") {
            cb(HttpUtils::json(msg));
            return;
        }
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k204NoContent);
        cb(resp);
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}
