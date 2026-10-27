#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// GET /api/v1/home — главный экран: сводка «Пока вас не было» (Claude API при заданном ключе,
// иначе шаблонный текст из тех же фактов), статистика за сутки, кто сейчас в голосе, активные
// каналы и кого стоит добавить в друзья. docs/API.md §19.
class HomeController : public HttpController<HomeController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(HomeController::home, "/api/v1/home", Get, Options, "AuthFilter");
    METHOD_LIST_END

    void home(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
