#include "Listen.h"
#include "../managers/VoiceManager.h"
#include "../managers/WSManager.h"
#include "JsonUtils.h"
#include <chrono>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace {

constexpr size_t kMaxQueue    = 50;
constexpr int    kPreviewMs   = 30000;   // превью каталога — 30 секунд

struct Room {
    std::vector<Json::Value> queue;
    bool    playing   = false;
    int64_t posMs     = 0;     // позиция в момент anchorMs
    int64_t anchorMs  = 0;     // серверное время, когда posMs была актуальна
    int64_t by        = 0;     // кто менял последним
};

std::mutex g_mu;
std::unordered_map<int64_t, Room> g_rooms;

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

int64_t positionOf(const Room& r, int64_t now) {
    if (r.queue.empty()) return 0;
    const int64_t p = r.playing ? r.posMs + (now - r.anchorMs) : r.posMs;
    return p < 0 ? 0 : (p > kPreviewMs ? kPreviewMs : p);
}

// Адрес превью: https с каталога Apple (как в GET /music/search) или путь на этом же сервере
bool previewOk(const std::string& u) {
    if (!u.empty() && u[0] == '/' && (u.size() < 2 || u[1] != '/')) return u.find("..") == std::string::npos;
    if (u.rfind("https://", 0) != 0) return false;
    const auto hostEnd = u.find('/', 8);
    const std::string host = u.substr(8, hostEnd == std::string::npos ? std::string::npos : hostEnd - 8);
    const std::string suffix = ".apple.com";
    return host.size() > suffix.size() && host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool httpsOrEmpty(const std::string& u) { return u.empty() || u.rfind("https://", 0) == 0; }

// Трек из клиента → проверенный объект; false — мусор
bool cleanTrack(const Json::Value& in, int64_t userId, Json::Value& out) {
    if (!in.isObject()) return false;
    const std::string title = JsonUtils::getStr(in, "title"), artist = JsonUtils::getStr(in, "artist");
    const std::string preview = JsonUtils::getStr(in, "preview"), artwork = JsonUtils::getStr(in, "artwork"), url = JsonUtils::getStr(in, "url");
    if (title.empty() || title.size() > 200 || artist.size() > 200 || preview.size() > 500 || artwork.size() > 500 || url.size() > 500) return false;
    if (!previewOk(preview) || !httpsOrEmpty(artwork) || !httpsOrEmpty(url)) return false;
    out["id"]       = in["id"].isIntegral() ? in["id"] : Json::Value(0);
    out["title"]    = title;
    out["artist"]   = artist;
    out["album"]    = JsonUtils::getStr(in, "album").substr(0, 200);
    out["artwork"]  = artwork;
    out["preview"]  = preview;
    out["url"]      = url;
    out["added_by"] = static_cast<Json::Int64>(userId);
    return true;
}

Json::Value stateJson(int64_t channelId, const Room& r) {
    const int64_t now = nowMs();
    Json::Value s;
    s["type"]        = "listen_state";
    s["channel_id"]  = static_cast<Json::Int64>(channelId);
    s["queue"]       = Json::Value(Json::arrayValue);
    for (const auto& t : r.queue) s["queue"].append(t);
    s["playing"]     = r.playing && !r.queue.empty();
    s["position_ms"] = static_cast<Json::Int64>(positionOf(r, now));
    s["duration_ms"] = kPreviewMs;
    s["by"]          = static_cast<Json::Int64>(r.by);
    return s;
}

void broadcast(int64_t channelId, const Room& r) {
    const std::string payload = JsonUtils::write(stateJson(channelId, r));
    for (int64_t uid : VoiceManager::instance().usersIn(channelId)) WSManager::instance().sendToUser(uid, payload);
}

}  // namespace

namespace Listen {

void handle(int64_t userId, int64_t channelId, const std::string& type, const Json::Value& root) {
    std::lock_guard<std::mutex> lock(g_mu);
    Room& r = g_rooms[channelId];
    const int64_t now = nowMs();
    // Фиксируем позицию перед любым изменением
    const int64_t pos = positionOf(r, now);
    bool changed = false;

    if (type == "listen_add") {
        Json::Value t;
        if (r.queue.size() >= kMaxQueue || !cleanTrack(root["track"], userId, t)) return;
        r.queue.push_back(t);
        if (r.queue.size() == 1) { r.playing = true; r.posMs = 0; r.anchorMs = now; }
        changed = true;
    } else if (type == "listen_remove") {
        const int idx = JsonUtils::getInt(root, "index", -1);
        if (idx < 0 || idx >= static_cast<int>(r.queue.size())) return;
        r.queue.erase(r.queue.begin() + idx);
        if (idx == 0) { r.posMs = 0; r.anchorMs = now; }   // убрали текущий — следующий с начала
        changed = true;
    } else if (type == "listen_play" || type == "listen_pause") {
        if (r.queue.empty()) return;
        const bool play = type == "listen_play";
        if (play == r.playing) return;
        r.posMs = pos >= kPreviewMs ? 0 : pos;
        r.anchorMs = now;
        r.playing = play;
        changed = true;
    } else if (type == "listen_next") {
        if (r.queue.empty()) return;
        // Автопереход в конце трека шлют все слушатели — учитываем только первый (index совпадает, значит, трек ещё текущий)
        const int idx = JsonUtils::getInt(root, "index", 0);
        if (idx != 0) return;
        r.queue.erase(r.queue.begin());
        r.posMs = 0;
        r.anchorMs = now;
        changed = true;
    } else if (type == "listen_seek") {
        if (r.queue.empty()) return;
        const int p = JsonUtils::getInt(root, "position_ms", -1);
        if (p < 0 || p > kPreviewMs) return;
        r.posMs = p;
        r.anchorMs = now;
        changed = true;
    } else if (type == "listen_clear") {
        if (r.queue.empty()) return;
        r.queue.clear();
        r.playing = false;
        changed = true;
    }
    if (!changed) return;
    r.by = userId;
    if (r.queue.empty()) r.playing = false;
    broadcast(channelId, r);
}

void sendTo(const drogon::WebSocketConnectionPtr& conn, int64_t channelId) {
    std::lock_guard<std::mutex> lock(g_mu);
    const auto it = g_rooms.find(channelId);
    if (it == g_rooms.end() || it->second.queue.empty()) return;
    conn->send(JsonUtils::write(stateJson(channelId, it->second)));
}

void clear(int64_t channelId) {
    std::lock_guard<std::mutex> lock(g_mu);
    g_rooms.erase(channelId);
}

}  // namespace Listen
