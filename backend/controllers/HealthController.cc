#include "HealthController.h"
#include "../utils/HttpUtils.h"
#include <drogon/drogon.h>

void HealthController::health(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb) {
    Json::Value v;
    try {
        auto r = app().getDbClient()->execSqlSync("SELECT 1 AS one");
        v["ok"] = !r.empty() && r[0]["one"].as<int>() == 1;
    } catch (const std::exception& e) {
        LOG_ERROR << "health: db check failed: " << e.what();
        v["ok"] = false;
    }
    auto resp = HttpUtils::json(v, v["ok"].asBool() ? k200OK : k503ServiceUnavailable);
    resp->addHeader("Cache-Control", "no-store");
    cb(resp);
}
