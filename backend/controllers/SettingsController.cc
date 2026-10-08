#include "SettingsController.h"
#include "../models/User.h"
#include "../utils/JsonUtils.h"
#include "../utils/Tiers.h"
#include <drogon/drogon.h>
#include <cctype>
#include <initializer_list>
#include <set>

using namespace drogon;

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto resp = HttpResponse::newHttpJsonResponse(std::move(body));
    resp->setStatusCode(code);
    return resp;
}

static HttpResponsePtr error(const std::string& msg, HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    return jsonResp(std::move(v), code);
}

// ── Настройки оформления ─────────────────────────────────────────────────────
// Хранятся одним JSON в user_settings.appearance. Сервер знает только допустимые значения;
// как выглядит тема, решает клиент (web/src/lib/themes.ts — те же id).

// Готовые цветовые темы (подписка Standard+)
static const std::set<std::string>& colorThemeIds() {
    static const std::set<std::string> ids = {
        "mint", "peach", "lavender", "lime", "rose", "cotton", "sky", "cream",
        "dusk", "aurora", "forest", "crimson", "midnight", "brick", "mist", "sage",
        "ocean", "lagoon", "berry", "sunset", "neon", "bronze", "indigo",
    };
    return ids;
}

static bool isHexColor(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
    return true;
}

// Значения по умолчанию — так выглядит новый аккаунт
static Json::Value defaults() {
    Json::Value v;
    v["follow_system"]     = false;
    v["base_theme"]        = "dark";
    v["color_theme"]       = Json::nullValue;
    v["custom_theme"]      = Json::nullValue;
    v["sync_devices"]      = true;
    v["apply_to_profiles"] = false;
    v["server_theme"]      = "mine";
    v["accent"]            = "";
    v["font_size"]         = "m";
    v["compact"]           = false;
    v["reduce_motion"]     = false;
    v["saturation"]        = 100;
    v["high_contrast"]     = false;
    return v;
}

static Json::Value load(int64_t userId) {
    Json::Value out = defaults();
    auto rows = app().getDbClient()->execSqlSync("SELECT appearance FROM user_settings WHERE user_id = ?", userId);
    if (rows.empty() || rows[0]["appearance"].isNull()) return out;
    Json::Value stored;
    if (!JsonUtils::parse(rows[0]["appearance"].as<std::string>(), stored) || !stored.isObject()) return out;
    for (const auto& key : out.getMemberNames())
        if (stored.isMember(key)) out[key] = stored[key];
    return out;
}

// Ответ: настройки + что из премиум-оформления доступно. Тема, на которую подписки больше нет
// (подписку сняли), отдаётся пустой — клиент не применяет то, что сохранить уже нельзя.
static Json::Value withAccess(Json::Value v, int tier) {
    if (!Tiers::colorThemes(tier)) v["color_theme"] = Json::nullValue;
    if (!Tiers::customTheme(tier)) v["custom_theme"] = Json::nullValue;
    Json::Value out;
    out["settings"] = v;
    out["access"]["color_themes"] = Tiers::colorThemes(tier);
    out["access"]["custom_theme"] = Tiers::customTheme(tier);
    out["access"]["tier"]         = Tiers::clamp(tier);
    return out;
}

// GET /api/v1/subscription → {tier, current, plans:[0..3]} — что даёт каждая подписка
void SettingsController::subscription(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    const auto me = UserModel::findById(userId);
    const int tier = Tiers::clamp(me ? me->subscriptionTier : 0);
    Json::Value resp;
    resp["tier"]    = tier;
    resp["current"] = Tiers::describe(tier);
    for (int t = 0; t <= 3; ++t) resp["plans"].append(Tiers::describe(t));
    cb(jsonResp(std::move(resp)));
}

// GET /api/v1/settings/appearance → {settings, access}
void SettingsController::getAppearance(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        const auto me = UserModel::findById(userId);
        cb(jsonResp(withAccess(load(userId), me ? me->subscriptionTier : 0)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// PATCH /api/v1/settings/appearance {любые поля settings} → {settings, access}
// Цветовая тема без Standard и своя тема без Ultra — 403 (проверка на сервере, подменой запроса не обойти).
void SettingsController::patchAppearance(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const Json::Value& in = *json;
    try {
        const auto me = UserModel::findById(userId);
        const int tier = me ? me->subscriptionTier : 0;
        Json::Value v = load(userId);

        auto bad = [&](const std::string& field) { cb(error("Некорректное значение: " + field, k400BadRequest)); };
        for (const char* key : {"follow_system", "sync_devices", "apply_to_profiles", "compact", "reduce_motion",
                                "high_contrast"}) {
            if (!in.isMember(key)) continue;
            if (!in[key].isBool()) { bad(key); return; }
            v[key] = in[key].asBool();
        }
        auto oneOf = [&](const char* key, std::initializer_list<const char*> allowed) {
            if (!in.isMember(key)) return true;
            if (!in[key].isString()) return false;
            for (const char* a : allowed)
                if (in[key].asString() == a) { v[key] = a; return true; }
            return false;
        };
        if (!oneOf("base_theme", {"light", "dark", "graphite", "black"})) { bad("base_theme"); return; }
        if (!oneOf("server_theme", {"mine", "default"}))                  { bad("server_theme"); return; }
        if (!oneOf("font_size", {"s", "m", "l"}))                          { bad("font_size"); return; }
        if (in.isMember("accent")) {
            if (!in["accent"].isString() || (!in["accent"].asString().empty() && !isHexColor(in["accent"].asString()))) {
                bad("accent"); return;
            }
            v["accent"] = in["accent"].asString();
        }
        if (in.isMember("saturation")) {
            if (!in["saturation"].isIntegral() || in["saturation"].asInt() < 0 || in["saturation"].asInt() > 100) {
                bad("saturation"); return;
            }
            v["saturation"] = in["saturation"].asInt();
        }

        if (in.isMember("color_theme")) {
            const Json::Value& ct = in["color_theme"];
            if (ct.isNull()) v["color_theme"] = Json::nullValue;
            else {
                if (!ct.isString() || !colorThemeIds().count(ct.asString())) { bad("color_theme"); return; }
                if (!Tiers::colorThemes(tier)) {
                    Json::Value e;
                    e["error"]         = "Цветовые темы — с подпиской Standard";
                    e["required_tier"] = 2;
                    cb(jsonResp(std::move(e), k403Forbidden));
                    return;
                }
                v["color_theme"]  = ct.asString();
                v["custom_theme"] = Json::nullValue;   // одна тема за раз
            }
        }
        if (in.isMember("custom_theme")) {
            const Json::Value& ct = in["custom_theme"];
            if (ct.isNull()) v["custom_theme"] = Json::nullValue;
            else {
                if (!ct.isObject()) { bad("custom_theme"); return; }
                const Json::Value& colors = ct["colors"];
                if (!colors.isArray() || colors.size() < 2 || colors.size() > 3) { bad("custom_theme"); return; }
                Json::Value clean;
                for (const auto& c : colors) {
                    if (!c.isString() || !isHexColor(c.asString())) { bad("custom_theme.colors"); return; }
                    clean["colors"].append(c.asString());
                }
                const int angle = ct["angle"].isIntegral() ? ct["angle"].asInt() : 135;
                if (angle < 0 || angle > 360) { bad("custom_theme.angle"); return; }
                clean["angle"] = angle;
                const std::string base = ct["base"].isString() ? ct["base"].asString() : "dark";
                if (base != "dark" && base != "light") { bad("custom_theme.base"); return; }
                clean["base"] = base;
                if (!Tiers::customTheme(tier)) {
                    Json::Value e;
                    e["error"]         = "Своя тема — с подпиской Ultra";
                    e["required_tier"] = 3;
                    cb(jsonResp(std::move(e), k403Forbidden));
                    return;
                }
                v["custom_theme"] = clean;
                v["color_theme"]  = Json::nullValue;
            }
        }

        Json::StreamWriterBuilder w;
        w["indentation"] = "";
        app().getDbClient()->execSqlSync(
            "INSERT INTO user_settings(user_id, appearance, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(user_id) DO UPDATE SET appearance = excluded.appearance, updated_at = CURRENT_TIMESTAMP",
            userId, Json::writeString(w, v));
        cb(jsonResp(withAccess(v, tier)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
