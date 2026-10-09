#include "GamesController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include <drogon/HttpClient.h>
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <unordered_set>
#include <unordered_map>

using namespace drogon;
namespace fs = std::filesystem;

static HttpResponsePtr error(const std::string& msg, HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    auto resp = HttpResponse::newHttpJsonResponse(v);
    resp->setStatusCode(code);
    return resp;
}

// Ответы поиска — в памяти на час: одинаковые запросы не ходят в Steam повторно
struct CachedSearch {
    Json::Value                            items;
    std::chrono::steady_clock::time_point  at;
};
static std::mutex searchMutex;
static std::unordered_map<std::string, CachedSearch> searchCache;

// GET /api/v1/games/search?q= → {games:[{appid, name, cover}]} — до 10 игр из магазина Steam
void GamesController::search(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t userId = req->attributes()->get<int64_t>("user_id");
    std::string q = TextUtils::trim(req->getParameter("q"));
    if (!TextUtils::isValidUtf8(q) || TextUtils::hasControlChars(q)) { cb(error("Некорректный запрос", k400BadRequest)); return; }
    q = TextUtils::utf8Truncate(q, 60);
    if (q.size() < 2) {
        Json::Value empty;
        empty["games"] = Json::Value(Json::arrayValue);
        cb(HttpResponse::newHttpJsonResponse(empty));
        return;
    }
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, userId)) {
        cb(error("Слишком часто, подождите немного", k429TooManyRequests)); return;
    }
    {
        std::lock_guard<std::mutex> lock(searchMutex);
        auto it = searchCache.find(q);
        if (it != searchCache.end() && std::chrono::steady_clock::now() - it->second.at < std::chrono::hours(1)) {
            Json::Value resp;
            resp["games"] = it->second.items;
            cb(HttpResponse::newHttpJsonResponse(resp));
            return;
        }
    }

    auto client = HttpClient::newHttpClient("https://store.steampowered.com");
    auto steamReq = HttpRequest::newHttpRequest();
    steamReq->setMethod(Get);
    steamReq->setPath("/api/storesearch/");
    steamReq->setParameter("term", q);
    steamReq->setParameter("l", "russian");
    steamReq->setParameter("cc", "RU");
    // client захвачен в колбэк: иначе он уничтожится раньше ответа
    client->sendRequest(
        steamReq,
        [cb = std::move(cb), client, q](ReqResult result, const HttpResponsePtr& resp) {
            if (result != ReqResult::Ok || !resp || resp->statusCode() != k200OK) {
                cb(error("Каталог игр сейчас недоступен — попробуйте позже", k502BadGateway));
                return;
            }
            Json::Value body;
            if (!JsonUtils::parse(std::string(resp->body()), body) || !body["items"].isArray()) {
                cb(error("Каталог игр ответил непонятно", k502BadGateway));
                return;
            }
            Json::Value games(Json::arrayValue);
            for (const auto& it : body["items"]) {
                if (games.size() >= 10) break;
                if (!it["id"].isIntegral() || !it["name"].isString()) continue;
                if (it["type"].isString() && it["type"].asString() != "app") continue;
                Json::Value g;
                g["appid"] = static_cast<Json::Int64>(it["id"].asInt64());
                g["name"]  = TextUtils::utf8Truncate(it["name"].asString(), 100);
                g["cover"] = "/api/v1/games/" + std::to_string(it["id"].asInt64()) + "/cover";
                games.append(g);
            }
            {
                std::lock_guard<std::mutex> lock(searchMutex);
                if (searchCache.size() > 500) searchCache.clear();
                searchCache[q] = CachedSearch{games, std::chrono::steady_clock::now()};
            }
            Json::Value out;
            out["games"] = games;
            cb(HttpResponse::newHttpJsonResponse(out));
        },
        10.0);
}

static HttpResponsePtr redirectTo(const std::string& url) {
    auto resp = HttpResponse::newRedirectionResponse(url, k302Found);
    resp->addHeader("Cache-Control", "public, max-age=86400");
    return resp;
}

// Обложки, которых у Steam нет, и число идущих скачиваний
static std::mutex missingMutex;
static std::unordered_set<std::string> missingCovers;
static std::atomic<int> downloads{0};

// Обложка: вертикальная library_600x900, а если её нет — горизонтальная header.jpg
static void fetchCover(const std::string& appid, const std::string& file, bool vertical,
                       std::function<void(const HttpResponsePtr&)> cb) {
    auto client = HttpClient::newHttpClient("https://cdn.cloudflare.steamstatic.com");
    auto req = HttpRequest::newHttpRequest();
    req->setMethod(Get);
    req->setPath("/steam/apps/" + appid + (vertical ? "/library_600x900.jpg" : "/header.jpg"));
    client->sendRequest(
        req,
        [client, appid, file, vertical, cb](ReqResult result, const HttpResponsePtr& resp) {
            const bool ok = result == ReqResult::Ok && resp && resp->statusCode() == k200OK;
            const std::string_view body = ok ? resp->body() : std::string_view();
            // Только настоящий JPEG разумного размера
            const bool jpeg = body.size() > 3 && body.size() < 3 * 1024 * 1024 && static_cast<unsigned char>(body[0]) == 0xFF &&
                              static_cast<unsigned char>(body[1]) == 0xD8 && static_cast<unsigned char>(body[2]) == 0xFF;
            if (!jpeg) {
                if (vertical) { fetchCover(appid, file, false, cb); return; }
                {
                    std::lock_guard<std::mutex> lock(missingMutex);
                    if (missingCovers.size() > 5000) missingCovers.clear();
                    missingCovers.insert(appid);
                }
                downloads.fetch_sub(1);
                cb(error("Обложка не найдена", k404NotFound));
                return;
            }
            std::error_code ec;
            fs::create_directories(fs::path(file).parent_path(), ec);
            const std::string tmp = file + ".part";
            {
                std::ofstream out(tmp, std::ios::binary);
                out.write(body.data(), static_cast<std::streamsize>(body.size()));
            }
            fs::rename(tmp, file, ec);
            downloads.fetch_sub(1);
            if (ec) { cb(error("Не удалось сохранить обложку", k500InternalServerError)); return; }
            cb(redirectTo("/uploads/games/" + appid + ".jpg"));
        },
        15.0);
}

// GET /api/v1/games/{appid}/cover → 302 на /uploads/games/<appid>.jpg (скачивается при первом запросе)
void GamesController::cover(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb,
                            const std::string& appid) {
    if (appid.empty() || appid.size() > 9 || appid.find_first_not_of("0123456789") != std::string::npos) {
        cb(error("Некорректная игра", k400BadRequest));
        return;
    }
    const std::string file = (fs::path(app().getUploadPath()) / "games" / (appid + ".jpg")).string();
    std::error_code ec;
    if (fs::exists(file, ec)) { cb(redirectTo("/uploads/games/" + appid + ".jpg")); return; }
    {
        std::lock_guard<std::mutex> lock(missingMutex);
        if (missingCovers.count(appid)) { cb(error("Обложка не найдена", k404NotFound)); return; }
    }
    if (downloads.fetch_add(1) >= 4) {
        downloads.fetch_sub(1);
        auto busy = error("Попробуйте ещё раз через секунду", k503ServiceUnavailable);
        busy->addHeader("Retry-After", "1");
        cb(busy);
        return;
    }
    fetchCover(appid, file, true, std::move(cb));
}
