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

// Владелец сервера; 0 — сервера нет
int64_t serverOwner(const drogon::orm::DbClientPtr& db, int64_t serverId);

// Пользователь забанен на сервере
bool isBanned(const drogon::orm::DbClientPtr& db, int64_t serverId, int64_t userId);

// Подзапрос со всеми каналами, доступными пользователю (те же правила, что у channel()):
// "... WHERE m.channel_id IN (" + kAccessibleChannels + ")" — два параметра, оба user_id
extern const char* const kAccessibleChannels;

// Друзья (accepted) или общая личка — условие для звонков 1:1
bool canCall(const drogon::orm::DbClientPtr& db, int64_t userId, int64_t otherId);

// Один из двоих заблокировал другого — между ними нет личных сообщений, звонков и заявок в друзья
bool blockedBetween(const drogon::orm::DbClientPtr& db, int64_t a, int64_t b);

// Видит ли viewer профиль target по номеру: сам, разработчик, друзья или заявка в друзья,
// общая личка или беседа, общий сервер. Остальные открывают профиль только по ссылке (/u/<код>).
bool canSeeProfile(const drogon::orm::DbClientPtr& db, int64_t viewer, int64_t target);

// Владелец ссылки на профиль; 0 — такой ссылки нет
int64_t profileLinkOwner(const drogon::orm::DbClientPtr& db, const std::string& code);

// Можно ли обратиться к target (заявка в друзья, личка): виден по номеру, или есть его ссылка,
// или viewer знает его полный ник
bool canReach(const drogon::orm::DbClientPtr& db, int64_t viewer, int64_t target,
              const std::string& link, std::string username);

// Личка (2 участника) и её второй участник; 0 — канал не личка
int64_t dmPeer(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t userId);

} // namespace Access
