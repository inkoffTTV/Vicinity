#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

class AuthController : public HttpController<AuthController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(AuthController::registerUser, "/api/v1/auth/register", Post, Options, "RateLimitFilter");
    ADD_METHOD_TO(AuthController::login,        "/api/v1/auth/login",    Post, Options, "RateLimitFilter");
    ADD_METHOD_TO(AuthController::logout,       "/api/v1/auth/logout",   Post, Options, "AuthFilter");
    ADD_METHOD_TO(AuthController::me,           "/api/v1/auth/me",       Get,  Options, "AuthFilter");
    METHOD_LIST_END

    void registerUser(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void login       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void logout      (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void me          (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
