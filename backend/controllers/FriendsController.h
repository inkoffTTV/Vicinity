#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

class FriendsController : public HttpController<FriendsController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(FriendsController::listFriends, "/api/v1/friends",          Get,    Options, "AuthFilter");
    ADD_METHOD_TO(FriendsController::pending,     "/api/v1/friends/pending",  Get,    Options, "AuthFilter");
    ADD_METHOD_TO(FriendsController::request,     "/api/v1/friends/request",  Post,   Options, "AuthFilter");
    ADD_METHOD_TO(FriendsController::respond,     "/api/v1/friends/respond",  Post,   Options, "AuthFilter");
    ADD_METHOD_TO(FriendsController::remove,      "/api/v1/friends/{id}",     Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void listFriends(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void pending    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void request    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void respond    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void remove     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
};
