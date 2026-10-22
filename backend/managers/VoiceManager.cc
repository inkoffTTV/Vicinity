#include "VoiceManager.h"
#include <chrono>

static int64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

VoiceManager& VoiceManager::instance() {
    static VoiceManager inst;
    return inst;
}

int64_t VoiceManager::leaveLocked(int64_t userId) {
    auto it = users_.find(userId);
    if (it == users_.end()) return 0;
    int64_t ch = it->second.channelId;
    auto cit = chUsers_.find(ch);
    if (cit != chUsers_.end()) {
        cit->second.erase(userId);
        if (cit->second.empty()) chUsers_.erase(cit);
    }
    users_.erase(it);
    return ch;
}

int64_t VoiceManager::join(int64_t userId, int64_t channelId,
                           const drogon::WebSocketConnectionPtr& conn, int proto) {
    std::lock_guard<std::mutex> lock(m_);
    int64_t prev = leaveLocked(userId);
    users_[userId] = State{channelId, conn, proto, false, false, nowMs()};
    chUsers_[channelId].insert(userId);
    return prev;
}

int64_t VoiceManager::secondsIn(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    return it == users_.end() || !it->second.joinedMs ? 0 : (nowMs() - it->second.joinedMs) / 1000;
}

int64_t VoiceManager::leave(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    return leaveLocked(userId);
}

int64_t VoiceManager::leaveIfOwner(int64_t userId, const drogon::WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    if (it == users_.end() || it->second.conn != conn) return 0;
    return leaveLocked(userId);
}

int64_t VoiceManager::channelOfConnection(int64_t userId, const drogon::WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    return (it != users_.end() && it->second.conn == conn) ? it->second.channelId : 0;
}

std::vector<int64_t> VoiceManager::usersIn(int64_t channelId) {
    std::lock_guard<std::mutex> lock(m_);
    std::vector<int64_t> out;
    auto it = chUsers_.find(channelId);
    if (it != chUsers_.end())
        out.assign(it->second.begin(), it->second.end());
    return out;
}

std::vector<VoiceManager::Member> VoiceManager::membersIn(int64_t channelId) {
    std::lock_guard<std::mutex> lock(m_);
    std::vector<Member> out;
    auto it = chUsers_.find(channelId);
    if (it == chUsers_.end()) return out;
    for (int64_t uid : it->second) {
        auto st = users_.find(uid);
        if (st != users_.end())
            out.push_back(Member{uid, st->second.conn, st->second.proto, st->second.screen, st->second.camera});
    }
    return out;
}

int64_t VoiceManager::channelOf(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    return it != users_.end() ? it->second.channelId : 0;
}

drogon::WebSocketConnectionPtr VoiceManager::connectionOf(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    return it != users_.end() ? it->second.conn : nullptr;
}

bool VoiceManager::setMedia(int64_t userId, const drogon::WebSocketConnectionPtr& conn,
                            bool screen, bool camera, int64_t* channelOut) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = users_.find(userId);
    if (it == users_.end() || it->second.conn != conn) return false;
    if (channelOut) *channelOut = it->second.channelId;
    if (it->second.screen == screen && it->second.camera == camera) return false;
    it->second.screen = screen;
    it->second.camera = camera;
    return true;
}
