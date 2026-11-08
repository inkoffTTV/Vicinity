#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// Bot API в стиле Telegram (docs/API.md §21): /api/v1/bot<токен>/<метод>, GET и POST,
// параметры из query, form-urlencoded, multipart или JSON. Без AuthFilter: бот входит токеном из пути.
// Токен начинается с цифры — регулярка не пересекается с /api/v1/bots/...
class BotApiController : public HttpController<BotApiController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_VIA_REGEX(BotApiController::handle, "/api/v1/bot([0-9][^/]*)/([^/]+)", Get, Post);
    METHOD_LIST_END

    void handle(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                const std::string& token, const std::string& method);
};
