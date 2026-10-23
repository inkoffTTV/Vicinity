#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Приглашения в беседу и на сервер (docs/API.md §7.1): список своих и ответ на них
class InviteController : public HttpController<InviteController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(InviteController::list,    "/api/v1/invites",              Get,  Options, "AuthFilter");
    ADD_METHOD_TO(InviteController::accept,  "/api/v1/invites/{id}/accept",  Post, Options, "AuthFilter");
    ADD_METHOD_TO(InviteController::decline, "/api/v1/invites/{id}/decline", Post, Options, "AuthFilter");
    METHOD_LIST_END

    void list   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void accept (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void decline(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
};
