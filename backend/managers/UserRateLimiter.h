#pragma once
#include <chrono>
#include <cstdint>
#include <map>
#include <mutex>
#include <utility>

// Лимиты частоты действий по пользователю (docs/API.md §13): token bucket в памяти.
// Ёмкость ведра = сколько действий подряд можно сделать, затем — не быстрее period/capacity.
class UserRateLimiter {
public:
    enum class Action {
        Message,        // 10 сообщений за 5 с
        Upload,         // 20 загрузок в минуту (вложения, аватар, баннер)
        FriendRequest,  // 20 заявок в друзья в минуту
        JoinByCode,     // 10 попыток кода приглашения в минуту (перебор кодов)
        ChannelCreate,  // 10 новых каналов сервера в минуту
        CallInvite,     // 10 входящих звонков в минуту (спам звонками)
    };

    static UserRateLimiter& instance();

    // true — действие разрешено (и учтено), false — лимит исчерпан
    bool allow(Action action, int64_t userId);

private:
    UserRateLimiter() = default;
    struct Bucket {
        double tokens = 0;
        std::chrono::steady_clock::time_point last;
    };
    void prune(std::chrono::steady_clock::time_point now);

    std::mutex m_;
    std::map<std::pair<Action, int64_t>, Bucket> buckets_;
    std::chrono::steady_clock::time_point lastPrune_ = std::chrono::steady_clock::now();
};
