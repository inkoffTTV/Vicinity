#pragma once
#include <drogon/orm/DbClient.h>
#include <json/json.h>
#include <cstdint>
#include <string>

// Приглашения в беседу и на сервер (docs/API.md §7.1): человека больше не добавляют сразу —
// ему приходит приглашение, и он сам решает, принять его или отклонить.
// Строки удаляются вместе с беседой, сервером и аккаунтом (models/Cascade.cc).
namespace Invites {

enum class Kind { Group, Server };

const char* kindName(Kind k);

// Итог попытки пригласить
enum class Outcome {
    Invited,         // приглашение создано, приглашённому ушло invite_received
    AlreadyInvited,  // уже ждёт ответа — повторно не шлём
    AlreadyMember,   // уже в беседе / на сервере
};

// Создать приглашение (права пригласившего проверяет вызывающий). Бросает исключение при ошибке БД.
Outcome create(const drogon::orm::DbClientPtr& db, Kind kind, int64_t targetId, int64_t inviterId, int64_t inviteeId);

// Приглашение для списка и события: {id, kind, target_id, name, icon, inviter{...}, created_at};
// null — приглашения (или беседы/сервера) уже нет
Json::Value describe(const drogon::orm::DbClientPtr& db, int64_t inviteId);

// Снять ожидающее приглашение (бан, вступление по ссылке) и сообщить приглашённому
void drop(const drogon::orm::DbClientPtr& db, Kind kind, int64_t targetId, int64_t inviteeId);

} // namespace Invites
