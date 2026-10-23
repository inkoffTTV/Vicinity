#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Темы сообщества (docs/API.md §18): опубликовать свою тему (Ultra), список, лайк, удалить свою.
// Применить тему сообщества — PATCH /settings/appearance {custom_theme:{from:id}} (Standard+).
class ThemesController : public HttpController<ThemesController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ThemesController::list,    "/api/v1/themes/community",           Get,    Options, "AuthFilter");
    ADD_METHOD_TO(ThemesController::publish, "/api/v1/themes/community",           Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ThemesController::like,    "/api/v1/themes/community/{id}/like", Post,   Options, "AuthFilter");
    ADD_METHOD_TO(ThemesController::remove,  "/api/v1/themes/community/{id}",      Delete, Options, "AuthFilter");
    METHOD_LIST_END

    void list   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void publish(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void like   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void remove (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);

    /** Тема по id как {colors, angle, base} или null — для PATCH /settings/appearance */
    static Json::Value find(int64_t id);
};
