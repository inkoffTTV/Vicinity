#include "ThemesController.h"
#include "../models/User.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Tiers.h"
#include <drogon/drogon.h>

using HttpUtils::error;

namespace {

constexpr int kMaxOwn = 5;

bool isHexColor(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
    return true;
}

// Строка таблицы → объект для клиента
Json::Value rowToJson(const drogon::orm::Row& r, int64_t viewer) {
    Json::Value t;
    t["id"]    = static_cast<Json::Int64>(r["id"].as<int64_t>());
    t["name"]  = r["name"].as<std::string>();
    Json::Value colors;
    JsonUtils::parse(r["colors"].as<std::string>(), colors);
    t["colors"] = colors.isArray() ? colors : Json::Value(Json::arrayValue);
    t["angle"]  = r["angle"].as<int>();
    t["base"]   = r["base"].as<std::string>();
    t["likes"]  = r["likes"].as<int>();
    t["liked"]  = r["liked"].as<int>() > 0;
    t["created_at"] = r["created_at"].as<std::string>();
    const int64_t author = r["author_id"].as<int64_t>();
    t["mine"] = author == viewer;
    t["author"]["id"]           = static_cast<Json::Int64>(author);
    t["author"]["display_name"] = r["display_name"].isNull() ? std::string() : r["display_name"].as<std::string>();
    return t;
}

const char* kSelect =
    "SELECT t.id, t.name, t.colors, t.angle, t.base, t.author_id, t.created_at, u.display_name, "
    "(SELECT COUNT(*) FROM community_theme_likes l WHERE l.theme_id = t.id) AS likes, "
    "(SELECT COUNT(*) FROM community_theme_likes l WHERE l.theme_id = t.id AND l.user_id = ?) AS liked "
    "FROM community_themes t LEFT JOIN users u ON u.id = t.author_id ";

}  // namespace

Json::Value ThemesController::find(int64_t id) {
    auto rows = app().getDbClient()->execSqlSync("SELECT colors, angle, base FROM community_themes WHERE id = ?", id);
    if (rows.empty()) return Json::nullValue;
    Json::Value t, colors;
    JsonUtils::parse(rows[0]["colors"].as<std::string>(), colors);
    t["colors"] = colors;
    t["angle"]  = rows[0]["angle"].as<int>();
    t["base"]   = rows[0]["base"].as<std::string>();
    return t;
}

// GET /api/v1/themes/community?sort=top|new → {themes:[...], can_publish, own}
void ThemesController::list(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        const bool byNew = req->getParameter("sort") == "new";
        const std::string order = byNew ? "ORDER BY t.id DESC LIMIT 100" : "ORDER BY likes DESC, t.id DESC LIMIT 100";
        auto rows = app().getDbClient()->execSqlSync(std::string(kSelect) + order, userId);
        Json::Value resp;
        resp["themes"] = Json::Value(Json::arrayValue);
        int own = 0;
        for (const auto& r : rows) {
            resp["themes"].append(rowToJson(r, userId));
            if (r["author_id"].as<int64_t>() == userId) ++own;
        }
        const auto me = UserModel::findById(userId);
        resp["can_publish"] = me && Tiers::customTheme(me->subscriptionTier);
        resp["own"]         = own;
        resp["max_own"]     = kMaxOwn;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/themes/community {name, colors, angle, base} → тема. Ultra; не больше 5 своих
void ThemesController::publish(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const Json::Value& in = *json;
    try {
        const auto me = UserModel::findById(userId);
        if (!me || !Tiers::customTheme(me->subscriptionTier)) {
            Json::Value e;
            e["error"]         = "Публиковать темы можно с подпиской Ultra";
            e["required_tier"] = 3;
            cb(HttpUtils::json(std::move(e), k403Forbidden));
            return;
        }
        std::string name = JsonUtils::getStr(in, "name");
        // Обрезаем пробелы по краям; длина в символах UTF-8
        const auto l = name.find_first_not_of(" \t\n\r");
        name = l == std::string::npos ? std::string() : name.substr(l, name.find_last_not_of(" \t\n\r") - l + 1);
        size_t chars = 0;
        for (unsigned char c : name) if ((c & 0xC0) != 0x80) ++chars;
        if (chars < 2 || chars > 30 || name.find('\n') != std::string::npos) { cb(error("Название — от 2 до 30 символов", k400BadRequest)); return; }
        const Json::Value& colors = in["colors"];
        if (!colors.isArray() || colors.size() < 2 || colors.size() > 3) { cb(error("Нужно 2–3 цвета", k400BadRequest)); return; }
        Json::Value clean(Json::arrayValue);
        for (const auto& c : colors) {
            if (!c.isString() || !isHexColor(c.asString())) { cb(error("Некорректный цвет", k400BadRequest)); return; }
            std::string s = c.asString();
            for (auto& ch : s) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
            clean.append(s);
        }
        const int angle = in["angle"].isIntegral() ? in["angle"].asInt() : 135;
        if (angle < 0 || angle > 360) { cb(error("Некорректный угол", k400BadRequest)); return; }
        const std::string base = in["base"].isString() ? in["base"].asString() : "dark";
        if (base != "dark" && base != "light") { cb(error("Некорректная основа", k400BadRequest)); return; }

        auto db = app().getDbClient();
        const int own = db->execSqlSync("SELECT COUNT(*) AS n FROM community_themes WHERE author_id = ?", userId)[0]["n"].as<int>();
        if (own >= kMaxOwn) { cb(error("Можно опубликовать не больше 5 своих тем — удалите одну из старых", k409Conflict)); return; }
        Json::StreamWriterBuilder w;
        w["indentation"] = "";
        db->execSqlSync("INSERT INTO community_themes(author_id, name, colors, angle, base) VALUES(?, ?, ?, ?, ?)",
                        userId, name, Json::writeString(w, clean), angle, base);
        const int64_t id = db->execSqlSync("SELECT last_insert_rowid() AS id")[0]["id"].as<int64_t>();
        auto rows = db->execSqlSync(std::string(kSelect) + "WHERE t.id = ?", userId, id);
        cb(HttpUtils::json(rowToJson(rows[0], userId)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/themes/community/{id}/like — поставить или снять сердечко → {likes, liked}
void ThemesController::like(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        auto db = app().getDbClient();
        if (db->execSqlSync("SELECT 1 FROM community_themes WHERE id = ?", id).empty()) { cb(error("Такой темы нет", k404NotFound)); return; }
        const bool liked = !db->execSqlSync("SELECT 1 FROM community_theme_likes WHERE theme_id = ? AND user_id = ?", id, userId).empty();
        if (liked) db->execSqlSync("DELETE FROM community_theme_likes WHERE theme_id = ? AND user_id = ?", id, userId);
        else       db->execSqlSync("INSERT INTO community_theme_likes(theme_id, user_id) VALUES(?, ?)", id, userId);
        Json::Value resp;
        resp["liked"] = !liked;
        resp["likes"] = db->execSqlSync("SELECT COUNT(*) AS n FROM community_theme_likes WHERE theme_id = ?", id)[0]["n"].as<int>();
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/themes/community/{id} — только автор (или разработчик)
void ThemesController::remove(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        auto db = app().getDbClient();
        auto rows = db->execSqlSync("SELECT author_id FROM community_themes WHERE id = ?", id);
        if (rows.empty()) { cb(error("Такой темы нет", k404NotFound)); return; }
        const auto me = UserModel::findById(userId);
        if (rows[0]["author_id"].as<int64_t>() != userId && !(me && me->developer)) { cb(error("Удалить можно только свою тему", k403Forbidden)); return; }
        db->execSqlSync("DELETE FROM community_theme_likes WHERE theme_id = ?", id);
        db->execSqlSync("DELETE FROM community_themes WHERE id = ?", id);
        Json::Value resp;
        resp["ok"] = true;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
