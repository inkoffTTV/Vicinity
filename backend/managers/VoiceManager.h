#pragma once
#include <cstdint>
#include <set>
#include <unordered_map>
#include <vector>
#include <mutex>

// Отслеживает присутствие пользователей в голосовых каналах (без самого аудио).
// Аудио (WebRTC) — следующий этап; здесь только «кто в канале».
class VoiceManager {
public:
    static VoiceManager& instance();

    // Пользователь заходит в голосовой канал. Возвращает предыдущий канал (0 если не было).
    int64_t join(int64_t userId, int64_t channelId);
    // Пользователь выходит. Возвращает канал, из которого вышел (0 если не был).
    int64_t leave(int64_t userId);
    // Список user_id в канале.
    std::vector<int64_t> usersIn(int64_t channelId);
    // В каком голосовом канале пользователь (0 если ни в каком).
    int64_t channelOf(int64_t userId);

private:
    std::mutex m_;
    std::unordered_map<int64_t, std::set<int64_t>> chUsers_;  // channelId -> userIds
    std::unordered_map<int64_t, int64_t>           userCh_;   // userId -> channelId
};
