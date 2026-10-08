#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Управление каналами и беседами (docs/API.md §6, §7): состав, выход, переименование, удаление, закрепы
class ChannelController : public HttpController<ChannelController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ChannelController::members,  "/api/v1/channels/{id}/members",    Get,    Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::leave,    "/api/v1/channels/{id}/leave",      Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::update,   "/api/v1/channels/{id}/update",     Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::remove,   "/api/v1/channels/{id}",            Delete, Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::listPins, "/api/v1/channels/{id}/pins",       Get,    Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::pin,      "/api/v1/channels/{id}/pins",       Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ChannelController::unpin,    "/api/v1/channels/{id}/pins/{mid}", Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void members (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void leave   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void update  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void remove  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void listPins(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void pin     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void unpin   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t mid);
};
