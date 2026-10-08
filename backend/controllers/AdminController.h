#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Админ-панель (docs/API.md §0.4): только для аккаунтов с developer = 1.
class AdminController : public HttpController<AdminController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(AdminController::listUsers,     "/api/v1/admin/users",               Get,    Options, "AuthFilter");
    ADD_METHOD_TO(AdminController::setBanned,     "/api/v1/admin/users/{id}/ban",      Post,   Options, "AuthFilter");
    ADD_METHOD_TO(AdminController::deleteUser,    "/api/v1/admin/users/{id}",          Delete, Options, "AuthFilter");
    ADD_METHOD_TO(AdminController::listBlocked,   "/api/v1/admin/blocked-ips",         Get,    Options, "AuthFilter");
    ADD_METHOD_TO(AdminController::blockIp,       "/api/v1/admin/blocked-ips",         Post,   Options, "AuthFilter");
    ADD_METHOD_TO(AdminController::unblockIp,     "/api/v1/admin/blocked-ips/{ip}",    Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void listUsers  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void setBanned  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void deleteUser (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void listBlocked(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void blockIp    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void unblockIp  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& ip);
};
