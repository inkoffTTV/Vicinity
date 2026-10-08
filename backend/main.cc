#include <drogon/drogon.h>
#include "models/Database.h"
#include "managers/SessionManager.h"

int main() {
    drogon::app()
        .loadConfigFile("config.json")
        // Статика раздаётся только из каталога загрузок (locations в config.json), но
        // Drogon не проверяет «..» внутри location — «/uploads/../vicinity.db» вышел бы
        // за его пределы. Такие пути отсекаем до маршрутизации.
        .registerPreRoutingAdvice([](const drogon::HttpRequestPtr& req,
                                     drogon::AdviceCallback&& acb,
                                     drogon::AdviceChainCallback&& accb) {
            const std::string& path = req->path();
            if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos) {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setStatusCode(drogon::k403Forbidden);
                acb(resp);
                return;
            }
            accb();
        })
        .registerBeginningAdvice([]() {
            Database::initialize();
            // Токен проверяется только при подключении к /ws: раз в 5 минут закрываем
            // сокеты истёкших сессий
            drogon::app().getLoop()->runEvery(300.0, [] {
                AppSessionManager::instance().closeExpiredSessions();
            });
        })
        .run();
    return 0;
}
