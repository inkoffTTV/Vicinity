#include "WSController.h"
#include "../managers/WSManager.h"
#include "../managers/VoiceManager.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/JsonUtils.h"
#include <drogon/drogon.h>
#include <trantor/net/TcpConnection.h>
#include <trantor/utils/Logger.h>
#include <chrono>
#include <cstring>
#include <map>
#include <set>

using namespace drogon;

// Кадр голоса — PCM s16le, 320 сэмплов = 640 байт (20 мс); десктоп на Linux может прислать
// кадр короче, но всегда чётной длины. Остальное — не голос: не ретранслируем.
static constexpr size_t kMaxVoiceFrame = 640;
// Короткие кадры учитываем в лимите как кадры этого размера — поток мелких кадров не обойдёт лимит
static constexpr size_t kMinVoiceFrameCost = 160;

// Исходящая очередь подключения (байты, которые клиент ещё не забрал из сокета):
// больше kCongestedBytes — голос ему не шлём, больше kMaxPendingBytes — закрываем подключение.
static constexpr size_t kCongestedBytes  = 256 * 1024;
static constexpr size_t kMaxPendingBytes = 4 * 1024 * 1024;
static constexpr int64_t kCongestedHoldMs = 500;

// Пересылаемые поля сигналинга звонка (docs/CALLS.md §3.2) и их максимальная длина.
// Всё остальное от клиента отбрасывается: адресату не уходит чужой мусор на сотню килобайт.
static const std::map<std::string, size_t> kCallFields = {
    {"sdp", 32 * 1024}, {"sdpType", 16}, {"candidate", 1024}, {"mid", 64},
};

static int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// Получателю голоса можно отправить кадр: подключение живо и его очередь не переполнена
static bool voiceReceiverReady(const WebSocketConnectionPtr& conn) {
    if (!wsUsable(conn)) return false;
    auto s = conn->getContext<WSSession>();
    return !s || s->congestedUntilMs.load() <= steadyMs();
}

// Сигналинг звонков 1:1 (docs/CALLS.md)
static const std::set<std::string> kCallTypes = {
    "call_invite", "call_accept", "call_reject", "call_end", "call_busy",
    "rtc_offer",   "rtc_answer",  "rtc_ice",
};

// Голос: кадр от подключения, которое владеет голосом, — голосовым подключениям остальных участников.
// v2-получатели видят перед кадром 8 байт id отправителя (int64 LE), v1 — кадр как есть.
// Отправитель ограничен по байтам (UserRateLimiter::VoiceBytes): реальный клиент шлёт 50 кадров
// по 640 байт в секунду, лишнее молча отбрасывается.
static void relayVoice(int64_t selfId, const WebSocketConnectionPtr& conn, const std::string& frame) {
    if (frame.empty() || frame.size() > kMaxVoiceFrame || frame.size() % 2 != 0) return;
    auto& vm = VoiceManager::instance();
    int64_t ch = vm.channelOfConnection(selfId, conn);
    if (ch == 0) return;   // не в голосе или голосом владеет другое подключение
    const double cost = static_cast<double>(std::max(frame.size(), kMinVoiceFrameCost));
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::VoiceBytes, selfId, cost)) return;

    std::string framed;   // кадр с префиксом — собираем один раз и только если есть v2-получатели
    for (const auto& m : vm.membersIn(ch)) {
        if (m.userId == selfId || !voiceReceiverReady(m.conn)) continue;
        if (m.proto == 2) {
            if (framed.empty()) {
                framed.resize(8 + frame.size());
                const auto id = static_cast<uint64_t>(selfId);
                for (int i = 0; i < 8; ++i) framed[i] = static_cast<char>((id >> (8 * i)) & 0xFF);
                std::memcpy(&framed[8], frame.data(), frame.size());
            }
            m.conn->send(framed.data(), framed.size(), WebSocketMessageType::Binary);
        } else {
            m.conn->send(frame.data(), frame.size(), WebSocketMessageType::Binary);
        }
    }
}

static void handleVoiceJoin(int64_t userId, const WebSocketConnectionPtr& conn, const Json::Value& root) {
    int64_t channelId = JsonUtils::getInt(root, "channel_id");
    if (channelId <= 0) return;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::VoiceJoin, userId)) return;
    // Голос: голосовой канал сервера, где пользователь состоит, или личка/беседа, где он участник
    Access::ChannelInfo info;
    if (Access::channel(app().getDbClient(), channelId, userId, &info) != Access::Result::Ok) return;
    if (info.serverId != 0 && !info.isVoice) return;
    int proto = JsonUtils::getInt(root, "proto", 1) == 2 ? 2 : 1;
    int64_t prev = VoiceManager::instance().join(userId, channelId, conn, proto);
    Broadcast::voiceState(channelId);
    if (prev != 0 && prev != channelId) Broadcast::voiceState(prev);
    LOG_INFO << "voice_join: user " << userId << " -> channel " << channelId << " (proto " << proto << ")";
}

static void handleVoiceSpeaking(int64_t userId, const WebSocketConnectionPtr& conn, const Json::Value& root) {
    int64_t ch = VoiceManager::instance().channelOfConnection(userId, conn);
    if (ch == 0) return;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::VoiceSpeaking, userId)) return;
    Json::Value p;
    p["type"]     = "voice_speaking";
    p["user_id"]  = static_cast<Json::Int64>(userId);
    p["speaking"] = JsonUtils::getBool(root, "speaking");
    const std::string payload = JsonUtils::write(p);
    for (int64_t uid : VoiceManager::instance().usersIn(ch))
        if (uid != userId) WSManager::instance().sendToUser(uid, payload);
}

// Текущее состояние всех голосовых каналов сервера — только запросившему участнику сервера
static void handleVoiceQuery(int64_t userId, const WebSocketConnectionPtr& conn, const Json::Value& root) {
    int64_t serverId = JsonUtils::getInt(root, "server_id");
    if (serverId <= 0) return;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::VoiceQuery, userId)) return;
    auto db = app().getDbClient();
    if (!Access::isServerMember(db, serverId, userId)) return;
    auto chans = db->execSqlSync(
        "SELECT id FROM channels WHERE server_id = ? AND is_voice = 1", serverId);
    for (const auto& row : chans)
        conn->send(Broadcast::voiceStatePayload(row["id"].as<int64_t>()));
}

// «Печатает…» (docs/API.md §3): всем, кто видит канал, кроме самого пользователя.
// Чаще раза в 2 с не пересылаем; в недоступный канал — молча игнорируем.
static void handleTyping(int64_t userId, const Json::Value& root) {
    int64_t channelId = JsonUtils::getInt(root, "channel_id");
    if (channelId <= 0) return;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Typing, userId)) return;
    auto db = app().getDbClient();
    if (Access::channel(db, channelId, userId) != Access::Result::Ok) return;
    auto r = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", userId);
    Json::Value ev;
    ev["type"]       = "typing";
    ev["channel_id"] = static_cast<Json::Int64>(channelId);
    ev["user_id"]    = static_cast<Json::Int64>(userId);
    ev["name"]       = r.empty() ? std::string() : r[0]["display_name"].as<std::string>();
    Broadcast::toChannel(channelId, ev, userId);
}

static void handleSetPresence(int64_t userId, const Json::Value& root) {
    std::string p = JsonUtils::getStr(root, "presence");
    if (p != "online" && p != "idle" && p != "dnd" && p != "invisible") return;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Presence, userId)) return;
    app().getDbClient()->execSqlSync("UPDATE users SET presence=? WHERE id=?", p, userId);
    Broadcast::presence(userId);
}

// Релей адресату {to} со штампом {from} — только между друзьями или собеседниками по личке.
// Имя звонящего в call_invite ставит сервер: подделать «кто звонит» нельзя.
// Пересылаются только поля из kCallFields (строки не длиннее лимита); слишком длинное — не пересылается вовсе.
static void handleCallSignal(int64_t userId, const WebSocketConnectionPtr& conn,
                             const std::string& type, const Json::Value& root) {
    int64_t to = JsonUtils::getInt(root, "to");
    if (to <= 0 || to == userId) return;
    const auto action = type == "call_invite" ? UserRateLimiter::Action::CallInvite
                                              : UserRateLimiter::Action::CallSignal;
    if (!UserRateLimiter::instance().allow(action, userId)) return;
    Json::Value out;
    out["type"] = type;
    out["to"]   = static_cast<Json::Int64>(to);
    for (const auto& [field, maxLen] : kCallFields) {
        if (!root.isMember(field) || !root[field].isString()) continue;
        const std::string v = root[field].asString();
        if (v.size() > maxLen) return;
        out[field] = v;
    }
    auto db = app().getDbClient();
    if (!Access::canCall(db, userId, to)) return;
    if (!WSManager::instance().isOnline(to)) {
        Json::Value ev;
        ev["type"]    = "call_unavailable";
        ev["user_id"] = static_cast<Json::Int64>(to);
        conn->send(JsonUtils::write(ev));
        return;
    }
    out["from"] = static_cast<Json::Int64>(userId);
    if (type == "call_invite") {
        auto r = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", userId);
        out["name"] = r.empty() ? std::string() : r[0]["display_name"].as<std::string>();
    }
    WSManager::instance().sendToUser(to, JsonUtils::write(out));
}

void WSController::handleNewConnection(const HttpRequestPtr& req, const WebSocketConnectionPtr& conn) {
    try {
        auto s = std::make_shared<WSSession>();
        s->userId    = req->attributes()->get<int64_t>("user_id");
        s->tokenHash = CryptoUtils::sha256Hex(req->attributes()->get<std::string>("token"));
        conn->setContext(s);
        // Клиент, который не забирает данные из сокета, копил бы исходящие кадры в памяти сервера
        // без предела: при переполненной очереди не шлём ему голос, при сильно переполненной — закрываем
        if (auto tcp = req->getConnectionPtr().lock()) {
            std::weak_ptr<WSSession> weakSession = s;
            tcp->setHighWaterMarkCallback(
                [weakSession](const trantor::TcpConnectionPtr& t, size_t pending) {
                    auto ws = weakSession.lock();
                    if (!ws) return;
                    ws->congestedUntilMs = steadyMs() + kCongestedHoldMs;
                    if (pending <= kMaxPendingBytes || ws->closing.exchange(true)) return;
                    LOG_WARN << "WS: user " << ws->userId << " does not read (" << pending
                             << " bytes queued), closing";
                    // Не внутри send(): закрываем следующим шагом цикла событий
                    std::weak_ptr<trantor::TcpConnection> weakTcp = t;
                    t->getLoop()->queueInLoop([weakTcp] {
                        if (auto c = weakTcp.lock()) c->forceClose();
                    });
                },
                kCongestedBytes);
        }
        // Друзья увидят, что я в сети, — только при первом подключении
        if (WSManager::instance().addConnection(s->userId, conn)) Broadcast::presence(s->userId);
        LOG_INFO << "WS connected: user " << s->userId;
    } catch (const std::exception& e) {
        LOG_ERROR << "WS connect: " << e.what();
        conn->forceClose();
    }
}

void WSController::handleNewMessage(const WebSocketConnectionPtr& conn,
                                    std::string&& msg,
                                    const WebSocketMessageType& type) {
    // Исключение из обработчика WS роняет весь процесс (Drogon их не ловит) — ловим всё здесь
    try {
        auto s = conn->getContext<WSSession>();
        // Сессия отозвана (выход, смена пароля, истечение) — подключение уже закрывается
        if (!s || s->closing) return;
        const int64_t userId = s->userId;

        if (type == WebSocketMessageType::Binary) {
            relayVoice(userId, conn, msg);
            return;
        }
        if (type != WebSocketMessageType::Text) return;

        Json::Value root;
        if (!JsonUtils::parse(msg, root) || !root.isObject()) return;
        const std::string t = JsonUtils::getStr(root, "type");

        if (t == "ping")                conn->send(R"({"type":"pong"})");
        else if (t == "voice_join")     handleVoiceJoin(userId, conn, root);
        else if (t == "voice_leave") {
            // Выйти может только подключение, которое владеет голосом: вкладка без голоса
            // не выкинет из канала десктоп того же пользователя
            int64_t ch = VoiceManager::instance().leaveIfOwner(userId, conn);
            if (ch != 0) Broadcast::voiceState(ch);
        }
        else if (t == "voice_speaking") handleVoiceSpeaking(userId, conn, root);
        else if (t == "voice_query")    handleVoiceQuery(userId, conn, root);
        else if (t == "typing")         handleTyping(userId, root);
        else if (t == "set_presence")   handleSetPresence(userId, root);
        else if (kCallTypes.count(t))   handleCallSignal(userId, conn, t, root);
    } catch (const std::exception& e) {
        LOG_WARN << "WS message dropped: " << e.what();
    } catch (...) {
        LOG_WARN << "WS message dropped: unknown error";
    }
}

void WSController::handleConnectionClosed(const WebSocketConnectionPtr& conn) {
    try {
        auto s = conn->getContext<WSSession>();
        if (!s) return;
        // Закрылось голосовое подключение — выход из канала; другие подключения голос не трогают
        int64_t ch = VoiceManager::instance().leaveIfOwner(s->userId, conn);
        if (ch != 0) Broadcast::voiceState(ch);
        // Офлайн — только когда закрылось последнее подключение
        if (WSManager::instance().removeConnection(s->userId, conn)) Broadcast::presence(s->userId);
        LOG_INFO << "WS closed: user " << s->userId;
    } catch (const std::exception& e) {
        LOG_ERROR << "WS close: " << e.what();
    }
}
