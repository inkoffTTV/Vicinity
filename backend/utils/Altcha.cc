#include "Altcha.h"
#include "CryptoUtils.h"
#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <chrono>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace Altcha {

static constexpr int64_t ALTCHA_TTL_SEC = 10 * 60;
// В среднем maxnumber/2 хэшей: ~0,2 с в браузере компьютера, 1–2 с на телефоне
static constexpr int64_t DEFAULT_MAX_NUMBER = 300000;

static int64_t nowSec() {
    return std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

// Ключ подписи — случайный на каждый запуск: перезапуск сервера просто делает старые задачи недействительными
static const std::string& hmacKey() {
    static const std::string key = CryptoUtils::randomHex(32);
    return key;
}

static int64_t maxNumber() {
    static const int64_t value = [] {
        const Json::Value& cfg = drogon::app().getCustomConfig()["registration"]["altcha_max_number"];
        const int64_t v = cfg.isIntegral() ? cfg.asInt64() : DEFAULT_MAX_NUMBER;
        return v >= 1000 && v <= 10000000 ? v : DEFAULT_MAX_NUMBER;
    }();
    return value;
}

// Использованные решения (challenge → когда истекает) — одно решение нельзя предъявить дважды
static std::mutex usedMutex;
static std::unordered_map<std::string, int64_t> used;

Json::Value createChallenge() {
    const int64_t expires = nowSec() + ALTCHA_TTL_SEC;
    const std::string salt = CryptoUtils::randomHex(12) + "?expires=" + std::to_string(expires);
    const uint64_t number = CryptoUtils::randomBelow(static_cast<uint64_t>(maxNumber()) + 1);
    const std::string challenge = CryptoUtils::sha256Hex(salt + std::to_string(number));

    Json::Value out;
    out["algorithm"] = "SHA-256";
    out["challenge"] = challenge;
    out["maxnumber"] = static_cast<Json::Int64>(maxNumber());
    out["salt"]      = salt;
    out["signature"] = CryptoUtils::hmacSha256Hex(hmacKey(), challenge);
    return out;
}

// expires=<unix-время> из параметров соли ("<hex>?expires=...")
static int64_t saltExpires(const std::string& salt) {
    const auto q = salt.find('?');
    if (q == std::string::npos) return 0;
    const std::string params = salt.substr(q + 1);
    const std::string key = "expires=";
    const auto p = params.find(key);
    if (p == std::string::npos || (p != 0 && params[p - 1] != '&')) return 0;
    const std::string value = params.substr(p + key.size(), params.find('&', p) - p - key.size());
    if (value.empty() || value.size() > 12 || value.find_first_not_of("0123456789") != std::string::npos)
        return 0;
    return std::stoll(value);
}

bool verify(const std::string& payload) {
    if (payload.empty() || payload.size() > 4096) return false;
    Json::Value v;
    {
        const std::string json = drogon::utils::base64Decode(payload);
        Json::CharReaderBuilder builder;
        std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
        std::string errors;
        if (!reader->parse(json.data(), json.data() + json.size(), &v, &errors) || !v.isObject())
            return false;
    }
    if (!v["algorithm"].isString() || v["algorithm"].asString() != "SHA-256") return false;
    if (!v["challenge"].isString() || !v["salt"].isString() || !v["signature"].isString()) return false;
    if (!v["number"].isIntegral() || v["number"].asInt64() < 0) return false;

    const std::string challenge = v["challenge"].asString();
    const std::string salt      = v["salt"].asString();
    const int64_t     number    = v["number"].asInt64();
    const int64_t     now       = nowSec();
    const int64_t     expires   = saltExpires(salt);
    if (expires <= now || expires > now + ALTCHA_TTL_SEC) return false;

    // Подпись — наша (задачу выдал этот сервер), и число действительно решает задачу
    if (!CryptoUtils::constTimeEquals(CryptoUtils::hmacSha256Hex(hmacKey(), challenge), v["signature"].asString()))
        return false;
    if (CryptoUtils::sha256Hex(salt + std::to_string(number)) != challenge) return false;

    std::lock_guard<std::mutex> lock(usedMutex);
    for (auto it = used.begin(); it != used.end();)
        it = it->second <= now ? used.erase(it) : std::next(it);
    return used.emplace(challenge, expires).second;
}

} // namespace Altcha
