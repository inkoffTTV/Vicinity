#pragma once
#include "Access.h"
#include <drogon/HttpRequest.h>
#include <drogon/HttpResponse.h>
#include <json/json.h>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <string>

// Общие ответы REST-контроллеров: JSON, ошибки {"error": "..."} и разбор параметров запроса.
namespace HttpUtils {

inline drogon::HttpResponsePtr json(Json::Value body, drogon::HttpStatusCode code = drogon::k200OK) {
    auto resp = drogon::HttpResponse::newHttpJsonResponse(std::move(body));
    resp->setStatusCode(code);
    return resp;
}

inline drogon::HttpResponsePtr error(const std::string& msg, drogon::HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    return json(std::move(v), code);
}

// Нет доступа к каналу (docs/API.md §1): канала нет — 404, чужой канал — 403
inline drogon::HttpResponsePtr accessError(Access::Result r) {
    return r == Access::Result::NotFound ? error("Канал не найден", drogon::k404NotFound)
                                         : error("Нет доступа к каналу", drogon::k403Forbidden);
}

inline drogon::HttpResponsePtr tooManyRequests() {
    return error("Слишком часто, попробуйте позже", drogon::k429TooManyRequests);
}

// Целочисленный параметр запроса (?key=N); нет, не число или мусор после числа — def
inline int64_t intParam(const drogon::HttpRequestPtr& req, const std::string& key, int64_t def = 0) {
    const std::string& raw = req->getParameter(key);
    if (raw.empty()) return def;
    char* end = nullptr;
    errno = 0;
    const long long v = std::strtoll(raw.c_str(), &end, 10);
    if (errno != 0 || end == raw.c_str() || *end != '\0') return def;
    return static_cast<int64_t>(v);
}

} // namespace HttpUtils
