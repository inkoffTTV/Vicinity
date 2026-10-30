#include "Privacy.h"
#include "JsonUtils.h"
#include "PresenceUtil.h"
#include <drogon/drogon.h>
#include <initializer_list>
#include <set>

using namespace drogon;

namespace {

// Элементы с правилом {who, hide_from, show_to}: status и stats (их who дублируется в старых строковых полях),
// элементы профиля и "all" — только hide_from, «скрыть профиль целиком от этих людей»
const char* const kRuleKeys[] = {"status", "stats", "about", "banner", "wishlist", "games", "music", "connections", "all"};
constexpr std::size_t kMaxExceptions = 200;

Json::Value emptyRule() {
    Json::Value r;
    r["who"] = "everyone";
    r["hide_from"] = Json::Value(Json::arrayValue);
    r["show_to"] = Json::Value(Json::arrayValue);
    return r;
}

Json::Value defaults() {
    Json::Value v;
    v["status"]          = "everyone";   // everyone | friends | nobody
    v["stats"]           = "everyone";   // everyone | friends | nobody
    v["dm"]              = "everyone";   // everyone | friends
    v["friend_requests"] = "everyone";   // everyone | friends_of_friends | nobody
    for (const char* k : kRuleKeys) v["rules"][k] = emptyRule();
    return v;
}

// Список id без дублей и без самого владельца
Json::Value cleanIds(const Json::Value& in, int64_t self) {
    Json::Value out(Json::arrayValue);
    std::set<int64_t> seen;
    for (const auto& x : in) {
        if (!x.isIntegral()) continue;
        const int64_t id = x.asInt64();
        if (id <= 0 || id == self || !seen.insert(id).second) continue;
        out.append(static_cast<Json::Int64>(id));
        if (out.size() >= kMaxExceptions) break;
    }
    return out;
}

bool inList(const Json::Value& list, int64_t id) {
    for (const auto& x : list) if (x.isIntegral() && x.asInt64() == id) return true;
    return false;
}

bool oneOf(const Json::Value& v, std::initializer_list<const char*> allowed) {
    if (!v.isString()) return false;
    for (const char* a : allowed) if (v.asString() == a) return true;
    return false;
}

Json::Value load(int64_t userId) {
    Json::Value out = defaults();
    try {
        auto rows = app().getDbClient()->execSqlSync("SELECT privacy FROM user_settings WHERE user_id = ?", userId);
        if (rows.empty() || rows[0]["privacy"].isNull()) return out;
        Json::Value saved;
        if (!JsonUtils::parse(rows[0]["privacy"].as<std::string>(), saved) || !saved.isObject()) return out;
        for (const auto& key : out.getMemberNames())
            if (saved[key].isString()) out[key] = saved[key];
        if (saved["rules"].isObject())
            for (const char* k : kRuleKeys) {
                const Json::Value& r = saved["rules"][k];
                if (!r.isObject()) continue;
                if (r["who"].isString()) out["rules"][k]["who"] = r["who"];
                if (r["hide_from"].isArray()) out["rules"][k]["hide_from"] = cleanIds(r["hide_from"], userId);
                if (r["show_to"].isArray()) out["rules"][k]["show_to"] = cleanIds(r["show_to"], userId);
            }
        // Старые поля status/stats и who их правил — одно и то же
        out["rules"]["status"]["who"] = out["status"];
        out["rules"]["stats"]["who"] = out["stats"];
    } catch (const std::exception& e) {
        LOG_WARN << "privacy: " << e.what();
    }
    return out;
}

} // namespace

namespace Privacy {

Json::Value get(int64_t userId) { return load(userId); }

bool patch(int64_t userId, const Json::Value& in, Json::Value& out, std::string& error) {
    out = load(userId);
    if (in.isMember("status") && !oneOf(in["status"], {"everyone", "friends", "nobody"})) { error = "status"; return false; }
    if (in.isMember("stats") && !oneOf(in["stats"], {"everyone", "friends", "nobody"})) { error = "stats"; return false; }
    if (in.isMember("dm") && !oneOf(in["dm"], {"everyone", "friends"})) { error = "dm"; return false; }
    if (in.isMember("friend_requests") && !oneOf(in["friend_requests"], {"everyone", "friends_of_friends", "nobody"})) {
        error = "friend_requests"; return false;
    }
    for (const char* key : {"status", "stats", "dm", "friend_requests"})
        if (in.isMember(key)) out[key] = in[key];
    if (in.isMember("rules")) {
        if (!in["rules"].isObject()) { error = "rules"; return false; }
        for (const char* k : kRuleKeys) {
            if (!in["rules"].isMember(k)) continue;
            const Json::Value& r = in["rules"][k];
            if (!r.isObject()) { error = std::string("rules.") + k; return false; }
            if (r.isMember("who")) {
                if (!oneOf(r["who"], {"everyone", "friends", "nobody"}) || (std::string(k) == "all" && r["who"].asString() != "everyone")) {
                    error = std::string("rules.") + k + ".who"; return false;
                }
                out["rules"][k]["who"] = r["who"];
            }
            for (const char* list : {"hide_from", "show_to"}) {
                if (!r.isMember(list)) continue;
                if (!r[list].isArray()) { error = std::string("rules.") + k + "." + list; return false; }
                out["rules"][k][list] = cleanIds(r[list], userId);
            }
        }
    }
    // who у status/stats и старые строковые поля — одно и то же, что бы ни прислали
    if (in.isMember("rules") && in["rules"]["status"].isObject() && in["rules"]["status"].isMember("who")) out["status"] = out["rules"]["status"]["who"];
    else out["rules"]["status"]["who"] = out["status"];
    if (in.isMember("rules") && in["rules"]["stats"].isObject() && in["rules"]["stats"].isMember("who")) out["stats"] = out["rules"]["stats"]["who"];
    else out["rules"]["stats"]["who"] = out["stats"];
    app().getDbClient()->execSqlSync(
        "INSERT INTO user_settings(user_id, privacy, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(user_id) DO UPDATE SET privacy = excluded.privacy, updated_at = CURRENT_TIMESTAMP",
        userId, JsonUtils::write(out));
    return true;
}

bool friends(const orm::DbClientPtr& db, int64_t a, int64_t b) {
    if (a == b) return true;
    auto r = db->execSqlSync(
        "SELECT 1 FROM friendships WHERE status = 'accepted' AND "
        "((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))", a, b, b, a);
    return !r.empty();
}

const char* const kProfileFields[6] = {"about", "banner", "wishlist", "games", "music", "connections"};

bool allows(const orm::DbClientPtr& db, int64_t target, int64_t viewer, const char* field) {
    if (target == viewer) return true;
    const Json::Value p = load(target);
    if (inList(p["rules"]["all"]["hide_from"], viewer)) return false;
    const Json::Value& rule = p["rules"][field];
    if (inList(rule["hide_from"], viewer)) return false;
    if (inList(rule["show_to"], viewer)) return true;
    const std::string mode = rule["who"].asString();
    if (mode == "nobody") return false;
    if (mode == "friends") return friends(db, target, viewer);
    return true;
}

std::string presenceFor(const orm::DbClientPtr& db, int64_t target, int64_t viewer) {
    if (!allows(db, target, viewer, "status")) return "offline";
    return effectivePresence(target);
}

bool canDm(const orm::DbClientPtr& db, int64_t from, int64_t target, std::string& reason) {
    if (load(target)["dm"].asString() == "friends" && !friends(db, from, target)) {
        reason = "Пользователь принимает сообщения только от друзей";
        return false;
    }
    return true;
}

bool canRequest(const orm::DbClientPtr& db, int64_t from, int64_t target, std::string& reason) {
    const std::string mode = load(target)["friend_requests"].asString();
    if (mode == "nobody") { reason = "Пользователь не принимает заявки в друзья"; return false; }
    if (mode == "friends_of_friends") {
        auto r = db->execSqlSync(
            "SELECT 1 FROM friendships f1 JOIN friendships f2 ON f1.status = 'accepted' AND f2.status = 'accepted' "
            "AND (CASE WHEN f1.requester_id = ? THEN f1.addressee_id ELSE f1.requester_id END) = "
            "    (CASE WHEN f2.requester_id = ? THEN f2.addressee_id ELSE f2.requester_id END) "
            "WHERE (f1.requester_id = ? OR f1.addressee_id = ?) AND (f2.requester_id = ? OR f2.addressee_id = ?) LIMIT 1",
            from, target, from, from, target, target);
        if (r.empty()) { reason = "Пользователь принимает заявки только от друзей друзей"; return false; }
    }
    return true;
}

} // namespace Privacy
