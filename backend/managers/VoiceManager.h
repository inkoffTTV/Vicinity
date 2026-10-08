#pragma once
#include <drogon/WebSocketConnection.h>
#include <cstdint>
#include <set>
#include <unordered_map>
#include <vector>
#include <mutex>

// Кто в каком голосовом канале. Голосом пользователя владеет одно WS-подключение —
// то, что прислало voice_join: только от него принимаются кадры и только ему они пересылаются.
class VoiceManager {
public:
    struct Member {
        int64_t                         userId = 0;
        drogon::WebSocketConnectionPtr  conn;
        int                             proto  = 1;   // 2 — кадры с префиксом id отправителя
    };

    static VoiceManager& instance();

    // Пользователь заходит в канал с подключения conn. Возвращает предыдущий канал (0 если не было).
    int64_t join(int64_t userId, int64_t channelId, const drogon::WebSocketConnectionPtr& conn, int proto);
    // Пользователь выходит. Возвращает канал, из которого вышел (0 если не был).
    int64_t leave(int64_t userId);
    // Выход, только если голосом владеет именно это подключение. Возвращает канал (0 — не владеет).
    int64_t leaveIfOwner(int64_t userId, const drogon::WebSocketConnectionPtr& conn);
    // Канал пользователя, если голосом владеет это подключение (иначе 0).
    int64_t channelOfConnection(int64_t userId, const drogon::WebSocketConnectionPtr& conn);
    // Список user_id в канале.
    std::vector<int64_t> usersIn(int64_t channelId);
    // Участники канала с их голосовыми подключениями.
    std::vector<Member> membersIn(int64_t channelId);
    // В каком голосовом канале пользователь (0 если ни в каком).
    int64_t channelOf(int64_t userId);

private:
    struct State {
        int64_t                         channelId = 0;
        drogon::WebSocketConnectionPtr  conn;
        int                             proto = 1;
    };
    int64_t leaveLocked(int64_t userId);

    std::mutex m_;
    std::unordered_map<int64_t, std::set<int64_t>> chUsers_;  // channelId -> userIds
    std::unordered_map<int64_t, State>             users_;    // userId -> канал + подключение
};
