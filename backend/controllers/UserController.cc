#include "UserController.h"
#include "../utils/HttpUtils.h"
#include "../models/User.h"
#include "../utils/Access.h"
#include "../utils/Activity.h"
#include "../utils/Privacy.h"
#include "../utils/PresenceUtil.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/ProfileExt.h"
#include "../utils/TextUtils.h"
#include "../managers/UserRateLimiter.h"
#include <random>
#include <drogon/HttpResponse.h>

using namespace drogon;
using namespace drogon::orm;

// Бейджи выводятся из существующих полей (developer / подписка)
static Json::Value computeBadges(const User& u) {
    Json::Value arr(Json::arrayValue);
    if (u.developer) {
        Json::Value b; b["id"] = "dev"; b["label"] = "Разработчик"; b["color"] = "#5865f2"; arr.append(b);
    }
    if (u.subscriptionTier == 1) { Json::Value b; b["id"]="basic";    b["label"]="Basic";    b["color"]="#9e9e9e"; arr.append(b); }
    if (u.subscriptionTier == 2) { Json::Value b; b["id"]="standard"; b["label"]="Standard"; b["color"]="#42a5f5"; arr.append(b); }
    if (u.subscriptionTier == 3) { Json::Value b; b["id"]="ultra";    b["label"]="Ultra";    b["color"]="#ce93d8"; arr.append(b); }
    return arr;
}

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto r = HttpResponse::newHttpJsonResponse(std::move(body));
    r->setStatusCode(code);
    return r;
}
static HttpResponsePtr errResp(const std::string& msg, HttpStatusCode code) {
    Json::Value v; v["error"] = msg;
    return jsonResp(std::move(v), code);
}

// GET /api/v1/users/search?q=tag
void UserController::search(const HttpRequestPtr& req,
                           std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    // Только точный ник целиком (без учёта регистра): по части ника или по имени людей не найти —
    // чтобы аккаунты нельзя было перебирать поиском. Ведущий @ и пробелы по краям убираются.
    std::string q = TextUtils::trim(req->getParameter("q"));
    if (!q.empty() && q[0] == '@') q.erase(0, 1);
    if (q.empty() || q.size() > 64) { cb(errResp("Введите ник полностью", k400BadRequest)); return; }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, selfId)) {
        cb(errResp("Слишком много запросов — подождите минуту", k429TooManyRequests)); return;
    }

    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT id, username, display_name, avatar_path FROM users "
            "WHERE username = ? COLLATE NOCASE AND id != ? LIMIT 1",
            q, selfId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value u;
            u["id"]           = row["id"].as<int64_t>();
            u["username"]     = row["username"].as<std::string>();
            u["display_name"] = row["display_name"].as<std::string>();
            u["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            arr.append(u);
        }
        Json::Value resp; resp["users"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// Код ссылки на профиль: 20 букв и цифр (≈119 бит), подобрать нельзя
static std::string newLinkCode() {
    static const char abc[] = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    std::random_device rd;
    std::uniform_int_distribution<size_t> pick(0, sizeof(abc) - 2);
    std::string s;
    for (int i = 0; i < 20; ++i) s += abc[pick(rd)];
    return s;
}

static std::string ensureLink(const drogon::orm::DbClientPtr& db, int64_t userId, bool reset) {
    if (!reset) {
        auto r = db->execSqlSync("SELECT profile_link FROM users WHERE id = ?", userId);
        if (!r.empty() && !r[0]["profile_link"].isNull()) return r[0]["profile_link"].as<std::string>();
    }
    std::string code = newLinkCode();
    db->execSqlSync("UPDATE users SET profile_link = ? WHERE id = ?", code, userId);
    return code;
}

// GET /api/v1/profile-link → {code} — своя ссылка на профиль (/u/<код>), создаётся при первом запросе
void UserController::myLink(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    try {
        Json::Value v;
        v["code"] = ensureLink(app().getDbClient(), self, false);
        cb(jsonResp(v));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// POST /api/v1/profile-link/reset → {code} — новая ссылка, старая перестаёт работать
void UserController::resetLink(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    try {
        Json::Value v;
        v["code"] = ensureLink(app().getDbClient(), self, true);
        cb(jsonResp(v));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/users/by-link/{code} → {user_id} — чей профиль по ссылке; дальше /users/{id}/profile?link=<код>
void UserController::byLink(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& code) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, self)) {
        cb(errResp("Слишком много запросов — подождите минуту", k429TooManyRequests)); return;
    }
    try {
        const int64_t owner = Access::profileLinkOwner(app().getDbClient(), code);
        if (!owner) { cb(errResp("Ссылка на профиль недействительна", k404NotFound)); return; }
        Json::Value v;
        v["user_id"] = static_cast<Json::Int64>(owner);
        cb(jsonResp(v));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/users/{id} — полный профиль пользователя
void UserController::profile(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto u = UserModel::findById(id);
    if (!u) { cb(errResp("Пользователь не найден", k404NotFound)); return; }
    // Чужой профиль по номеру — только знакомым (друзья, собеседники, общий сервер) или по ссылке ?link=.
    // Остальным — тот же ответ, что для несуществующего: перебором номеров людей не найти.
    try {
        auto adb = app().getDbClient();
        if (!Access::canSeeProfile(adb, self, id) && Access::profileLinkOwner(adb, req->getParameter("link")) != id) {
            cb(errResp("Пользователь не найден", k404NotFound)); return;
        }
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError)); return;
    }

    Json::Value resp;
    resp["id"]                = u->id;
    resp["username"]          = u->username;
    resp["display_name"]      = u->displayName;
    resp["avatar_path"]       = u->avatarPath;
    resp["banner_path"]       = u->bannerPath;
    resp["bio"]               = u->bio;
    resp["accent_color"]      = u->accentColor;
    resp["pronouns"]          = u->pronouns;
    resp["profile_json"]      = u->profileJson;
    resp["created_at"]        = u->createdAt;
    resp["subscription_tier"] = u->subscriptionTier;
    resp["developer"]         = u->developer;
    resp["badges"]            = computeBadges(*u);
    // Расширенный профиль сайта: украшения без подписки не показываются (utils/ProfileExt.h)
    resp["profile_ext"]       = ProfileExt::forDisplay(u->profileExt, u->subscriptionTier);
    auto db = app().getDbClient();
    resp["presence"]          = (id == self) ? u->presence : Privacy::presenceFor(db, id, self);
    resp["friendship_status"] = (id == self) ? "self" : friendshipStatus(self, id);
    // Уровень, серия, титул и награды — если владелец не скрыл статистику
    try {
        if (Privacy::allows(db, id, self, "stats")) resp["activity"] = Activity::summary(id);
        else resp["activity"] = Activity::brief(id), resp["activity"]["hidden"] = true;
    } catch (...) {}
    resp["subscription_until"] = u->subscriptionUntil;
    // Общие серверы
    Json::Value servers(Json::arrayValue);
    try {
        auto r = db->execSqlSync(
            "SELECT s.id, s.name FROM servers s "
            "JOIN server_members a ON a.server_id=s.id AND a.user_id=? "
            "JOIN server_members b ON b.server_id=s.id AND b.user_id=? "
            "ORDER BY s.name COLLATE NOCASE", self, id);
        for (const auto& row : r) {
            Json::Value s; s["id"]=row["id"].as<int64_t>(); s["name"]=row["name"].as<std::string>();
            servers.append(s);
        }
    } catch (...) {}
    resp["mutual_servers"] = servers;

    // Общие друзья
    Json::Value mfriends(Json::arrayValue);
    if (id != self) {
        try {
            auto r = db->execSqlSync(
                "SELECT u.id, u.username, u.display_name, u.avatar_path FROM users u WHERE u.id IN ("
                "  SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END "
                "  FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted') "
                "AND u.id IN ("
                "  SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END "
                "  FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted') "
                "ORDER BY u.display_name COLLATE NOCASE",
                self, self, self, id, id, id);
            for (const auto& row : r) {
                Json::Value m;
                m["id"]=row["id"].as<int64_t>();
                m["username"]=row["username"].as<std::string>();
                m["display_name"]=row["display_name"].as<std::string>();
                m["avatar_path"]=row["avatar_path"].isNull()?"":row["avatar_path"].as<std::string>();
                mfriends.append(m);
            }
        } catch (...) {}
    }
    resp["mutual_friends"] = mfriends;
    resp["blocked"] = id != self &&
        !db->execSqlSync("SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", self, id).empty();

    // Бейджик — сервер, который человек выбрал: название и иконка (если он всё ещё в нём состоит)
    resp["badge"] = Json::nullValue;
    const Json::Value& badgeId = resp["profile_ext"]["badge_server"];
    if (badgeId.isIntegral()) {
        try {
            auto r = db->execSqlSync(
                "SELECT s.id, s.name, s.icon, s.tag, s.tag_icon FROM servers s JOIN server_members m ON m.server_id = s.id AND m.user_id = ? "
                "WHERE s.id = ?", id, badgeId.asInt64());
            if (!r.empty()) {
                Json::Value b;
                b["id"]   = static_cast<Json::Int64>(r[0]["id"].as<int64_t>());
                b["name"] = r[0]["name"].as<std::string>();
                b["icon"] = r[0]["icon"].isNull() ? std::string() : r[0]["icon"].as<std::string>();
                b["tag"]      = r[0]["tag"].isNull() ? std::string() : r[0]["tag"].as<std::string>();
                b["tag_icon"] = r[0]["tag_icon"].isNull() ? std::string() : r[0]["tag_icon"].as<std::string>();
                resp["badge"] = b;
            }
        } catch (...) {}
    }

    // Рекорды в играх «Активностей» (только сыгранные)
    try {
        auto r = app().getDbClient()->execSqlSync(
            "SELECT game, best_floor, runs, wins FROM game_stats WHERE user_id = ? AND runs > 0", id);
        for (const auto& row : r) {
            Json::Value g;
            g["best_floor"] = row["best_floor"].as<int>();
            g["runs"]       = row["runs"].as<int>();
            g["wins"]       = row["wins"].as<int>();
            resp["games"][row["game"].as<std::string>()] = g;
        }
    } catch (...) {}

    cb(jsonResp(resp));
}

// POST /api/v1/dms  { user_id: <target> }
// Creates (or returns existing) 1-on-1 DM channel between caller and target.
// POST /api/v1/users/{id}/block — заблокировать: дружба и заявки удаляются, личка и звонки закрыты
void UserController::block(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (id == self) { cb(errResp("Нельзя заблокировать себя", k400BadRequest)); return; }
    try {
        auto db = app().getDbClient();
        if (!UserModel::findById(id)) { cb(errResp("Пользователь не найден", k404NotFound)); return; }
        db->execSqlSync("INSERT OR IGNORE INTO user_blocks(blocker_id, blocked_id) VALUES(?, ?)", self, id);
        db->execSqlSync("DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
                        self, id, id, self);
        Json::Value resp;
        resp["blocked"] = true;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// DELETE /api/v1/users/{id}/block
void UserController::unblock(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    try {
        app().getDbClient()->execSqlSync("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", self, id);
        Json::Value resp;
        resp["blocked"] = false;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/blocks → {users:[{id, username, display_name, avatar_path}]} — кого я заблокировал
void UserController::blocks(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    try {
        auto rows = app().getDbClient()->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path FROM user_blocks b JOIN users u ON u.id = b.blocked_id "
            "WHERE b.blocker_id = ? ORDER BY b.created_at DESC", self);
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            Json::Value u;
            u["id"]           = static_cast<Json::Int64>(r["id"].as<int64_t>());
            u["username"]     = r["username"].as<std::string>();
            u["display_name"] = r["display_name"].as<std::string>();
            u["avatar_path"]  = r["avatar_path"].isNull() ? std::string() : r["avatar_path"].as<std::string>();
            arr.append(u);
        }
        Json::Value resp;
        resp["users"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

void UserController::startDm(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }

    int64_t targetId = JsonUtils::getInt(*json, "user_id");
    if (targetId <= 0 || targetId == selfId) {
        cb(errResp("Invalid target user", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    try {
        auto target = UserModel::findById(targetId);
        if (!target) { cb(errResp("User not found", k404NotFound)); return; }
        // Незнакомцу — только по его ссылке или полному нику (не перебором номеров)
        if (!Access::canReach(db, selfId, targetId, JsonUtils::getStr(*json, "link"), JsonUtils::getStr(*json, "username"))) {
            cb(errResp("Пользователь не найден", k404NotFound)); return;
        }
        if (Access::blockedBetween(db, selfId, targetId)) {
            cb(errResp("Нельзя написать: один из вас заблокировал другого", k403Forbidden)); return;
        }
        // Приватность адресата: «только от друзей» — незнакомым новую личку не открыть
        if (std::string why; !Privacy::canDm(db, selfId, targetId, why)) { cb(errResp(why, k403Forbidden)); return; }

        // Существующая личка ровно этих двоих: канал с третьим участником (подсунутый
        // кем-то «dm») не подходит — иначе переписка шла бы через чужой канал
        auto existing = db->execSqlSync(
            "SELECT c.id FROM channels c "
            "JOIN channel_members m1 ON c.id = m1.channel_id AND m1.user_id = ? "
            "JOIN channel_members m2 ON c.id = m2.channel_id AND m2.user_id = ? "
            "WHERE c.type = 'dm' "
            "  AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2 "
            "ORDER BY c.id LIMIT 1",
            selfId, targetId);

        int64_t channelId;
        if (!existing.empty()) {
            channelId = existing[0]["id"].as<int64_t>();
        } else {
            auto ins = db->execSqlSync(
                "INSERT INTO channels(type, name, owner_id) VALUES('dm', ?, ?) RETURNING id",
                target->displayName, selfId);
            channelId = ins[0]["id"].as<int64_t>();
            db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                            channelId, selfId);
            db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)",
                            channelId, targetId);
        }

        Json::Value resp;
        resp["channel_id"]   = channelId;
        resp["display_name"] = target->displayName;
        resp["username"]     = target->username;
        cb(jsonResp(resp, k201Created));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}

// GET /api/v1/dms — list the caller's DM channels with the other participant's info
void UserController::listDms(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t selfId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto result = db->execSqlSync(
            "SELECT c.id AS channel_id, u.id AS user_id, u.username, u.display_name, u.avatar_path, " +
            Messages::kLastColumns + " "
            "FROM channels c "
            "JOIN channel_members me    ON c.id = me.channel_id    AND me.user_id = ? "
            "JOIN channel_members other ON c.id = other.channel_id AND other.user_id != ? "
            "JOIN users u ON u.id = other.user_id " +
            Messages::kLastJoin + " "
            "WHERE c.type = 'dm' "
            "  AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2 "
            "ORDER BY lm.id DESC, c.created_at DESC",   // самые свежие беседы — сверху
            selfId, selfId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : result) {
            Json::Value d;
            d["channel_id"]   = row["channel_id"].as<int64_t>();
            d["user_id"]      = row["user_id"].as<int64_t>();
            d["username"]     = row["username"].as<std::string>();
            d["display_name"] = row["display_name"].as<std::string>();
            d["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
            d["last_message"] = Messages::lastFromRow(row);
            arr.append(d);
        }
        Json::Value resp; resp["dms"] = arr;
        cb(jsonResp(resp));
    } catch (const std::exception& e) {
        cb(errResp(HttpUtils::internal(e), k500InternalServerError));
    }
}
