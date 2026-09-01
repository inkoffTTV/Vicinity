#include "AuthFilter.h"
#include "../managers/SessionManager.h"
#include <drogon/HttpResponse.h>

void AuthFilter::doFilter(const drogon::HttpRequestPtr& req,
                          drogon::FilterCallback&&      fcb,
                          drogon::FilterChainCallback&& fccb) {
    std::string auth = req->getHeader("Authorization");
    if (auth.size() > 7 && auth.substr(0, 7) == "Bearer ") {
        std::string token = auth.substr(7);
        auto session = AppSessionManager::instance().validate(token);
        if (session) {
            req->attributes()->insert("user_id", session->userId);
            req->attributes()->insert("token", token);
            fccb();
            return;
        }
    }
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(drogon::k401Unauthorized);
    resp->setBody(R"({"error":"Unauthorized"})");
    resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    fcb(resp);
}
