#include "RateLimitFilter.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/HttpResponse.h>

// Адрес из локальной/докер-сети — это наш reverse-proxy (nginx веб-клиента)
static bool isPrivatePeer(const trantor::InetAddress& a) {
    return a.isLoopbackIp() || a.isIntranetIp();
}

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      fcb,
                               drogon::FilterChainCallback&& fccb) {
    std::string ip = req->peerAddr().toIp();
    // За nginx все веб-клиенты приходят с одного адреса — берём реальный IP из X-Real-IP,
    // но только если запрос пришёл из приватной сети (снаружи заголовок подделывается).
    const std::string& realIp = req->getHeader("X-Real-IP");
    if (!realIp.empty() && isPrivatePeer(req->peerAddr())) ip = realIp;
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
