// WSManager.cc
#include "WSManager.h"
#include <trantor/utils/Logger.h>
#include <algorithm>
#include <set>

WSManager& WSManager::instance() {
    static WSManager instance;
    return instance;
}

bool WSManager::addConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto& list = connections_[user_id];
    list.push_back(conn);
    LOG_INFO << "User " << user_id << " connected via WebSocket (" << list.size() << " connection(s)).";
    return list.size() == 1;
}

bool WSManager::removeConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    auto it = connections_.find(user_id);
    if (it == connections_.end()) return false;
    auto& list = it->second;
    auto pos = std::find(list.begin(), list.end(), conn);
    if (pos == list.end()) return false;
    list.erase(pos);
    LOG_INFO << "User " << user_id << " disconnected (" << list.size() << " left).";
    if (!list.empty()) return false;
    connections_.erase(it);
    return true;
}

// Копия списка подключений: отправка и закрытие идут уже без блокировки,
// иначе колбэк закрытия (removeConnection) в этом же потоке упрётся в mutex_.
std::vector<drogon::WebSocketConnectionPtr> WSManager::connectionsOf(int64_t user_id) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = connections_.find(user_id);
    return it != connections_.end() ? it->second : std::vector<drogon::WebSocketConnectionPtr>{};
}

bool WSManager::isOnline(int64_t user_id) {
    for (const auto& c : connectionsOf(user_id))
        if (c->connected()) return true;
    return false;
}

void WSManager::sendToUser(int64_t user_id, const std::string& json_payload) {
    for (const auto& c : connectionsOf(user_id))
        if (c->connected()) c->send(json_payload);
}

void WSManager::closeSession(const std::string& tokenHash) {
    std::vector<drogon::WebSocketConnectionPtr> toClose;
    {
        std::shared_lock<std::shared_mutex> lock(mutex_);
        for (const auto& [uid, list] : connections_)
            for (const auto& c : list) {
                auto s = c->getContext<WSSession>();
                if (s && s->tokenHash == tokenHash) toClose.push_back(c);
            }
    }
    for (const auto& c : toClose) c->shutdown(drogon::CloseCode::kViolation, "session ended");
}

std::vector<std::string> WSManager::sessionHashes() {
    std::set<std::string> out;
    std::shared_lock<std::shared_mutex> lock(mutex_);
    for (const auto& [uid, list] : connections_)
        for (const auto& c : list) {
            auto s = c->getContext<WSSession>();
            if (s) out.insert(s->tokenHash);
        }
    return {out.begin(), out.end()};
}
