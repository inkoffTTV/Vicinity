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

} // namespace Cascade
