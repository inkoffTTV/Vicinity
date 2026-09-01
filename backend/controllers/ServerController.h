#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

class ServerController : public HttpController<ServerController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ServerController::createServer,        "/api/v1/servers",                 Post, Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::listServers,         "/api/v1/servers",                 Get,  Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::joinServer,          "/api/v1/servers/{id}/join",       Post, Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::joinByCode,          "/api/v1/servers/join",            Post, Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::createServerChannel, "/api/v1/servers/{id}/channels",   Post, Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::listServerChannels,  "/api/v1/servers/{id}/channels",   Get,  Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::addMember,           "/api/v1/servers/{id}/members",    Post, Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::listMembers,         "/api/v1/servers/{id}/members",    Get,  Options, "AuthFilter");
    ADD_METHOD_TO(ServerController::removeMember,        "/api/v1/servers/{id}/members/{uid}", Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void createServer       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void listServers        (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void joinServer         (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void joinByCode         (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void createServerChannel(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void listServerChannels (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void addMember          (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void listMembers        (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void removeMember       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t uid);
};
