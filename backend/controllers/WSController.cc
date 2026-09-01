#include "WSController.h"
#include "../managers/WSManager.h"
#include "../managers/VoiceManager.h"
#include "../utils/PresenceUtil.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <json/json.h>
#include <set>

using namespace drogon;

// Рассылает эффективное присутствие пользователя всем его друзьям (accepted).
static void broadcastPresence(int64_t uid) {
    std::string p = effectivePresence(uid);
    Json::Value ev;
    ev["type"]     = "presence";
    ev["user_id"]  = static_cast<Json::Int64>(uid);
    ev["presence"] = p;
    Json::FastWriter fw;
    std::string payload = fw.write(ev);
    try {
        auto db = drogon::app().getDbClient();
        std::set<int64_t> recipients;
        // Друзья
        auto fr = db->execSqlSync(
            "SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS fid "
            "FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'",
            uid, uid, uid);
        for (const auto& row : fr) recipients.insert(row["fid"].as<int64_t>());
        // Сослуживцы по серверам — чтобы presence обновлялся в панели участников
        auto co = db->execSqlSync(
            "SELECT DISTINCT sm2.user_id AS cid FROM server_members sm1 "
            "JOIN server_members sm2 ON sm1.server_id = sm2.server_id "
            "WHERE sm1.user_id = ? AND sm2.user_id != ?",
            uid, uid);
        for (const auto& row : co) recipients.insert(row["cid"].as<int64_t>());
        for (int64_t rid : recipients)
            WSManager::instance().sendToUser(rid, payload);
    } catch (...) {}
}

// Собирает JSON-состояние голосового канала: {type:voice_state, channel_id, users:[{user_id,name}]}
static std::string voiceStatePayload(int64_t channelId) {
    auto db = drogon::app().getDbClient();
    Json::Value arr(Json::arrayValue);
    for (int64_t uid : VoiceManager::instance().usersIn(channelId)) {
        std::string name;
        try {
            auto r = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", uid);
            if (!r.empty()) name = r[0]["display_name"].as<std::string>();
        } catch (...) {}
        Json::Value u;
        u["user_id"] = static_cast<Json::Int64>(uid);
        u["name"]    = name;
        arr.append(u);
    }
    Json::Value payload;
    payload["type"]       = "voice_state";
    payload["channel_id"] = static_cast<Json::Int64>(channelId);
    payload["users"]      = arr;
    Json::FastWriter fw;
    return fw.write(payload);
}

// Кому слать состояние канала: участникам сервера (если это серверный канал), иначе — тем, кто в канале
static std::vector<int64_t> recipientsFor(int64_t channelId) {
    auto db = drogon::app().getDbClient();
    std::vector<int64_t> out;
    try {
        auto ch = db->execSqlSync("SELECT server_id FROM channels WHERE id = ?", channelId);
        if (!ch.empty() && !ch[0]["server_id"].isNull()) {
            int64_t serverId = ch[0]["server_id"].as<int64_t>();
            auto m = db->execSqlSync("SELECT user_id FROM server_members WHERE server_id = ?", serverId);
            for (const auto& row : m) out.push_back(row["user_id"].as<int64_t>());
            return out;
        }
    } catch (...) {}
    // Личка/группа: слать всем участникам канала (чтобы собеседник узнал о входящем звонке)
    try {
        auto cm = db->execSqlSync("SELECT user_id FROM channel_members WHERE channel_id = ?", channelId);
        for (const auto& row : cm) out.push_back(row["user_id"].as<int64_t>());
        if (!out.empty()) return out;
    } catch (...) {}
    return VoiceManager::instance().usersIn(channelId);
}

static void broadcastVoiceState(int64_t channelId) {
    std::string payload = voiceStatePayload(channelId);
    for (int64_t uid : recipientsFor(channelId))
        WSManager::instance().sendToUser(uid, payload);
}

void WSController::handleNewConnection(const drogon::HttpRequestPtr& req,
                                       const drogon::WebSocketConnectionPtr& conn) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    conn->setContext(std::make_shared<int64_t>(userId));
    WSManager::instance().addConnection(userId, conn);
    broadcastPresence(userId);   // друзья увидят, что я в сети
    LOG_INFO << "WS connected: user " << userId;
}

void WSController::handleNewMessage(const drogon::WebSocketConnectionPtr& conn,
                                    std::string&& msg,
                                    const drogon::WebSocketMessageType& type) {
    auto ctxBin = conn->getContext<int64_t>();
    int64_t selfId = ctxBin ? *ctxBin : 0;

    // Бинарные сообщения = аудио голоса → ретранслируем остальным в том же голосовом канале
    if (type == drogon::WebSocketMessageType::Binary) {
        if (selfId == 0) return;
        int64_t ch = VoiceManager::instance().channelOf(selfId);
        if (ch == 0) return;
        for (int64_t uid : VoiceManager::instance().usersIn(ch))
            if (uid != selfId)
                WSManager::instance().sendBinaryToUser(uid, msg.data(), msg.size());
        return;
    }

    if (type != drogon::WebSocketMessageType::Text) return;

    Json::Value root;
    Json::Reader reader;
    if (!reader.parse(msg, root)) return;

    auto ctx = conn->getContext<int64_t>();
    int64_t userId = ctx ? *ctx : 0;
    std::string t = root["type"].asString();

    if (t == "ping") {
        conn->send(R"({"type":"pong"})");
    }
    else if (t == "voice_join") {
        int64_t channelId = root["channel_id"].asInt64();
        if (userId == 0 || channelId == 0) return;
        int64_t prev = VoiceManager::instance().join(userId, channelId);
        broadcastVoiceState(channelId);
        if (prev != 0 && prev != channelId) broadcastVoiceState(prev);
        LOG_INFO << "voice_join: user " << userId << " -> channel " << channelId;
    }
    else if (t == "voice_leave") {
        if (userId == 0) return;
        int64_t ch = VoiceManager::instance().leave(userId);
        if (ch != 0) broadcastVoiceState(ch);
    }
    else if (t == "voice_speaking") {
        if (userId == 0) return;
        int64_t ch = VoiceManager::instance().channelOf(userId);
        if (ch == 0) return;
        bool speaking = root["speaking"].asBool();
        Json::Value p;
        p["type"]     = "voice_speaking";
        p["user_id"]  = static_cast<Json::Int64>(userId);
        p["speaking"] = speaking;
        Json::FastWriter fw;
        std::string payload = fw.write(p);
        for (int64_t uid : VoiceManager::instance().usersIn(ch))
            if (uid != userId) WSManager::instance().sendToUser(uid, payload);
    }
    else if (t == "voice_query") {
        // Текущее состояние всех голосовых каналов сервера — только запросившему
        int64_t serverId = root["server_id"].asInt64();
        if (serverId == 0) return;
        auto db = drogon::app().getDbClient();
        try {
            auto chans = db->execSqlSync(
                "SELECT id FROM channels WHERE server_id = ? AND is_voice = 1", serverId);
            for (const auto& row : chans) {
                int64_t cid = row["id"].as<int64_t>();
                conn->send(voiceStatePayload(cid));
            }
        } catch (...) {}
    }
    else if (t == "set_presence") {
        if (userId == 0) return;
        std::string p = root["presence"].asString();
        if (p != "online" && p != "idle" && p != "dnd" && p != "invisible") return;
        try {
            drogon::app().getDbClient()->execSqlSync(
                "UPDATE users SET presence=? WHERE id=?", p, userId);
        } catch (...) {}
        broadcastPresence(userId);
    }
    // ── Сигналинг звонков (WebRTC): чистый релей адресату {to}, штампуем {from} ──
    else if (t == "call_invite" || t == "call_accept" || t == "call_reject" ||
             t == "call_end"    || t == "call_busy"   ||
             t == "rtc_offer"   || t == "rtc_answer"  || t == "rtc_ice") {
        if (userId == 0) return;
        int64_t to = root["to"].asInt64();
        if (to == 0) return;
        root["from"] = static_cast<Json::Int64>(userId);
        Json::FastWriter fw;
        WSManager::instance().sendToUser(to, fw.write(root));
    }
}

void WSController::handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn) {
    auto ctx = conn->getContext<int64_t>();
    if (ctx) {
        int64_t ch = VoiceManager::instance().leave(*ctx);
        if (ch != 0) broadcastVoiceState(ch);
        WSManager::instance().removeConnection(*ctx);
        broadcastPresence(*ctx);   // друзья увидят, что я офлайн
        LOG_INFO << "WS closed: user " << *ctx;
    }
}
