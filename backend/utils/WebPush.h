#pragma once
#include <json/json.h>
#include <cstdint>
#include <string>

// Web Push (RFC 8030/8291/8292): уведомления на телефон, когда приложение закрыто.
// Ключи VAPID создаются при первом запуске и хранятся в таблице kv. Отправка — в отдельном потоке
// через libcurl; подписки, которые сервис пуш-уведомлений отверг (404/410), удаляются.
// Сборка без libcurl: подписки принимаются, но ничего не отправляется.
namespace WebPush {

// Создать или загрузить ключи VAPID, запустить поток отправки. Вызывать после Database::initialize()
void init();

// Публичный ключ VAPID (base64url, 65 байт несжатой точки P-256) — клиенту для pushManager.subscribe
std::string publicKey();

// Сообщение в канале: тем участникам, кого нет в сети, с учётом настроек подписки
// (заглушённые каналы, уровень уведомлений сервера, @упоминания). Без исключений.
void notifyMessage(const Json::Value& msg, int64_t channelId);

// Входящий звонок пользователю, которого нет в сети
void notifyCall(int64_t toUserId, int64_t fromUserId, const std::string& fromName);

} // namespace WebPush
