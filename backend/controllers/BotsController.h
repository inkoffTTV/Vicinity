#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Боты для людей (docs/API.md §21): свои боты, боты на сервере, команды ботов канала и нажатие кнопок
class BotsController : public HttpController<BotsController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(BotsController::list,        "/api/v1/bots",                  Get,    Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::directory,   "/api/v1/bots/directory",        Get,    Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::card,        "/api/v1/bots/by-username/{username}", Get, Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::create,      "/api/v1/bots",                  Post,   Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::update,      "/api/v1/bots/{id}",             Patch,  Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::remove,      "/api/v1/bots/{id}",             Delete, Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::regenerate,  "/api/v1/bots/{id}/token",       Post,   Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::serverBots,  "/api/v1/servers/{id}/bots",     Get,    Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::addToServer, "/api/v1/servers/{id}/bots",     Post,   Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::removeFromServer, "/api/v1/servers/{id}/bots/{bid}", Delete, Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::commands,    "/api/v1/channels/{id}/commands", Get,   Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::press,       "/api/v1/channels/{id}/messages/{mid}/callback", Post, Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::webApp,      "/api/v1/bots/{id}/webapp",      Post,   Options, "AuthFilter");
    ADD_METHOD_TO(BotsController::menu,        "/api/v1/bots/{id}/menu_button", Get,    Options, "AuthFilter");
    METHOD_LIST_END

    void list       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void create     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    // Каталог ботов (docs/API.md §21.9): боты, видимые пользователю, и карточка бота по @имени
    void directory  (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void card       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& username);
    void update     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void remove     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void regenerate (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void serverBots (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void addToServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void removeFromServer(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t bid);
    void commands   (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void press      (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id, int64_t mid);
    // Мини-приложения (docs/API.md §21.8): подписанный initData для открытия и кнопка меню бота
    void webApp     (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
    void menu       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id);
};
