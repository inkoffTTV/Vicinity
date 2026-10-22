#pragma once
#include <json/json.h>
#include <cstdint>
#include <string>

// Подарочные коды подписки (docs/API.md §17): администратор создаёт коды на уровень и срок,
// пользователь активирует в настройках или по ссылке /gift/<код>. Таблица gift_codes;
// срок подписки — users.subscription_until, истёкшие снимает expire() (раз в час из main.cc).
namespace Gifts {
    // Создать count кодов; возвращает [{code, tier, days}]
    Json::Value create(int64_t adminId, int tier, int days, int count, const std::string& note);
    // Последние коды: [{code, tier, days, note, created_at, redeemed_by, redeemed_by_name, redeemed_at}]
    Json::Value list();
    // Что внутри кода (без активации): {code, tier, name, days, redeemed}
    bool info(const std::string& code, Json::Value& out);
    // Активировать: уровень поднимается до tier (или продлевается тот же), срок — days от сегодня
    // либо от конца текущего срока того же уровня. status: 404 — нет кода, 409 — уже активирован
    bool redeem(int64_t userId, const std::string& code, Json::Value& out, std::string& error, int& status);
    // Снять истёкшие подписки
    void expire();
    // Нормализованный код (верхний регистр, без пробелов и дефисов) или "" если формат неверный
    std::string normalize(const std::string& raw);
}
