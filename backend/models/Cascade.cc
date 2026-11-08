#include "Cascade.h"
#include "../utils/Uploads.h"
#include <drogon/orm/DbClient.h>
#include <string>
#include <vector>

namespace Cascade {

using Files = std::vector<std::string>;

// Вложения удаляемых сообщений: файлы удаляются после транзакции, иначе остались бы доступны по ссылке
static void collect(const std::shared_ptr<drogon::orm::Transaction>& tr, const char* where, int64_t id, Files& files) {
    auto rows = tr->execSqlSync(std::string("SELECT attachment FROM messages WHERE ") + where +
                                " AND attachment IS NOT NULL AND attachment != ''", id);
    for (const auto& r : rows) files.push_back(r["attachment"].as<std::string>());
}

// Транзакция уже завершена (единственное соединение SQLite свободно): удалить файлы
static void removeFiles(std::shared_ptr<drogon::orm::Transaction>& tr, const Files& files) {
    tr.reset();   // commit
    for (const auto& url : files) Uploads::removeByUrl(url);
}

static void channelRows(const std::shared_ptr<drogon::orm::Transaction>& tr, int64_t channelId, Files& files) {
    collect(tr, "channel_id = ?", channelId, files);
    tr->execSqlSync("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)",
                    channelId);
    tr->execSqlSync("DELETE FROM pins WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channel_reads WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM messages WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channel_members WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM invites WHERE kind = 'group' AND target_id = ?", channelId);
    // Боты и вебхуки: нажатия кнопок и вебхуки этого канала
    tr->execSqlSync("DELETE FROM bot_callbacks WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM webhooks WHERE channel_id = ?", channelId);
    tr->execSqlSync("DELETE FROM channels WHERE id = ?", channelId);
}

void deleteChannel(const drogon::orm::DbClientPtr& db, int64_t channelId) {
    auto tr = db->newTransaction();
    Files files;
    try {
        channelRows(tr, channelId, files);
    } catch (...) {
        tr->rollback();
        throw;
    }
    removeFiles(tr, files);
}

void deleteServer(const drogon::orm::DbClientPtr& db, int64_t serverId) {
    auto tr = db->newTransaction();
    Files files;
    try {
        auto channels = tr->execSqlSync("SELECT id FROM channels WHERE server_id = ?", serverId);
        for (const auto& row : channels) channelRows(tr, row["id"].as<int64_t>(), files);
        tr->execSqlSync("DELETE FROM server_bans WHERE server_id = ?", serverId);
        tr->execSqlSync("DELETE FROM server_members WHERE server_id = ?", serverId);
        tr->execSqlSync("DELETE FROM invites WHERE kind = 'server' AND target_id = ?", serverId);
        tr->execSqlSync("DELETE FROM webhooks WHERE server_id = ?", serverId);
        tr->execSqlSync("DELETE FROM servers WHERE id = ?", serverId);
    } catch (...) {
        tr->rollback();
        throw;
    }
    removeFiles(tr, files);
}

static void userRows(const std::shared_ptr<drogon::orm::Transaction>& tr, int64_t userId, Files& files) {
    collect(tr, "author_id = ?", userId, files);
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
    tr->execSqlSync("DELETE FROM invites WHERE inviter_id = ? OR invitee_id = ?", userId, userId);
    tr->execSqlSync("DELETE FROM server_bans WHERE user_id = ?", userId);
    tr->execSqlSync("DELETE FROM user_roles WHERE user_id = ?", userId);
    tr->execSqlSync("DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?", userId, userId);
    tr->execSqlSync("DELETE FROM sessions WHERE user_id = ?", userId);
    tr->execSqlSync("DELETE FROM user_settings WHERE user_id = ?", userId);
    tr->execSqlSync("DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?", userId, userId);
    // Беседы и роли, которые он создал, остаются без владельца
    tr->execSqlSync("UPDATE channels SET owner_id = NULL WHERE owner_id = ?", userId);
    tr->execSqlSync("UPDATE roles SET created_by = NULL WHERE created_by = ?", userId);
    // Бот (docs/API.md §21): токен, очередь обновлений, нажатия кнопок; вебхуки, которые человек создал
    tr->execSqlSync("DELETE FROM bots WHERE user_id = ?", userId);
    tr->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", userId);
    tr->execSqlSync("DELETE FROM bot_callbacks WHERE bot_id = ? OR user_id = ?", userId, userId);
    tr->execSqlSync("DELETE FROM webhooks WHERE created_by = ?", userId);
    tr->execSqlSync("DELETE FROM users WHERE id = ?", userId);
}

void deleteUser(const drogon::orm::DbClientPtr& db, int64_t userId) {
    auto tr = db->newTransaction();
    Files files;
    try {
        // Боты удаляемого человека уходят вместе с ним
        auto bots = tr->execSqlSync("SELECT user_id FROM bots WHERE owner_id = ?", userId);
        for (const auto& row : bots) userRows(tr, row["user_id"].as<int64_t>(), files);
        userRows(tr, userId, files);
    } catch (...) {
        tr->rollback();
        throw;
    }
    removeFiles(tr, files);
}

} // namespace Cascade
