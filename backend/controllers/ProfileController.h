#pragma once
#include <drogon/HttpController.h>
#include <drogon/orm/DbClient.h>

using namespace drogon;

class ProfileController : public HttpController<ProfileController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(ProfileController::updateProfile, "/api/v1/profile/update", Post, Options, "AuthFilter");
    ADD_METHOD_TO(ProfileController::uploadMedia,   "/api/v1/profile/upload", Post, Options, "AuthFilter");
    ADD_METHOD_TO(ProfileController::updateBio,     "/api/v1/profile/bio",    Post, Options, "AuthFilter");
    ADD_METHOD_TO(ProfileController::updateAccent,  "/api/v1/profile/accent",    Post, Options, "AuthFilter");
    ADD_METHOD_TO(ProfileController::customize,     "/api/v1/profile/customize", Post, Options, "AuthFilter");
    ADD_METHOD_TO(ProfileController::clearMedia,    "/api/v1/profile/clear_media", Post, Options, "AuthFilter");
    METHOD_LIST_END

    void updateProfile(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void uploadMedia  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void updateBio    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void updateAccent (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void customize    (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void clearMedia   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
