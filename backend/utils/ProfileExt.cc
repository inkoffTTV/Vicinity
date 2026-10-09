#include "ProfileExt.h"
#include "JsonUtils.h"
#include "TextUtils.h"
#include "Tiers.h"
#include <map>
#include <set>

namespace ProfileExt {

// Украшения и минимальная подписка (1 — Basic, 2 — Standard, 3 — Ultra). Как они выглядят — web/src/lib/cosmetics.ts.
static const std::map<std::string, int>& frames() {
    static const std::map<std::string, int> m = {{"neon", 1}, {"gold", 1}, {"ice", 1}, {"fire", 2}, {"rainbow", 3}};
    return m;
}
static const std::map<std::string, int>& effects() {
    static const std::map<std::string, int> m = {{"stars", 3}, {"aurora", 3}, {"snow", 3}, {"glint", 3}};
    return m;
}
static const std::map<std::string, int>& nameStyles() {
    static const std::map<std::string, int> m = {{"gradient", 2}, {"neon", 2}, {"metal", 2}, {"flame", 2}, {"aurora", 3}};
    return m;
}
static const std::set<std::string>& connectionTypes() {
    static const std::set<std::string> s = {"steam", "spotify", "epic", "xbox", "playstation", "battlenet", "twitch",
                                            "youtube", "github", "telegram", "vk", "website"};
    return s;
}
static const std::set<std::string>& gameTags() {
    static const std::set<std::string> s = {"Опытный", "Новичок", "Не оторваться", "Рейджквит", "Люблю", "Ностальгия",
                                            "С друзьями", "Соревновательно", "Расслабляет", "Хардкор", "Сюжет",
                                            "Красиво"};
    return s;
}

static const char* tierName(int t) { return t >= 3 ? "Ultra" : t == 2 ? "Standard" : "Basic"; }

// Короткая строка без управляющих символов; пустая — допустима
static bool cleanText(const Json::Value& v, size_t maxChars, std::string& out) {
    if (v.isNull()) { out.clear(); return true; }
    if (!v.isString()) return false;
    std::string s = v.asString();
    if (!TextUtils::isValidUtf8(s) || TextUtils::hasControlChars(s)) return false;
    out = TextUtils::trim(TextUtils::utf8Truncate(s, maxChars));
    return true;
}

// Игра из каталога Steam: {appid, name}; обложку сервер отдаёт сам по appid
static bool cleanGame(const Json::Value& g, Json::Value& out) {
    if (!g.isObject()) return false;
    const Json::Value& id = g["appid"];
    int64_t appid = id.isIntegral() ? id.asInt64() : 0;
    if (appid <= 0 || appid > 99999999) return false;
    std::string name;
    if (!cleanText(g["name"], 100, name) || name.empty()) return false;
    out = Json::Value(Json::objectValue);
    out["appid"] = static_cast<Json::Int64>(appid);
    out["name"]  = name;
    out["cover"] = "/api/v1/games/" + std::to_string(appid) + "/cover";
    return true;
}

static bool cleanGameList(const Json::Value& v, Json::Value& out) {
    out = Json::Value(Json::arrayValue);
    if (v.isNull()) return true;
    if (!v.isArray() || v.size() > 20) return false;
    std::set<int64_t> seen;
    for (const auto& g : v) {
        Json::Value c;
        if (!cleanGame(g, c)) return false;
        if (seen.insert(c["appid"].asInt64()).second) out.append(c);
    }
    return true;
}

// Украшение: null/"" или id из каталога; без нужной подписки — 403
static bool cleanCosmetic(const Json::Value& v, const std::map<std::string, int>& catalog, int tier,
                          const char* what, Json::Value& out, std::string& error, int& code) {
    if (v.isNull() || (v.isString() && v.asString().empty())) { out = Json::nullValue; return true; }
    if (!v.isString() || !catalog.count(v.asString())) { error = std::string("Неизвестное значение: ") + what; code = 400; return false; }
    const int need = catalog.at(v.asString());
    if (Tiers::clamp(tier) < need) {
        error = std::string(what) + " — с подпиской " + tierName(need);
        code  = 403;
        return false;
    }
    out = v.asString();
    return true;
}

bool sanitize(const Json::Value& in, int tier, const Json::Value& memberServerIds,
              Json::Value& out, std::string& error, int& code) {
    code = 400;
    if (!in.isObject()) { error = "Invalid JSON"; return false; }
    out = Json::Value(Json::objectValue);

    // Бейджик: тег одного из своих серверов
    const Json::Value& badge = in["badge_server"];
    if (badge.isNull()) out["badge_server"] = Json::nullValue;
    else {
        if (!badge.isIntegral()) { error = "Некорректный бейджик"; return false; }
        bool member = false;
        for (const auto& id : memberServerIds) member = member || id.asInt64() == badge.asInt64();
        if (!member) { error = "Бейджиком можно поставить только сервер, в котором вы состоите"; return false; }
        out["badge_server"] = static_cast<Json::Int64>(badge.asInt64());
    }

    Json::Value c;
    if (!cleanCosmetic(in["frame"], frames(), tier, "Рамка аватара", c, error, code)) return false;
    out["frame"] = c;
    if (!cleanCosmetic(in["effect"], effects(), tier, "Эффект профиля", c, error, code)) return false;
    out["effect"] = c;
    if (!cleanCosmetic(in["name_style"], nameStyles(), tier, "Стиль ника", c, error, code)) return false;
    out["name_style"] = c;
    code = 400;

    // Подключённые аккаунты: до 10, имя до 40 символов, ссылка — только https://
    out["connections"] = Json::Value(Json::arrayValue);
    const Json::Value& conns = in["connections"];
    if (!conns.isNull()) {
        if (!conns.isArray() || conns.size() > 10) { error = "Подключений — не больше 10"; return false; }
        for (const auto& cn : conns) {
            if (!cn.isObject() || !cn["type"].isString() || !connectionTypes().count(cn["type"].asString())) {
                error = "Неизвестный тип подключения"; return false;
            }
            std::string name, url;
            if (!cleanText(cn["name"], 40, name) || name.empty()) { error = "Укажите имя аккаунта"; return false; }
            if (!cleanText(cn["url"], 200, url)) { error = "Некорректная ссылка"; return false; }
            if (!url.empty() && (url.rfind("https://", 0) != 0 || url.find_first_of(" \"'<>") != std::string::npos)) {
                error = "Ссылка должна начинаться с https://"; return false;
            }
            Json::Value o;
            o["type"] = cn["type"].asString();
            o["name"] = name;
            o["url"]  = url;
            out["connections"].append(o);
        }
    }

    // Виджеты
    const Json::Value& w = in["widgets"];
    Json::Value widgets(Json::objectValue);
    widgets["favorite_game"] = Json::nullValue;
    widgets["games"]         = Json::Value(Json::arrayValue);
    widgets["wishlist"]      = Json::Value(Json::arrayValue);
    if (!w.isNull()) {
        if (!w.isObject()) { error = "Некорректные виджеты"; return false; }
        const Json::Value& fav = w["favorite_game"];
        if (!fav.isNull()) {
            Json::Value g;
            if (!cleanGame(fav, g)) { error = "Некорректная любимая игра"; return false; }
            std::string note;
            if (!cleanText(fav["note"], 120, note)) { error = "Некорректный текст"; return false; }
            g["note"] = note;
            g["tags"] = Json::Value(Json::arrayValue);
            const Json::Value& tags = fav["tags"];
            if (!tags.isNull()) {
                if (!tags.isArray() || tags.size() > 6) { error = "Тегов — не больше 6"; return false; }
                for (const auto& t : tags)
                    if (t.isString() && gameTags().count(t.asString())) g["tags"].append(t.asString());
            }
            widgets["favorite_game"] = g;
        }
        if (!cleanGameList(w["games"], widgets["games"]))       { error = "Любимых игр — не больше 20"; return false; }
        if (!cleanGameList(w["wishlist"], widgets["wishlist"])) { error = "Игр в вишлисте — не больше 20"; return false; }
        // Порядок виджетов на доске
        widgets["order"] = Json::Value(Json::arrayValue);
        const Json::Value& order = w["order"];
        if (order.isArray())
            for (const auto& o : order)
                if (o.isString() && (o.asString() == "favorite_game" || o.asString() == "games"))
                    widgets["order"].append(o.asString());
    }
    out["widgets"] = widgets;
    return true;
}

Json::Value forDisplay(const std::string& stored, int tier) {
    Json::Value v;
    if (stored.empty() || !JsonUtils::parse(stored, v) || !v.isObject()) return Json::Value(Json::objectValue);
    auto drop = [&](const char* key, const std::map<std::string, int>& catalog) {
        if (v[key].isString() && (!catalog.count(v[key].asString()) || Tiers::clamp(tier) < catalog.at(v[key].asString())))
            v[key] = Json::nullValue;
    };
    drop("frame", frames());
    drop("effect", effects());
    drop("name_style", nameStyles());
    return v;
}

} // namespace ProfileExt
