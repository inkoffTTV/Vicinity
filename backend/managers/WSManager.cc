// WSManager.cc
#include "WSManager.h"
#include <trantor/utils/Logger.h>

WSManager& WSManager::instance() {
    static WSManager instance;
    return instance;
}

void WSManager::addConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    connections_[user_id] = conn;
    LOG_INFO << "User " << user_id << " connected via WebSocket.";
}

void WSManager::removeConnection(int64_t user_id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    connections_.erase(user_id);
    LOG_INFO << "User " << user_id << " disconnected.";
}

bool WSManager::isOnline(int64_t user_id) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = connections_.find(user_id);
    return it != connections_.end() && it->second->connected();
}

void WSManager::sendToUser(int64_t user_id, const std::string& json_payload) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = connections_.find(user_id);
    if (it != connections_.end() && it->second->connected()) {
        it->second->send(json_payload);
    }
}

void WSManager::sendBinaryToUser(int64_t user_id, const char* data, size_t len) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = connections_.find(user_id);
    if (it != connections_.end() && it->second->connected())
        it->second->send(data, len, drogon::WebSocketMessageType::Binary);
}

void WSManager::broadcast(const std::string& json_payload) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    for (auto& pair : connections_) {
        if (pair.second->connected()) {
            pair.second->send(json_payload);
        }
    }
}