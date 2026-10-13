// ActivityManager.h
#pragma once
#include <drogon/WebSocketConnection.h>
#include <json/json.h>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

// «Активности» — игры прямо в голосовом канале или звонке. Сервер ничего не считает за игру:
// он держит, кто в какой игре какого канала, и пересылает сообщения игры остальным её участникам.
// Участник — WS-подключение (у одного человека может быть игра в двух вкладках).
class ActivityManager {
public:
    static ActivityManager& instance();

    struct Peer {
        int64_t                        peerId = 0;   // номер подключения в игре
        int64_t                        userId = 0;
        drogon::WebSocketConnectionPtr conn;
    };

    // Войти в игру game канала channelId. Возвращает свой номер и тех, кто уже в игре.
    int64_t join(int64_t channelId, const std::string& game, int64_t userId,
                 const drogon::WebSocketConnectionPtr& conn, std::vector<Peer>& others);
    // Выйти; возвращает тех, кто остался (им сообщить), и номер вышедшего (0 — его не было)
    int64_t leave(int64_t channelId, const std::string& game, const drogon::WebSocketConnectionPtr& conn,
                  std::vector<Peer>& rest);
    // Подключение закрылось: выйти из всех игр. Для каждой — канал, игра, номер и оставшиеся.
    struct Left { int64_t channelId; std::string game; int64_t peerId; std::vector<Peer> rest; };
    std::vector<Left> dropConnection(const drogon::WebSocketConnectionPtr& conn);

    // Номер подключения в игре (0 — не участвует) и остальные участники
    int64_t peersOf(int64_t channelId, const std::string& game, const drogon::WebSocketConnectionPtr& conn,
                    std::vector<Peer>& others);

private:
    ActivityManager() = default;
    struct Room {
        int64_t channelId = 0;
        std::string game;
        std::vector<Peer> peers;
    };
    std::mutex mutex_;
    std::vector<Room> rooms_;
    int64_t nextPeer_ = 1;
};
