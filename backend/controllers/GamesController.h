#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Игры для виджетов профиля (docs/API.md §10.2): поиск по каталогу Steam и обложки.
// Браузер не ходит на чужие сайты (CSP img-src 'self'): сервер сам ищет и один раз скачивает обложку
// в /uploads/games/<appid>.jpg.
class GamesController : public HttpController<GamesController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(GamesController::search, "/api/v1/games/search",        Get, Options, "AuthFilter");
    // Без фильтров: <img> не умеет передавать токен, а общий RateLimitFilter делит лимит со входом.
    // Защита — внутри: не больше 12 скачиваний одновременно и запоминание несуществующих обложек.
    ADD_METHOD_TO(GamesController::cover,  "/api/v1/games/{appid}/cover", Get, Options);
    METHOD_LIST_END

    void search(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void cover (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, const std::string& appid);
};
