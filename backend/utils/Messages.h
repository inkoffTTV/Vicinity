#pragma once
#include <drogon/orm/DbClient.h>
#include <drogon/orm/Row.h>
#include <json/json.h>
#include <cstdint>
#include <string>

// Объект сообщения (docs/API.md §2) — один и тот же в истории, поиске, закрепах и WS new_message.
// Функции выполняют синхронные запросы и бросают исключение при ошибке БД.
namespace Messages {

// Выборка сообщений: "SELECT " + kColumns + " FROM " + kFrom + " WHERE ...".
// m — сообщение, u — автор, rm/ru — сообщение, на которое ответ (того же канала), и его автор.
extern const std::string kColumns;
extern const std::string kFrom;

// Последнее сообщение канала c.id для списков чатов (§7): kLastColumns — в SELECT, kLastJoin — после FROM
extern const std::string kLastColumns;
extern const std::string kLastJoin;

// Сообщение из строки выборки kColumns; reactions — пустой массив (см. attachReactions)
Json::Value fromRow(const drogon::orm::Row& row);
// {id, author_id, author_name, text, attachment, created_at} из строки с kLastColumns; null — сообщений нет
Json::Value lastFromRow(const drogon::orm::Row& row);

// Реакции одного сообщения: [{emoji, count, users:[ids]}]
Json::Value reactions(const drogon::orm::DbClientPtr& db, int64_t messageId);
// Заполнить reactions у массива сообщений одним запросом
void attachReactions(const drogon::orm::DbClientPtr& db, Json::Value& messages);

// Сообщение целиком (с реакциями) по id; null — такого нет
Json::Value load(const drogon::orm::DbClientPtr& db, int64_t messageId);

} // namespace Messages
