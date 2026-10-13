#include "ActivityManager.h"
#include <algorithm>

ActivityManager& ActivityManager::instance() {
    static ActivityManager inst;
    return inst;
}

int64_t ActivityManager::join(int64_t channelId, const std::string& game, int64_t userId,
                              const drogon::WebSocketConnectionPtr& conn, std::vector<Peer>& others) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = std::find_if(rooms_.begin(), rooms_.end(),
                           [&](const Room& r) { return r.channelId == channelId && r.game == game; });
    if (it == rooms_.end()) {
        rooms_.push_back(Room{channelId, game, {}});
        it = rooms_.end() - 1;
    }
    // Повторный вход того же подключения — тот же номер
    for (const auto& p : it->peers)
        if (p.conn == conn) {
            for (const auto& q : it->peers)
                if (q.conn != conn) others.push_back(q);
            return p.peerId;
        }
    others = it->peers;
    const int64_t id = nextPeer_++;
    it->peers.push_back(Peer{id, userId, conn});
    return id;
}

int64_t ActivityManager::leave(int64_t channelId, const std::string& game, const drogon::WebSocketConnectionPtr& conn,
                               std::vector<Peer>& rest) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto it = rooms_.begin(); it != rooms_.end(); ++it) {
        if (it->channelId != channelId || it->game != game) continue;
        auto p = std::find_if(it->peers.begin(), it->peers.end(), [&](const Peer& x) { return x.conn == conn; });
        if (p == it->peers.end()) return 0;
        const int64_t id = p->peerId;
        it->peers.erase(p);
        rest = it->peers;
        if (it->peers.empty()) rooms_.erase(it);
        return id;
    }
    return 0;
}

std::vector<ActivityManager::Left> ActivityManager::dropConnection(const drogon::WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Left> out;
    for (auto it = rooms_.begin(); it != rooms_.end();) {
        auto p = std::find_if(it->peers.begin(), it->peers.end(), [&](const Peer& x) { return x.conn == conn; });
        if (p != it->peers.end()) {
            Left l{it->channelId, it->game, p->peerId, {}};
            it->peers.erase(p);
            l.rest = it->peers;
            out.push_back(std::move(l));
        }
        if (it->peers.empty()) it = rooms_.erase(it);
        else ++it;
    }
    return out;
}

int64_t ActivityManager::peersOf(int64_t channelId, const std::string& game, const drogon::WebSocketConnectionPtr& conn,
                                 std::vector<Peer>& others) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& r : rooms_) {
        if (r.channelId != channelId || r.game != game) continue;
        int64_t self = 0;
        for (const auto& p : r.peers) {
            if (p.conn == conn) self = p.peerId;
            else others.push_back(p);
        }
        if (!self) others.clear();
        return self;
    }
    return 0;
}
