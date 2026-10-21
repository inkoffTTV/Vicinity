#include "MusicController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include <chrono>
#include <map>
#include <mutex>
#include <thread>
#ifdef VICINITY_HAVE_CURL
#include <curl/curl.h>
#endif

using HttpUtils::error;

namespace {

#ifdef VICINITY_HAVE_CURL
size_t collect(char* ptr, size_t size, size_t nmemb, void* userdata) {
    static_cast<std::string*>(userdata)->append(ptr, size * nmemb);
    return size * nmemb;
}

bool httpGet(const std::string& url, std::string& body) {
    CURL* curl = curl_easy_init();
    if (!curl) return false;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, collect);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 8L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 3L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Vicinity/1.0");
    const CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_easy_cleanup(curl);
    return res == CURLE_OK && code == 200;
}

std::string urlEncode(const std::string& s) {
    CURL* curl = curl_easy_init();
    if (!curl) return "";
    char* out = curl_easy_escape(curl, s.c_str(), static_cast<int>(s.size()));
    std::string r = out ? out : "";
    curl_free(out);
    curl_easy_cleanup(curl);
    return r;
}
#endif

// Ответ каталога по запросу живёт 10 минут: один и тот же трек ищут много раз, а каталог просит не частить
struct Cached { Json::Value tracks; std::chrono::steady_clock::time_point at; };
std::mutex gCacheMutex;
std::map<std::string, Cached> gCache;
constexpr auto kCacheTtl = std::chrono::minutes(10);

Json::Value simplify(const Json::Value& itunes) {
    Json::Value tracks(Json::arrayValue);
    for (const auto& r : itunes["results"]) {
        if (!r.isObject() || !r["trackId"].isIntegral() || !r["trackName"].isString()) continue;
        Json::Value t;
        t["id"]      = static_cast<Json::Int64>(r["trackId"].asInt64());
        t["title"]   = r["trackName"].asString().substr(0, 120);
        t["artist"]  = r["artistName"].isString() ? r["artistName"].asString().substr(0, 120) : "";
        t["album"]   = r["collectionName"].isString() ? r["collectionName"].asString().substr(0, 120) : "";
        t["artwork"] = r["artworkUrl100"].isString() ? r["artworkUrl100"].asString() : "";
        t["preview"] = r["previewUrl"].isString() ? r["previewUrl"].asString() : "";
        t["url"]     = r["trackViewUrl"].isString() ? r["trackViewUrl"].asString() : "";
        tracks.append(t);
    }
    return tracks;
}

} // namespace

// GET /api/v1/music/search?q=… → {tracks: [{id, title, artist, album, artwork, preview, url}]}
void MusicController::search(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    std::string q = req->getParameter("q");
    while (!q.empty() && q.back() == ' ') q.pop_back();
    while (!q.empty() && q.front() == ' ') q.erase(q.begin());
    if (q.size() < 2) { cb(error("Введите хотя бы два символа", k400BadRequest)); return; }
    if (q.size() > 80) q.resize(80);
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, userId)) {
        cb(error("Слишком много запросов, подождите", k429TooManyRequests)); return;
    }
    {
        std::lock_guard<std::mutex> lock(gCacheMutex);
        auto it = gCache.find(q);
        if (it != gCache.end() && std::chrono::steady_clock::now() - it->second.at < kCacheTtl) {
            Json::Value resp; resp["tracks"] = it->second.tracks;
            cb(HttpUtils::json(std::move(resp))); return;
        }
    }
#ifndef VICINITY_HAVE_CURL
    cb(error("Поиск музыки недоступен: сервер собран без libcurl", k503ServiceUnavailable));
#else
    // Запрос к каталогу — в отдельном потоке, чтобы не держать IO-поток сервера
    std::thread([q, cb = std::move(cb)]() mutable {
        std::string body;
        const std::string url = "https://itunes.apple.com/search?entity=song&limit=8&country=RU&term=" + urlEncode(q);
        Json::Value parsed;
        if (!httpGet(url, body) || !JsonUtils::parse(body, parsed) || !parsed.isObject()) {
            cb(error("Каталог музыки не отвечает, попробуйте позже", k502BadGateway)); return;
        }
        Json::Value tracks = simplify(parsed);
        {
            std::lock_guard<std::mutex> lock(gCacheMutex);
            if (gCache.size() > 500) gCache.clear();
            gCache[q] = { tracks, std::chrono::steady_clock::now() };
        }
        Json::Value resp; resp["tracks"] = tracks;
        cb(HttpUtils::json(std::move(resp)));
    }).detach();
#endif
}
