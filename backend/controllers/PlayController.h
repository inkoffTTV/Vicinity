#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Статистика игр «Активностей» (web/public/activities): рекорды, награды (шапки и цвета),
// ежедневный забег. Награды проверяет сервер: шапку за победу без победы не надеть.
class PlayController : public HttpController<PlayController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PlayController::me,       "/api/v1/play/{game}/me",       Get,  Options, "AuthFilter");
    ADD_METHOD_TO(PlayController::result,   "/api/v1/play/{game}/result",   Post, Options, "AuthFilter");
    ADD_METHOD_TO(PlayController::cosmetic, "/api/v1/play/{game}/cosmetic", Post, Options, "AuthFilter");
    ADD_METHOD_TO(PlayController::daily,    "/api/v1/play/{game}/daily",    Get,  Options, "AuthFilter");
    METHOD_LIST_END

    void me      (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game);
    void result  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game);
    void cosmetic(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game);
    void daily   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& game);
};
