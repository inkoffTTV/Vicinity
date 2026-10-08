#pragma once
#include <json/json.h>
#include <cstdint>
#include <optional>

// Что даёт каждая подписка (0 — бесплатно, 1 — Basic, 2 — Standard, 3 — Ultra).
// Единственное место с лимитами: сервер проверяет их сам, клиенты получают их из GET /subscription.
// Оплаты нет — уровень выдаёт администратор (админ-панель, users.subscription_tier).
namespace Tiers {
    int     clamp(int tier);                  // 0..3
    int64_t uploadLimitBytes(int tier);       // вложения: 15 / 25 / 50 / 100 МБ
    int     maxOwnedServers(int tier);        // своих серверов: 10 / 25 / 50 / без лимита (-1)
    int     bioLimit(int tier);               // «О себе», символов: 190 / 190 / 400 / 400
    bool    animatedBanner(int tier);         // загрузка GIF-баннера — Standard+
    bool    colorThemes(int tier);            // готовые цветовые темы оформления — Standard+
    bool    customTheme(int tier);            // своя тема из любых цветов — Ultra
    bool    nameColor(int tier);              // ник в чатах цветом профиля — Basic+
    bool    gradientName(int tier);           // градиентный ник — Ultra

    // Описание уровня для клиентов: {tier, name, files_mb, screen:{height,fps}, camera_height,
    // servers (-1 — без лимита), bio, animated_banner, color_themes, custom_theme, name_color, gradient_name}
    Json::Value describe(int tier);
}
