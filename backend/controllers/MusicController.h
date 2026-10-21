#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Поиск трека для карточки профиля по каталогу iTunes Search API (без ключа; превью 30 с и обложка).
// Запрос идёт через сервер: клиент по CSP ходит только на свой origin (docs/API.md §10.1)
class MusicController : public HttpController<MusicController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(MusicController::search, "/api/v1/music/search", Get, Options, "AuthFilter");
    METHOD_LIST_END

    void search(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
