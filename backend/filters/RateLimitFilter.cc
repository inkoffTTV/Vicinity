#include "RateLimitFilter.h"
#include "../utils/NetUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>

// Прокси, которым верим заголовок X-Real-IP: custom_config.trusted_proxies (список подсетей).
// По умолчанию — никому (даже loopback: через туннель весь интернет приходит с 127.0.0.1).
static const std::vector<NetUtils::Cidr>& trustedProxies() {
    static const std::vector<NetUtils::Cidr> list = [] {
        const Json::Value& cfg = drogon::app().getCustomConfig();
        return cfg.isObject() ? NetUtils::parseCidrList(cfg["trusted_proxies"])
                              : std::vector<NetUtils::Cidr>{};
    }();
    return list;
}

void RateLimitFilter::doFilter(const drogon::HttpRequestPtr& req,
                               drogon::FilterCallback&&      fcb,
                               drogon::FilterChainCallback&& fccb) {
    std::string ip = req->peerAddr().toIp();
    // За nginx все веб-клиенты приходят с одного адреса — берём реальный IP из X-Real-IP,
    // но только от доверенного прокси (иначе заголовок подделывается).
    const std::string& realIp = req->getHeader("X-Real-IP");
    if (!realIp.empty() && NetUtils::contains(trustedProxies(), req->peerAddr())) ip = realIp;
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
