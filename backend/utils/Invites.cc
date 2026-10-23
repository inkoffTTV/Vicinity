#include "Invites.h"
#include "Broadcast.h"

namespace Invites {

const char* kindName(Kind k) { return k == Kind::Group ? "group" : "server"; }

static bool isMember(const drogon::orm::DbClientPtr& db, Kind kind, int64_t targetId, int64_t userId) {
    auto r = kind == Kind::Group
        ? db->execSqlSync("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1", targetId, userId)
        : db->execSqlSync("SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1", targetId, userId);
    return !r.empty();
}

Outcome create(const drogon::orm::DbClientPtr& db, Kind kind, int64_t targetId, int64_t inviterId, int64_t inviteeId) {
    if (isMember(db, kind, targetId, inviteeId)) return Outcome::AlreadyMember;
    auto ins = db->execSqlSync(
        "INSERT OR IGNORE INTO invites(kind, target_id, inviter_id, invitee_id) VALUES(?, ?, ?, ?) RETURNING id",
        kindName(kind), targetId, inviterId, inviteeId);
    if (ins.empty()) return Outcome::AlreadyInvited;
    Json::Value ev;
    ev["type"]   = "invite_received";
    ev["invite"] = describe(db, ins[0]["id"].as<int64_t>());
    Broadcast::toUser(inviteeId, ev);
    return Outcome::Invited;
}

Json::Value describe(const drogon::orm::DbClientPtr& db, int64_t inviteId) {
    auto r = db->execSqlSync(
        "SELECT i.id, i.kind, i.target_id, i.created_at, "
        "       u.id AS uid, u.username, u.display_name, u.avatar_path, "
        "       CASE i.kind WHEN 'group' THEN c.name ELSE s.name END AS name, "
        "       CASE i.kind WHEN 'server' THEN s.icon END AS icon, "
        "       CASE i.kind WHEN 'group' THEN (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = i.target_id) "
        "                   ELSE (SELECT COUNT(*) FROM server_members m WHERE m.server_id = i.target_id) END AS members "
        "FROM invites i JOIN users u ON u.id = i.inviter_id "
        "LEFT JOIN channels c ON i.kind = 'group' AND c.id = i.target_id "
        "LEFT JOIN servers s ON i.kind = 'server' AND s.id = i.target_id "
        "WHERE i.id = ?",
        inviteId);
    if (r.empty() || r[0]["name"].isNull()) return Json::Value(Json::nullValue);
    const auto& row = r[0];
    Json::Value v;
    v["id"]         = static_cast<Json::Int64>(row["id"].as<int64_t>());
    v["kind"]       = row["kind"].as<std::string>();
    v["target_id"]  = static_cast<Json::Int64>(row["target_id"].as<int64_t>());
    v["name"]       = row["name"].as<std::string>();
    v["icon"]       = row["icon"].isNull() ? "" : row["icon"].as<std::string>();
    v["members"]    = static_cast<Json::Int64>(row["members"].as<int64_t>());
    v["created_at"] = row["created_at"].isNull() ? "" : row["created_at"].as<std::string>();
    Json::Value inviter;
    inviter["id"]           = static_cast<Json::Int64>(row["uid"].as<int64_t>());
    inviter["username"]     = row["username"].as<std::string>();
    inviter["display_name"] = row["display_name"].as<std::string>();
    inviter["avatar_path"]  = row["avatar_path"].isNull() ? "" : row["avatar_path"].as<std::string>();
    v["inviter"] = inviter;
    return v;
}

void drop(const drogon::orm::DbClientPtr& db, Kind kind, int64_t targetId, int64_t inviteeId) {
    auto del = db->execSqlSync(
        "DELETE FROM invites WHERE kind = ? AND target_id = ? AND invitee_id = ? RETURNING id",
        kindName(kind), targetId, inviteeId);
    for (const auto& row : del) {
        Json::Value ev;
        ev["type"]      = "invite_removed";
        ev["invite_id"] = static_cast<Json::Int64>(row["id"].as<int64_t>());
        Broadcast::toUser(inviteeId, ev);
    }
}

} // namespace Invites
