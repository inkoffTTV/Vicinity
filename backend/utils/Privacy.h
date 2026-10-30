#pragma once
#include <drogon/orm/DbClient.h>
#include <json/json.h>
#include <cstdint>
#include <string>

// Приватность (docs/API.md §15): кто видит статус и активность, кто может писать в личку и слать заявки.
// Хранится в user_settings.privacy (JSON); значения по умолчанию — «все».
namespace Privacy {
    // {status, stats, dm, friend_requests} с подставленными значениями по умолчанию
    Json::Value get(int64_t userId);
    // Проверить и сохранить присланные поля; false — некорректное значение (error заполнен)
    bool patch(int64_t userId, const Json::Value& in, Json::Value& out, std::string& error);

    // Друзья ли (accepted)
    bool friends(const drogon::orm::DbClientPtr& db, int64_t a, int64_t b);
    // Виден ли viewer-у аспект field пользователя target: "status" | "stats" | "about" | "banner" | "wishlist" |
    // "games" | "music" | "connections". Правило элемента — rules[field] = {who, hide_from, show_to} плюс общий список
    // rules.all.hide_from («скрыть профиль целиком от…»): сначала исключения, потом who (everyone | friends | nobody)
    bool allows(const drogon::orm::DbClientPtr& db, int64_t target, int64_t viewer, const char* field);
    // Элементы профиля с правилами (кроме status и stats, у них свои поля)
    extern const char* const kProfileFields[6];
    // Статус target глазами viewer: effectivePresence или "offline", если статус скрыт
    std::string presenceFor(const drogon::orm::DbClientPtr& db, int64_t target, int64_t viewer);
    // Может ли from написать target в личку (новую); текст отказа в reason
    bool canDm(const drogon::orm::DbClientPtr& db, int64_t from, int64_t target, std::string& reason);
    // Может ли from отправить target заявку в друзья; текст отказа в reason
    bool canRequest(const drogon::orm::DbClientPtr& db, int64_t from, int64_t target, std::string& reason);
}
