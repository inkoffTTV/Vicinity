#pragma once
#include <drogon/HttpController.h>

using namespace drogon;

// ICE-серверы для звонков 1:1 (docs/API.md §12) и вход в голосовой канал через SFU (docs/VOICE-SFU.md)
class RtcController : public HttpController<RtcController> {
public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(RtcController::iceServers, "/api/v1/rtc/ice", Get, Options, "AuthFilter");
    ADD_METHOD_TO(RtcController::sfu,        "/api/v1/rtc/sfu", Get, Options, "AuthFilter");
    METHOD_LIST_END

    void iceServers(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
    void sfu       (const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb);
};
