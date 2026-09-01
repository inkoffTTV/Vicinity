#pragma once
#include <drogon/WebSocketController.h>

class WSController : public drogon::WebSocketController<WSController> {
public:
    void handleNewConnection(const drogon::HttpRequestPtr& req,
                             const drogon::WebSocketConnectionPtr& conn) override;
    void handleNewMessage(const drogon::WebSocketConnectionPtr& conn,
                          std::string&& msg,
                          const drogon::WebSocketMessageType& type) override;
    void handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn) override;

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/ws", "AuthFilter");
    WS_PATH_LIST_END
};
