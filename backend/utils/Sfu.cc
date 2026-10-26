#include "Sfu.h"
#include "CryptoUtils.h"
#include "JsonUtils.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <ctime>

namespace {

struct Config {
    std::string url;
    std::string key;
    std::string secret;
};

const Config& config() {
    static const Config c = [] {
        Config r;
        const Json::Value& cfg = drogon::app().getCustomConfig()["sfu"];
        if (cfg.isObject()) {
            r.url    = cfg.get("url", "").asString();
            r.key    = cfg.get("key", "").asString();
            r.secret = cfg.get("secret", "").asString();
        }
        if (r.url.empty()) r.url = "/livekit";
        while (r.url.size() > 1 && r.url.back() == '/') r.url.pop_back();
        if (!r.key.empty() && r.secret.size() < 32) {
            LOG_WARN << "sfu.secret короче 32 символов — LiveKit такой ключ не примет; голос через SFU выключен";
            r.key.clear();
        }
        LOG_INFO << "Голос через SFU: " << (r.key.empty() ? "не настроен (PCM через WebSocket)" : "LiveKit " + r.url);
        return r;
    }();
    return c;
}

// base64url без дополнения (RFC 7515)
std::string base64Url(const std::string& bytes) {
    static const char* const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    size_t i = 0;
    while (i + 2 < bytes.size()) {
        const uint32_t n = (static_cast<unsigned char>(bytes[i]) << 16) |
                           (static_cast<unsigned char>(bytes[i + 1]) << 8) | static_cast<unsigned char>(bytes[i + 2]);
        out += abc[(n >> 18) & 63]; out += abc[(n >> 12) & 63]; out += abc[(n >> 6) & 63]; out += abc[n & 63];
        i += 3;
    }
    if (i + 1 == bytes.size()) {
        const uint32_t n = static_cast<unsigned char>(bytes[i]) << 16;
        out += abc[(n >> 18) & 63]; out += abc[(n >> 12) & 63];
    } else if (i + 2 == bytes.size()) {
        const uint32_t n = (static_cast<unsigned char>(bytes[i]) << 16) | (static_cast<unsigned char>(bytes[i + 1]) << 8);
        out += abc[(n >> 18) & 63]; out += abc[(n >> 12) & 63]; out += abc[(n >> 6) & 63];
    }
    return out;
}

std::string hexToBytes(const std::string& hex) {
    std::string out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i + 1 < hex.size(); i += 2)
        out += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
    return out;
}

} // namespace

namespace Sfu {

bool configured() { return !config().key.empty(); }

std::string url() { return config().url; }

std::string roomFor(int64_t channelId) { return "voice-" + std::to_string(channelId); }

std::string token(int64_t userId, const std::string& displayName, const std::string& room, int64_t ttlSec) {
    const auto& c = config();
    const int64_t now = static_cast<int64_t>(std::time(nullptr));

    Json::Value header;
    header["alg"] = "HS256";
    header["typ"] = "JWT";

    Json::Value grant;
    grant["roomJoin"]             = true;
    grant["room"]                 = room;
    grant["canPublish"]           = true;
    grant["canSubscribe"]         = true;
    grant["canPublishData"]       = false;
    grant["canUpdateOwnMetadata"] = false;

    Json::Value payload;
    payload["iss"]   = c.key;
    payload["sub"]   = "u" + std::to_string(userId);
    payload["name"]  = displayName;
    payload["iat"]   = static_cast<Json::Int64>(now);
    payload["nbf"]   = static_cast<Json::Int64>(now - 10);
    payload["exp"]   = static_cast<Json::Int64>(now + ttlSec);
    payload["video"] = grant;

    const std::string signing = base64Url(JsonUtils::write(header)) + "." + base64Url(JsonUtils::write(payload));
    const std::string sig = base64Url(hexToBytes(CryptoUtils::hmacSha256Hex(c.secret, signing)));
    return signing + "." + sig;
}

} // namespace Sfu
