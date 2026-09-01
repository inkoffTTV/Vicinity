#include "RateLimitFilter.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/HttpResponse.h>

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      fcb,
                               drogon::FilterChainCallback&& fccb) {
    std::string ip = req->peerAddr().toIp();
    auto now = std::chrono::steady_clock::now();

    std::lock_guard<std::mutex> lock(mutex_);
    auto& c = clients_[ip];
    auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - c.windowStart).count();

    if (elapsed >= Vicinity::RATE_LIMIT_WINDOW_SEC) {
        c.count = 0;
        c.windowStart = now;
    }

    if (++c.count > Vicinity::RATE_LIMIT_REQUESTS) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k429TooManyRequests);
        resp->setBody(R"({"error":"Too many requests"})");
        resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
        fcb(resp);
        return;
    }
    fccb();
}
