#include "RateLimitFilter.h"
#include "../utils/NetUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      fcb,
                               drogon::FilterChainCallback&& fccb) {
    const std::string ip = NetUtils::clientIp(req);
    auto now = std::chrono::steady_clock::now();
    const auto window = std::chrono::seconds(Vicinity::RATE_LIMIT_WINDOW_SEC);

    std::lock_guard<std::mutex> lock(mutex_);
    // Раз в окно выбрасываем клиентов с истёкшим окном — карта не растёт бесконечно
    if (now - lastPrune_ >= window) {
        lastPrune_ = now;
        for (auto it = clients_.begin(); it != clients_.end();)
            it = (now - it->second.windowStart >= window) ? clients_.erase(it) : std::next(it);
    }

    auto& c = clients_[ip];
    if (now - c.windowStart >= window) {
        c.count = 0;
        c.windowStart = now;
    }

    if (++c.count > Vicinity::RATE_LIMIT_REQUESTS) {
        Json::Value body;
        body["error"] = "Too many requests";
        auto resp = drogon::HttpResponse::newHttpJsonResponse(body);
        resp->setStatusCode(drogon::k429TooManyRequests);
        fcb(resp);
        return;
    }
    fccb();
}
