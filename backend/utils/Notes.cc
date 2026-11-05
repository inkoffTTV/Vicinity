#include "Notes.h"

namespace Notes {

int64_t channelOf(const drogon::orm::DbClientPtr& db, int64_t userId, bool create) {
    auto r = db->execSqlSync("SELECT channel_id FROM notes_channels WHERE user_id = ?", userId);
    if (!r.empty()) return r[0]["channel_id"].as<int64_t>();
    if (!create) return 0;
    auto tr = db->newTransaction();
    auto again = tr->execSqlSync("SELECT channel_id FROM notes_channels WHERE user_id = ?", userId);
    if (!again.empty()) return again[0]["channel_id"].as<int64_t>();
    auto ch = tr->execSqlSync("INSERT INTO channels(type, name, owner_id) VALUES('dm', 'Заметки', ?) RETURNING id", userId);
    const int64_t id = ch[0]["id"].as<int64_t>();
    tr->execSqlSync("INSERT INTO channel_members(channel_id, user_id) VALUES(?, ?)", id, userId);
    tr->execSqlSync("INSERT INTO notes_channels(user_id, channel_id) VALUES(?, ?)", userId, id);
    return id;
}

int64_t ownerOf(const drogon::orm::DbClientPtr& db, int64_t channelId) {
    auto r = db->execSqlSync("SELECT user_id FROM notes_channels WHERE channel_id = ?", channelId);
    return r.empty() ? 0 : r[0]["user_id"].as<int64_t>();
}

} // namespace Notes
