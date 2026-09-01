#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

class ChatController : public HttpController<ChatController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ChatController::listChannels,  "/api/v1/channels",                  Get,  Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::createChannel, "/api/v1/channels",                  Post, Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::getMessages,   "/api/v1/channels/{id}/messages",    Get,  Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::sendMessage,   "/api/v1/channels/{id}/messages",    Post, Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::addMember,     "/api/v1/channels/{id}/members",     Post, Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::editMessage,      "/api/v1/channels/{id}/messages/{mid}/edit",  Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::deleteMessage,    "/api/v1/channels/{id}/messages/{mid}",       Delete, Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::toggleReaction,   "/api/v1/channels/{id}/messages/{mid}/react", Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ChatController::uploadAttachment, "/api/v1/channels/{id}/attachments",          Post,   Options, "AuthFilter");
    METHOD_LIST_END

    void listChannels (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void createChannel(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void getMessages  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void sendMessage  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void addMember    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void editMessage     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t mid);
    void deleteMessage   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t mid);
    void toggleReaction  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t mid);
    void uploadAttachment(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
};
