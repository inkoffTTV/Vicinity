#include "BotsController.h"
#include "../managers/UserRateLimiter.h"
#include "../models/Cascade.h"
#include "../utils/Access.h"
#include "../utils/Bots.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <algorithm>
#include <cctype>
#include <ctime>
#include <regex>

using namespace drogon;
using HttpUtils::error;

namespace {

constexpr int kMaxBotsPerOwner = 10;
constexpr size_t kMaxDescription = 512;
constexpr size_t kMaxShortDescription = 120;

int64_t uid(const HttpRequestPtr& req) { return req->attributes()->get<int64_t>("user_id"); }

// Бот этого владельца; иначе ответ 404
HttpResponsePtr ownBot(const orm::DbClientPtr& db, int64_t botId, int64_t owner) {
    if (db->execSqlSync("SELECT 1 FROM bots WHERE user_id = ? AND owner_id = ?", botId, owner).empty())
        return error("Бот не найден", k404NotFound);
    return nullptr;
}

HttpResponsePtr ownerOnly(const orm::DbClientPtr& db, int64_t serverId, int64_t userId) {
    const int64_t owner = Access::serverOwner(db, serverId);
    if (owner == 0) return error("Сервер не найден", k404NotFound);
    if (owner != userId) return error("Только владелец сервера может это сделать", k403Forbidden);
    return nullptr;
}

void memberEvent(const char* type, int64_t serverId, int64_t userId) {
    Json::Value ev;
    ev["type"]      = type;
    ev["server_id"] = static_cast<Json::Int64>(serverId);
    ev["user_id"]   = static_cast<Json::Int64>(userId);
    Broadcast::toServer(serverId, ev);
}

Json::Value shortBot(const orm::Row& r) {
    Json::Value b;
    b["id"]           = static_cast<Json::Int64>(r["id"].as<int64_t>());
    b["username"]     = r["username"].as<std::string>();
    b["display_name"] = r["display_name"].as<std::string>();
    b["avatar_path"]  = r["avatar_path"].isNull() ? std::string() : r["avatar_path"].as<std::string>();
    b["description"]  = r["description"].isNull() ? std::string() : r["description"].as<std::string>();
    return b;
}


// ---------- Каталог (docs/API.md §21.9) ----------

// Боты, которых видит пользователь (Bots::kVisibleWhere: публичные, свои, с общего сервера, из общей лички или беседы;
// бот или его владелец заблокирован админом — бота нет нигде), в порядке каталога: свои, с общих серверов, с личкой, по имени.
// Сначала отбор по видимости, потом сортировка и страница — в SQL. name — только бот с этим @именем (пусто — все);
// needle — ASCII-подстрока поиска в нижнем регистре (пусто — без поиска); limit < 0 — без предела
orm::Result visibleBots(const orm::DbClientPtr& db, int64_t viewer, std::string name, std::string needle,
                        int64_t limit, int64_t offset) {
    const std::string sql =
        "SELECT u.id, u.username, u.display_name, u.avatar_path, b.short_description, b.description, "
        "b.is_public, b.owner_id, b.commands, "
        "EXISTS(SELECT 1 FROM server_members v2 JOIN server_members v1 ON v1.server_id = v2.server_id AND v1.user_id = u.id "
        "  WHERE v2.user_id = ?) AS on_server, "
        "EXISTS(SELECT 1 FROM channel_members d2 JOIN channel_members d1 ON d1.channel_id = d2.channel_id AND d1.user_id = u.id "
        "  JOIN channels dc ON dc.id = d2.channel_id AND dc.type = 'dm' WHERE d2.user_id = ?) AS in_dm "
        "FROM bots b JOIN users u ON u.id = b.user_id JOIN users o ON o.id = b.owner_id WHERE " +
        std::string(Bots::kVisibleWhere) +
        " AND (? = '' OR u.username = ? COLLATE NOCASE) "
        "AND (? = '' OR instr(lower(u.display_name), ?) > 0 OR instr('@' || lower(u.username), ?) > 0 "
        "  OR instr(lower(b.short_description), ?) > 0 OR instr(lower(b.description), ?) > 0) "
        "ORDER BY (b.owner_id = ?) DESC, on_server DESC, in_dm DESC, u.display_name COLLATE NOCASE, u.id "
        "LIMIT ? OFFSET ?";
    std::string name2 = name, n2 = needle, n3 = needle, n4 = needle, n5 = needle;
    return db->execSqlSync(sql, viewer, viewer, viewer, viewer, viewer, name, name2, needle, n2, n3, n4, n5, viewer,
                           limit, offset);
}

// Личка ровно этих двоих (0 — нет)
int64_t dmWith(const orm::DbClientPtr& db, int64_t viewer, int64_t botId) {
    auto r = db->execSqlSync(
        "SELECT c.id FROM channel_members m2 JOIN channel_members m1 ON m1.channel_id = m2.channel_id AND m1.user_id = ? "
        "JOIN channels c ON c.id = m2.channel_id AND c.type = 'dm' WHERE m2.user_id = ? "
        "AND (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id = c.id) = 2 ORDER BY c.id LIMIT 1",
        botId, viewer);
    return r.empty() ? 0 : r[0]["id"].as<int64_t>();
}

// Нижний регистр для поиска: ASCII и кириллица (А–Я, Ё)
std::string fold(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        if (c < 0x80) { out += static_cast<char>(std::tolower(c)); continue; }
        if (c == 0xD0 && i + 1 < s.size()) {
            const auto d = static_cast<unsigned char>(s[i + 1]);
            if (d >= 0x90 && d <= 0x9F) { out += static_cast<char>(0xD0); out += static_cast<char>(d + 0x20); ++i; continue; }
            if (d >= 0xA0 && d <= 0xAF) { out += static_cast<char>(0xD1); out += static_cast<char>(d - 0x20); ++i; continue; }
            if (d == 0x81) { out += static_cast<char>(0xD1); out += static_cast<char>(0x91); ++i; continue; }
        }
        out += static_cast<char>(c);
    }
    return out;
}

// Первые n символов UTF-8 (по кодовым точкам)
std::string utf8Prefix(const std::string& s, size_t n) {
    size_t i = 0, count = 0;
    while (i < s.size() && count < n) {
        const auto c = static_cast<unsigned char>(s[i]);
        const size_t len = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : 4;
        i += len;
        ++count;
    }
    return s.substr(0, std::min(i, s.size()));
}

// Короткое описание для списка: short_description, а если его нет — первая строка description (до 120 символов)
std::string shortAbout(const orm::Row& r) {
    std::string s = r["short_description"].isNull() ? std::string() : r["short_description"].as<std::string>();
    if (!s.empty()) return s;
    std::string d = r["description"].isNull() ? std::string() : r["description"].as<std::string>();
    d = TextUtils::trim(d.substr(0, d.find('\n')));
    if (TextUtils::utf8Length(d) > kMaxShortDescription) d = utf8Prefix(d, kMaxShortDescription - 1) + "…";
    return d;
}

// Общие с пользователем серверы бота
Json::Value sharedServers(const orm::DbClientPtr& db, int64_t botId, int64_t viewer) {
    Json::Value arr(Json::arrayValue);
    for (const auto& s : db->execSqlSync(
             "SELECT s.id, s.name FROM servers s JOIN server_members a ON a.server_id = s.id AND a.user_id = ? "
             "JOIN server_members m ON m.server_id = s.id AND m.user_id = ? ORDER BY s.name COLLATE NOCASE", botId, viewer)) {
        Json::Value v;
        v["id"]   = static_cast<Json::Int64>(s["id"].as<int64_t>());
        v["name"] = s["name"].as<std::string>();
        arr.append(v);
    }
    return arr;
}

// Элемент каталога: {id, username, display_name, avatar_path, short_description, is_public, mine, servers, has_dm, dm_channel_id}
Json::Value directoryItem(const orm::DbClientPtr& db, const orm::Row& r, int64_t viewer) {
    Json::Value b;
    const int64_t id = r["id"].as<int64_t>();
    b["id"]                = static_cast<Json::Int64>(id);
    b["username"]          = r["username"].as<std::string>();
    b["display_name"]      = r["display_name"].as<std::string>();
    b["avatar_path"]       = r["avatar_path"].isNull() ? std::string() : r["avatar_path"].as<std::string>();
    b["short_description"] = shortAbout(r);
    b["is_public"]         = r["is_public"].as<int>() != 0;
    b["mine"]              = r["owner_id"].as<int64_t>() == viewer;
    b["servers"]           = sharedServers(db, id, viewer);
    const int64_t dm = r["in_dm"].as<int>() != 0 ? dmWith(db, viewer, id) : 0;
    b["has_dm"]            = dm != 0;
    b["dm_channel_id"]     = static_cast<Json::Int64>(dm);
    return b;
}
} // namespace

// GET /api/v1/bots — мои боты
void BotsController::list(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto db = app().getDbClient();
    try {
        Json::Value arr(Json::arrayValue);
        for (const auto& r : db->execSqlSync("SELECT user_id FROM bots WHERE owner_id = ? ORDER BY user_id", uid(req)))
            arr.append(Bots::botObject(db, r["user_id"].as<int64_t>()));
        Json::Value resp;
        resp["bots"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/bots/directory?q=&limit=&offset= — каталог: боты, видимые пользователю (§21.9)
void BotsController::directory(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = uid(req);
    std::string q = TextUtils::trim(req->getParameter("q"));
    if (!TextUtils::isValidUtf8(q) || TextUtils::utf8Length(q) > 64) { cb(error("Слишком длинный запрос", k400BadRequest)); return; }
    const int64_t limit = std::clamp<int64_t>(HttpUtils::intParam(req, "limit", 50), 1, 100);
    const int64_t offset = std::max<int64_t>(HttpUtils::intParam(req, "offset", 0), 0);
    // Поиск — как другие поиски (30 в минуту), просто список — 60 в минуту
    if (!UserRateLimiter::instance().allow(q.empty() ? UserRateLimiter::Action::Directory : UserRateLimiter::Action::Search, self)) {
        cb(HttpUtils::tooManyRequests()); return;
    }
    auto db = app().getDbClient();
    try {
        const std::string needle = fold(q);
        const bool ascii = std::all_of(needle.begin(), needle.end(), [](unsigned char c) { return c < 0x80; });
        Json::Value arr(Json::arrayValue);
        bool more = false;
        if (ascii) {
            // Поиск латиницей (ники, имена, описания) — целиком в SQL: lower() и instr() точны для ASCII
            const auto rows = visibleBots(db, self, "", needle, limit + 1, offset);
            for (const auto& r : rows) {
                if (static_cast<int64_t>(arr.size()) >= limit) { more = true; break; }
                arr.append(directoryItem(db, r, self));
            }
        } else {
            // Кириллица и прочее: регистр сворачивает fold(), отбор видимых — всё равно в SQL
            int64_t matched = 0;
            for (const auto& r : visibleBots(db, self, "", "", -1, 0)) {
                const std::string hay = fold(r["display_name"].as<std::string>()) + "\n@" + r["username"].as<std::string>() +
                                        "\n" + fold(r["short_description"].as<std::string>()) + "\n" +
                                        fold(r["description"].as<std::string>());
                if (hay.find(needle) == std::string::npos) continue;
                if (matched++ < offset) continue;
                if (static_cast<int64_t>(arr.size()) >= limit) { more = true; break; }
                arr.append(directoryItem(db, r, self));
            }
        }
        Json::Value resp;
        resp["bots"] = arr;
        resp["has_more"] = more;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/bots/by-username/{username} — карточка бота (§21.9); невидимый пользователю бот — 404
void BotsController::card(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                          const std::string& username) {
    const int64_t self = uid(req);
    std::string name = username;
    if (!name.empty() && name[0] == '@') name.erase(0, 1);
    const bool okName = !name.empty() && name.size() <= 32 && std::all_of(name.begin(), name.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '_';
    });
    if (!okName) { cb(error("Бот не найден", k404NotFound)); return; }
    auto db = app().getDbClient();
    try {
        auto rows = visibleBots(db, self, name, "", 1, 0);
        if (rows.empty()) { cb(error("Бот не найден", k404NotFound)); return; }
        const auto& r = rows[0];
        const int64_t id = r["id"].as<int64_t>();
        Json::Value b = directoryItem(db, r, self);
        b["short_description"] = r["short_description"].as<std::string>();
        b["description"] = r["description"].as<std::string>();
        Json::Value commands(Json::arrayValue);
        if (!JsonUtils::parse(r["commands"].as<std::string>(), commands) || !commands.isArray()) commands = Json::Value(Json::arrayValue);
        b["commands"] = commands;
        // Владелец — только тем, кому виден его профиль (знакомые: друзья, общий чат или сервер)
        const int64_t owner = r["owner_id"].as<int64_t>();
        b["owner"] = Json::Value(Json::nullValue);
        if (Access::canSeeProfile(db, self, owner)) {
            auto o = db->execSqlSync("SELECT username, display_name FROM users WHERE id = ?", owner);
            if (!o.empty()) {
                Json::Value ov;
                ov["id"]           = static_cast<Json::Int64>(owner);
                ov["username"]     = o[0]["username"].as<std::string>();
                ov["display_name"] = o[0]["display_name"].as<std::string>();
                b["owner"] = ov;
            }
        }
        const int64_t dm = b["dm_channel_id"].asInt64();
        // Писал ли пользователь боту (сообщение или нажатие кнопки в личке) — иначе в личке кнопка «Начать».
        // Отметка в bot_dm_started не пропадает, даже если сообщение потом удалят
        bool started = false;
        if (dm != 0) {
            started = !db->execSqlSync("SELECT 1 FROM bot_dm_started WHERE channel_id = ? AND user_id = ?", dm, self).empty();
            if (!started && !db->execSqlSync("SELECT 1 FROM messages WHERE channel_id = ? AND author_id = ? LIMIT 1", dm, self).empty()) {
                db->execSqlSync("INSERT OR IGNORE INTO bot_dm_started(channel_id, user_id) VALUES(?, ?)", dm, self);
                started = true;
            }
        }
        b["dm_started"] = started;
        b["blocked"] = Access::blockedBetween(db, self, id);
        b["menu_button"] = Bots::menuButton(db, id, dm);
        Json::Value resp;
        resp["bot"] = b;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/bots {username, display_name} → 201 {bot, token}; токен показывается один раз
void BotsController::create(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = uid(req);
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string username = TextUtils::trim(JsonUtils::getStr(*json, "username"));
    if (!username.empty() && username[0] == '@') username.erase(0, 1);
    std::transform(username.begin(), username.end(), username.begin(), [](unsigned char c) { return std::tolower(c); });
    if (const std::string why = Bots::usernameProblem(username); !why.empty()) { cb(error(why, k400BadRequest)); return; }
    std::string rawName = JsonUtils::getStr(*json, "display_name");
    if (TextUtils::trim(rawName).empty()) rawName = username;
    auto name = TextUtils::cleanName(rawName, Vicinity::MAX_DISPLAY_NAME_LEN);
    if (!name) { cb(error("Имя бота — от 1 до 32 символов", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        if (Bots::isBot(db, self)) { cb(error("Бот не может создавать ботов", k403Forbidden)); return; }
        auto count = db->execSqlSync("SELECT COUNT(*) AS n FROM bots WHERE owner_id = ?", self);
        if (count[0]["n"].as<int>() >= kMaxBotsPerOwner) {
            cb(error("Можно создать не больше 10 ботов — удалите ненужного", k400BadRequest)); return;
        }
        if (!db->execSqlSync("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", username).empty()) {
            cb(error("Имя @" + username + " уже занято", k409Conflict)); return;
        }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::ChannelCreate, self)) {
            cb(HttpUtils::tooManyRequests()); return;
        }
        auto tr = db->newTransaction();
        int64_t botId = 0;
        Bots::Token token;
        try {
            // Пароль '!' не подходит ни под один формат хэша — войти паролем нельзя
            auto ins = tr->execSqlSync(
                "INSERT INTO users(username, password_hash, display_name, is_bot) VALUES(?, '!', ?, 1) RETURNING id",
                username, *name);
            botId = ins[0]["id"].as<int64_t>();
            token = Bots::newToken(botId);
            tr->execSqlSync("INSERT INTO bots(user_id, owner_id, token_hash, token_hint, webapp_key) VALUES(?, ?, ?, ?, ?)",
                            botId, self, token.hash, token.hint, token.webappKey);
        } catch (...) {
            tr->rollback();
            throw;
        }
        tr.reset();   // фиксируем транзакцию до чтения через общий клиент
        Json::Value resp;
        resp["bot"]   = Bots::botObject(db, botId);
        resp["token"] = token.token;
        cb(HttpUtils::json(std::move(resp), k201Created));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// PATCH /api/v1/bots/{id} {display_name?, description?, short_description?, read_all?, is_public?}
void BotsController::update(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        bool renamed = false;
        if (JsonUtils::has(*json, "display_name")) {
            auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "display_name"), Vicinity::MAX_DISPLAY_NAME_LEN);
            if (!name) { cb(error("Имя бота — от 1 до 32 символов", k400BadRequest)); return; }
            db->execSqlSync("UPDATE users SET display_name = ? WHERE id = ?", *name, id);
            renamed = true;
        }
        if (JsonUtils::has(*json, "description")) {
            std::string d = TextUtils::trim(JsonUtils::getStr(*json, "description"));
            if (!TextUtils::isValidUtf8(d) || TextUtils::utf8Length(d) > kMaxDescription || TextUtils::hasControlChars(d, true)) {
                cb(error("Описание — не длиннее 512 символов", k400BadRequest)); return;
            }
            db->execSqlSync("UPDATE bots SET description = ? WHERE user_id = ?", d, id);
        }
        if (JsonUtils::has(*json, "short_description")) {
            std::string d = TextUtils::trim(JsonUtils::getStr(*json, "short_description"));
            if (!TextUtils::isValidUtf8(d) || TextUtils::utf8Length(d) > kMaxShortDescription || TextUtils::hasControlChars(d)) {
                cb(error("Короткое описание — одна строка не длиннее 120 символов", k400BadRequest)); return;
            }
            db->execSqlSync("UPDATE bots SET short_description = ? WHERE user_id = ?", d, id);
        }
        if (JsonUtils::has(*json, "read_all"))
            db->execSqlSync("UPDATE bots SET read_all = ? WHERE user_id = ?", JsonUtils::getBool(*json, "read_all") ? 1 : 0, id);
        if (JsonUtils::has(*json, "is_public"))
            db->execSqlSync("UPDATE bots SET is_public = ? WHERE user_id = ?", JsonUtils::getBool(*json, "is_public") ? 1 : 0, id);
        if (renamed) Broadcast::userUpdated(id);
        Json::Value resp;
        resp["bot"] = Bots::botObject(db, id);
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/bots/{id} — бот, его сообщения и очередь удаляются насовсем
void BotsController::remove(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        // Что увидят открытые клиенты: бот уходит с серверов и из бесед, его сообщения пропадают
        auto servers = db->execSqlSync("SELECT server_id FROM server_members WHERE user_id = ?", id);
        auto chats = db->execSqlSync(
            "SELECT m.channel_id FROM channel_members m JOIN channels c ON c.id = m.channel_id "
            "WHERE m.user_id = ? AND c.server_id IS NULL", id);
        auto msgs = db->execSqlSync(
            "SELECT id, channel_id FROM messages WHERE author_id = ? ORDER BY id DESC LIMIT 1000", id);
        Bots::forget(id, Bots::fail(401, "Unauthorized"));
        Cascade::deleteUser(db, id);
        for (const auto& m : msgs) {
            Json::Value ev;
            ev["type"]       = "message_deleted";
            ev["channel_id"] = static_cast<Json::Int64>(m["channel_id"].as<int64_t>());
            ev["id"]         = static_cast<Json::Int64>(m["id"].as<int64_t>());
            Broadcast::toChannel(m["channel_id"].as<int64_t>(), ev);
        }
        for (const auto& r : servers) memberEvent("server_member_left", r["server_id"].as<int64_t>(), id);
        for (const auto& r : chats) {
            Json::Value ev;
            ev["type"]       = "channel_member_left";
            ev["channel_id"] = static_cast<Json::Int64>(r["channel_id"].as<int64_t>());
            ev["user_id"]    = static_cast<Json::Int64>(id);
            Broadcast::toChannel(r["channel_id"].as<int64_t>(), ev);
        }
        Json::Value resp;
        resp["status"] = "deleted";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/bots/{id}/token — новый токен, старый сразу перестаёт работать
void BotsController::regenerate(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownBot(db, id, uid(req))) { cb(e); return; }
        const Bots::Token token = Bots::newToken(id);
        db->execSqlSync("UPDATE bots SET token_hash = ?, token_hint = ?, webapp_key = ? WHERE user_id = ?", token.hash,
                        token.hint, token.webappKey, id);
        Bots::cancelWaiter(id, Bots::fail(401, "Unauthorized"));
        Json::Value resp;
        resp["bot"]   = Bots::botObject(db, id);
        resp["token"] = token.token;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/servers/{id}/bots — боты-участники сервера (только владелец)
void BotsController::serverBots(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, uid(req))) { cb(e); return; }
        Json::Value arr(Json::arrayValue);
        for (const auto& r : db->execSqlSync(
                 "SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM server_members m "
                 "JOIN users u ON u.id = m.user_id JOIN bots b ON b.user_id = u.id WHERE m.server_id = ? "
                 "ORDER BY u.username", id))
            arr.append(shortBot(r));
        Json::Value resp;
        resp["bots"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/servers/{id}/bots {username} — добавить бота сразу, без приглашения
void BotsController::addToServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string username = TextUtils::trim(JsonUtils::getStr(*json, "username"));
    if (!username.empty() && username[0] == '@') username.erase(0, 1);
    const int64_t botIdParam = JsonUtils::getInt(*json, "bot_id");
    const int64_t self = uid(req);
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Invite, self)) { cb(HttpUtils::tooManyRequests()); return; }
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, self)) { cb(e); return; }
        auto r = botIdParam > 0
            ? db->execSqlSync("SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM users u "
                              "JOIN bots b ON b.user_id = u.id WHERE u.id = ?", botIdParam)
            : db->execSqlSync("SELECT u.id, u.username, u.display_name, u.avatar_path, b.description FROM users u "
                              "JOIN bots b ON b.user_id = u.id WHERE u.username = ? COLLATE NOCASE", username);
        // По id — только бот, которого вы видите (§21.9): перебором номеров чужого приватного бота не добавить.
        // По полному @имени — как личку (§7): имя знает тот, кому его дали; заблокированный админом бот — нигде
        if (r.empty() || (botIdParam > 0 ? !Bots::visibleTo(db, self, r[0]["id"].as<int64_t>())
                                         : !Bots::available(db, r[0]["id"].as<int64_t>()))) {
            cb(error("Бот не найден — проверьте @имя", k404NotFound)); return;
        }
        const int64_t botId = r[0]["id"].as<int64_t>();
        if (Access::isBanned(db, id, botId)) { cb(error("Этот бот заблокирован на сервере", k403Forbidden)); return; }
        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?) RETURNING user_id", id, botId);
        if (!ins.empty()) memberEvent("server_member_joined", id, botId);
        Json::Value resp;
        resp["bot"] = shortBot(r[0]);
        resp["status"] = ins.empty() ? "already_member" : "added";
        cb(HttpUtils::json(std::move(resp), ins.empty() ? k200OK : k201Created));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/servers/{id}/bots/{bid}
void BotsController::removeFromServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                                      int64_t id, int64_t bid) {
    auto db = app().getDbClient();
    try {
        if (auto e = ownerOnly(db, id, uid(req))) { cb(e); return; }
        if (!Bots::isBot(db, bid)) { cb(error("Бот не найден", k404NotFound)); return; }
        auto del = db->execSqlSync("DELETE FROM server_members WHERE server_id = ? AND user_id = ? RETURNING user_id", id, bid);
        if (del.empty()) { cb(error("Этого бота нет на сервере", k404NotFound)); return; }
        memberEvent("server_member_left", id, bid);
        Json::Value resp;
        resp["status"] = "removed";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/channels/{id}/commands — команды ботов канала для подсказок композера
void BotsController::commands(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        const auto acc = Access::channel(db, id, uid(req), &info);
        if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        auto rows = info.serverId
            ? db->execSqlSync("SELECT u.id, u.username, b.commands FROM server_members m JOIN bots b ON b.user_id = m.user_id "
                              "JOIN users u ON u.id = b.user_id WHERE m.server_id = ? ORDER BY u.username", info.serverId)
            : db->execSqlSync("SELECT u.id, u.username, b.commands FROM channel_members m JOIN bots b ON b.user_id = m.user_id "
                              "JOIN users u ON u.id = b.user_id WHERE m.channel_id = ? ORDER BY u.username", id);
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value cmds;
            if (!JsonUtils::parse(r["commands"].as<std::string>(), cmds) || !cmds.isArray()) continue;
            for (const auto& c : cmds) {
                Json::Value item;
                item["bot_id"]       = static_cast<Json::Int64>(r["id"].as<int64_t>());
                item["bot_username"] = r["username"].as<std::string>();
                item["command"]      = JsonUtils::getStr(c, "command");
                item["description"]  = JsonUtils::getStr(c, "description");
                arr.append(item);
            }
        }
        Json::Value resp;
        resp["commands"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/messages/{mid}/callback {data, ephemeral_id?} — нажатие кнопки бота.
// mid = 0 и ephemeral_id — кнопка эфемерного сообщения
void BotsController::press(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id,
                           int64_t mid) {
    const int64_t self = uid(req);
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string data = JsonUtils::getStr(*json, "data");
    if (data.empty() || data.size() > 64) {
        cb(error("Кнопка устарела — попросите бота прислать сообщение снова", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
        const auto acc = Access::channel(db, id, self);
        if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Callback, self)) {
            cb(error("Слишком часто нажимаете — подождите пару секунд", k429TooManyRequests)); return;
        }
        int64_t botId = 0;
        Json::Value msg;
        if (mid == 0) {
            const auto eph = Bots::findEphemeral(JsonUtils::getStr(*json, "ephemeral_id"));
            if (!eph || eph->userId != self || eph->channelId != id) {
                cb(error("Сообщение устарело — попросите бота прислать его снова", k404NotFound)); return;
            }
            botId = eph->botId;
            msg = eph->message;
        } else {
            msg = Messages::load(db, mid);
            if (msg.isNull() || msg["channel_id"].asInt64() != id) { cb(error("Сообщение не найдено", k404NotFound)); return; }
            if (!msg["author_bot"].asBool()) { cb(error("У этого сообщения нет кнопок бота", k400BadRequest)); return; }
            botId = msg["author_id"].asInt64();
        }
        if (!Bots::markupHasCallback(msg["reply_markup"], data)) {
            cb(error("Кнопка устарела — попросите бота прислать сообщение снова", k400BadRequest)); return;
        }
        // Бота убрали с сервера или из беседы — нажатие ему не уходит (и кто нажал, он не узнаёт)
        if (Access::channel(db, id, botId) != Access::Result::Ok) {
            cb(error("Бот больше не в этом чате — кнопка не работает", k400BadRequest)); return;
        }
        std::string queryId = CryptoUtils::randomHex(16);
        // Нажатие в личке с ботом — диалог начат (кнопка «Начать» больше не нужна, docs/API.md §21.9)
        db->execSqlSync("INSERT OR IGNORE INTO bot_dm_started(channel_id, user_id) SELECT id, ? FROM channels WHERE id = ? AND type = 'dm'",
                        self, id);
        db->execSqlSync("INSERT INTO bot_callbacks(id, bot_id, user_id, channel_id, message_id, data) VALUES(?, ?, ?, ?, ?, ?)",
                        queryId, botId, self, id, mid, data);
        Json::Value q;
        q["id"]            = queryId;
        q["from"]          = Bots::tgUser(db, self);
        q["message"]       = Bots::tgMessage(db, msg, botId);
        q["chat_instance"] = std::to_string(id);
        q["data"]          = data;
        if (mid == 0) q["message"]["ephemeral_id"] = msg["ephemeral_id"];
        Json::Value update;
        update["callback_query"] = q;
        Bots::enqueue(db, botId, update);
        Json::Value resp;
        resp["ok"]       = true;
        resp["query_id"] = queryId;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

namespace {

// Ключи theme_params, которые знает telegram-web-app.js; значения — только #rrggbb
const char* const kThemeKeys[] = {"bg_color", "text_color", "hint_color", "link_color", "button_color", "button_text_color",
                                  "secondary_bg_color", "header_bg_color", "bottom_bar_bg_color", "accent_text_color",
                                  "section_bg_color", "section_header_text_color", "section_separator_color",
                                  "subtitle_text_color", "destructive_text_color"};

Json::Value cleanTheme(const Json::Value& in) {
    Json::Value out(Json::objectValue);
    if (!in.isObject()) return out;
    static const std::regex hex("#[0-9a-fA-F]{6}");
    for (const char* k : kThemeKeys) {
        const std::string v = JsonUtils::getStr(in, k);
        if (std::regex_match(v, hex)) out[k] = v;
    }
    return out;
}

// Кнопка web_app с этим адресом есть в кнопках сообщения
bool markupHasWebApp(const Json::Value& markup, const std::string& url) {
    if (!markup.isObject() || !markup["inline_keyboard"].isArray()) return false;
    for (const auto& row : markup["inline_keyboard"])
        if (row.isArray())
            for (const auto& b : row)
                if (b.isObject() && b["web_app"].isObject() && b["web_app"]["url"].isString() &&
                    b["web_app"]["url"].asString() == url)
                    return true;
    return false;
}

} // namespace

// POST /api/v1/bots/{id}/webapp {url, channel_id?, message_id?, ephemeral_id?, theme_params?} — открыть мини-приложение:
// адрес с параметрами telegram-web-app.js во фрагменте и подписанный initData. Адрес — из кнопки сообщения
// (message_id или ephemeral_id) или кнопки меню бота
void BotsController::webApp(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t self = uid(req);
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string url = JsonUtils::getStr(*json, "url");
    const int64_t channelId = JsonUtils::getInt(*json, "channel_id");
    const int64_t messageId = JsonUtils::getInt(*json, "message_id");
    const std::string ephemeralId = JsonUtils::getStr(*json, "ephemeral_id");
    if (!Bots::webAppUrlOk(url)) { cb(error("Мини-приложение открывается только по https-ссылке", k400BadRequest)); return; }
    // Хост самого Vicinity (с любым портом и схемой): с allow-same-origin такая страница вышла бы из песочницы iframe,
    // а соседний порт делит с Vicinity куки. Сравниваем имена так, как их разберёт браузер (Bots::webAppHost)
    const std::string host = Bots::requestHost(req->getHeader("host"));
    if (!host.empty() && Bots::webAppHost(url) == host) {
        cb(error("Мини-приложение не может быть на адресе самого Vicinity", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Callback, self)) {
            cb(error("Слишком часто — подождите пару секунд", k429TooManyRequests)); return;
        }
        auto bot = db->execSqlSync("SELECT u.username, u.display_name, b.webapp_key FROM bots b JOIN users u ON u.id = b.user_id "
                                   "WHERE b.user_id = ? AND u.banned = 0", id);
        if (bot.empty()) { cb(error("Бот не найден", k404NotFound)); return; }
        Access::ChannelInfo info;
        if (channelId > 0) {
            const auto acc = Access::channel(db, channelId, self, &info);
            if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        }
        if (messageId > 0 || !ephemeralId.empty()) {
            if (channelId <= 0) { cb(error("Не указан чат сообщения", k400BadRequest)); return; }
            Json::Value msg;
            if (!ephemeralId.empty()) {
                const auto eph = Bots::findEphemeral(ephemeralId);
                if (!eph || eph->userId != self || eph->channelId != channelId) {
                    cb(error("Сообщение устарело — попросите бота прислать его снова", k404NotFound)); return;
                }
                if (eph->botId == id) msg = eph->message;
            } else {
                msg = Messages::load(db, messageId);
                if (msg.isNull() || msg["channel_id"].asInt64() != channelId) {
                    cb(error("Сообщение не найдено", k404NotFound)); return;
                }
                if (!msg["author_bot"].asBool() || msg["author_id"].asInt64() != id) msg = Json::Value();
            }
            if (!markupHasWebApp(msg["reply_markup"], url)) {
                cb(error("Кнопка устарела — попросите бота прислать сообщение снова", k400BadRequest)); return;
            }
        } else {
            const Json::Value menu = Bots::menuButton(db, id, channelId > 0 ? channelId : 0);
            if (JsonUtils::getStr(menu, "type") != "web_app" || JsonUtils::getStr(menu["web_app"], "url") != url) {
                cb(error("У бота нет такого мини-приложения", k400BadRequest)); return;
            }
        }
        if (channelId > 0 && Access::channel(db, channelId, id) != Access::Result::Ok) {
            cb(error("Бот больше не в этом чате — мини-приложение не открыть", k400BadRequest)); return;
        }

        auto me = db->execSqlSync("SELECT username, display_name FROM users WHERE id = ?", self);
        Json::Value user;
        user["id"]                 = static_cast<Json::Int64>(self);
        user["first_name"]         = me.empty() ? std::string() : me[0]["display_name"].as<std::string>();
        user["username"]           = me.empty() ? std::string() : me[0]["username"].as<std::string>();
        user["language_code"]      = "ru";
        user["allows_write_to_pm"] = true;
        std::string userJson = JsonUtils::write(user);
        while (!userJson.empty() && userJson.back() == '\n') userJson.pop_back();

        const std::string queryId = CryptoUtils::randomHex(16);
        std::vector<std::pair<std::string, std::string>> fields = {
            {"query_id", queryId}, {"user", userJson}, {"auth_date", std::to_string(std::time(nullptr))}};
        if (channelId > 0) {
            // Как у Telegram: «sender» — личка открывшего с самим ботом
            const std::string chatType = info.serverId ? "supergroup" : info.type == "dm" ? "sender" : "group";
            fields.emplace_back("chat_type", chatType);
            fields.emplace_back("chat_instance", std::to_string(channelId));
        }
        db->execSqlSync("INSERT INTO bot_webapp_queries(id, bot_id, user_id, channel_id) VALUES(?, ?, ?, ?)", queryId, id,
                        self, channelId > 0 ? channelId : 0);
        const std::string key = bot[0]["webapp_key"].isNull() ? std::string() : bot[0]["webapp_key"].as<std::string>();
        const std::string initData = Bots::signInitData(fields, key);

        const Json::Value theme = cleanTheme((*json)["theme_params"]);
        std::string params = "tgWebAppData=" + Bots::urlEncode(initData) + "&tgWebAppVersion=7.10&tgWebAppPlatform=web";
        if (!theme.empty()) {
            std::string t = JsonUtils::write(theme);
            while (!t.empty() && t.back() == '\n') t.pop_back();
            params += "&tgWebAppThemeParams=" + Bots::urlEncode(t);
        }
        // Свой фрагмент у адреса: «#/путь» — параметры после «?», «#a=b» — через «&» (так их читает telegram-web-app.js)
        std::string full = url;
        const auto hash = url.find('#');
        if (hash == std::string::npos) full += "#" + params;
        else if (hash + 1 == url.size()) full += params;
        else if (url.find_first_of("?=", hash) != std::string::npos) full += "&" + params;
        else full += "?" + params;

        Json::Value resp;
        resp["url_with_fragment"] = full;
        resp["init_data"]         = initData;
        resp["theme_params"]      = theme;
        resp["signed"]            = key.size() == 64;
        Json::Value b;
        b["id"]           = static_cast<Json::Int64>(id);
        b["username"]     = bot[0]["username"].as<std::string>();
        b["display_name"] = bot[0]["display_name"].as<std::string>();
        resp["bot"] = b;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/bots/{id}/menu_button?channel_id= — кнопка меню бота для шапки лички (setChatMenuButton)
void BotsController::menu(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    int64_t channelId = 0;
    try {
        channelId = std::stoll(req->getParameter("channel_id").empty() ? "0" : req->getParameter("channel_id"));
    } catch (...) {
        cb(error("Неверный channel_id", k400BadRequest)); return;
    }
    auto db = app().getDbClient();
    try {
        if (!Bots::isBot(db, id)) { cb(error("Бот не найден", k404NotFound)); return; }
        if (channelId > 0) {
            const auto acc = Access::channel(db, channelId, uid(req));
            if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        }
        Json::Value resp;
        resp["menu_button"] = Bots::menuButton(db, id, channelId > 0 ? channelId : 0);
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
    }
}
