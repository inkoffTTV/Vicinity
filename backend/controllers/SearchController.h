#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Поиск по сообщениям (docs/API.md §5)
class SearchController : public HttpController<SearchController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(SearchController::search, "/api/v1/search", Get, Options, "AuthFilter");
    METHOD_LIST_END

    void search(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
