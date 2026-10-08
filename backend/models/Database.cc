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

    // Migration: метаданные вложения (у старых сообщений NULL — это картинки) и ответы
    exec("ALTER TABLE messages ADD COLUMN attachment_name TEXT DEFAULT NULL");
    exec("ALTER TABLE messages ADD COLUMN attachment_size INTEGER DEFAULT NULL");
    exec("ALTER TABLE messages ADD COLUMN attachment_type TEXT DEFAULT NULL");
    exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER DEFAULT NULL");

    // Реакции на сообщения (эмодзи)
    exec("CREATE TABLE IF NOT EXISTS reactions ("
         "message_id INTEGER NOT NULL,"
         "user_id INTEGER NOT NULL,"
         "emoji TEXT NOT NULL,"
         "PRIMARY KEY(message_id, user_id, emoji),"
         "FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    // Закреплённые сообщения: у сообщения не больше одного закрепа (оно живёт в одном канале)
    exec("CREATE TABLE IF NOT EXISTS pins ("
         "message_id INTEGER PRIMARY KEY,"
         "channel_id INTEGER NOT NULL,"
         "pinned_by INTEGER NOT NULL,"
         "pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,"
         "FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,"
         "FOREIGN KEY(pinned_by) REFERENCES users(id) ON DELETE CASCADE)");

    // Баны на серверах: забаненный не вступит ни по коду, ни через добавление участником
    exec("CREATE TABLE IF NOT EXISTS server_bans ("
         "server_id INTEGER NOT NULL,"
         "user_id INTEGER NOT NULL,"
         "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
         "PRIMARY KEY(server_id, user_id),"
         "FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,"
         "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)");

    // Исходные имена загруженных файлов-вложений — для Content-Disposition при скачивании /uploads/files/
    exec("CREATE TABLE IF NOT EXISTS upload_names ("
         "url TEXT PRIMARY KEY,"
         "name TEXT NOT NULL)");

    // Разовые миграции с данными: номер последней выполненной хранится в PRAGMA user_version,
    // каждая выполняется в транзакции вместе с повышением номера — ровно один раз.
    int version = 0;
    try {
        version = db->execSqlSync("PRAGMA user_version")[0]["user_version"].as<int>();
    } catch (const std::exception& e) {
        LOG_ERROR << "DB init error: " << e.what();
    }
    if (version < 1) {
        // Прочитанное (docs/API.md §4). Существующим участникам — текущий максимум id,
        // чтобы после обновления у всех не загорелась непрочитанной вся история.
        auto tr = db->newTransaction();
        try {
            tr->execSqlSync("CREATE TABLE IF NOT EXISTS channel_reads ("
                            "user_id INTEGER NOT NULL,"
                            "channel_id INTEGER NOT NULL,"
                            "last_read_id INTEGER NOT NULL DEFAULT 0,"
                            "PRIMARY KEY(user_id, channel_id),"
                            "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,"
                            "FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE)");
            tr->execSqlSync("INSERT OR IGNORE INTO channel_reads(user_id, channel_id, last_read_id) "
                            "SELECT cm.user_id, cm.channel_id, MAX(m.id) FROM channel_members cm "
                            "JOIN channels c ON c.id = cm.channel_id AND c.server_id IS NULL "
                            "JOIN messages m ON m.channel_id = cm.channel_id "
                            "GROUP BY cm.user_id, cm.channel_id");
            tr->execSqlSync("INSERT OR IGNORE INTO channel_reads(user_id, channel_id, last_read_id) "
                            "SELECT sm.user_id, c.id, MAX(m.id) FROM server_members sm "
                            "JOIN channels c ON c.server_id = sm.server_id "
                            "JOIN messages m ON m.channel_id = c.id "
                            "GROUP BY sm.user_id, c.id");
            tr->execSqlSync("PRAGMA user_version = 1");
        } catch (const std::exception& e) {
            tr->rollback();
            LOG_ERROR << "DB migration 1 (channel_reads) failed: " << e.what();
        }
    }

    if (version < 2) {
        // Файлы, загруженные до появления upload_names: имя берём из первого сообщения с этим файлом
        auto tr = db->newTransaction();
        try {
            tr->execSqlSync("INSERT OR IGNORE INTO upload_names(url, name) "
                            "SELECT attachment, attachment_name FROM messages "
                            "WHERE attachment LIKE '/uploads/files/%' AND attachment_name IS NOT NULL "
                            "AND attachment_name != '' ORDER BY id");
            tr->execSqlSync("PRAGMA user_version = 2");
        } catch (const std::exception& e) {
            tr->rollback();
            LOG_ERROR << "DB migration 2 (upload_names) failed: " << e.what();
        }
    }

    // Цвет профиля #AARRGGBB (старый сервер сохранял цвет десктопа как есть) — без альфы, как принимает API
    exec("UPDATE users SET accent_color = '#' || substr(accent_color, 4) "
         "WHERE length(accent_color) = 9 AND substr(accent_color, 1, 1) = '#' "
         "AND substr(accent_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'");

    // Индексы под частые выборки: история канала, «мои» беседы/серверы/сессии,
    // реакции сообщения, входящие заявки в друзья
    exec("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id)");
    exec("CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id)");
    exec("CREATE INDEX IF NOT EXISTS idx_pins_channel ON pins(channel_id)");

    LOG_INFO << "Database initialized";
}

} // namespace Database
