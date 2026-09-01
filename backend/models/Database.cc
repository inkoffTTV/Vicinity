#include "Database.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>

namespace Database {

void initialize() {
    auto db = drogon::app().getDbClient();

    auto exec = [&](const char* sql) {
        try {
            db->execSqlSync(sql);
        } catch (const std::exception& e) {
            LOG_ERROR << "DB init error: " << e.what();
        }
    };

    exec("PRAGMA foreign_keys = ON");

    exec("CREATE TABLE IF NOT EXISTS users ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT,"
         "username TEXT UNIQUE NOT NULL,"
         "password_hash TEXT NOT NULL,"
         "display_name TEXT NOT NULL,"
         "bio TEXT DEFAULT NULL,"
         "accent_color TEXT DEFAULT NULL,"
         "avatar_path TEXT DEFAULT NULL,"
         "banner_path TEXT DEFAULT NULL,"
         "subscription_tier INTEGER NOT NULL DEFAULT 0,"
         "developer INTEGER NOT NULL DEFAULT 0,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

    // Migration: add developer column to existing databases
    exec("ALTER TABLE users ADD COLUMN developer INTEGER NOT NULL DEFAULT 0");

    // Migration: profile_json holds customizable profile (links, status, banner, theme)
    exec("ALTER TABLE users ADD COLUMN profile_json TEXT DEFAULT NULL");

    // Migration: расширенный профиль — местоимения и присутствие
    exec("ALTER TABLE users ADD COLUMN pronouns TEXT DEFAULT NULL");
    exec("ALTER TABLE users ADD COLUMN presence TEXT NOT NULL DEFAULT 'online'");

    // Друзья: одна строка на связь (requester → addressee), status pending/accepted
    exec("CREATE TABLE IF NOT EXISTS friendships ("
         "requester_id INTEGER NOT NULL,"
         "addressee_id INTEGER NOT NULL,"
         "status TEXT NOT NULL DEFAULT 'pending'," // pending | accepted
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "PRIMARY KEY(requester_id, addressee_id),"
         "FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,"
         "FOREIGN KEY(addressee_id) REFERENCES users(id) ON DELETE CASCADE)");

    exec("CREATE TABLE IF NOT EXISTS roles ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT,"
         "name TEXT NOT NULL,"
         "color TEXT NOT NULL DEFAULT '#888888',"
         "is_premium INTEGER NOT NULL DEFAULT 0,"
         "icon TEXT DEFAULT NULL,"
         "created_by INTEGER,"
         "position INTEGER NOT NULL DEFAULT 0,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "FOREIGN KEY(created_by) REFERENCES users(id))");

    exec("CREATE TABLE IF NOT EXISTS user_roles ("
         "user_id INTEGER NOT NULL,"
         "role_id INTEGER NOT NULL,"
         "assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "PRIMARY KEY(user_id, role_id),"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,"
         "FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE)");

    exec("CREATE TABLE IF NOT EXISTS sessions ("
         "token TEXT PRIMARY KEY,"
         "user_id INTEGER NOT NULL,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "expires_at DATETIME NOT NULL,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    exec("CREATE TABLE IF NOT EXISTS channels ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT,"
         "type TEXT NOT NULL CHECK(type IN ('dm','group','channel')),"
         "name TEXT,"
         "owner_id INTEGER,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "FOREIGN KEY(owner_id) REFERENCES users(id))");

    exec("CREATE TABLE IF NOT EXISTS channel_members ("
         "channel_id INTEGER,"
         "user_id INTEGER,"
         "joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "PRIMARY KEY(channel_id, user_id),"
         "FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    // ── Серверы-гильдии (Discord-подобные) ───────────────────────────────────
    exec("CREATE TABLE IF NOT EXISTS servers ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT,"
         "name TEXT NOT NULL,"
         "icon TEXT DEFAULT NULL,"
         "owner_id INTEGER,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "FOREIGN KEY(owner_id) REFERENCES users(id))");

    // Инвайт-код сервера (для приглашения людей)
    exec("ALTER TABLE servers ADD COLUMN invite_code TEXT");
    exec("UPDATE servers SET invite_code = upper(substr(hex(randomblob(4)),1,6)) "
         "WHERE invite_code IS NULL OR invite_code = ''");

    exec("CREATE TABLE IF NOT EXISTS server_members ("
         "server_id INTEGER,"
         "user_id INTEGER,"
         "joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "PRIMARY KEY(server_id, user_id),"
         "FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    // channels могут принадлежать серверу (server_id) и быть голосовыми (is_voice)
    exec("ALTER TABLE channels ADD COLUMN server_id INTEGER DEFAULT NULL");
    exec("ALTER TABLE channels ADD COLUMN is_voice INTEGER NOT NULL DEFAULT 0");

    exec("CREATE TABLE IF NOT EXISTS messages ("
         "id INTEGER PRIMARY KEY AUTOINCREMENT,"
         "channel_id INTEGER NOT NULL,"
         "author_id INTEGER NOT NULL,"
         "text TEXT NOT NULL,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,"
         "FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE)");

    // Migration: редактирование сообщений + вложения-картинки
    exec("ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0");
    exec("ALTER TABLE messages ADD COLUMN attachment TEXT DEFAULT NULL");

    // Реакции на сообщения (эмодзи)
    exec("CREATE TABLE IF NOT EXISTS reactions ("
         "message_id INTEGER NOT NULL,"
         "user_id INTEGER NOT NULL,"
         "emoji TEXT NOT NULL,"
         "PRIMARY KEY(message_id, user_id, emoji),"
         "FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    LOG_INFO << "Database initialized";
}

} // namespace Database
