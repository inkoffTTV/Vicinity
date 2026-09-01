#pragma once
#include <drogon/HttpController.h>
using namespace drogon;

class RoleController : public HttpController<RoleController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(RoleController::listRoles,   "/api/v1/roles",             Get,    Options, "AuthFilter");
    ADD_METHOD_TO(RoleController::createRole,  "/api/v1/roles",             Post,   Options, "AuthFilter");
    ADD_METHOD_TO(RoleController::myRoles,     "/api/v1/roles/mine",        Get,    Options, "AuthFilter");
    ADD_METHOD_TO(RoleController::assignRole,  "/api/v1/roles/{id}/assign", Post,   Options, "AuthFilter");
    ADD_METHOD_TO(RoleController::unassignRole,"/api/v1/roles/{id}/assign", Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void listRoles   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void createRole  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void myRoles     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void assignRole  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void unassignRole(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
};
