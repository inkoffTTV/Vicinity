#include "Telegram.h"
#include "../managers/UserRateLimiter.h"
#include "../managers/WSManager.h"
#include "../../shared/crypto/common_consts.h"
#include "Access.h"
#include "Activity.h"
#include "Broadcast.h"
#include "CryptoUtils.h"
#include "JsonUtils.h"
#include "Messages.h"
#include "Notes.h"
#include "TextUtils.h"
#include "WebPush.h"
#include <drogon/HttpClient.h>
#include <drogon/drogon.h>
#include <atomic>
#include <mutex>
#include <set>

using namespace drogon;

namespace {

std::string gToken;
std::string gApi;          // https://api.telegram.org (или мок в e2e)
std::string gSiteUrl;      // ссылка «Открыть в Vicinity», если задан VICINITY_SITE_URL
std::string gBotUsername;
std::mutex gMutex;
HttpClientPtr gClient;
int64_t gOffset = 0;
int gFailures = 0;

constexpr double kPollSeconds = 25;   // длинный опрос getUpdates
constexpr double kRetrySeconds = 3;   // пауза после ошибки сети
constexpr int kCodeTtlSeconds = 600;

std::string escapeHtml(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        if (c == '&') out += "&amp;";
        else if (c == '<') out += "&lt;";
        else if (c == '>') out += "&gt;";
        else out += c;
    }
    return out;
}

bool mentions(const std::string& text, const std::string& username) {
    if (username.empty()) return false;
    const std::string needle = "@" + username;
    for (size_t pos = 0; (pos = text.find(needle, pos)) != std::string::npos;) {
        const size_t end = pos + needle.size();
        if (end == text.size() || !(std::isalnum(static_cast<unsigned char>(text[end])) || text[end] == '_')) return true;
        pos = end;
    }
    return text.find("@everyone") != std::string::npos || text.find("@here") != std::string::npos;
}

// Вызов метода Bot API: JSON в теле, ответ — result (или null при ошибке)
void call(const std::string& method, const Json::Value& body, std::function<void(const Json::Value&)> done = nullptr,
          double timeout = 15) {
    if (gToken.empty() || !gClient) return;
    auto req = HttpRequest::newHttpJsonRequest(body);
    req->setMethod(Post);
    req->setPath("/bot" + gToken + "/" + method);
    gClient->sendRequest(
        req,
        [method, done](ReqResult result, const HttpResponsePtr& resp) {
            Json::Value out;
            const bool ok = result == ReqResult::Ok && resp && JsonUtils::parse(std::string(resp->body()), out) &&
                            out["ok"].asBool();
            if (!ok && method != "getUpdates") {
                // Токен в путь запроса не логируем — только метод и описание ошибки Telegram
                LOG_WARN << "telegram: " << method << " failed: "
                         << (resp ? std::to_string(resp->statusCode()) + " " + out["description"].asString() : "no response");
            }
            if (done) done(ok ? out["result"] : Json::Value());
        },
        timeout);
}

void sendText(int64_t chatId, const std::string& html, std::function<void(int64_t)> sent = nullptr,
              const std::string& url = std::string()) {
    Json::Value body;
    body["chat_id"] = static_cast<Json::Int64>(chatId);
    body["text"] = html;
    body["parse_mode"] = "HTML";
    body["link_preview_options"]["is_disabled"] = true;
    if (!url.empty()) {
        Json::Value btn;
        btn["text"] = "Открыть в Vicinity";
        btn["url"] = url;
        Json::Value row(Json::arrayValue);
        row.append(btn);
        body["reply_markup"]["inline_keyboard"].append(row);
    }
    call("sendMessage", body, [sent](const Json::Value& r) {
        if (sent && r.isObject() && r["message_id"].isIntegral()) sent(r["message_id"].asInt64());
    });
}

// Ответ из Telegram → сообщение в канале Vicinity от имени привязанного пользователя
void postFromTelegram(int64_t chatId, int64_t tgMessageId, int64_t userId, int64_t channelId, const std::string& text) {
    auto db = app().getDbClient();
    std::string why;
    if (Access::channel(db, channelId, userId) != Access::Result::Ok) why = "Этого чата для вас больше нет в Vicinity.";
    else if (const int64_t peer = Access::dmPeer(db, channelId, userId); peer && Access::blockedBetween(db, userId, peer))
        why = "Нельзя написать: один из вас заблокировал другого.";
    else if (text.empty() || !TextUtils::isValidUtf8(text) || TextUtils::utf8Length(text) > Vicinity::MAX_MESSAGE_LEN)
        why = "Сообщение пустое или слишком длинное.";
    else if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Message, userId))
        why = "Слишком часто, подождите несколько секунд.";
    if (!why.empty()) {
        sendText(chatId, escapeHtml(why));
        return;
    }
    auto ins = db->execSqlSync("INSERT INTO messages(channel_id, author_id, text) VALUES(?, ?, ?) RETURNING id",
                               channelId, userId, text);
    Json::Value msg = Messages::load(db, ins[0]["id"].as<int64_t>());
    Json::Value ws = msg;
    ws["type"] = "new_message";
    Broadcast::toChannel(channelId, ws);
    WebPush::notifyMessage(msg, channelId);
    Telegram::notifyMessage(msg, channelId, true);
    Activity::bump(userId, Activity::Kind::Message);
    // Отметка «доставлено» реакцией на свой ответ — без лишнего сообщения в чате
    Json::Value react;
    react["chat_id"] = static_cast<Json::Int64>(chatId);
    react["message_id"] = static_cast<Json::Int64>(tgMessageId);
    Json::Value emoji;
    emoji["type"] = "emoji";
    emoji["emoji"] = "👌";
    react["reaction"].append(emoji);
    call("setMessageReaction", react);
}

void link(int64_t chatId, const Json::Value& from, const std::string& code) {
    auto db = app().getDbClient();
    auto rows = db->execSqlSync(
        "SELECT user_id FROM telegram_link_codes WHERE code = ? AND expires_at > datetime('now')", code);
    if (rows.empty()) {
        sendText(chatId, "Ссылка устарела или уже использована. Откройте Vicinity → Настройки → Уведомления и "
                         "нажмите «Подключить Telegram» ещё раз.");
        return;
    }
    const int64_t userId = rows[0]["user_id"].as<int64_t>();
    const std::string tgUsername = from["username"].isString() ? from["username"].asString() : std::string();
    const std::string tgName = from["first_name"].isString() ? from["first_name"].asString() : std::string();
    db->execSqlSync("DELETE FROM telegram_link_codes WHERE code = ? OR expires_at <= datetime('now')", code);
    db->execSqlSync("DELETE FROM telegram_links WHERE user_id = ? OR chat_id = ?", userId, chatId);
    db->execSqlSync("INSERT INTO telegram_links(user_id, chat_id, tg_username, tg_name) VALUES(?, ?, ?, ?)",
                    userId, chatId, tgUsername, tgName);
    auto u = db->execSqlSync("SELECT display_name, username FROM users WHERE id = ?", userId);
    const std::string who = u.empty() ? "" : u[0]["display_name"].as<std::string>() + " (@" + u[0]["username"].as<std::string>() + ")";
    sendText(chatId,
             "Готово: Telegram подключён к аккаунту Vicinity <b>" + escapeHtml(who) + "</b>.\n\n"
             "Сюда будут приходить личные сообщения, беседы и упоминания, пока вас нет в Vicinity. "
             "Чтобы ответить, нажмите «Ответить» на нужном сообщении: ответ уйдёт в тот же чат.\n\n"
             "Всё, что вы напишете сюда просто так, попадёт в <b>Заметки</b> в Vicinity, а заметки из Vicinity придут сюда.\n\n"
             "Отключить: /stop или в настройках Vicinity.");
    // Открытые вкладки настроек узнают о привязке сразу
    Json::Value ev;
    ev["type"] = "telegram_linked";
    ev["tg_username"] = tgUsername;
    WSManager::instance().sendToUser(userId, JsonUtils::write(ev));
}

void handleUpdate(const Json::Value& upd) {
    const Json::Value& m = upd["message"];
    if (!m.isObject() || m["chat"]["type"].asString() != "private") return;
    const int64_t chatId = m["chat"]["id"].asInt64();
    const std::string text = m["text"].isString() ? m["text"].asString() : std::string();
    auto db = app().getDbClient();

    if (text.rfind("/start", 0) == 0) {
        std::string code = text.size() > 6 ? text.substr(6) : "";
        code.erase(0, code.find_first_not_of(' '));
        if (!code.empty()) return link(chatId, m["from"], code);
        sendText(chatId, "Это бот мессенджера Vicinity. Чтобы получать сюда сообщения, откройте в Vicinity "
                         "Настройки → Уведомления → «Подключить Telegram».");
        return;
    }
    auto linked = db->execSqlSync("SELECT user_id FROM telegram_links WHERE chat_id = ?", chatId);
    if (text == "/stop") {
        if (!linked.empty()) db->execSqlSync("DELETE FROM telegram_links WHERE chat_id = ?", chatId);
        sendText(chatId, linked.empty() ? "Telegram и так не подключён к Vicinity." : "Отключено: сообщения из Vicinity больше не придут.");
        return;
    }
    if (linked.empty()) {
        sendText(chatId, "Telegram не подключён к Vicinity. Подключите его в Настройках → Уведомления.");
        return;
    }
    const int64_t userId = linked[0]["user_id"].as<int64_t>();
    const Json::Value& replyTo = m["reply_to_message"];
    if (!replyTo.isObject()) {
        // Просто сообщение боту — в «Заметки»
        if (text.empty()) {
            sendText(chatId, "Пока в Заметки можно отправлять только текст.");
            return;
        }
        postFromTelegram(chatId, m["message_id"].asInt64(), userId, Notes::channelOf(db, userId), text);
        return;
    }
    auto map = db->execSqlSync("SELECT channel_id FROM telegram_messages WHERE chat_id = ? AND tg_message_id = ?",
                               chatId, replyTo["message_id"].asInt64());
    if (map.empty()) {
        sendText(chatId, "Не нашёл, из какого чата это сообщение. Ответьте на более свежее сообщение из Vicinity.");
        return;
    }
    if (text.empty()) {
        sendText(chatId, "Пока можно отвечать только текстом.");
        return;
    }
    postFromTelegram(chatId, m["message_id"].asInt64(), userId, map[0]["channel_id"].as<int64_t>(), text);
}

void poll() {
    Json::Value body;
    body["offset"] = static_cast<Json::Int64>(gOffset);
    body["timeout"] = static_cast<int>(kPollSeconds);
    body["allowed_updates"].append("message");
    call("getUpdates", body, [](const Json::Value& result) {
        if (!result.isArray()) {
            if (gFailures++ == 0) LOG_WARN << "telegram: getUpdates failed, retrying every " << kRetrySeconds << " s";
            app().getLoop()->runAfter(kRetrySeconds, poll);
            return;
        }
        if (gFailures) LOG_INFO << "telegram: polling restored";
        gFailures = 0;
        for (const auto& upd : result) {
            if (upd["update_id"].isIntegral()) gOffset = std::max<int64_t>(gOffset, upd["update_id"].asInt64() + 1);
            try {
                handleUpdate(upd);
            } catch (const std::exception& e) {
                LOG_WARN << "telegram: update: " << e.what();
            }
        }
        app().getLoop()->queueInLoop(poll);
    }, kPollSeconds + 10);
}

void whoAmI() {
    call("getMe", Json::Value(Json::objectValue), [](const Json::Value& me) {
        if (!me.isObject() || !me["username"].isString()) {
            app().getLoop()->runAfter(kRetrySeconds, whoAmI);
            return;
        }
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gBotUsername = me["username"].asString();
        }
        LOG_INFO << "telegram: bot @" << gBotUsername << " ready";
        // Вебхук мешает getUpdates — снимаем, если когда-то ставили
        call("deleteWebhook", Json::Value(Json::objectValue), [](const Json::Value&) { poll(); });
    });
}

} // namespace

namespace Telegram {

void init() {
    const Json::Value& cfg = app().getCustomConfig()["telegram"];
    gToken = cfg["token"].isString() ? cfg["token"].asString() : std::string();
    gApi = cfg["api"].isString() && !cfg["api"].asString().empty() ? cfg["api"].asString() : "https://api.telegram.org";
    gSiteUrl = app().getCustomConfig()["registration"]["site_url"].asString();
    while (!gSiteUrl.empty() && gSiteUrl.back() == '/') gSiteUrl.pop_back();
    if (gToken.empty()) return;
    gClient = HttpClient::newHttpClient(gApi, app().getLoop());
    whoAmI();
    // Сопоставления «сообщение бота → чат Vicinity» старше 30 дней не нужны
    app().getLoop()->runEvery(3600.0, [] {
        try {
            app().getDbClient()->execSqlSync("DELETE FROM telegram_messages WHERE created_at < datetime('now', '-30 days')");
        } catch (...) {}
    });
}

bool ready() {
    std::lock_guard<std::mutex> lock(gMutex);
    return !gToken.empty() && !gBotUsername.empty();
}

std::string botUsername() {
    std::lock_guard<std::mutex> lock(gMutex);
    return gBotUsername;
}

std::string createLinkCode(int64_t userId) {
    const std::string code = CryptoUtils::randomHex(12);
    auto db = app().getDbClient();
    db->execSqlSync("DELETE FROM telegram_link_codes WHERE user_id = ? OR expires_at <= datetime('now')", userId);
    db->execSqlSync("INSERT INTO telegram_link_codes(code, user_id, expires_at) VALUES(?, ?, datetime('now', ?))",
                    code, userId, "+" + std::to_string(kCodeTtlSeconds) + " seconds");
    return code;
}

void unlink(int64_t userId) {
    auto db = app().getDbClient();
    auto rows = db->execSqlSync("SELECT chat_id FROM telegram_links WHERE user_id = ?", userId);
    if (rows.empty()) return;
    db->execSqlSync("DELETE FROM telegram_links WHERE user_id = ?", userId);
    sendText(rows[0]["chat_id"].as<int64_t>(), "Отключено в настройках Vicinity: сообщения больше не придут.");
}

void notifyMessage(const Json::Value& msg, int64_t channelId, bool fromTelegram) {
    if (!ready()) return;
    try {
        auto db = app().getDbClient();
        const int64_t author = msg["author_id"].asInt64();
        // «Заметки»: владельцу в его Telegram, всегда (не только вне сети), кроме пришедшего из самого Telegram
        if (const int64_t owner = Notes::ownerOf(db, channelId)) {
            if (fromTelegram) return;
            auto l = db->execSqlSync("SELECT chat_id, enabled FROM telegram_links WHERE user_id = ?", owner);
            if (l.empty() || !l[0]["enabled"].as<int>()) return;
            const std::string text = msg["text"].asString();
            std::string body;
            if (msg["kind"].asString() == "voice") body = "[голосовое сообщение]";
            else if (!text.empty()) body = escapeHtml(TextUtils::utf8Truncate(text, 3500));
            else body = msg["attachment_type"].asString() == "file" ? "[файл] " + escapeHtml(msg["attachment_name"].asString()) : "[изображение]";
            if (!text.empty() && !msg["attachment_type"].asString().empty()) body += "\n[вложение]";
            const int64_t chatId = l[0]["chat_id"].as<int64_t>();
            sendText(chatId, "<b>Заметки</b>\n" + body, [chatId, channelId](int64_t tgMessageId) {
                try {
                    app().getDbClient()->execSqlSync(
                        "INSERT OR REPLACE INTO telegram_messages(chat_id, tg_message_id, channel_id) VALUES(?, ?, ?)",
                        chatId, tgMessageId, channelId);
                } catch (...) {}
            });
            return;
        }
        std::set<int64_t> audience = Broadcast::channelAudience(channelId);
        audience.erase(author);
        if (audience.empty()) return;
        auto ch = db->execSqlSync("SELECT type, name, server_id FROM channels WHERE id = ?", channelId);
        if (ch.empty()) return;
        const std::string chType = ch[0]["type"].as<std::string>();
        const int64_t serverId = ch[0]["server_id"].isNull() ? 0 : ch[0]["server_id"].as<int64_t>();
        const std::string chName = ch[0]["name"].isNull() ? "" : ch[0]["name"].as<std::string>();
        std::string serverName;
        if (serverId) {
            auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", serverId);
            if (!s.empty()) serverName = s[0]["name"].as<std::string>();
        }
        const std::string text = msg["text"].asString();
        const std::string kind = msg["kind"].asString();
        std::string body;
        if (kind == "voice") body = "[голосовое сообщение]";
        else if (kind == "call") body = "[пропущенный звонок]";
        else if (!text.empty()) body = escapeHtml(TextUtils::utf8Truncate(text, 3500));
        else body = msg["attachment_type"].asString() == "file" ? "[файл] " + escapeHtml(msg["attachment_name"].asString()) : "[изображение]";
        if (!text.empty() && !msg["attachment_type"].asString().empty()) body += "\n[вложение]";
        std::string where;
        if (serverId) where = " · #" + escapeHtml(chName) + " · " + escapeHtml(serverName);
        else if (chType == "group") where = " · " + escapeHtml(chName);
        const std::string head = "<b>" + escapeHtml(msg["author_name"].asString()) + "</b>" + where;
        const std::string url = gSiteUrl.empty() ? std::string()
                                : gSiteUrl + (serverId ? "/channels/" + std::to_string(serverId) + "/" + std::to_string(channelId)
                                                       : "/channels/@me/" + std::to_string(channelId));

        for (const int64_t uid : audience) {
            auto l = db->execSqlSync(
                "SELECT l.chat_id, l.enabled, l.offline_only, l.servers, u.username FROM telegram_links l "
                "JOIN users u ON u.id = l.user_id WHERE l.user_id = ?", uid);
            if (l.empty() || !l[0]["enabled"].as<int>()) continue;
            if (l[0]["offline_only"].as<int>() && WSManager::instance().isOnline(uid)) continue;
            const bool mentioned = mentions(text, l[0]["username"].as<std::string>());
            if (serverId) {
                const std::string mode = l[0]["servers"].as<std::string>();
                if (mode == "none" || (mode != "all" && !mentioned)) continue;
            }
            const int64_t chatId = l[0]["chat_id"].as<int64_t>();
            sendText(chatId, (mentioned && serverId ? "Упоминание · " : "") + head + "\n" + body,
                     [chatId, channelId](int64_t tgMessageId) {
                         try {
                             app().getDbClient()->execSqlSync(
                                 "INSERT OR REPLACE INTO telegram_messages(chat_id, tg_message_id, channel_id) VALUES(?, ?, ?)",
                                 chatId, tgMessageId, channelId);
                         } catch (...) {}
                     },
                     url);
        }
    } catch (const std::exception& e) {
        LOG_WARN << "telegram: notifyMessage: " << e.what();
    }
}

} // namespace Telegram
