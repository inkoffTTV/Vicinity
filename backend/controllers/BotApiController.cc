#include "BotApiController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Bots.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../utils/Uploads.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/MultiPart.h>
#include <drogon/drogon.h>
#include <algorithm>
#include <cctype>
#include <ctime>
#include <map>

using namespace drogon;
using Bots::fail;
using Bots::ok;

namespace {

// Параметры метода из любого источника. Вложенные объекты (reply_markup, commands, …) могут прийти
// JSON-строкой (так шлют aiogram и python-telegram-bot в form-urlencoded) — json() их разбирает.
struct Params {
    Json::Value v{Json::objectValue};

    bool has(const char* k) const { return v.isMember(k) && !v[k].isNull(); }

    std::string str(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isString()) return x.asString();
        if (x.isIntegral()) return std::to_string(x.asInt64());
        if (x.isBool()) return x.asBool() ? "true" : "false";
        return "";
    }

    std::optional<int64_t> integer(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isIntegral()) return x.asInt64();
        if (x.isDouble() && x.asDouble() == static_cast<double>(static_cast<int64_t>(x.asDouble())))
            return static_cast<int64_t>(x.asDouble());
        if (x.isString()) {
            const std::string s = TextUtils::trim(x.asString());
            if (s.empty() || s.size() > 20) return std::nullopt;
            size_t i = s[0] == '-' ? 1 : 0;
            if (i == s.size()) return std::nullopt;
            for (size_t k2 = i; k2 < s.size(); ++k2)
                if (!std::isdigit(static_cast<unsigned char>(s[k2]))) return std::nullopt;
            try { return std::stoll(s); } catch (...) { return std::nullopt; }
        }
        return std::nullopt;
    }

    bool boolean(const char* k, bool def = false) const {
        const Json::Value& x = v[k];
        if (x.isBool()) return x.asBool();
        if (x.isIntegral()) return x.asInt64() != 0;
        if (x.isString()) {
            std::string s = x.asString();
            std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
            if (s == "true" || s == "1") return true;
            if (s == "false" || s == "0") return false;
        }
        return def;
    }

    // Объект/массив; строка — разбирается как JSON, а если не разбирается — возвращается как есть
    Json::Value json(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isString()) {
            Json::Value out;
            if (JsonUtils::parse(x.asString(), out)) return out;
        }
        return x;
    }
};

Params collect(const HttpRequestPtr& req) {
    Params p;
    // query и form-urlencoded (Drogon разбирает тело POST сам)
    for (const auto& [k, val] : req->getParameters()) p.v[k] = val;
    if (req->contentType() == CT_APPLICATION_JSON) {
        auto j = req->getJsonObject();
        if (j && j->isObject())
            for (const auto& name : j->getMemberNames()) p.v[name] = (*j)[name];
    } else if (req->contentType() == CT_MULTIPART_FORM_DATA) {
        MultiPartParser mp;
        if (mp.parse(req) == 0)
            for (const auto& [k, val] : mp.getParameters()) p.v[k] = val;
    }
    return p;
}

struct Ctx {
    int64_t bot = 0;
    Params p;
    orm::DbClientPtr db;
};

using Handler = HttpResponsePtr (*)(Ctx&);

HttpResponsePtr tooFast() { return fail(429, "Too Many Requests: retry after 1", 1); }

// chat_id → канал, где бот участник; иначе ответ с ошибкой
HttpResponsePtr chatOf(Ctx& c, int64_t& chatId, Access::ChannelInfo* info = nullptr) {
    if (!c.p.has("chat_id")) return fail(400, "Bad Request: chat_id is empty");
    const auto id = c.p.integer("chat_id");
    if (!id || *id <= 0) return fail(400, "Bad Request: chat not found");
    chatId = *id;
    const auto acc = Access::channel(c.db, chatId, c.bot, info);
    if (acc == Access::Result::NotFound) return fail(400, "Bad Request: chat not found");
    if (acc == Access::Result::Forbidden) return fail(403, "Forbidden: bot is not a member of the chat");
    return nullptr;
}

HttpResponsePtr textOf(const Params& p, std::string& out) {
    const std::string raw = p.str("text");
    if (!TextUtils::isValidUtf8(raw)) return fail(400, "Bad Request: text must be encoded in UTF-8");
    out = Bots::convertText(raw, p.str("parse_mode"));
    if (TextUtils::trim(out).empty()) return fail(400, "Bad Request: message text is empty");
    if (static_cast<int>(TextUtils::utf8Length(out)) > Vicinity::MAX_MESSAGE_LEN)
        return fail(400, "Bad Request: message is too long");
    return nullptr;
}

HttpResponsePtr markupOf(const Params& p, Json::Value& out) {
    std::string err;
    if (!Bots::parseMarkup(p.has("reply_markup") ? p.json("reply_markup") : Json::Value(), out, err))
        return fail(400, "Bad Request: " + err);
    return nullptr;
}

std::optional<std::string> markupColumn(const Json::Value& markup) {
    if (markup.isNull()) return std::nullopt;
    std::string s = JsonUtils::write(markup);
    while (!s.empty() && s.back() == '\n') s.pop_back();
    return s;
}

std::string nowUtc() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S", &tm);
    return buf;
}

// ---------- Методы ----------

HttpResponsePtr getMe(Ctx& c) {
    Json::Value u = Bots::tgUser(c.db, c.bot);
    u.removeMember("language_code");
    auto r = c.db->execSqlSync("SELECT read_all FROM bots WHERE user_id = ?", c.bot);
    u["can_join_groups"] = true;
    u["can_read_all_group_messages"] = !r.empty() && r[0]["read_all"].as<int>() != 0;
    u["supports_inline_queries"] = false;
    u["can_connect_to_business"] = false;
    u["has_main_web_app"] = false;
    return ok(u);
}

HttpResponsePtr sendMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    if (const int64_t peer = Access::dmPeer(c.db, chatId, c.bot); peer && Access::blockedBetween(c.db, c.bot, peer))
        return fail(403, "Forbidden: bot was blocked by the user");
    std::string text;
    if (auto e = textOf(c.p, text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    int64_t replyTo = c.p.integer("reply_to_message_id").value_or(0);
    bool withoutReply = c.p.boolean("allow_sending_without_reply");
    if (c.p.has("reply_parameters")) {
        const Json::Value rp = c.p.json("reply_parameters");
        replyTo = JsonUtils::getInt(rp, "message_id", replyTo);
        withoutReply = JsonUtils::getBool(rp, "allow_sending_without_reply", withoutReply);
    }
    if (replyTo > 0 && c.db->execSqlSync("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?", replyTo, chatId).empty()) {
        if (!withoutReply) return fail(400, "Bad Request: message to be replied not found");
        replyTo = 0;
    }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    Messages::Post post;
    post.text = text;
    if (replyTo > 0) post.replyTo = replyTo;
    post.replyMarkup = markupColumn(markup);
    post.push = false;
    post.activity = false;
    const Json::Value msg = Messages::post(c.db, chatId, c.bot, post);
    return ok(Bots::tgMessage(c.db, msg, c.bot));
}

HttpResponsePtr editMessage(Ctx& c, bool withText) {
    if (c.p.has("inline_message_id")) return fail(400, "Bad Request: inline messages are not supported");
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto mid = c.p.integer("message_id");
    if (!mid || *mid <= 0) return fail(400, "Bad Request: message identifier is not specified");
    auto row = c.db->execSqlSync("SELECT author_id, text, reply_markup, edited FROM messages WHERE id = ? AND channel_id = ?",
                                 *mid, chatId);
    if (row.empty()) return fail(400, "Bad Request: message to edit not found");
    if (row[0]["author_id"].as<int64_t>() != c.bot) return fail(400, "Bad Request: message can't be edited");
    const std::string oldText = row[0]["text"].as<std::string>();
    Json::Value oldMarkup;
    if (row[0]["reply_markup"].isNull() || !JsonUtils::parse(row[0]["reply_markup"].as<std::string>(), oldMarkup))
        oldMarkup = Json::Value(Json::nullValue);
    std::string text = oldText;
    if (withText)
        if (auto e = textOf(c.p, text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    if (text == oldText && markup == oldMarkup)
        return fail(400, "Bad Request: message is not modified: specified new message content and reply markup are "
                         "exactly the same as a current content and reply markup of the message");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    const bool textChanged = text != oldText;
    c.db->execSqlSync("UPDATE messages SET text = ?, reply_markup = ?, edited = CASE WHEN ? THEN 1 ELSE edited END "
                      "WHERE id = ?",
                      text, markupColumn(markup), textChanged ? 1 : 0, *mid);
    const Json::Value msg = Messages::load(c.db, *mid);
    Json::Value ws;
    ws["type"]         = "message_edited";
    ws["channel_id"]   = static_cast<Json::Int64>(chatId);
    ws["id"]           = static_cast<Json::Int64>(*mid);
    ws["text"]         = msg["text"];
    ws["reply_markup"] = msg["reply_markup"];
    ws["edited"]       = msg["edited"];
    Broadcast::toChannel(chatId, ws);
    return ok(Bots::tgMessage(c.db, msg, c.bot, textChanged));
}

HttpResponsePtr editMessageText(Ctx& c) { return editMessage(c, true); }
HttpResponsePtr editMessageReplyMarkup(Ctx& c) { return editMessage(c, false); }

HttpResponsePtr deleteMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto mid = c.p.integer("message_id");
    if (!mid || *mid <= 0) return fail(400, "Bad Request: message identifier is not specified");
    auto row = c.db->execSqlSync("SELECT author_id, attachment FROM messages WHERE id = ? AND channel_id = ?", *mid, chatId);
    if (row.empty()) return fail(400, "Bad Request: message to delete not found");
    if (row[0]["author_id"].as<int64_t>() != c.bot) return fail(400, "Bad Request: message can't be deleted");
    const bool pinned = !c.db->execSqlSync("SELECT 1 FROM pins WHERE message_id = ?", *mid).empty();
    c.db->execSqlSync("DELETE FROM messages WHERE id = ?", *mid);
    if (!row[0]["attachment"].isNull() && !row[0]["attachment"].as<std::string>().empty())
        Uploads::removeByUrl(row[0]["attachment"].as<std::string>());
    c.db->execSqlSync("DELETE FROM reactions WHERE message_id = ?", *mid);
    c.db->execSqlSync("DELETE FROM pins WHERE message_id = ?", *mid);
    c.db->execSqlSync("DELETE FROM bot_callbacks WHERE message_id = ?", *mid);
    Json::Value ws;
    ws["type"]       = "message_deleted";
    ws["channel_id"] = static_cast<Json::Int64>(chatId);
    ws["id"]         = static_cast<Json::Int64>(*mid);
    Broadcast::toChannel(chatId, ws);
    if (pinned) {
        Json::Value pins;
        pins["type"]       = "pins_updated";
        pins["channel_id"] = static_cast<Json::Int64>(chatId);
        Broadcast::toChannel(chatId, pins);
    }
    return ok(true);
}

HttpResponsePtr answerCallbackQuery(Ctx& c) {
    std::string id = c.p.str("callback_query_id");
    const std::string text = c.p.str("text");
    if (!TextUtils::isValidUtf8(text) || TextUtils::utf8Length(text) > 200)
        return fail(400, "Bad Request: answer text must be at most 200 characters");
    const std::string url = c.p.str("url");
    if (!url.empty()) {
        if (url.size() > 512 || !TextUtils::isValidUtf8(url) || TextUtils::hasControlChars(url) ||
            url.find(' ') != std::string::npos ||
            !(url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0))
            return fail(400, "Bad Request: URL_INVALID");
    }
    auto pending = c.db->execSqlSync(
        "SELECT channel_id FROM bot_callbacks WHERE id = ? AND bot_id = ? AND answered = 0 "
        "AND created_at > datetime('now', '-15 minutes')", id, c.bot);
    if (pending.empty()) return fail(400, "Bad Request: query is too old or already answered");
    // Бота убрали из чата после нажатия — ответить нажавшему он уже не может
    if (Access::channel(c.db, pending[0]["channel_id"].as<int64_t>(), c.bot) != Access::Result::Ok)
        return fail(403, "Forbidden: bot is not a member of the chat");
    auto row = c.db->execSqlSync(
        "UPDATE bot_callbacks SET answered = 1 WHERE id = ? AND bot_id = ? AND answered = 0 "
        "RETURNING user_id, channel_id, message_id", id, c.bot);
    if (row.empty()) return fail(400, "Bad Request: query is too old or already answered");
    Json::Value ev;
    ev["type"]       = "callback_answer";
    ev["query_id"]   = id;
    ev["channel_id"] = static_cast<Json::Int64>(row[0]["channel_id"].as<int64_t>());
    ev["message_id"] = static_cast<Json::Int64>(row[0]["message_id"].as<int64_t>());
    ev["show_alert"] = c.p.boolean("show_alert");
    if (!text.empty()) ev["text"] = text;
    if (!url.empty()) ev["url"] = url;
    Broadcast::toUser(row[0]["user_id"].as<int64_t>(), ev);
    return ok(true);
}

HttpResponsePtr setMyCommands(Ctx& c) {
    const Json::Value cmds = c.p.json("commands");
    if (!cmds.isArray()) return fail(400, "Bad Request: commands must be an Array");
    if (cmds.size() > 100) return fail(400, "Bad Request: too many commands (at most 100)");
    Json::Value clean(Json::arrayValue);
    for (const auto& cmd : cmds) {
        std::string name = JsonUtils::getStr(cmd, "command");
        if (!name.empty() && name[0] == '/') name.erase(0, 1);
        const std::string desc = TextUtils::trim(JsonUtils::getStr(cmd, "description"));
        const bool okName = !name.empty() && name.size() <= 32 &&
                            std::all_of(name.begin(), name.end(), [](unsigned char ch) {
                                return std::islower(ch) || std::isdigit(ch) || ch == '_';
                            });
        if (!okName) return fail(400, "Bad Request: BOT_COMMAND_INVALID: command must be 1-32 characters a-z, 0-9, _");
        if (desc.empty() || !TextUtils::isValidUtf8(desc) || TextUtils::utf8Length(desc) > 256 ||
            TextUtils::hasControlChars(desc))
            return fail(400, "Bad Request: BOT_COMMAND_DESCRIPTION_INVALID: description must be 1-256 characters");
        Json::Value item;
        item["command"] = name;
        item["description"] = desc;
        clean.append(item);
    }
    std::string stored = JsonUtils::write(clean);
    c.db->execSqlSync("UPDATE bots SET commands = ? WHERE user_id = ?", stored, c.bot);
    return ok(true);
}

HttpResponsePtr getMyCommands(Ctx& c) {
    auto r = c.db->execSqlSync("SELECT commands FROM bots WHERE user_id = ?", c.bot);
    Json::Value cmds(Json::arrayValue);
    if (r.empty() || !JsonUtils::parse(r[0]["commands"].as<std::string>(), cmds) || !cmds.isArray())
        cmds = Json::Value(Json::arrayValue);
    return ok(cmds);
}

HttpResponsePtr deleteMyCommands(Ctx& c) {
    c.db->execSqlSync("UPDATE bots SET commands = '[]' WHERE user_id = ?", c.bot);
    return ok(true);
}

HttpResponsePtr getChat(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    Json::Value chat = Bots::tgChat(c.db, chatId, c.bot);
    chat["accent_color_id"] = 0;
    chat["max_reaction_count"] = 11;
    // Обязательные поля ChatFullInfo в актуальных библиотеках (aiogram 3)
    for (const char* k : {"unlimited_gifts", "limited_gifts", "unique_gifts", "premium_subscription", "gifts_from_channels"})
        chat["accepted_gift_types"][k] = false;
    return ok(chat);
}

HttpResponsePtr sendChatAction(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    // «печатает…» не чаще раза в 2 с; лишние вызовы молча принимаются
    if (UserRateLimiter::instance().allow(UserRateLimiter::Action::Typing, c.bot)) {
        auto r = c.db->execSqlSync("SELECT display_name FROM users WHERE id = ?", c.bot);
        Json::Value ev;
        ev["type"]       = "typing";
        ev["channel_id"] = static_cast<Json::Int64>(chatId);
        ev["user_id"]    = static_cast<Json::Int64>(c.bot);
        ev["name"]       = r.empty() ? std::string() : r[0]["display_name"].as<std::string>();
        Broadcast::toChannel(chatId, ev, c.bot);
    }
    return ok(true);
}

HttpResponsePtr setWebhook(Ctx& c) {
    const std::string url = TextUtils::trim(c.p.str("url"));
    const bool drop = c.p.boolean("drop_pending_updates");
    if (url.empty()) {
        c.db->execSqlSync("UPDATE bots SET webhook_url = NULL, webhook_secret = NULL WHERE user_id = ?", c.bot);
        if (drop) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
        return ok(true);
    }
    if (const std::string why = Bots::webhookUrlProblem(url); !why.empty()) return fail(400, "Bad Request: " + why);
    const std::string secret = c.p.str("secret_token");
    if (secret.size() > 256 || !std::all_of(secret.begin(), secret.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '_' || ch == '-';
        }))
        return fail(400, "Bad Request: secret token contains unallowed characters");
    std::optional<std::string> secretCol;
    if (!secret.empty()) secretCol = secret;
    std::string urlCopy = url;
    c.db->execSqlSync("UPDATE bots SET webhook_url = ?, webhook_secret = ?, webhook_error = NULL, webhook_error_at = NULL "
                      "WHERE user_id = ?", urlCopy, secretCol, c.bot);
    if (c.p.has("allowed_updates")) Bots::setAllowedUpdates(c.db, c.bot, c.p.json("allowed_updates"));
    if (drop) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
    Bots::cancelWaiter(c.bot, fail(409, "Conflict: terminated by setWebhook request"));
    Bots::flushToWebhook(c.bot);
    return ok(true);
}

HttpResponsePtr deleteWebhook(Ctx& c) {
    c.db->execSqlSync("UPDATE bots SET webhook_url = NULL, webhook_secret = NULL WHERE user_id = ?", c.bot);
    if (c.p.boolean("drop_pending_updates")) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
    return ok(true);
}

HttpResponsePtr getWebhookInfo(Ctx& c) {
    auto r = c.db->execSqlSync(
        "SELECT webhook_url, webhook_error, CAST(strftime('%s', webhook_error_at) AS INTEGER) AS error_at, "
        "(SELECT COUNT(*) FROM bot_updates WHERE bot_id = ?) AS pending FROM bots WHERE user_id = ?",
        c.bot, c.bot);
    Json::Value info;
    info["url"] = r.empty() || r[0]["webhook_url"].isNull() ? std::string() : r[0]["webhook_url"].as<std::string>();
    info["has_custom_certificate"] = false;
    info["pending_update_count"] = r.empty() ? 0 : r[0]["pending"].as<int>();
    if (!r.empty() && !r[0]["webhook_error"].isNull()) {
        info["last_error_message"] = r[0]["webhook_error"].as<std::string>();
        if (!r[0]["error_at"].isNull()) info["last_error_date"] = static_cast<Json::Int64>(r[0]["error_at"].as<int64_t>());
    }
    info["max_connections"] = 40;
    return ok(info);
}

// Расширение Vicinity: сообщение видит только user_id, в истории его нет
HttpResponsePtr sendEphemeralMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto userId = c.p.integer("user_id");
    if (!userId || *userId <= 0) return fail(400, "Bad Request: user_id is empty");
    if (Access::channel(c.db, chatId, *userId) != Access::Result::Ok)
        return fail(400, "Bad Request: user not found in the chat");
    std::string text;
    if (auto e = textOf(c.p, text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    auto u = c.db->execSqlSync("SELECT display_name, avatar_path, accent_color FROM users WHERE id = ?", c.bot);
    const std::string id = CryptoUtils::randomHex(12);
    const std::string created = nowUtc();
    Json::Value msg;
    msg["id"]              = 0;
    msg["channel_id"]      = static_cast<Json::Int64>(chatId);
    msg["author_id"]       = static_cast<Json::Int64>(c.bot);
    msg["author_name"]     = u.empty() ? std::string() : u[0]["display_name"].as<std::string>();
    msg["author_avatar"]   = u.empty() || u[0]["avatar_path"].isNull() ? std::string() : u[0]["avatar_path"].as<std::string>();
    msg["author_tier"]     = 0;
    msg["author_accent"]   = u.empty() || u[0]["accent_color"].isNull() ? std::string() : u[0]["accent_color"].as<std::string>();
    msg["author_style"]    = Json::Value(Json::nullValue);
    msg["author_badge"]    = Json::Value(Json::nullValue);
    msg["author_title"]    = "";
    msg["author_emblem"]   = "";
    msg["author_bot"]      = true;
    msg["text"]            = text;
    msg["created_at"]      = created;
    msg["edited"]          = false;
    msg["attachment"]      = "";
    msg["attachment_url"]  = "";
    msg["attachment_name"] = "";
    msg["attachment_size"] = 0;
    msg["attachment_type"] = "";
    msg["kind"]            = "";
    msg["meta"]            = Json::Value(Json::nullValue);
    msg["reactions"]       = Json::Value(Json::arrayValue);
    msg["reply_to"]        = 0;
    msg["reply"]           = Json::Value(Json::nullValue);
    msg["reply_markup"]    = markup;
    msg["webhook"]         = Json::Value(Json::nullValue);
    msg["ephemeral"]       = true;
    msg["ephemeral_id"]    = id;
    Json::Value ev;
    ev["type"]       = "ephemeral_message";
    ev["channel_id"] = static_cast<Json::Int64>(chatId);
    ev["message"]    = msg;
    Broadcast::toUser(*userId, ev);
    Bots::rememberEphemeral(id, {c.bot, *userId, chatId, msg});

    Json::Value result = Bots::tgMessage(c.db, msg, c.bot);
    result["ephemeral_id"] = id;
    return ok(result);
}

HttpResponsePtr trueResult(Ctx&) { return ok(true); }

const std::map<std::string, Handler>& methods() {
    static const std::map<std::string, Handler> m = {
        {"getme", getMe},
        {"sendmessage", sendMessage},
        {"editmessagetext", editMessageText},
        {"editmessagereplymarkup", editMessageReplyMarkup},
        {"deletemessage", deleteMessage},
        {"answercallbackquery", answerCallbackQuery},
        {"setmycommands", setMyCommands},
        {"getmycommands", getMyCommands},
        {"deletemycommands", deleteMyCommands},
        {"getchat", getChat},
        {"sendchataction", sendChatAction},
        {"setwebhook", setWebhook},
        {"deletewebhook", deleteWebhook},
        {"getwebhookinfo", getWebhookInfo},
        {"sendephemeralmessage", sendEphemeralMessage},
        {"logout", trueResult},
        {"close", trueResult},
    };
    return m;
}

} // namespace

void BotApiController::handle(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                              const std::string& token, const std::string& method) {
    // Токен — часть пути: в лог не пишем ни путь, ни токен
    try {
        auto db = app().getDbClient();
        const int64_t bot = Bots::authenticate(db, token);
        if (!bot) { cb(fail(401, "Unauthorized")); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotApi, bot)) { cb(tooFast()); return; }
        std::string name = method;
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char ch) { return std::tolower(ch); });
        Ctx c{bot, collect(req), db};

        if (name == "getupdates") {
            auto hook = db->execSqlSync("SELECT webhook_url FROM bots WHERE user_id = ?", bot);
            if (!hook.empty() && !hook[0]["webhook_url"].isNull()) {
                cb(fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to "
                             "delete the webhook first"));
                return;
            }
            const int64_t offset = c.p.integer("offset").value_or(0);
            const int limit = static_cast<int>(std::clamp<int64_t>(c.p.integer("limit").value_or(100), 1, 100));
            const int timeout = static_cast<int>(std::clamp<int64_t>(c.p.integer("timeout").value_or(0), 0, 50));
            std::optional<Json::Value> allowed;
            if (c.p.has("allowed_updates")) allowed = c.p.json("allowed_updates");
            Bots::getUpdates(bot, offset, limit, timeout, allowed, std::move(cb));
            return;
        }
        const auto& m = methods();
        auto it = m.find(name);
        if (it == m.end()) { cb(fail(404, "Not Found")); return; }
        cb(it->second(c));
    } catch (const std::exception& e) {
        LOG_ERROR << "bot api: " << method << ": " << e.what();
        cb(fail(500, "Internal Server Error"));
    }
}
