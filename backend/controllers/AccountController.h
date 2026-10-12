#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Настройки → Аккаунт (docs/API.md §9.1): логин, почта, двухфакторная аутентификация
class AccountController : public HttpController<AccountController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(AccountController::info,          "/api/v1/account",                Get,  Options, "AuthFilter");
    ADD_METHOD_TO(AccountController::checkUsername, "/api/v1/account/username/check", Get,  Options, "AuthFilter");
    ADD_METHOD_TO(AccountController::setUsername,   "/api/v1/account/username",       Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::email,         "/api/v1/account/email",          Get,  Options, "AuthFilter");
    ADD_METHOD_TO(AccountController::emailStart,    "/api/v1/account/email/start",    Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::emailVerify,   "/api/v1/account/email/verify",   Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::emailResend,   "/api/v1/account/email/resend",   Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::totpSetup,     "/api/v1/account/2fa/setup",      Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::totpEnable,    "/api/v1/account/2fa/enable",     Post, Options, "RateLimitFilter", "AuthFilter");
    ADD_METHOD_TO(AccountController::totpDisable,   "/api/v1/account/2fa/disable",    Post, Options, "RateLimitFilter", "AuthFilter");
    METHOD_LIST_END

    void info         (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void checkUsername(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void setUsername  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void email        (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void emailStart   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void emailVerify  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void emailResend  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void totpSetup    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void totpEnable   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void totpDisable  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
