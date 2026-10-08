// WSManager.h
#pragma once
#include <drogon/WebSocketConnection.h>
#include <shared_mutex>
#include <unordered_map>
#include <string>
#include <memory>
#include <vector>

// Контекст WS-подключения
struct WSSession {
    int64_t     userId = 0;
    std::string tokenHash;   // sha256 токена сессии — чтобы закрыть подключения при выходе
};

// Все WS-подключения пользователей. У одного пользователя их может быть несколько
// (десктоп + вкладки браузера): события уходят во все, «в сети» — пока открыто хотя бы одно.
class WSManager {
public:
    static WSManager& instance();

    // true — это первое подключение пользователя (он только что появился в сети)
    bool addConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn);
    // Убирает именно это подключение. true — у пользователя не осталось подключений.
    bool removeConnection(int64_t user_id, const drogon::WebSocketConnectionPtr& conn);

    // Онлайн ли пользователь (есть хотя бы одно активное WS-подключение)
    bool isOnline(int64_t user_id);

    // Отправка сообщения во все подключения пользователя
    void sendToUser(int64_t user_id, const std::string& json_payload);

    // Закрыть все подключения, открытые с этой сессией (выход, истечение сессии)
    void closeSession(const std::string& tokenHash);
    // Хэши сессий всех открытых подключений (для периодической перепроверки)
    std::vector<std::string> sessionHashes();

private:
    WSManager() = default;
    std::vector<drogon::WebSocketConnectionPtr> connectionsOf(int64_t user_id);

    std::shared_mutex mutex_;
    std::unordered_map<int64_t, std::vector<drogon::WebSocketConnectionPtr>> connections_;
};
