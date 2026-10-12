#include <drogon/drogon.h>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include "models/Database.h"
#include "managers/SessionManager.h"
#include "utils/Uploads.h"
#ifdef VICINITY_HAVE_CURL
#include <curl/curl.h>
#endif

// Переменные окружения поверх custom_config из config.json (Docker: deploy/env.example → .env).
// Незаданная или пустая переменная оставляет значение из файла; списки — через запятую.
static void applyEnvOverrides(Json::Value& config) {
    const auto env = [](const char* name) {
        const char* value = std::getenv(name);
        return std::string(value ? value : "");
    };
    const auto list = [](const std::string& text) {
        Json::Value out(Json::arrayValue);
        std::istringstream in(text);
        std::string item;
        while (std::getline(in, item, ',')) {
            const auto first = item.find_first_not_of(" \t");
            if (first == std::string::npos) continue;
            out.append(item.substr(first, item.find_last_not_of(" \t") - first + 1));
        }
        return out;
    };
    Json::Value& custom = config["custom_config"];
    if (const auto v = env("VICINITY_TURN_SECRET"); !v.empty())     custom["rtc"]["turn_secret"] = v;
    if (const auto v = env("VICINITY_TURN_URLS"); !v.empty())       custom["rtc"]["turn"] = list(v);
    if (const auto v = env("VICINITY_STUN_URLS"); !v.empty())       custom["rtc"]["stun"] = list(v);
    if (const auto v = env("VICINITY_TRUSTED_PROXIES"); !v.empty()) custom["trusted_proxies"] = list(v);

    // Регистрация и почта (deploy/env.example, раздел «Регистрация»)
    if (const auto v = env("VICINITY_REGISTRATION"); !v.empty())    custom["registration"]["mode"] = v;
    if (const auto v = env("VICINITY_SIGNUPS_PER_IP"); !v.empty())  custom["registration"]["signups_per_ip_per_day"] = v;
    if (const auto v = env("VICINITY_SITE_URL"); !v.empty())        custom["registration"]["site_url"] = v;
    if (const auto v = env("VICINITY_SMTP_HOST"); !v.empty())       custom["smtp"]["host"] = v;
    if (const auto v = env("VICINITY_SMTP_PORT"); !v.empty())       custom["smtp"]["port"] = v;
    if (const auto v = env("VICINITY_SMTP_USER"); !v.empty())       custom["smtp"]["user"] = v;
    if (const auto v = env("VICINITY_SMTP_PASSWORD"); !v.empty())   custom["smtp"]["password"] = v;
    if (const auto v = env("VICINITY_SMTP_FROM"); !v.empty())       custom["smtp"]["from"] = v;
    if (const auto v = env("VICINITY_SMTP_SECURITY"); !v.empty())   custom["smtp"]["security"] = v;
}

int main() {
    Json::Value config;
    {
        std::ifstream file("config.json");
        Json::CharReaderBuilder reader;
        reader["collectComments"] = false;
        std::string errors;
        if (!file) {
            std::cerr << "Config file config.json not found!" << std::endl;
            return 1;
        }
        if (!Json::parseFromStream(reader, file, &config, &errors)) {
            std::cerr << "Error reading config file config.json: " << errors << std::endl;
            return 1;
        }
    }
    applyEnvOverrides(config);
#ifdef VICINITY_HAVE_CURL
    // До запуска потоков: письма отправляются из фоновых потоков (utils/Mailer.cc)
    curl_global_init(CURL_GLOBAL_DEFAULT);
#endif

    drogon::app()
        .loadConfigJson(std::move(config))
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
        // Загрузки отдаются как есть, без угадывания типа браузером; произвольные файлы-вложения
        // только скачиваются, а не открываются как страница, и под исходным именем (docs/API.md §2;
        // nginx пропускает этот Content-Disposition как есть)
        .registerPreSendingAdvice([](const drogon::HttpRequestPtr& req, const drogon::HttpResponsePtr& resp) {
            const std::string& path = req->path();
            if (path.rfind("/uploads/", 0) != 0) return;
            resp->addHeader("X-Content-Type-Options", "nosniff");
            if (path.rfind("/uploads/files/", 0) != 0) return;
            const auto code = resp->statusCode();
            const bool found = code == drogon::k200OK || code == drogon::k206PartialContent ||
                               code == drogon::k304NotModified;
            resp->addHeader("Content-Disposition",
                            Uploads::contentDisposition(found ? Uploads::downloadName(path) : std::string()));
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
