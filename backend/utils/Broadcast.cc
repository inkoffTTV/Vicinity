#include "Broadcast.h"
#include "JsonUtils.h"
#include "PresenceUtil.h"
#include "../managers/WSManager.h"
#include "../managers/VoiceManager.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <algorithm>

namespace Broadcast {

static void toUsers(const std::set<int64_t>& users, const Json::Value& ev) {
    const std::string payload = JsonUtils::write(ev);
    for (int64_t uid : users) WSManager::instance().sendToUser(uid, payload);
}

void toUser(int64_t userId, const Json::Value& ev) {
    WSManager::instance().sendToUser(userId, JsonUtils::write(ev));
}

std::set<int64_t> channelAudience(int64_t channelId) {
    auto db = drogon::app().getDbClient();
    std::set<int64_t> out;
    auto ch = db->execSqlSync("SELECT server_id FROM channels WHERE id = ?", channelId);
    if (ch.empty()) return out;
    auto members = ch[0]["server_id"].isNull()
        ? db->execSqlSync("SELECT user_id FROM channel_members WHERE channel_id = ?", channelId)
        : db->execSqlSync("SELECT user_id FROM server_members WHERE server_id = ?",
                          ch[0]["server_id"].as<int64_t>());
    for (const auto& m : members) out.insert(m["user_id"].as<int64_t>());
    return out;
}

void toChannel(int64_t channelId, const Json::Value& ev, int64_t exceptUserId) {
    try {
        auto users = channelAudience(channelId);
        users.erase(exceptUserId);
        toUsers(users, ev);
    } catch (const std::exception& e) {
        LOG_WARN << "Broadcast::toChannel " << channelId << ": " << e.what();
    }
}

void toServer(int64_t serverId, const Json::Value& ev) {
    try {
        auto rows = drogon::app().getDbClient()->execSqlSync(
            "SELECT user_id FROM server_members WHERE server_id = ?", serverId);
        std::set<int64_t> users;
        for (const auto& r : rows) users.insert(r["user_id"].as<int64_t>());
        toUsers(users, ev);
    } catch (const std::exception& e) {
        LOG_WARN << "Broadcast::toServer " << serverId << ": " << e.what();
    }
}

std::set<int64_t> contactsOf(int64_t userId) {
    std::set<int64_t> out;
    try {
        auto db = drogon::app().getDbClient();
        auto fr = db->execSqlSync(
            "SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS fid "
            "FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'",
            userId, userId, userId);
        for (const auto& row : fr) out.insert(row["fid"].as<int64_t>());
        // Сослуживцы по серверам — чтобы обновлялась панель участников
        auto co = db->execSqlSync(
            "SELECT DISTINCT sm2.user_id AS cid FROM server_members sm1 "
            "JOIN server_members sm2 ON sm1.server_id = sm2.server_id "
            "WHERE sm1.user_id = ? AND sm2.user_id != ?",
            userId, userId);
        for (const auto& row : co) out.insert(row["cid"].as<int64_t>());
    } catch (const std::exception& e) {
        LOG_WARN << "Broadcast::contactsOf " << userId << ": " << e.what();
    }
    return out;
}

void presence(int64_t userId) {
    Json::Value ev;
    ev["type"]     = "presence";
    ev["user_id"]  = static_cast<Json::Int64>(userId);
    ev["presence"] = effectivePresence(userId);
    toUsers(contactsOf(userId), ev);
}

void userUpdated(int64_t userId) {
    try {
        auto r = drogon::app().getDbClient()->execSqlSync(
            "SELECT display_name, avatar_path, banner_path, accent_color, bio, pronouns "
            "FROM users WHERE id = ?", userId);
        if (r.empty()) return;
        auto col = [&](const char* name) {
            return r[0][name].isNull() ? std::string() : r[0][name].as<std::string>();
        };
        Json::Value ev;
        ev["type"]         = "user_updated";
        ev["user_id"]      = static_cast<Json::Int64>(userId);
        ev["display_name"] = col("display_name");
        ev["avatar_path"]  = col("avatar_path");
        ev["accent_color"] = col("accent_color");
        ev["banner_path"]  = col("banner_path");
        ev["bio"]          = col("bio");
        ev["pronouns"]     = col("pronouns");
        auto users = contactsOf(userId);
        users.insert(userId);
        toUsers(users, ev);
    } catch (const std::exception& e) {
        LOG_WARN << "Broadcast::userUpdated " << userId << ": " << e.what();
    }
}

std::string voiceStatePayload(int64_t channelId) {
    auto db = drogon::app().getDbClient();
    Json::Value arr(Json::arrayValue);
    for (int64_t uid : VoiceManager::instance().usersIn(channelId)) {
        std::string name;
        try {
            auto r = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", uid);
            if (!r.empty()) name = r[0]["display_name"].as<std::string>();
        } catch (...) {}
        Json::Value u;
        u["user_id"] = static_cast<Json::Int64>(uid);
        u["name"]    = name;
        arr.append(u);
    }
    Json::Value payload;
    payload["type"]       = "voice_state";
    payload["channel_id"] = static_cast<Json::Int64>(channelId);
    payload["users"]      = arr;
    return JsonUtils::write(payload);
}

void voiceState(int64_t channelId) {
    std::set<int64_t> users;
    try {
        users = channelAudience(channelId);
    } catch (const std::exception& e) {
        LOG_WARN << "Broadcast::voiceState " << channelId << ": " << e.what();
    }
    // Канал не найден — хотя бы тем, кто в нём сидит
    if (users.empty())
        for (int64_t uid : VoiceManager::instance().usersIn(channelId)) users.insert(uid);
    const std::string payload = voiceStatePayload(channelId);
    for (int64_t uid : users) WSManager::instance().sendToUser(uid, payload);
}

void evictFromVoice(int64_t userId, const std::vector<int64_t>& channelIds) {
    auto& vm = VoiceManager::instance();
    const int64_t ch = vm.channelOf(userId);
    if (ch == 0 || std::find(channelIds.begin(), channelIds.end(), ch) == channelIds.end()) return;
    if (vm.leave(userId) != ch) return;
    voiceState(ch);
    WSManager::instance().sendToUser(userId, voiceStatePayload(ch));
}

} // namespace Broadcast
