#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Мост с Telegram (docs/API.md §20): статус привязки, ссылка на бота, настройки, отвязка
class TelegramController : public HttpController<TelegramController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(TelegramController::status, "/api/v1/telegram", Get, Options, "AuthFilter");
    ADD_METHOD_TO(TelegramController::patch, "/api/v1/telegram", Patch, Options, "AuthFilter");
    ADD_METHOD_TO(TelegramController::unlink, "/api/v1/telegram", Delete, Options, "AuthFilter");
    ADD_METHOD_TO(TelegramController::link, "/api/v1/telegram/link", Post, Options, "AuthFilter");
    METHOD_LIST_END

    void status(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void patch(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void unlink(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void link(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
