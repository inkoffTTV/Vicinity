#include "Cascade.h"
#include <drogon/orm/DbClient.h>

namespace Cascade {

static void channelRows(const std::shared_ptr<drogon::orm::Transaction>& tr, int64_t channelId) {
    tr->execSqlSync("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)",
                    channelId);
    tr->execSqlSync("DELETE FROM pins WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channel_reads WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM messages WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channel_members WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channels WHERE id = ?", channelId);
}

void deleteChannel(const drogon::orm::DbClientPtr& db, int64_t channelId) {
    auto tr = db->newTransaction();
    try {
        channelRows(tr, channelId);
    } catch (...) {
        tr->rollback();
        throw;
    }
}

void deleteServer(const drogon::orm::DbClientPtr& db, int64_t serverId) {
    auto tr = db->newTransaction();
    try {
        auto channels = tr->execSqlSync("SELECT id FROM channels WHERE server_id = ?", serverId);
        for (const auto& row : channels) channelRows(tr, row["id"].as<int64_t>());
        tr->execSqlSync("DELETE FROM server_bans WHERE server_id = ?", serverId);
        tr->execSqlSync("DELETE FROM server_members WHERE server_id = ?", serverId);
        tr->execSqlSync("DELETE FROM servers WHERE id = ?", serverId);
    } catch (...) {
        tr->rollback();
        throw;
    }
}


void deleteUser(const drogon::orm::DbClientPtr& db, int64_t userId) {
    auto tr = db->newTransaction();
    try {
        const char* own = "SELECT id FROM messages WHERE author_id = ?";
        tr->execSqlSync(std::string("DELETE FROM reactions WHERE user_id = ? OR message_id IN (") + own + ")",
                        userId, userId);
        tr->execSqlSync(std::string("DELETE FROM pins WHERE pinned_by = ? OR message_id IN (") + own + ")",
                        userId, userId);
        // Ответы других людей на его сообщения остаются, но без цитаты
        tr->execSqlSync(std::string("UPDATE messages SET reply_to = NULL WHERE reply_to IN (") + own + ")", userId);
        tr->execSqlSync("DELETE FROM messages WHERE author_id = ?", userId);
        tr->execSqlSync("DELETE FROM channel_reads WHERE user_id = ?", userId);
        tr->execSqlSync("DELETE FROM channel_members WHERE user_id = ?", userId);
        tr->execSqlSync("DELETE FROM server_members WHERE user_id = ?", userId);
        tr->execSqlSync("DELETE FROM server_bans WHERE user_id = ?", userId);
        tr->execSqlSync("DELETE FROM user_roles WHERE user_id = ?", userId);
        tr->execSqlSync("DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?", userId, userId);
        tr->execSqlSync("DELETE FROM sessions WHERE user_id = ?", userId);
        // Беседы и роли, которые он создал, остаются без владельца
        tr->execSqlSync("UPDATE channels SET owner_id = NULL WHERE owner_id = ?", userId);
        tr->execSqlSync("UPDATE roles SET created_by = NULL WHERE created_by = ?", userId);
        tr->execSqlSync("DELETE FROM users WHERE id = ?", userId);
    } catch (...) {
        tr->rollback();
        throw;
    }
}

} // namespace Cascade
