#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// ICE-серверы для звонков 1:1 (docs/API.md §12)
class RtcController : public HttpController<RtcController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(RtcController::iceServers, "/api/v1/rtc/ice", Get, Options, "AuthFilter");
    METHOD_LIST_END

    void iceServers(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
