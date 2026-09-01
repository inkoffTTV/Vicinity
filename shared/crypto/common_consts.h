#pragma once
#include <cstdint>

namespace Vicinity {
    constexpr int SESSION_EXPIRE_HOURS   = 24 * 7;
    constexpr int RATE_LIMIT_REQUESTS    = 60;
    constexpr int RATE_LIMIT_WINDOW_SEC  = 60;
    constexpr int64_t MAX_FILE_SIZE      = 5 * 1024 * 1024;
    constexpr int MAX_MESSAGE_LEN        = 4096;
    constexpr int MIN_USERNAME_LEN       = 3;
    constexpr int MAX_USERNAME_LEN       = 32;
    constexpr int MIN_PASSWORD_LEN       = 8;
    constexpr int TOKEN_BYTES            = 32;

    // Subscription tiers
    constexpr int SUB_FREE     = 0; // No subscription
    constexpr int SUB_BASIC    = 1; // Vicinity Basic
    constexpr int SUB_STANDARD = 2; // Vicinity Standard
    constexpr int SUB_ULTRA    = 3; // Vicinity Ultra
}
