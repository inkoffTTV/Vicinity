// WSManager.h 
// WSManager.h
#pragma once
#include <drogon/WebSocketConnection.h>
#include <shared_mutex>
#include <unordered_map>
#include <string>
#include <memory>

class WSManager {
public:
    static WSManager& instance();
    
    void addConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn);
    void removeConnection(int64_t user_id);
    
    // Онлайн ли пользователь (есть активное WS-подключение)
    bool isOnline(int64_t user_id);

    // Отправка сообщения конкретному пользователю
    void sendToUser(int64_t user_id, const std::string& json_payload);

    // Отправка бинарных данных (аудио голоса) конкретному пользователю
    void sendBinaryToUser(int64_t user_id, const char* data, size_t len);

    // Рассылка всем (для будущих групп/каналов)
    void broadcast(const std::string& json_payload);

private:
    WSManager() = default;
    std::shared_mutex mutex_;
    std::unordered_map<int64_t, drogon::WebSocketConnectionPtr> connections_;
};