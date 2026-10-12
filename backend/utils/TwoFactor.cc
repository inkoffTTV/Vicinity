#include "TwoFactor.h"
#include "CryptoUtils.h"
#include "JsonUtils.h"
#include "Totp.h"
#include <drogon/drogon.h>
#include <cctype>
#include <chrono>
#include <mutex>
#include <unordered_map>

namespace TwoFactor {

static std::string normalizeBackup(const std::string& code) {
    std::string out;
    for (char c : code) {
        if (c == '-' || c == ' ') continue;
        out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return out;
}

bool enabled(int64_t userId) {
    try {
        auto r = drogon::app().getDbClient()->execSqlSync("SELECT totp_secret FROM users WHERE id = ?", userId);
        return !r.empty() && !r[0]["totp_secret"].isNull() && !r[0]["totp_secret"].as<std::string>().empty();
    } catch (...) { return false; }
}

std::string hashBackupCodes(const std::vector<std::string>& codes) {
    Json::Value arr(Json::arrayValue);
    for (const auto& c : codes) arr.append(CryptoUtils::sha256Hex("backup:" + normalizeBackup(c)));
    Json::StreamWriterBuilder w;
    w["indentation"] = "";
    return Json::writeString(w, arr);
}

bool check(int64_t userId, const std::string& code) {
    auto db = drogon::app().getDbClient();
    auto r = db->execSqlSync("SELECT totp_secret, totp_backup FROM users WHERE id = ?", userId);
    if (r.empty() || r[0]["totp_secret"].isNull()) return false;
    if (Totp::verify(r[0]["totp_secret"].as<std::string>(), code)) return true;
    // Резервный код: 8 букв/цифр, после входа удаляется из списка
    const std::string norm = normalizeBackup(code);
    if (norm.size() != 8 || r[0]["totp_backup"].isNull()) return false;
    Json::Value list;
    if (!JsonUtils::parse(r[0]["totp_backup"].as<std::string>(), list) || !list.isArray()) return false;
    const std::string hash = CryptoUtils::sha256Hex("backup:" + norm);
    Json::Value rest(Json::arrayValue);
    bool found = false;
    for (const auto& h : list) {
        if (!found && h.isString() && CryptoUtils::constTimeEquals(h.asString(), hash)) { found = true; continue; }
        rest.append(h);
    }
    if (!found) return false;
    Json::StreamWriterBuilder w;
    w["indentation"] = "";
    std::string text = Json::writeString(w, rest);
    db->execSqlSync("UPDATE users SET totp_backup = ? WHERE id = ?", text, userId);
    return true;
}

struct Ticket {
    int64_t userId = 0;
    int attempts = 0;
    std::chrono::steady_clock::time_point expires;
};
static std::mutex ticketMutex;
static std::unordered_map<std::string, Ticket> tickets;

std::string issueTicket(int64_t userId) {
    std::lock_guard<std::mutex> lock(ticketMutex);
    const auto now = std::chrono::steady_clock::now();
    for (auto it = tickets.begin(); it != tickets.end();) it = it->second.expires < now ? tickets.erase(it) : std::next(it);
    std::string id = CryptoUtils::randomHex(16);
    tickets[id] = Ticket{userId, 0, now + std::chrono::minutes(5)};
    return id;
}

int64_t ticketUser(const std::string& ticket) {
    std::lock_guard<std::mutex> lock(ticketMutex);
    auto it = tickets.find(ticket);
    if (it == tickets.end() || it->second.expires < std::chrono::steady_clock::now()) return 0;
    return it->second.userId;
}

bool ticketFailed(const std::string& ticket) {
    std::lock_guard<std::mutex> lock(ticketMutex);
    auto it = tickets.find(ticket);
    if (it == tickets.end()) return false;
    if (++it->second.attempts >= 5) { tickets.erase(it); return false; }
    return true;
}

void dropTicket(const std::string& ticket) {
    std::lock_guard<std::mutex> lock(ticketMutex);
    tickets.erase(ticket);
}

} // namespace TwoFactor
