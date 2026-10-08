#include "UserRateLimiter.h"
#include <algorithm>

namespace {
struct Limit { double capacity; double periodSec; };

Limit limitFor(UserRateLimiter::Action a) {
    using A = UserRateLimiter::Action;
    switch (a) {
        case A::Message:       return {10, 5};
        case A::Upload:        return {20, 60};
        case A::FriendRequest: return {20, 60};
        case A::JoinByCode:    return {10, 60};
        case A::ChannelCreate: return {10, 60};
        case A::CallInvite:    return {10, 60};
        case A::Typing:        return {1, 2};
        case A::Search:        return {30, 60};
        case A::Presence:      return {10, 60};
        case A::VoiceJoin:     return {20, 60};
        case A::VoiceQuery:    return {30, 60};
        case A::VoiceSpeaking: return {50, 10};
        case A::CallSignal:    return {100, 20};
        case A::VoiceBytes:    return {64000, 64000.0 / 48000.0};
    }
    return {10, 60};
}
} // namespace

UserRateLimiter& UserRateLimiter::instance() {
    static UserRateLimiter inst;
    return inst;
}

bool UserRateLimiter::allow(Action action, int64_t userId, double cost) {
    const auto now = std::chrono::steady_clock::now();
    const Limit lim = limitFor(action);
    std::lock_guard<std::mutex> lock(m_);
    prune(now);
    auto it = buckets_.find({action, userId});
    if (it == buckets_.end())
        it = buckets_.emplace(std::make_pair(action, userId), Bucket{lim.capacity, now}).first;
    Bucket& b = it->second;
    const double elapsed = std::chrono::duration<double>(now - b.last).count();
    b.tokens = std::min(lim.capacity, b.tokens + elapsed * lim.capacity / lim.periodSec);
    b.last   = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
}

// Раз в минуту выбрасываем вёдра, которые успели наполниться полностью, — память не растёт
void UserRateLimiter::prune(std::chrono::steady_clock::time_point now) {
    if (now - lastPrune_ < std::chrono::minutes(1)) return;
    lastPrune_ = now;
    for (auto it = buckets_.begin(); it != buckets_.end();) {
        const Limit lim = limitFor(it->first.first);
        const double idle = std::chrono::duration<double>(now - it->second.last).count();
        if (idle >= lim.periodSec) it = buckets_.erase(it);
        else ++it;
    }
}
