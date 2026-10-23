#pragma once
#include <drogon/WebSocketConnection.h>
#include <json/json.h>
#include <cstdint>
#include <string>

// «Слушать вместе» в голосовом канале (docs/CALLS.md §2.7): общая очередь 30-секундных превью из каталога
// (GET /music/search). Состояние живёт в памяти, пока в канале кто-то есть; все участники получают
// listen_state и играют трек у себя, сверяясь с позицией сервера.
namespace Listen {
    // WS-сообщения listen_add {track} / listen_remove {index} / listen_play / listen_pause /
    // listen_next {index} / listen_seek {position_ms} / listen_clear — от участника канала channelId.
    // Меняет состояние и рассылает listen_state всем в канале; неизвестные или некорректные — молча игнорирует.
    void handle(int64_t userId, int64_t channelId, const std::string& type, const Json::Value& root);
    // Текущее состояние канала (для только что вошедшего); пусто — не шлём
    void sendTo(const drogon::WebSocketConnectionPtr& conn, int64_t channelId);
    // Канал опустел — очередь забывается
    void clear(int64_t channelId);
}
