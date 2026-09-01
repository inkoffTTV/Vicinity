#include "ProfileController.h"
#include "../models/User.h"
#include "../managers/WSManager.h"
#include <trantor/utils/Logger.h>
#include <trantor/utils/Date.h>
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <string_view>

using namespace drogon::orm;
namespace fs = std::filesystem;

static drogon::HttpResponsePtr errResp(const std::string& msg, drogon::HttpStatusCode code) {
    auto r = drogon::HttpResponse::newHttpResponse();
    r->setStatusCode(code);
    r->setBody("{\"error\":\"" + msg + "\"}");
    r->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    return r;
}

void ProfileController::updateProfile(const HttpRequestPtr& req,
                                      std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string display_name = (*json)["display_name"].asString();
    auto db = app().getDbClient();
    db->execSqlAsync(
        "UPDATE users SET display_name = $1 WHERE id = $2",
        [callback, user_id, display_name](const Result&) {
            Json::Value resp;
            resp["status"]       = "success";
            resp["display_name"] = display_name;
            callback(HttpResponse::newHttpJsonResponse(resp));
            WSManager::instance().sendToUser(
                user_id,
                R"({"type":"profile_updated","display_name":")" + display_name + R"("})");
        },
        [callback](const DrogonDbException& e) {
            Json::Value resp; resp["status"] = "error";
            resp["message"] = std::string(e.base().what());
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        display_name, user_id);
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

    // Drogon's getFileExtension() returns the extension WITHOUT a leading dot
    std::string ext = std::string(file.getFileExtension());
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    if (ext != "gif" && ext != "png" && ext != "jpg" && ext != "jpeg") {
        callback(errResp("Only GIF, PNG, JPG allowed", k415UnsupportedMediaType)); return;
    }
    if (file.fileLength() > 15 * 1024 * 1024) {
        callback(errResp("Файл слишком большой (макс 15 МБ)", k413RequestEntityTooLarge)); return;
    }

    // Проверяем реальную сигнатуру файла (magic bytes), а не доверяем расширению.
    {
        std::string_view content = file.fileContent();
        bool okSig = false;
        if (content.size() >= 4) {
            const auto* b = reinterpret_cast<const unsigned char*>(content.data());
            bool isPng  = (b[0]==0x89 && b[1]==0x50 && b[2]==0x4E && b[3]==0x47);  // \x89PNG
            bool isGif  = (b[0]==0x47 && b[1]==0x49 && b[2]==0x46 && b[3]==0x38);  // GIF8
            bool isJpeg = (b[0]==0xFF && b[1]==0xD8 && b[2]==0xFF);                // JFIF/EXIF
            okSig = isPng || isGif || isJpeg;
        }
        if (!okSig) {
            callback(errResp("File is not a valid image", k415UnsupportedMediaType)); return;
        }
    }

    std::string subDir   = fieldName + "s";          // avatars / banners
    fs::create_directories("uploads/" + subDir);     // ./uploads/avatars
    std::string fileName = "user_" + std::to_string(user_id) + "_" +
                           std::to_string(trantor::Date::now().microSecondsSinceEpoch()) +
                           "." + ext;
    // Drogon's saveAs() пишет относительно upload_path (./uploads),
    // поэтому передаём только под-путь, иначе получается uploads/uploads/.
    file.saveAs(subDir + "/" + fileName);

    std::string dbColumn = (fieldName == "avatar") ? "avatar_path" : "banner_path";
    std::string sql      = "UPDATE users SET " + dbColumn + " = $1 WHERE id = $2";
    std::string fileUrl  = "/uploads/" + subDir + "/" + fileName;  // путь для БД + раздачи статики
    auto db = app().getDbClient();
    db->execSqlAsync(
        sql,
        [callback, fileUrl](const Result&) {
            Json::Value resp;
            resp["status"]   = "success";
            resp["file_url"] = fileUrl;
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        [callback](const DrogonDbException& e) {
            Json::Value resp; resp["status"] = "error";
            resp["message"] = std::string(e.base().what());
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        fileUrl, user_id);   // в БД пишем fileUrl (со слэшем), а не fullPath
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
    if (!json) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string bio = (*json)["bio"].asString();
    if (bio.size() > 190) {
        callback(errResp("Bio must be 190 characters or less", k400BadRequest)); return;
    }

    auto db = app().getDbClient();
    db->execSqlAsync(
        "UPDATE users SET bio = $1 WHERE id = $2",
        [callback, bio](const Result&) {
            Json::Value resp; resp["status"] = "success"; resp["bio"] = bio;
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        [callback](const DrogonDbException& e) {
            Json::Value resp; resp["status"] = "error";
            resp["message"] = std::string(e.base().what());
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        bio, user_id);
}

void ProfileController::clearMedia(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { callback(errResp("Invalid JSON", k400BadRequest)); return; }
    std::string field = (*json)["field"].asString();
    std::string col = field == "avatar" ? "avatar_path" : field == "banner" ? "banner_path" : "";
    if (col.empty()) { callback(errResp("Invalid field", k400BadRequest)); return; }
    auto db = app().getDbClient();
    try {
        db->execSqlSync("UPDATE users SET " + col + " = NULL WHERE id = ?", user_id);
        Json::Value resp; resp["status"] = "success";
        callback(HttpResponse::newHttpJsonResponse(resp));
    } catch (const std::exception& e) { callback(errResp(e.what(), k500InternalServerError)); }
}

void ProfileController::customize(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json) { callback(errResp("Invalid JSON", k400BadRequest)); return; }

    std::string profileJson = (*json)["profile_json"].asString();
    if (profileJson.size() > 8000) {
        callback(errResp("Profile config too large", k400BadRequest)); return;
    }
    // Опциональные поля профиля — сохраняем всё одним запросом
    std::string pronouns = (*json).get("pronouns", "").asString();
    if (pronouns.size() > 40) pronouns = pronouns.substr(0, 40);
    std::string presence = (*json).get("presence", "online").asString();
    if (presence != "online" && presence != "idle" && presence != "dnd" && presence != "invisible")
        presence = "online";

    std::string displayName = (*json).get("display_name", "").asString();
    std::string bio         = (*json).get("bio", "").asString();
    std::string accent      = (*json).get("accent_color", "").asString();
    if (bio.size() > 190) { callback(errResp("Bio must be 190 characters or less", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        if (!displayName.empty()) {
            if (displayName.size() > 32) displayName = displayName.substr(0, 32);
            db->execSqlSync("UPDATE users SET display_name=? WHERE id=?", displayName, user_id);
        }
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
    } catch (const std::exception& e) {
        callback(errResp(e.what(), k500InternalServerError));
    }
}

void ProfileController::updateAccent(const HttpRequestPtr& req,
                                     std::function<void(const HttpResponsePtr&)>&& callback) {
    int64_t user_id = req->attributes()->get<int64_t>("user_id");

    // Accent color requires Standard+ (tier >= 2)
    auto user = UserModel::findById(user_id);
    if (!user || user->subscriptionTier < 2) {
        callback(errResp("Accent color requires Vicinity Standard subscription", k403Forbidden)); return;
    }

    auto json = req->getJsonObject();
    if (!json) { callback(errResp("Invalid JSON", k400BadRequest)); return; }
    std::string color = (*json)["color"].asString();

    auto db = app().getDbClient();
    db->execSqlAsync(
        "UPDATE users SET accent_color = $1 WHERE id = $2",
        [callback, color](const Result&) {
            Json::Value resp; resp["status"] = "success"; resp["color"] = color;
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        [callback](const DrogonDbException& e) {
            Json::Value resp; resp["status"] = "error";
            resp["message"] = std::string(e.base().what());
            callback(HttpResponse::newHttpJsonResponse(resp));
        },
        color, user_id);
}
