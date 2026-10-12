#pragma once
#include <json/json.h>
#include <cstdint>
#include <string>

// Расширенный профиль (users.profile_ext, docs/API.md §10.1): бейджик-сервер, рамка аватара, эффект профиля,
// стиль ника, подключённые аккаунты и виджеты с играми. Отдельно от profile_json: его десктоп-клиент
// перезаписывает целиком своими ключами (баннер, ссылки, статус) и стёр бы новые поля.
namespace ProfileExt {
    // Проверить и привести к каноническому виду. Ошибка — текст в error, httpCode 400 или 403 (украшение
    // не по подписке). serverIds — серверы пользователя: бейджиком можно поставить только свой сервер.
    bool sanitize(const Json::Value& in, int tier, const Json::Value& memberServerIds,
                  Json::Value& out, std::string& error, int& httpCode);

    // Сохранённый профиль для показа: украшения, на которые подписки уже нет, убираются
    Json::Value forDisplay(const std::string& stored, int tier);
}
