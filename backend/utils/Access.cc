#include "Access.h"

namespace Access {

Result channel(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t userId,
               ChannelInfo* info) {
    auto r = db->execSqlSync(
        "SELECT c.server_id, c.type, c.is_voice, "
        "  CASE WHEN c.server_id IS NOT NULL "
        "       THEN EXISTS(SELECT 1 FROM server_members WHERE server_id = c.server_id AND user_id = ?) "
        "       ELSE EXISTS(SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?) "
        "  END AS allowed "
        "FROM channels c WHERE c.id = ?",
        userId, userId, channelId);
    if (r.empty()) return Result::NotFound;
    if (info) {
        info->id       = channelId;
        info->serverId = r[0]["server_id"].isNull() ? 0 : r[0]["server_id"].as<int64_t>();
        info->type     = r[0]["type"].as<std::string>();
        info->isVoice  = r[0]["is_voice"].as<int>() != 0;
    }
    return r[0]["allowed"].as<int>() != 0 ? Result::Ok : Result::Forbidden;
}

bool isServerMember(const drogon::orm::DbClientPtr& db, int64_t serverId, int64_t userId) {
    auto r = db->execSqlSync(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        serverId, userId);
    return !r.empty();
}

int64_t serverOwner(const drogon::orm::DbClientPtr& db, int64_t serverId) {
    auto r = db->execSqlSync("SELECT owner_id FROM servers WHERE id = ?", serverId);
    if (r.empty() || r[0]["owner_id"].isNull()) return 0;
    return r[0]["owner_id"].as<int64_t>();
}

bool isBanned(const drogon::orm::DbClientPtr& db, int64_t serverId, int64_t userId) {
    auto r = db->execSqlSync(
        "SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ? LIMIT 1", serverId, userId);
    return !r.empty();
}

const char* const kAccessibleChannels =
    "SELECT cm.channel_id FROM channel_members cm "
    "JOIN channels c ON c.id = cm.channel_id AND c.server_id IS NULL WHERE cm.user_id = ? "
    "UNION "
    "SELECT c.id FROM channels c JOIN server_members sm ON sm.server_id = c.server_id "
    "WHERE sm.user_id = ?";

bool canCall(const drogon::orm::DbClientPtr& db, int64_t userId, int64_t otherId) {
    auto r = db->execSqlSync(
        "SELECT 1 FROM friendships "
        "WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) "
        "  AND status = 'accepted' "
        "UNION ALL "
        "SELECT 1 FROM channels c "
        "JOIN channel_members a ON a.channel_id = c.id AND a.user_id = ? "
        "JOIN channel_members b ON b.channel_id = c.id AND b.user_id = ? "
        "WHERE c.type = 'dm' "
        "LIMIT 1",
        userId, otherId, otherId, userId, userId, otherId);
    return !r.empty();
}

} // namespace Access
