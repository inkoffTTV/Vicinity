#include "PlayController.h"
#include "../managers/UserRateLimiter.h"
#include "../models/User.h"
#include "../utils/Access.h"
#include "../utils/JsonUtils.h"
#include "../utils/Tiers.h"
#include <drogon/drogon.h>
#include <algorithm>
#include <chrono>
#include <ctime>
#include <map>
#include <set>

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto r = HttpResponse::newHttpJsonResponse(std::move(body));
    r->setStatusCode(code);
    return r;
}
static HttpResponsePtr errResp(const std::string& msg, HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    return jsonResp(std::move(v), code);
}
static std::string compact(const Json::Value& v) {
    Json::StreamWriterBuilder w;
    w["indentation"] = "";
    return Json::writeString(w, v);
}

static const std::set<std::string>& games() {
    static const std::set<std::string> g = {"klyaksa", "hookduel"};
    return g;
}
// Достижения, за которые открываются шапки и цвета
static const std::set<std::string>& achievements() {
    static const std::set<std::string> a = {"win", "eraser_nohit", "floor5", "items10", "daily", "pvp3", "merge"};
    return a;
}
// Что нужно для шапки/цвета: достижение или подписка («tier2» — Standard, «tier3» — Ultra)
static const std::map<std::string, std::string>& hats() {
    static const std::map<std::string, std::string> m = {
        {"crown", "win"}, {"eraser", "eraser_nohit"}, {"beanie", "items10"}, {"horns", "pvp3"}, {"cap", "tier2"}, {"halo", "tier3"}};
    return m;
}
static const std::map<std::string, std::string>& colors() {
    static const std::map<std::string, std::string> m = {
        {"gold", "floor5"}, {"mint", "daily"}, {"pink", "merge"}, {"sky", "tier2"}, {"black", "tier3"}};
    return m;
}
static bool allowed(const std::string& need, const std::set<std::string>& unlocks, int tier) {
    if (need == "tier2") return tier >= 2;
    if (need == "tier3") return tier >= 3;
    return unlocks.count(need) > 0;
}

/** Сегодня и вчера по UTC — «YYYY-MM-DD» (ежедневный забег принимается за них) */
static std::string utcDay(int daysBack) {
    const std::time_t t = std::time(nullptr) - daysBack * 86400;
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[16];
    std::strftime(buf, sizeof buf, "%Y-%m-%d", &tm);
    return buf;
}

struct Stats {
    int best = 0, runs = 0, wins = 0, kills = 0;
    std::set<std::string> unlocks;
    Json::Value cosmetic = Json::objectValue;
};
static Stats loadStats(const drogon::orm::DbClientPtr& db, int64_t userId, const std::string& game) {
    Stats s;
    auto r = db->execSqlSync("SELECT best_floor, runs, wins, kills, unlocks, cosmetic FROM game_stats WHERE user_id = ? AND game = ?", userId, game);
    if (r.empty()) return s;
    s.best = r[0]["best_floor"].as<int>();
    s.runs = r[0]["runs"].as<int>();
    s.wins = r[0]["wins"].as<int>();
    s.kills = r[0]["kills"].as<int>();
    Json::Value u, c;
    if (JsonUtils::parse(r[0]["unlocks"].as<std::string>(), u) && u.isArray())
        for (const auto& x : u)
            if (x.isString() && achievements().count(x.asString())) s.unlocks.insert(x.asString());
    if (JsonUtils::parse(r[0]["cosmetic"].as<std::string>(), c) && c.isObject()) s.cosmetic = c;
    return s;
}
static Json::Value statsJson(const Stats& s, int tier) {
    Json::Value v;
    v["best_floor"] = s.best;
    v["runs"] = s.runs;
    v["wins"] = s.wins;
    v["kills"] = s.kills;
    v["unlocks"] = Json::Value(Json::arrayValue);
    for (const auto& u : s.unlocks) v["unlocks"].append(u);
    // что можно надеть сейчас (с учётом подписки)
    v["hats"] = Json::Value(Json::arrayValue);
    for (const auto& [id, need] : hats())
        if (allowed(need, s.unlocks, tier)) v["hats"].append(id);
    v["colors"] = Json::Value(Json::arrayValue);
    for (const auto& [id, need] : colors())
        if (allowed(need, s.unlocks, tier)) v["colors"].append(id);
    // надетое, если оно ещё доступно
    Json::Value c(Json::objectValue);
    const std::string h = s.cosmetic.get("hat", "").asString(), col = s.cosmetic.get("color", "").asString();
    c["hat"] = hats().count(h) && allowed(hats().at(h), s.unlocks, tier) ? h : "";
    c["color"] = colors().count(col) && allowed(colors().at(col), s.unlocks, tier) ? col : "";
    v["cosmetic"] = c;
    return v;
}
static int tierOf(int64_t userId) {
    const auto u = UserModel::findById(userId);
    return u ? Tiers::clamp(u->subscriptionTier) : 0;
}

// GET /api/v1/play/{game}/me → рекорды, открытое и надетое
void PlayController::me(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (!games().count(game)) { cb(errResp("Нет такой игры", k404NotFound)); return; }
    try {
        cb(jsonResp(statsJson(loadStats(app().getDbClient(), self, game), tierOf(self))));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/play/{game}/result {floor, kills, won, time_ms, daily?: "YYYY-MM-DD", ach: [...]}
void PlayController::result(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (!games().count(game)) { cb(errResp("Нет такой игры", k404NotFound)); return; }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::ActivityJoin, self)) { cb(errResp("Слишком часто", k429TooManyRequests)); return; }
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    const int floor = static_cast<int>(std::clamp<int64_t>(JsonUtils::getInt(*json, "floor"), 0, 999));
    const int kills = static_cast<int>(std::clamp<int64_t>(JsonUtils::getInt(*json, "kills"), 0, 99999));
    const int64_t timeMs = std::clamp<int64_t>(JsonUtils::getInt(*json, "time_ms"), 0, 24LL * 3600 * 1000);
    const bool won = (*json)["won"].isBool() && (*json)["won"].asBool();
    auto db = app().getDbClient();
    try {
        Stats s = loadStats(db, self, game);
        std::vector<std::string> fresh;
        const Json::Value& ach = (*json)["ach"];
        if (ach.isArray())
            for (const auto& a : ach)
                if (a.isString() && achievements().count(a.asString()) && !s.unlocks.count(a.asString())) {
                    s.unlocks.insert(a.asString());
                    fresh.push_back(a.asString());
                }
        s.best = std::max(s.best, floor);
        s.runs += 1;
        s.wins += won ? 1 : 0;
        s.kills = static_cast<int>(std::min<int64_t>(int64_t(s.kills) + kills, 1000000000));
        Json::Value u(Json::arrayValue);
        for (const auto& x : s.unlocks) u.append(x);
        db->execSqlSync(
            "INSERT INTO game_stats(user_id, game, best_floor, runs, wins, kills, unlocks, cosmetic, updated_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, '{}', CURRENT_TIMESTAMP) "
            "ON CONFLICT(user_id, game) DO UPDATE SET best_floor = excluded.best_floor, runs = excluded.runs, wins = excluded.wins, "
            "kills = excluded.kills, unlocks = excluded.unlocks, updated_at = CURRENT_TIMESTAMP",
            self, game, s.best, s.runs, s.wins, s.kills, compact(u));
        // ежедневный забег — за сегодня или вчера (UTC), лучший результат: победа, этаж, время
        const std::string day = JsonUtils::getStr(*json, "daily");
        if (!day.empty() && (day == utcDay(0) || day == utcDay(1))) {
            auto prev = db->execSqlSync("SELECT floor, won, time_ms FROM daily_runs WHERE day = ? AND game = ? AND user_id = ?", day, game, self);
            bool better = prev.empty();
            if (!better) {
                const int pw = prev[0]["won"].as<int>(), pf = prev[0]["floor"].as<int>();
                const int64_t pt = prev[0]["time_ms"].as<int64_t>();
                better = int(won) > pw || (int(won) == pw && (floor > pf || (floor == pf && timeMs < pt)));
            }
            if (better)
                db->execSqlSync(
                    "INSERT INTO daily_runs(day, game, user_id, floor, kills, time_ms, won) VALUES(?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(day, game, user_id) DO UPDATE SET floor = excluded.floor, kills = excluded.kills, "
                    "time_ms = excluded.time_ms, won = excluded.won",
                    day, game, self, floor, kills, timeMs, won ? 1 : 0);
        }
        Json::Value out = statsJson(s, tierOf(self));
        out["fresh"] = Json::Value(Json::arrayValue);
        for (const auto& f : fresh) out["fresh"].append(f);
        cb(jsonResp(out));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/play/{game}/cosmetic {hat, color} — только открытое (или по подписке)
void PlayController::cosmetic(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (!games().count(game)) { cb(errResp("Нет такой игры", k404NotFound)); return; }
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(errResp("Invalid JSON", k400BadRequest)); return; }
    const std::string hat = JsonUtils::getStr(*json, "hat"), color = JsonUtils::getStr(*json, "color");
    auto db = app().getDbClient();
    try {
        Stats s = loadStats(db, self, game);
        const int tier = tierOf(self);
        if (!hat.empty() && (!hats().count(hat) || !allowed(hats().at(hat), s.unlocks, tier))) { cb(errResp("Эта шапка ещё не открыта", k403Forbidden)); return; }
        if (!color.empty() && (!colors().count(color) || !allowed(colors().at(color), s.unlocks, tier))) { cb(errResp("Этот цвет ещё не открыт", k403Forbidden)); return; }
        Json::Value c;
        c["hat"] = hat;
        c["color"] = color;
        Json::Value u(Json::arrayValue);
        for (const auto& x : s.unlocks) u.append(x);
        db->execSqlSync(
            "INSERT INTO game_stats(user_id, game, unlocks, cosmetic, updated_at) VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(user_id, game) DO UPDATE SET cosmetic = excluded.cosmetic, updated_at = CURRENT_TIMESTAMP",
            self, game, compact(u), compact(c));
        s.cosmetic = c;
        cb(jsonResp(statsJson(s, tier)));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/play/{game}/daily?day= — таблица дня: только я и те, чей профиль мне виден
void PlayController::daily(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game) {
    const int64_t self = req->attributes()->get<int64_t>("user_id");
    if (!games().count(game)) { cb(errResp("Нет такой игры", k404NotFound)); return; }
    std::string day = req->getParameter("day");
    if (day != utcDay(0) && day != utcDay(1)) day = utcDay(0);
    auto db = app().getDbClient();
    try {
        auto rows = db->execSqlSync(
            "SELECT d.user_id, d.floor, d.kills, d.time_ms, d.won, u.display_name FROM daily_runs d JOIN users u ON u.id = d.user_id "
            "WHERE d.day = ? AND d.game = ? ORDER BY d.won DESC, d.floor DESC, d.time_ms ASC LIMIT 200",
            day, game);
        Json::Value out;
        out["day"] = day;
        out["rows"] = Json::Value(Json::arrayValue);
        int place = 0;
        for (const auto& r : rows) {
            const int64_t uid = r["user_id"].as<int64_t>();
            ++place;
            if (uid != self && !Access::canSeeProfile(db, self, uid)) continue;
            Json::Value v;
            v["place"] = place;
            v["me"] = uid == self;
            v["name"] = r["display_name"].as<std::string>();
            v["floor"] = r["floor"].as<int>();
            v["kills"] = r["kills"].as<int>();
            v["time_ms"] = static_cast<Json::Int64>(r["time_ms"].as<int64_t>());
            v["won"] = r["won"].as<int>() != 0;
            out["rows"].append(v);
            if (out["rows"].size() >= 10) break;
        }
        cb(jsonResp(out));
    } catch (const std::exception& e) {
        cb(errResp(e.what(), k500InternalServerError));
    }
}
