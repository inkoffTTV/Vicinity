#include "ProfileController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Broadcast.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include "../utils/Uploads.h"
#include "../../shared/crypto/common_consts.h"
#include <trantor/utils/Logger.h>
#include <optional>

using namespace drogon::orm;

static drogon::HttpResponsePtr errResp(const std::string& msg, drogon::HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    auto r = drogon::HttpResponse::newHttpJsonResponse(v);
    r->setStatusCode(code);
    return r;
}

// Отображаемое имя: 1–32 символа без управляющих; длинное обрезается по границе символа
// (как раньше обрезалось по байтам — старые клиенты не получают новых ошибок)
static std::optional<std::string> cleanDisplayName(const std::string& raw) {
    return TextUtils::cleanName(raw, Vicinity::MAX_DISPLAY_NAME_LEN, true);
}

// «О себе»: до 190 символов, переводы строк можно
static bool validBio(const std::string& bio) {
    return TextUtils::isValidUtf8(bio) && !TextUtils::hasControlChars(bio, true) &&
           TextUtils::utf8Length(bio) <= Vicinity::MAX_BIO_LEN;
}

// Цвет профиля: #RRGGBB или пусто (без цвета)
static bool validAccent(const std::string& color) {
    return color.empty() || TextUtils::isHexColor(color);
}

void ProfileController::updateProfile(const HttpRequestPtr& req,
                                      std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    auto displayName = cleanDisplayName(JsonUtils::getStr(*json, "display_name"));
    if (!displayName) { callback(errResp("Имя — от 1 до 32 символов", k400BadRequest)); return; }
    try {
        app().getDbClient()->execSqlSync("UPDATE users SET display_name = ? WHERE id = ?",
                                         *displayName, user_id);
        Json::Value resp;
        resp["status"]       = "success";
        resp["display_name"] = *displayName;
        callback(HttpResponse::newHttpJsonResponse(resp));

        Json::Value ev;
        ev["type"]         = "profile_updated";
        ev["display_name"] = *displayName;
        Broadcast::toUser(user_id, ev);
        Broadcast::userUpdated(user_id);
    } catch (const std::exception& e) {
        callback(errResp(e.what(), k500InternalServerError));
    }
}

void ProfileController::uploadMedia(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
  try {   // защита от падения всего сервера на кривом файле/диске
    MultiPartParser fileUpload;
    if (fileUpload.parse(req) != 0 || fileUpload.getFiles().empty()) {
        callback(errResp("Invalid file upload", k400BadRequest)); return;
    }

    const auto& file      = fileUpload.getFiles()[0];
    std::string fieldName = file.getItemName();

    if (fieldName != "avatar" && fieldName != "banner") {
        callback(errResp("Invalid field name", k400BadRequest)); return;
    }
    // Баннер доступен всем (ограничение по подписке снято).
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Upload, user_id)) {
        callback(errResp("Слишком часто, попробуйте позже", k429TooManyRequests)); return;
    }

    auto saved = Uploads::saveImage(file, fieldName + "s");   // avatars / banners
    if (!saved.error.empty()) { callback(errResp(saved.error, saved.code)); return; }

    // column — из белого списка выше, не из ввода
    const std::string dbColumn = (fieldName == "avatar") ? "avatar_path" : "banner_path";
    auto db = app().getDbClient();
    auto prev = db->execSqlSync("SELECT " + dbColumn + " AS path FROM users WHERE id = ?", user_id);
    db->execSqlSync("UPDATE users SET " + dbColumn + " = ? WHERE id = ?", saved.url, user_id);
    // Старый файл больше никому не нужен
    if (!prev.empty() && !prev[0]["path"].isNull()) Uploads::removeByUrl(prev[0]["path"].as<std::string>());

    Json::Value resp;
    resp["status"]   = "success";
    resp["file_url"] = saved.url;
    callback(HttpResponse::newHttpJsonResponse(resp));
    Broadcast::userUpdated(user_id);
  } catch (const std::exception& e) {
        LOG_ERROR << "uploadMedia exception: " << e.what();
        callback(errResp("Не удалось загрузить файл", k500InternalServerError));
  } catch (...) {
        LOG_ERROR << "uploadMedia unknown exception";
        callback(errResp("Не удалось загрузить файл", k500InternalServerError));
  }
}

void ProfileController::updateBio(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string bio = JsonUtils::getStr(*json, "bio");
    if (!validBio(bio)) {
        callback(errResp("Bio must be 190 characters or less", k400BadRequest)); return;
    }
    try {
        app().getDbClient()->execSqlSync("UPDATE users SET bio = ? WHERE id = ?", bio, user_id);
        Json::Value resp; resp["status"] = "success"; resp["bio"] = bio;
        callback(HttpResponse::newHttpJsonResponse(resp));
        Broadcast::userUpdated(user_id);
    } catch (const std::exception& e) {
        callback(errResp(e.what(), k500InternalServerError));
    }
}

void ProfileController::clearMedia(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { callback(errResp("Invalid JSON", k400BadRequest)); return; }
    std::string field = JsonUtils::getStr(*json, "field");
    std::string col = field == "avatar" ? "avatar_path" : field == "banner" ? "banner_path" : "";
    if (col.empty()) { callback(errResp("Invalid field", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        auto prev = db->execSqlSync("SELECT " + col + " AS path FROM users WHERE id = ?", user_id);
        db->execSqlSync("UPDATE users SET " + col + " = NULL WHERE id = ?", user_id);
        if (!prev.empty() && !prev[0]["path"].isNull()) Uploads::removeByUrl(prev[0]["path"].as<std::string>());
        Json::Value resp; resp["status"] = "success";
        callback(HttpResponse::newHttpJsonResponse(resp));
        Broadcast::userUpdated(user_id);
    } catch (const std::exception& e) { callback(errResp(e.what(), k500InternalServerError)); }
}

void ProfileController::customize(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string profileJson = JsonUtils::getStr(*json, "profile_json");
    if (profileJson.size() > 8000 || !TextUtils::isValidUtf8(profileJson)) {
        callback(errResp("Profile config too large", k400BadRequest)); return;
    }
    // Опциональные поля профиля — сохраняем всё одним запросом
    std::string pronouns = JsonUtils::getStr(*json, "pronouns");
    if (!TextUtils::isValidUtf8(pronouns) || TextUtils::hasControlChars(pronouns)) {
        callback(errResp("Invalid pronouns", k400BadRequest)); return;
    }
    pronouns = TextUtils::trim(TextUtils::utf8Truncate(pronouns, Vicinity::MAX_PRONOUNS_LEN));
    std::string presence = JsonUtils::getStr(*json, "presence", "online");
    if (presence != "online" && presence != "idle" && presence != "dnd" && presence != "invisible")
        presence = "online";

    // Пустое имя — «не менять» (как раньше)
    std::string displayName = JsonUtils::getStr(*json, "display_name");
    std::string bio         = JsonUtils::getStr(*json, "bio");
    std::string accent      = JsonUtils::getStr(*json, "accent_color");
    if (!validBio(bio)) { callback(errResp("Bio must be 190 characters or less", k400BadRequest)); return; }
    // Цвет профиля доступен всем (платных тарифов нет), но только в формате #RRGGBB
    if (!validAccent(accent)) { callback(errResp("Цвет — в формате #RRGGBB", k400BadRequest)); return; }
    if (!TextUtils::trim(displayName).empty()) {
        auto clean = cleanDisplayName(displayName);
        if (!clean) { callback(errResp("Имя — от 1 до 32 символов", k400BadRequest)); return; }
        displayName = *clean;
    } else {
        displayName.clear();
    }

    auto db = app().getDbClient();
    try {
        auto prev = db->execSqlSync("SELECT presence FROM users WHERE id = ?", user_id);
        if (!displayName.empty())
            db->execSqlSync("UPDATE users SET display_name=? WHERE id=?", displayName, user_id);
        db->execSqlSync("UPDATE users SET profile_json=?, pronouns=?, presence=?, bio=?, accent_color=? WHERE id=?",
                        profileJson, pronouns, presence, bio, accent, user_id);
        Json::Value resp;
        resp["status"]       = "success";
        resp["profile_json"] = profileJson;
        resp["pronouns"]     = pronouns;
        resp["presence"]     = presence;
        resp["display_name"] = displayName;
        resp["bio"]          = bio;
        resp["accent_color"] = accent;
        callback(HttpResponse::newHttpJsonResponse(resp));

        Broadcast::userUpdated(user_id);
        if (prev.empty() || prev[0]["presence"].isNull() || prev[0]["presence"].as<std::string>() != presence)
            Broadcast::presence(user_id);
    } catch (const std::exception& e) {
        callback(errResp(e.what(), k500InternalServerError));
    }
}

void ProfileController::updateAccent(const HttpRequestPtr& req,
                                     std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { callback(errResp("Invalid JSON", k400BadRequest)); return; }
    // Раньше требовалась подписка Standard, но оплаты нет — цвет доступен всем
    std::string color = JsonUtils::getStr(*json, "color");
    if (!validAccent(color)) { callback(errResp("Цвет — в формате #RRGGBB", k400BadRequest)); return; }

    try {
        app().getDbClient()->execSqlSync("UPDATE users SET accent_color = ? WHERE id = ?", color, user_id);
        Json::Value resp; resp["status"] = "success"; resp["color"] = color;
        callback(HttpResponse::newHttpJsonResponse(resp));
        Broadcast::userUpdated(user_id);
    } catch (const std::exception& e) {
        callback(errResp(e.what(), k500InternalServerError));
    }
}
