#pragma once
#include <json/json.h>
#include <cstdint>
#include <string>

// Мост с Telegram (docs/API.md §20): бот присылает пользователю новые сообщения из Vicinity, а ответ
// на такое сообщение в Telegram («Ответить») уходит обратно в тот же чат Vicinity от его имени.
// Токен бота — VICINITY_TG_BOT_TOKEN в deploy/.env (custom_config.telegram.token); без него мост выключен.
// Сервер сам опрашивает Bot API (getUpdates, длинный опрос) — вебхук и открытые порты не нужны.
namespace Telegram {

// Запустить опрос бота, если задан токен. Вызывать после Database::initialize()
void init();

// Бот настроен (есть токен) и уже узнал своё имя у Telegram (getMe прошёл)
bool ready();
// Имя бота без @ ('' — ещё не известно)
std::string botUsername();

// Новое сообщение в канале: участникам с подключённым Telegram (кроме автора) по их настройкам.
// Сообщение в «Заметках» уходит самому владельцу; fromTelegram — пришло из Telegram, обратно не отправлять
void notifyMessage(const Json::Value& msg, int64_t channelId, bool fromTelegram = false);

// Одноразовый код привязки для ссылки t.me/<бот>?start=<код>, живёт 10 минут
std::string createLinkCode(int64_t userId);

// Отвязать Telegram пользователя (бот пишет ему, что отключено)
void unlink(int64_t userId);

} // namespace Telegram
