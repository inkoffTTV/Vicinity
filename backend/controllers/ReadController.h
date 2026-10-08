#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Прочитанное (docs/API.md §4): отметка прочтения канала и счётчики непрочитанного
class ReadController : public HttpController<ReadController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ReadController::markRead, "/api/v1/channels/{id}/read", Post, Options, "AuthFilter");
    ADD_METHOD_TO(ReadController::unread,   "/api/v1/unread",             Get,  Options, "AuthFilter");
    METHOD_LIST_END

    void markRead(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void unread  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
