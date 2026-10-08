#pragma once
#include <drogon/orm/DbClient.h>
#include <cstdint>
#include <string>

// Проверка доступа к каналам и серверам (docs/API.md §1).
// Серверный канал доступен участникам сервера (server_members),
// личка/беседа — участникам канала (channel_members).
// Функции выполняют синхронные запросы и бросают исключение при ошибке БД.
namespace Access {

struct ChannelInfo {
    int64_t     id       = 0;
    int64_t     serverId = 0;   // 0 — личка/беседа
    std::string type;           // dm | group | channel
    bool        isVoice  = false;
};

enum class Result { Ok, NotFound, Forbidden };

// Есть ли у пользователя доступ к каналу. info (если передан) заполняется, когда канал найден.
Result channel(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t userId,
               ChannelInfo* info = nullptr);

bool isServerMember(const drogon::orm::DbClientPtr& db, int64_t serverId, int64_t userId);

// Друзья (accepted) или общая личка — условие для звонков 1:1
bool canCall(const drogon::orm::DbClientPtr& db, int64_t userId, int64_t otherId);

} // namespace Access
