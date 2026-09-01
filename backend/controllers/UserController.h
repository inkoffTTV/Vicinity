#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

class UserController : public HttpController<UserController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(UserController::search,   "/api/v1/users/search", Get,  Options, "AuthFilter");
    ADD_METHOD_TO(UserController::profile,   "/api/v1/users/{id}/profile", Get, Options, "AuthFilter");
    ADD_METHOD_TO(UserController::startDm,   "/api/v1/dms",          Post, Options, "AuthFilter");
    ADD_METHOD_TO(UserController::listDms,   "/api/v1/dms",          Get,  Options, "AuthFilter");
    METHOD_LIST_END

    void search (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void profile(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void startDm(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void listDms(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
