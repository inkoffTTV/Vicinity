#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Подписка и настройки оформления (docs/API.md §0.5–0.6)
class SettingsController : public HttpController<SettingsController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(SettingsController::subscription,     "/api/v1/subscription",        Get,   Options, "AuthFilter");
    ADD_METHOD_TO(SettingsController::getAppearance,    "/api/v1/settings/appearance", Get,   Options, "AuthFilter");
    ADD_METHOD_TO(SettingsController::patchAppearance,  "/api/v1/settings/appearance", Patch, Options, "AuthFilter");
    METHOD_LIST_END

    void subscription   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void getAppearance  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void patchAppearance(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
