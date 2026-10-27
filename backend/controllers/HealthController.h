#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// GET /api/v1/health — для healthcheck Docker и внешнего мониторинга: проверяет базу (SELECT 1),
// а не только то, что процесс жив. Без авторизации, ничего о системе не раскрывает.
class HealthController : public HttpController<HealthController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(HealthController::health, "/api/v1/health", Get, Options);
    METHOD_LIST_END
    void health(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
