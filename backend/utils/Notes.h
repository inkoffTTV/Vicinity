#pragma once
#include <drogon/orm/DbClient.h>
#include <cstdint>

// «Заметки» — личный чат пользователя с самим собой (docs/API.md §7): канал type 'dm' с одним участником.
// Создаётся при первом обращении; при подключённом Telegram зеркалится с ботом (utils/Telegram.cc).
namespace Notes {

// Канал заметок пользователя; create — создать, если ещё нет (иначе 0)
int64_t channelOf(const drogon::orm::DbClientPtr& db, int64_t userId, bool create = true);
// Канал — чьи-то заметки: id владельца, иначе 0
int64_t ownerOf(const drogon::orm::DbClientPtr& db, int64_t channelId);

} // namespace Notes
