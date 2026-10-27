#include "HomeController.h"
#include "../managers/VoiceManager.h"
#include "../managers/WSManager.h"
#include "../utils/Access.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include <drogon/HttpClient.h>
#include <drogon/drogon.h>
#include <chrono>
#include <functional>
#include <mutex>
#include <unordered_map>

using HttpUtils::error;
using HttpUtils::json;

namespace {

// Сводка от Claude: кэш по пользователю, чтобы не платить за каждый заход на главную.
// Текст живёт 10 минут; при тех же фактах — час.
struct CachedDigest {
    std::size_t factsHash = 0;
    std::string text;
    std::chrono::steady_clock::time_point at;
};
std::mutex digestMutex;
std::unordered_map<int64_t, CachedDigest> digestCache;

std::string plural(int64_t n, const char* one, const char* few, const char* many) {
    const int64_t a = n % 100, b = n % 10;
    const char* w = (a >= 11 && a <= 14) ? many : b == 1 ? one : (b >= 2 && b <= 4) ? few : many;
    return std::to_string(n) + " " + w;
}

std::string quoted(const std::string& s) { return "«" + s + "»"; }

// Шаблонная сводка из тех же фактов, что уходят в Claude: работает без ключа и при сбое API
std::string rulesDigest(const Json::Value& f) {
    std::vector<std::string> parts;
    const auto& chans = f["channels"];
    if (chans.size() > 0) {
        std::string s;
        for (Json::ArrayIndex i = 0; i < chans.size() && i < 3; ++i) {
            const auto& c = chans[i];
            const std::string kind = c["kind"].asString();
            std::string where = kind == "dm" ? "в личке с " + c["name"].asString()
                              : kind == "group" ? "в беседе " + quoted(c["name"].asString())
                              : "в #" + c["name"].asString() + " на " + quoted(c["server_name"].asString());
            s += (i == 0 ? "" : i + 1 == std::min<Json::ArrayIndex>(chans.size(), 3) ? " и " : ", ");
            s += where + " " + plural(c["messages"].asInt64(), "новое сообщение", "новых сообщения", "новых сообщений");
            if (kind != "dm" && c["top_author"].isString() && !c["top_author"].asString().empty())
                s += " (больше всех писал(а) " + c["top_author"].asString() + ")";
        }
        parts.push_back("За сутки " + s + ".");
    }
    const auto& voice = f["voice"];
    if (voice.size() > 0) {
        const auto& v = voice[0];
        std::string names;
        for (Json::ArrayIndex i = 0; i < v["users"].size(); ++i) names += (i ? ", " : "") + v["users"][i]["name"].asString();
        parts.push_back("Сейчас в голосе " + quoted(v["name"].asString()) +
                        (v["server_name"].isString() && !v["server_name"].asString().empty() ? " на " + quoted(v["server_name"].asString()) : "") +
                        ": " + names + (voice.size() > 1 ? " — и ещё " + plural(voice.size() - 1, "канал", "канала", "каналов") + " с людьми" : "") + ".");
    }
    if (f["friend_requests"].asInt64() > 0)
        parts.push_back(plural(f["friend_requests"].asInt64(), "заявка в друзья ждёт", "заявки в друзья ждут", "заявок в друзья ждут") + " ответа.");
    if (f["streak"].asInt64() > 0 && !f["today_counted"].asBool())
        parts.push_back("Серия " + plural(f["streak"].asInt64(), "день", "дня", "дней") + " — загляните в чат или голос, чтобы её не прервать.");
    if (parts.empty()) return "Тихо: за сутки новых сообщений не было, в голосе никого. Самое время позвать друзей.";
    std::string out;
    for (const auto& p : parts) out += (out.empty() ? "" : " ") + p;
    return out;
}

// Факты для сводки и экрана: каналы с новыми сообщениями, голос, заявки, серия
Json::Value collectFacts(int64_t userId) {
    auto db = app().getDbClient();
    Json::Value f;
    const std::string access = std::string("(") + Access::kAccessibleChannels + ")";

    // Каналы по числу чужих сообщений за сутки
    auto chans = db->execSqlSync(
        "SELECT m.channel_id, c.type, c.name, c.server_id, s.name AS server_name, COUNT(*) AS n "
        "FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN servers s ON s.id = c.server_id "
        "WHERE m.channel_id IN " + access + " AND m.created_at >= datetime('now', '-1 day') AND m.author_id != ? "
        "GROUP BY m.channel_id ORDER BY n DESC LIMIT 6",
        userId, userId, userId);
    Json::Value channels(Json::arrayValue);
    int64_t total = 0;
    for (const auto& r : chans) {
        const int64_t id = r["channel_id"].as<int64_t>();
        Json::Value c;
        c["channel_id"] = static_cast<Json::Int64>(id);
        const std::string type = r["type"].as<std::string>();
        c["kind"] = type == "channel" ? "channel" : type;
        c["messages"] = static_cast<Json::Int64>(r["n"].as<int64_t>());
        total += r["n"].as<int64_t>();
        if (!r["server_id"].isNull()) {
            c["server_id"] = static_cast<Json::Int64>(r["server_id"].as<int64_t>());
            c["server_name"] = r["server_name"].isNull() ? "" : r["server_name"].as<std::string>();
        }
        if (type == "dm") {
            auto other = db->execSqlSync(
                "SELECT u.display_name FROM channel_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? AND cm.user_id != ? LIMIT 1",
                id, userId);
            c["name"] = other.empty() ? "собеседник" : other[0]["display_name"].as<std::string>();
        } else {
            c["name"] = r["name"].isNull() ? "" : r["name"].as<std::string>();
            auto top = db->execSqlSync(
                "SELECT u.display_name, COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.author_id "
                "WHERE m.channel_id = ? AND m.created_at >= datetime('now', '-1 day') AND m.author_id != ? "
                "GROUP BY m.author_id ORDER BY n DESC LIMIT 1",
                id, userId);
            if (!top.empty()) c["top_author"] = top[0]["display_name"].as<std::string>();
        }
        channels.append(c);
    }
    f["channels"] = channels;
    f["messages"] = static_cast<Json::Int64>(total);
    auto people = db->execSqlSync(
        "SELECT COUNT(DISTINCT author_id) AS n FROM messages WHERE channel_id IN " + access +
        " AND created_at >= datetime('now', '-1 day') AND author_id != ?",
        userId, userId, userId);
    f["people"] = static_cast<Json::Int64>(people.empty() ? 0 : people[0]["n"].as<int64_t>());

    // Кто сейчас в голосе — по доступным голосовым каналам
    auto vch = db->execSqlSync(
        "SELECT c.id, c.name, c.type, c.server_id, s.name AS server_name FROM channels c LEFT JOIN servers s ON s.id = c.server_id "
        "WHERE c.id IN " + access + " AND (c.is_voice = 1 OR c.type != 'channel')",
        userId, userId);
    Json::Value voice(Json::arrayValue);
    int64_t inVoice = 0;
    for (const auto& r : vch) {
        const int64_t id = r["id"].as<int64_t>();
        auto ids = VoiceManager::instance().usersIn(id);
        if (ids.empty()) continue;
        Json::Value v;
        v["channel_id"] = static_cast<Json::Int64>(id);
        v["kind"] = r["type"].as<std::string>() == "channel" ? "channel" : r["type"].as<std::string>();
        if (!r["server_id"].isNull()) {
            v["server_id"] = static_cast<Json::Int64>(r["server_id"].as<int64_t>());
            v["server_name"] = r["server_name"].isNull() ? "" : r["server_name"].as<std::string>();
        }
        Json::Value users(Json::arrayValue);
        for (int64_t uid : ids) {
            auto u = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", uid);
            if (u.empty()) continue;
            Json::Value x;
            x["id"] = static_cast<Json::Int64>(uid);
            x["name"] = u[0]["display_name"].as<std::string>();
            users.append(x);
        }
        inVoice += users.size();
        std::string name = r["name"].isNull() ? "" : r["name"].as<std::string>();
        if (r["type"].as<std::string>() == "dm" && users.size() > 0) name = "звонок с " + users[0]["name"].asString();
        v["name"] = name;
        v["users"] = users;
        voice.append(v);
        if (voice.size() >= 6) break;
    }
    f["voice"] = voice;
    f["voice_now"] = static_cast<Json::Int64>(inVoice);

    auto fr = db->execSqlSync("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'", userId);
    f["friend_requests"] = static_cast<Json::Int64>(fr.empty() ? 0 : fr[0]["n"].as<int64_t>());

    // Друзья в сети
    auto friends = db->execSqlSync(
        "SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id FROM friendships "
        "WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'",
        userId, userId, userId);
    int64_t online = 0;
    for (const auto& r : friends)
        if (WSManager::instance().isOnline(r["id"].as<int64_t>())) ++online;
    f["friends_online"] = static_cast<Json::Int64>(online);
    f["friends"] = static_cast<Json::Int64>(friends.size());

    auto act = db->execSqlSync("SELECT streak, last_day, voice_sec, msgs FROM activity WHERE user_id = ?", userId);
    auto today = db->execSqlSync("SELECT date('now') AS d");
    f["streak"] = static_cast<Json::Int64>(act.empty() ? 0 : act[0]["streak"].as<int64_t>());
    f["today_counted"] = !act.empty() && !act[0]["last_day"].isNull() && !today.empty() && act[0]["last_day"].as<std::string>() == today[0]["d"].as<std::string>();
    f["voice_hours_total"] = act.empty() ? 0 : static_cast<int>(act[0]["voice_sec"].as<int64_t>() / 3600);
    f["msgs_total"] = static_cast<Json::Int64>(act.empty() ? 0 : act[0]["msgs"].as<int64_t>());

    // Кого добавить: люди с общих серверов, ещё не друзья, без блокировок
    auto sug = db->execSqlSync(
        "SELECT u.id, u.display_name, u.avatar_path, COUNT(DISTINCT sm.server_id) AS shared "
        "FROM server_members sm JOIN server_members mine ON mine.server_id = sm.server_id AND mine.user_id = ? "
        "JOIN users u ON u.id = sm.user_id "
        "WHERE sm.user_id != ? "
        "  AND sm.user_id NOT IN (SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships WHERE requester_id = ? OR addressee_id = ?) "
        "  AND sm.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?) "
        "  AND sm.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?) "
        "GROUP BY u.id ORDER BY shared DESC, u.display_name LIMIT 4",
        userId, userId, userId, userId, userId, userId, userId);
    Json::Value suggestions(Json::arrayValue);
    for (const auto& r : sug) {
        Json::Value s;
        s["id"] = static_cast<Json::Int64>(r["id"].as<int64_t>());
        s["display_name"] = r["display_name"].as<std::string>();
        s["avatar_path"] = r["avatar_path"].isNull() ? "" : r["avatar_path"].as<std::string>();
        s["shared_servers"] = static_cast<Json::Int64>(r["shared"].as<int64_t>());
        suggestions.append(s);
    }
    f["suggestions"] = suggestions;
    return f;
}

// Что из фактов уходит в Claude (без аватаров и id)
Json::Value factsForAi(const Json::Value& f) {
    Json::Value out;
    for (const char* k : {"channels", "voice", "friend_requests", "friends_online", "streak", "today_counted", "messages", "people"}) out[k] = f[k];
    for (auto& c : out["channels"]) { c.removeMember("channel_id"); c.removeMember("server_id"); }
    for (auto& v : out["voice"]) { v.removeMember("channel_id"); v.removeMember("server_id"); for (auto& u : v["users"]) u.removeMember("id"); }
    return out;
}

Json::Value response(const Json::Value& f, const std::string& text, const char* source) {
    Json::Value r;
    r["window_hours"] = 24;
    r["digest"]["text"] = text;
    r["digest"]["source"] = source;
    for (const char* k : {"messages", "people", "voice_now", "friends_online", "friends", "friend_requests", "streak", "voice_hours_total", "msgs_total"})
        r["stats"][k] = f[k];
    r["channels"] = f["channels"];
    r["voice"] = f["voice"];
    r["suggestions"] = f["suggestions"];
    return r;
}

} // namespace

void HomeController::home(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    Json::Value facts;
    try {
        facts = collectFacts(userId);
    } catch (const std::exception& e) {
        cb(error(HttpUtils::internal(e), k500InternalServerError));
        return;
    }
    const Json::Value& ai = app().getCustomConfig()["ai"];
    const std::string key = ai["key"].isString() ? ai["key"].asString() : std::string();
    if (key.empty()) { cb(json(response(facts, rulesDigest(facts), "rules"))); return; }

    const Json::Value aiFacts = factsForAi(facts);
    const std::string factsJson = Json::FastWriter().write(aiFacts);
    const std::size_t hash = std::hash<std::string>{}(factsJson);
    {
        std::lock_guard<std::mutex> lock(digestMutex);
        auto it = digestCache.find(userId);
        if (it != digestCache.end()) {
            const auto age = std::chrono::steady_clock::now() - it->second.at;
            const bool fresh = age < std::chrono::minutes(10) || (it->second.factsHash == hash && age < std::chrono::hours(1));
            if (fresh) { cb(json(response(facts, it->second.text, "ai"))); return; }
        }
    }

    const std::string model = ai["model"].isString() && !ai["model"].asString().empty() ? ai["model"].asString() : "claude-opus-5-5";
    Json::Value body;
    body["model"] = model;
    body["max_tokens"] = 400;
    body["output_config"]["effort"] = "low";
    body["system"] =
        "Ты пишешь короткую сводку для главного экрана мессенджера Vicinity. По фактам в JSON напиши 2–3 предложения "
        "по-русски, обращаясь на «вы», тепло и по делу: что случилось в чатах за сутки, кто сейчас в голосе, что ждёт ответа. "
        "Без эмодзи, списков, заголовков и приветствий. Упоминай только то, что есть в фактах, ничего не придумывай; имена людей, "
        "каналов и серверов — как в фактах. Если фактов нет — одно спокойное предложение, что было тихо, и совет позвать друзей.";
    Json::Value msg;
    msg["role"] = "user";
    msg["content"] = factsJson;
    body["messages"].append(msg);

    auto client = HttpClient::newHttpClient("https://api.anthropic.com");
    auto aiReq = HttpRequest::newHttpJsonRequest(body);
    aiReq->setMethod(Post);
    aiReq->setPath("/v1/messages");
    aiReq->addHeader("x-api-key", key);
    aiReq->addHeader("anthropic-version", "2026-10-21");
    client->sendRequest(
        aiReq,
        [cb = std::move(cb), client, facts, userId, hash](ReqResult result, const HttpResponsePtr& resp) {
            std::string text;
            Json::Value out;
            if (result == ReqResult::Ok && resp && resp->statusCode() == k200OK && JsonUtils::parse(std::string(resp->body()), out) &&
                out["stop_reason"].asString() != "refusal") {
                for (const auto& block : out["content"])
                    if (block["type"].asString() == "text") text += block["text"].asString();
            } else {
                LOG_WARN << "home digest: Claude API " << (resp ? std::to_string(resp->statusCode()) : "no response")
                         << (resp ? " " + std::string(resp->body()).substr(0, 200) : "");
            }
            if (text.empty()) { cb(json(response(facts, rulesDigest(facts), "rules"))); return; }
            {
                std::lock_guard<std::mutex> lock(digestMutex);
                if (digestCache.size() > 5000) digestCache.clear();
                digestCache[userId] = CachedDigest{hash, text, std::chrono::steady_clock::now()};
            }
            cb(json(response(facts, text, "ai")));
        },
        20.0);
}
