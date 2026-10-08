#pragma once
#include <drogon/orm/DbClient.h>
#include <cstdint>

// Удаление канала или сервера вместе со всеми зависимыми строками (сообщения, реакции, закрепы,
// прочитанное, участники, баны) — в одной транзакции. Не полагается на PRAGMA foreign_keys.
// Бросает исключение при ошибке БД (транзакция откатывается).
namespace Cascade {
    void deleteChannel(const drogon::orm::DbClientPtr& db, int64_t channelId);
    void deleteServer(const drogon::orm::DbClientPtr& db, int64_t serverId);
}
