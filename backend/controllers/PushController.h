#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Web Push: публичный ключ VAPID и подписки этого браузера (docs/API.md §14)
class PushController : public HttpController<PushController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PushController::vapid,       "/api/v1/push/vapid",     Get,    Options, "AuthFilter");
    ADD_METHOD_TO(PushController::subscribe,   "/api/v1/push/subscribe", Post,   Options, "AuthFilter");
    ADD_METHOD_TO(PushController::unsubscribe, "/api/v1/push/subscribe", Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void vapid      (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void subscribe  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void unsubscribe(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
