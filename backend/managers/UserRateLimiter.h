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
        Typing,         // «печатает…» — не чаще раза в 2 с
        Search,         // 30 поисковых запросов в минуту
        // WS-сообщения, которые сервер рассылает многим или которые стоят запросов к БД
        Presence,       // set_presence — 10 в минуту
        VoiceJoin,      // voice_join — 20 в минуту (voice_leave без канала ничего не рассылает)
        VoiceQuery,     // voice_query — 30 в минуту
        VoiceSpeaking,  // voice_speaking — 5 в секунду, до 50 подряд
        CallSignal,     // call_accept/reject/end/busy, rtc_* — 5 в секунду, до 100 подряд (пачка ICE)
        VoiceBytes,     // байты голоса: 48 КБ/с (полтора реального потока 32 КБ/с), запас 64 КБ
    };

    static UserRateLimiter& instance();

    // true — действие разрешено (и учтено), false — лимит исчерпан.
    // cost — сколько «жетонов» стоит действие (для VoiceBytes — байты кадра)
    bool allow(Action action, int64_t userId, double cost = 1.0);

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
