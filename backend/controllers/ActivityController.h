#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Активность и награды (docs/API.md §16), приватность (§15), подарочные коды (§17)
class ActivityController : public HttpController<ActivityController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ActivityController::me,          "/api/v1/activity/me",          Get,   Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::leaderboard, "/api/v1/activity/leaderboard", Get,   Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::equip,       "/api/v1/activity/equip",       Post,  Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::getPrivacy,  "/api/v1/settings/privacy",     Get,   Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::patchPrivacy,"/api/v1/settings/privacy",     Patch, Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::giftInfo,    "/api/v1/gifts/{code}",         Get,   Options, "AuthFilter");
    ADD_METHOD_TO(ActivityController::giftRedeem,  "/api/v1/gifts/redeem",         Post,  Options, "AuthFilter");
    METHOD_LIST_END

    void me          (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void leaderboard (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void equip       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void getPrivacy  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void patchPrivacy(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void giftInfo    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& code);
    void giftRedeem  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
