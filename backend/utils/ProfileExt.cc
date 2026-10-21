#include "ProfileExt.h"
#include "JsonUtils.h"
#include "TextUtils.h"
#include "Tiers.h"
#include <algorithm>
#include <cctype>
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
// Стиль ника (макет «4 · Стиль отображаемого имени»): шрифт, эффект, 1–2 цвета. Как выглядит — web/src/lib/nameStyle.ts
static const std::map<std::string, int>& nameFonts() {
    static const std::map<std::string, int> m = {
        {"onest", 1}, {"comfortaa", 1}, {"oswald", 1}, {"exo", 1},
        {"unbounded", 2}, {"russo", 2}, {"caveat", 2}, {"playfair", 2},
        {"pressstart", 3}, {"lobster", 3}, {"amatic", 3}, {"rubikmono", 3}};
    return m;
}
static const std::map<std::string, int>& nameEffects() {
    static const std::map<std::string, int> m = {
        {"minimal", 1}, {"gradient", 2}, {"outline", 2}, {"highlight", 2}, {"neon", 3}, {"jelly", 3}, {"prism", 3}};
    return m;
}
// Готовые цвета — с Basic; свой цвет — со Standard
static const std::set<std::string>& presetColors() {
    static const std::set<std::string> s = {"#2bc6a4", "#4c9bff", "#b78cf7", "#ff6b9a", "#ff8a3d", "#f2c14e", "#3dd68c", "#f0616d"};
    return s;
}

static bool isHex(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < 7; ++i)
        if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
    return true;
}

static std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

// Проверить стиль ника: {font, effect, colors[1..2]} → канонический объект; need — какая подписка нужна
static bool cleanNameStyle(const Json::Value& v, Json::Value& out, int& need) {
    need = 0;
    if (!v.isObject()) return false;
    const std::string font = v["font"].isString() ? v["font"].asString() : "";
    const std::string effect = v["effect"].isString() ? v["effect"].asString() : "";
    if (!nameFonts().count(font) || !nameEffects().count(effect)) return false;
    const Json::Value& colors = v["colors"];
    if (!colors.isArray() || colors.size() < 1 || colors.size() > 2) return false;
    out = Json::Value(Json::objectValue);
    out["font"]   = font;
    out["effect"] = effect;
    out["colors"] = Json::Value(Json::arrayValue);
    need = std::max(nameFonts().at(font), nameEffects().at(effect));
    for (const auto& c : colors) {
        if (!c.isString() || !isHex(c.asString())) return false;
        const std::string hex = lower(c.asString());
        if (!presetColors().count(hex)) need = std::max(need, 2);
        out["colors"].append(hex);
    }
    return true;
}

Json::Value nameStyleFromJson(const std::string& styleJson, int tier) {
    Json::Value v, out;
    int need = 0;
    if (styleJson.empty() || !JsonUtils::parse(styleJson, v) || !cleanNameStyle(v, out, need)) return Json::nullValue;
    return Tiers::clamp(tier) >= need ? out : Json::Value(Json::nullValue);
}
static const std::set<std::string>& connectionTypes() {
    static const std::set<std::string> s = {"steam", "spotify", "epic", "xbox", "playstation", "battlenet", "twitch",
                                            "youtube", "github", "telegram", "vk", "website"};
    return s;
}
// Значки профиля — набор клиента (web/src/lib/badges.ts); свои загружать нельзя
static const std::set<std::string>& badgePicks() {
    static const std::set<std::string> s = {"star", "flame", "heart", "gamepad", "code", "music",
                                            "camera", "palette", "rocket", "coffee", "moon", "leaf"};
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
// https-ссылка на один из хостов каталога (обложки — mzstatic.com, превью и страница — apple.com)
static bool catalogUrl(const Json::Value& v, std::string& out, bool required) {
    out.clear();
    if (!v.isString()) return !required;
    const std::string s = v.asString();
    if (s.empty()) return !required;
    if (s.size() > 500 || s.rfind("https://", 0) != 0 || s.find_first_of(" \"'<>") != std::string::npos) return false;
    const size_t hostEnd = s.find('/', 8);
    const std::string host = s.substr(8, hostEnd == std::string::npos ? std::string::npos : hostEnd - 8);
    auto ends = [&](const char* suf) { const std::string x(suf); return host.size() > x.size() && host.compare(host.size() - x.size(), x.size(), x) == 0; };
    if (!ends(".mzstatic.com") && !ends(".apple.com")) return false;
    out = s;
    return true;
}
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

    // Трек в профиле — из каталога через /music/search; только ссылки на хосты каталога
    out["music"] = Json::nullValue;
    if (in["music"].isObject()) {
        const Json::Value& m = in["music"];
        Json::Value t(Json::objectValue);
        std::string title, artist, album, artwork, preview, url;
        if (!cleanText(m["title"], 120, title) || title.empty() || !cleanText(m["artist"], 120, artist) || artist.empty()
            || !cleanText(m["album"], 120, album)) { error = "Некорректный трек"; return false; }
        if (!catalogUrl(m["artwork"], artwork, false) || !catalogUrl(m["preview"], preview, false) || !catalogUrl(m["url"], url, false)) {
            error = "Некорректные ссылки трека"; return false;
        }
        t["id"]      = m["id"].isIntegral() ? static_cast<Json::Int64>(m["id"].asInt64()) : 0;
        t["title"]   = title;
        t["artist"]  = artist;
        t["album"]   = album;
        t["artwork"] = artwork;
        t["preview"] = preview;
        t["url"]     = url;
        out["music"] = t;
    }

    // Значок из набора
    out["badge_pick"] = Json::nullValue;
    if (in["badge_pick"].isString() && !in["badge_pick"].asString().empty()) {
        if (!badgePicks().count(in["badge_pick"].asString())) { error = "Неизвестный значок"; return false; }
        out["badge_pick"] = in["badge_pick"].asString();
    }

    Json::Value c;
    if (!cleanCosmetic(in["frame"], frames(), tier, "Рамка аватара", c, error, code)) return false;
    out["frame"] = c;
    if (!cleanCosmetic(in["effect"], effects(), tier, "Эффект профиля", c, error, code)) return false;
    out["effect"] = c;
    // Стиль ника: null или {font, effect, colors}; старый формат (строка) — сбрасывается
    out["name_style"] = Json::nullValue;
    if (in["name_style"].isObject()) {
        Json::Value ns;
        int need = 0;
        if (!cleanNameStyle(in["name_style"], ns, need)) { error = "Некорректный стиль ника"; code = 400; return false; }
        if (Tiers::clamp(tier) < need) {
            error = std::string("Этот стиль ника — с подпиской ") + tierName(need);
            code  = 403;
            return false;
        }
        out["name_style"] = ns;
    }
    code = 400;

    // Тема профиля: два цвета карточки (верх и низ) — со Standard
    out["profile_theme"] = Json::nullValue;
    if (in["profile_theme"].isObject()) {
        const Json::Value& pt = in["profile_theme"];
        if (!pt["top"].isString() || !pt["bottom"].isString() || !isHex(pt["top"].asString()) || !isHex(pt["bottom"].asString())) {
            error = "Некорректная тема профиля"; code = 400; return false;
        }
        if (Tiers::clamp(tier) < 2) { error = "Тема профиля — с подпиской Standard"; code = 403; return false; }
        out["profile_theme"]["top"]    = lower(pt["top"].asString());
        out["profile_theme"]["bottom"] = lower(pt["bottom"].asString());
    }

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
    if (v.isMember("profile_theme") && Tiers::clamp(tier) < 2) v["profile_theme"] = Json::nullValue;
    // Стиль ника — только если подписка его ещё позволяет
    if (v.isMember("name_style")) {
        Json::StreamWriterBuilder w;
        w["indentation"] = "";
        v["name_style"] = v["name_style"].isObject() ? nameStyleFromJson(Json::writeString(w, v["name_style"]), tier)
                                                     : Json::Value(Json::nullValue);
    }
    return v;
}

} // namespace ProfileExt
