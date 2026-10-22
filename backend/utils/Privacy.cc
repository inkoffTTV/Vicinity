#include "Privacy.h"
#include "JsonUtils.h"
#include "PresenceUtil.h"
#include <drogon/drogon.h>
#include <initializer_list>

using namespace drogon;

namespace {

Json::Value defaults() {
    Json::Value v;
    v["status"]          = "everyone";   // everyone | friends | nobody
    v["stats"]           = "everyone";   // everyone | friends | nobody
    v["dm"]              = "everyone";   // everyone | friends
    v["friend_requests"] = "everyone";   // everyone | friends_of_friends | nobody
    return v;
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

bool allows(const orm::DbClientPtr& db, int64_t target, int64_t viewer, const char* field) {
    if (target == viewer) return true;
    const std::string mode = load(target)[field].asString();
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
