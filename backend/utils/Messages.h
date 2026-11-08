#pragma once
#include <drogon/orm/DbClient.h>
#include <drogon/orm/Row.h>
#include <json/json.h>
#include <cstdint>
#include <optional>
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
// Бейджик («id|ТЕГ|значок» из запроса) → {server_id, tag, icon} или null
Json::Value badgeFromString(const std::string& s);

Json::Value fromRow(const drogon::orm::Row& row);
// {id, author_id, author_name, text, attachment, created_at} из строки с kLastColumns; null — сообщений нет
Json::Value lastFromRow(const drogon::orm::Row& row);

// Реакции одного сообщения: [{emoji, count, users:[ids]}]
Json::Value reactions(const drogon::orm::DbClientPtr& db, int64_t messageId);
// Заполнить reactions у массива сообщений одним запросом
void attachReactions(const drogon::orm::DbClientPtr& db, Json::Value& messages);

// Сообщение целиком (с реакциями) по id; null — такого нет
Json::Value load(const drogon::orm::DbClientPtr& db, int64_t messageId);

// Новое сообщение: поля, которые уже проверил вызывающий (доступ, длина, вложение)
struct Post {
    std::string text;
    std::optional<std::string> attachment, attachmentName, attachmentType;
    std::optional<int64_t>     attachmentSize, replyTo;
    std::optional<std::string> kind, meta;
    std::optional<std::string> replyMarkup;   // JSON {"inline_keyboard": ...} — кнопки бота/вебхука
    std::optional<int64_t>     webhookId;     // сообщение входящего вебхука канала
    std::optional<std::string> webhookName;   // имя, под которым его показать
    std::string nonce;                        // метка клиента, возвращается в new_message
    bool push         = true;    // Web Push тем, кого нет в сети (боты и вебхуки — без пушей)
    bool activity     = true;    // опыт активности автору (людям, не ботам)
    bool fromTelegram = false;   // пришло из Telegram — обратно туда не пересылать
};

// Общий путь отправки (docs/API.md §2): INSERT → load → WS new_message → Web Push → Telegram →
// Activity → доставка ботам канала (кроме сообщений самих ботов). Возвращает сообщение (с nonce).
// Бросает исключение при ошибке БД.
Json::Value post(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t authorId, const Post& p);

} // namespace Messages
