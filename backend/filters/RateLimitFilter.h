#pragma once
#include <drogon/HttpFilter.h>
#include <unordered_map>
#include <mutex>
#include <chrono>

class RateLimitFilter : public drogon::HttpFilter<RateLimitFilter> {
public:
    void doFilter(const drogon::HttpRequestPtr& req,
                  drogon::FilterCallback&&      fcb,
                  drogon::FilterChainCallback&& fccb) override;

private:
    struct Client {
        int count = 0;
        std::chrono::steady_clock::time_point windowStart = std::chrono::steady_clock::now();
    };
    std::unordered_map<std::string, Client> clients_;
    std::mutex mutex_;
};
