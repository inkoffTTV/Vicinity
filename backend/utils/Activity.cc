#include "Activity.h"
#include "Broadcast.h"
#include "JsonUtils.h"
#include <drogon/drogon.h>
#include <cmath>
#include <ctime>
#include <functional>
#include <optional>
#include <set>
#include <vector>

using namespace drogon;

namespace {

struct Stats {
    int64_t xp = 0, msgs = 0, callSec = 0, voiceSec = 0, games = 0, wins = 0, streak = 0, bestStreak = 0;
    std::string lastDay, title, emblem;
};

struct Award {
    const char* id;
    const char* kind;     // title | emblem
    const char* rarity;   // common | rare | epic | legendary
    const char* name;
    const char* desc;
    std::function<bool(const Stats&)> check;
};

// Каталог наград. Эмблемы — имена иконок lucide на клиенте.
const std::vector<Award>& awards() {
    static const std::vector<Award> list = {
        {"novice",     "title",  "common",    "Новичок",           "Первое сообщение",                 [](const Stats& s) { return s.msgs >= 1; }},
        {"talker",     "title",  "common",    "Болтун",            "100 сообщений",                    [](const Stats& s) { return s.msgs >= 100; }},
        {"orator",     "title",  "rare",      "Оратор",            "1 000 сообщений",                  [](const Stats& s) { return s.msgs >= 1000; }},
        {"chronicler", "title",  "epic",      "Летописец",         "10 000 сообщений",                 [](const Stats& s) { return s.msgs >= 10000; }},
        {"caller",     "title",  "common",    "На связи",          "Первый звонок дольше минуты",      [](const Stats& s) { return s.callSec >= 60; }},
        {"marathon",   "title",  "rare",      "Марафонец",         "10 часов в голосе и звонках",      [](const Stats& s) { return s.callSec + s.voiceSec >= 10 * 3600; }},
        {"veteran",    "title",  "epic",      "Ветеран эфира",     "100 часов в голосе и звонках",     [](const Stats& s) { return s.callSec + s.voiceSec >= 100 * 3600; }},
        {"week",       "title",  "rare",      "Неделя подряд",     "Серия из 7 дней",                  [](const Stats& s) { return s.bestStreak >= 7; }},
        {"month",      "title",  "epic",      "Месяц подряд",      "Серия из 30 дней",                 [](const Stats& s) { return s.bestStreak >= 30; }},
        {"hundred",    "title",  "legendary", "Сто дней",          "Серия из 100 дней",                [](const Stats& s) { return s.bestStreak >= 100; }},
        {"gamer",      "title",  "common",    "Игрок",             "Первая партия в Активностях",      [](const Stats& s) { return s.games >= 1; }},
        {"winner",     "title",  "rare",      "Победитель",        "10 побед",                         [](const Stats& s) { return s.wins >= 10; }},
        {"champion",   "title",  "epic",      "Чемпион",           "100 побед",                        [](const Stats& s) { return s.wins >= 100; }},
        {"legend",     "title",  "legendary", "Легенда",           "30-й уровень",                     [](const Stats& s) { return Activity::levelFor(s.xp) >= 30; }},
        {"sparkles",   "emblem", "common",    "Искра",             "5-й уровень",                      [](const Stats& s) { return Activity::levelFor(s.xp) >= 5; }},
        {"flame",      "emblem", "rare",      "Пламя",             "10-й уровень",                     [](const Stats& s) { return Activity::levelFor(s.xp) >= 10; }},
        {"crown",      "emblem", "epic",      "Корона",            "20-й уровень",                     [](const Stats& s) { return Activity::levelFor(s.xp) >= 20; }},
        {"gem",        "emblem", "legendary", "Самоцвет",          "30-й уровень",                     [](const Stats& s) { return Activity::levelFor(s.xp) >= 30; }},
        {"mic",        "emblem", "rare",      "Голос",             "50 часов в голосе",                [](const Stats& s) { return s.voiceSec >= 50 * 3600; }},
        {"swords",     "emblem", "rare",      "Клинки",            "50 побед",                         [](const Stats& s) { return s.wins >= 50; }},
        {"calendar",   "emblem", "epic",      "Постоянство",       "Серия из 60 дней",                 [](const Stats& s) { return s.bestStreak >= 60; }},
    };
    return list;
}

const Award* findAward(const std::string& id) {
    for (const auto& a : awards()) if (id == a.id) return &a;
    return nullptr;
}

Stats load(const orm::DbClientPtr& db, int64_t userId) {
    Stats s;
    auto r = db->execSqlSync(
        "SELECT xp, msgs, call_sec, voice_sec, games, wins, streak, best_streak, last_day, title, emblem FROM activity WHERE user_id = ?",
        userId);
    if (r.empty()) return s;
    const auto& row = r[0];
    auto num = [&](const char* c) { return row[c].isNull() ? 0 : row[c].as<int64_t>(); };
    auto str = [&](const char* c) { return row[c].isNull() ? std::string() : row[c].as<std::string>(); };
    s.xp = num("xp"); s.msgs = num("msgs"); s.callSec = num("call_sec"); s.voiceSec = num("voice_sec");
    s.games = num("games"); s.wins = num("wins"); s.streak = num("streak"); s.bestStreak = num("best_streak");
    s.lastDay = str("last_day"); s.title = str("title"); s.emblem = str("emblem");
    return s;
}

void save(const orm::DbClientPtr& db, int64_t userId, const Stats& s) {
    db->execSqlSync(
        "INSERT INTO activity(user_id, xp, msgs, call_sec, voice_sec, games, wins, streak, best_streak, last_day, title, emblem, updated_at) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, msgs = excluded.msgs, call_sec = excluded.call_sec, "
        "voice_sec = excluded.voice_sec, games = excluded.games, wins = excluded.wins, streak = excluded.streak, "
        "best_streak = excluded.best_streak, last_day = excluded.last_day, title = excluded.title, emblem = excluded.emblem, "
        "updated_at = CURRENT_TIMESTAMP",
        userId, s.xp, s.msgs, s.callSec, s.voiceSec, s.games, s.wins, s.streak, s.bestStreak,
        s.lastDay.empty() ? std::optional<std::string>() : std::optional<std::string>(s.lastDay),
        s.title.empty() ? std::optional<std::string>() : std::optional<std::string>(s.title),
        s.emblem.empty() ? std::optional<std::string>() : std::optional<std::string>(s.emblem));
}

std::string dayUtc(int64_t offsetDays = 0) {
    std::time_t t = std::time(nullptr) - offsetDays * 86400;
    char buf[16];
    std::strftime(buf, sizeof buf, "%Y-%m-%d", std::gmtime(&t));
    return buf;
}

// Серия: первое событие за день продлевает её, пропущенный день обнуляет
void touchStreak(Stats& s) {
    const std::string today = dayUtc();
    if (s.lastDay == today) return;
    s.streak = (s.lastDay == dayUtc(1)) ? s.streak + 1 : 1;
    s.bestStreak = std::max(s.bestStreak, s.streak);
    s.lastDay = today;
}

std::set<std::string> earned(const orm::DbClientPtr& db, int64_t userId) {
    std::set<std::string> out;
    for (const auto& r : db->execSqlSync("SELECT award_id FROM awards WHERE user_id = ?", userId))
        out.insert(r["award_id"].as<std::string>());
    return out;
}

Json::Value awardJson(const Award& a) {
    Json::Value v;
    v["id"] = a.id; v["kind"] = a.kind; v["rarity"] = a.rarity; v["name"] = a.name; v["desc"] = a.desc;
    return v;
}

Json::Value statsJson(const Stats& s) {
    const int level = Activity::levelFor(s.xp);
    Json::Value v;
    v["xp"]          = static_cast<Json::Int64>(s.xp);
    v["level"]       = level;
    v["level_xp"]    = static_cast<Json::Int64>(40LL * (level - 1) * (level - 1));
    v["next_xp"]     = static_cast<Json::Int64>(40LL * level * level);
    v["streak"]      = static_cast<Json::Int64>(s.lastDay == dayUtc() || s.lastDay == dayUtc(1) ? s.streak : 0);
    v["best_streak"] = static_cast<Json::Int64>(s.bestStreak);
    v["msgs"]        = static_cast<Json::Int64>(s.msgs);
    v["call_min"]    = static_cast<Json::Int64>(s.callSec / 60);
    v["voice_min"]   = static_cast<Json::Int64>(s.voiceSec / 60);
    v["games"]       = static_cast<Json::Int64>(s.games);
    v["wins"]        = static_cast<Json::Int64>(s.wins);
    v["title"]       = s.title;
    v["emblem"]      = s.emblem;
    return v;
}

} // namespace

namespace Activity {

int levelFor(int64_t xp) { return static_cast<int>(std::floor(std::sqrt(static_cast<double>(std::max<int64_t>(0, xp)) / 40.0))) + 1; }

void bump(int64_t userId, Kind kind, int64_t amount) {
    if (userId <= 0 || amount <= 0) return;
    try {
        auto db = app().getDbClient();
        Stats s = load(db, userId);
        const int before = levelFor(s.xp);
        switch (kind) {
            case Kind::Message:      s.msgs += 1;             s.xp += 2; break;
            case Kind::CallSeconds:  s.callSec += amount;     s.xp += std::min<int64_t>(amount / 60, 120); break;
            case Kind::VoiceSeconds: s.voiceSec += amount;    s.xp += std::min<int64_t>(amount / 60, 240); break;
            case Kind::GamePlayed:   s.games += 1;            s.xp += 10; break;
            case Kind::GameWon:      s.wins += 1;             s.xp += 15; break;
        }
        touchStreak(s);
        save(db, userId, s);

        Json::Value fresh(Json::arrayValue);
        auto have = earned(db, userId);
        for (const auto& a : awards()) {
            if (have.count(a.id) || !a.check(s)) continue;
            db->execSqlSync("INSERT OR IGNORE INTO awards(user_id, award_id) VALUES(?, ?)", userId, std::string(a.id));
            fresh.append(awardJson(a));
        }
        Json::Value ev;
        ev["type"]     = "activity";
        ev["activity"] = statsJson(s);
        ev["fresh"]    = fresh;
        ev["level_up"] = levelFor(s.xp) > before;
        if (fresh.size() || ev["level_up"].asBool() || kind != Kind::Message || s.msgs % 10 == 0) Broadcast::toUser(userId, ev);
        if (fresh.size()) Broadcast::userUpdated(userId);
    } catch (const std::exception& e) {
        LOG_WARN << "activity: " << e.what();
    }
}

Json::Value summary(int64_t userId) {
    Json::Value v;
    try {
        auto db = app().getDbClient();
        v = statsJson(load(db, userId));
        Json::Value list(Json::arrayValue);
        for (const auto& r : db->execSqlSync("SELECT award_id, earned_at FROM awards WHERE user_id = ? ORDER BY earned_at", userId)) {
            const Award* a = findAward(r["award_id"].as<std::string>());
            if (!a) continue;
            Json::Value j = awardJson(*a);
            j["earned_at"] = r["earned_at"].isNull() ? "" : r["earned_at"].as<std::string>();
            list.append(j);
        }
        v["awards"] = list;
    } catch (const std::exception& e) {
        LOG_WARN << "activity summary: " << e.what();
    }
    return v;
}

Json::Value brief(int64_t userId) {
    Json::Value v;
    try {
        Stats s = load(app().getDbClient(), userId);
        v["level"]  = levelFor(s.xp);
        v["streak"] = static_cast<Json::Int64>(s.lastDay == dayUtc() || s.lastDay == dayUtc(1) ? s.streak : 0);
        v["title"]  = s.title;
        v["emblem"] = s.emblem;
    } catch (...) {}
    return v;
}

bool equip(int64_t userId, const std::string& title, const std::string& emblem, std::string& error) {
    try {
        auto db = app().getDbClient();
        auto have = earned(db, userId);
        auto ok = [&](const std::string& id, const char* kind) {
            if (id.empty()) return true;
            const Award* a = findAward(id);
            return a && std::string(a->kind) == kind && have.count(id) > 0;
        };
        if (!ok(title, "title"))   { error = "Такой титул не заработан"; return false; }
        if (!ok(emblem, "emblem")) { error = "Такая эмблема не заработана"; return false; }
        Stats s = load(db, userId);
        s.title = title;
        s.emblem = emblem;
        save(db, userId, s);
        Broadcast::userUpdated(userId);
        return true;
    } catch (const std::exception& e) {
        error = e.what();
        return false;
    }
}

Json::Value catalog() {
    Json::Value list(Json::arrayValue);
    for (const auto& a : awards()) list.append(awardJson(a));
    return list;
}

Json::Value leaderboard(int64_t userId) {
    Json::Value list(Json::arrayValue);
    try {
        auto rows = app().getDbClient()->execSqlSync(
            "SELECT u.id, u.username, u.display_name, u.avatar_path, IFNULL(a.xp, 0) AS xp, IFNULL(a.streak, 0) AS streak, a.last_day, a.title, a.emblem "
            "FROM users u LEFT JOIN activity a ON a.user_id = u.id "
            "WHERE u.id = ? OR u.id IN ("
            "  SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships "
            "  WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted') "
            "ORDER BY xp DESC, u.display_name COLLATE NOCASE LIMIT 100",
            userId, userId, userId, userId);
        for (const auto& r : rows) {
            Json::Value u;
            const std::string last = r["last_day"].isNull() ? "" : r["last_day"].as<std::string>();
            u["id"]           = r["id"].as<int64_t>();
            u["username"]     = r["username"].as<std::string>();
            u["display_name"] = r["display_name"].as<std::string>();
            u["avatar_path"]  = r["avatar_path"].isNull() ? "" : r["avatar_path"].as<std::string>();
            u["xp"]           = r["xp"].as<int64_t>();
            u["level"]        = levelFor(r["xp"].as<int64_t>());
            u["streak"]       = static_cast<Json::Int64>(last == dayUtc() || last == dayUtc(1) ? r["streak"].as<int64_t>() : 0);
            u["title"]        = r["title"].isNull() ? "" : r["title"].as<std::string>();
            u["emblem"]       = r["emblem"].isNull() ? "" : r["emblem"].as<std::string>();
            list.append(u);
        }
    } catch (const std::exception& e) {
        LOG_WARN << "activity leaderboard: " << e.what();
    }
    return list;
}

} // namespace Activity
