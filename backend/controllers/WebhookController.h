#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Входящие вебхуки каналов (docs/API.md §22): владелец сервера создаёт адрес, внешний сервис
// шлёт на него POST {content|text, username?} — в канале появляется сообщение под именем вебхука.
class WebhookController : public HttpController<WebhookController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(WebhookController::list,    "/api/v1/servers/{id}/webhooks",        Get,    Options, "AuthFilter");
    ADD_METHOD_TO(WebhookController::create,  "/api/v1/servers/{id}/webhooks",        Post,   Options, "AuthFilter");
    ADD_METHOD_TO(WebhookController::remove,  "/api/v1/servers/{id}/webhooks/{wid}",  Delete, Options, "AuthFilter");
    // Без AuthFilter: доступ — по секрету в адресе
    ADD_METHOD_TO(WebhookController::execute, "/api/v1/webhooks/{id}/{token}",        Post);
    METHOD_LIST_END

    void list   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void create (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void remove (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t wid);
    void execute(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id,
                 const std::string& token);
};
