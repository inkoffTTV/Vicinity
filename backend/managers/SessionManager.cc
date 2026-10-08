#include "SessionManager.h"
#include "WSManager.h"
#include "../utils/CryptoUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>

AppSessionManager& AppSessionManager::instance() {
    static AppSessionManager inst;
    return inst;
}

std::string AppSessionManager::createSession(int64_t userId) {
    std::string token = CryptoUtils::generateToken();
    // В БД храним ТОЛЬКО хэш токена — утечка базы не даст угнать сессии.
    std::string tokenHash = CryptoUtils::sha256Hex(token);
    auto db = drogon::app().getDbClient();
    db->execSqlSync(
        "INSERT INTO sessions(token, user_id, expires_at) "
        "VALUES(?, ?, datetime('now', '+' || ? || ' hours'))",
        tokenHash, userId, Vicinity::SESSION_EXPIRE_HOURS);
    return token;   // клиенту отдаём сырой токен
}

std::optional<SessionInfo> AppSessionManager::validate(const std::string& token) {
    auto db = drogon::app().getDbClient();
    try {
        std::string tokenHash = CryptoUtils::sha256Hex(token);
        auto res = db->execSqlSync(
            "SELECT token, user_id, expires_at FROM sessions "
            "WHERE token = ? AND expires_at > datetime('now')",
            tokenHash);
        if (res.empty()) return std::nullopt;
        SessionInfo info;
        info.token     = token;   // наружу — сырой токен (как пришёл в заголовке)
        info.userId    = res[0]["user_id"].as<int64_t>();
        info.expiresAt = res[0]["expires_at"].as<std::string>();
        return info;
    } catch (...) { return std::nullopt; }
}

void AppSessionManager::deleteSession(const std::string& token) {
    deleteByHash(CryptoUtils::sha256Hex(token));
}

void AppSessionManager::deleteByHash(const std::string& tokenHash) {
    auto db = drogon::app().getDbClient();
    try {
        db->execSqlSync("DELETE FROM sessions WHERE token = ?", tokenHash);
    } catch (const std::exception& e) {
        LOG_WARN << "deleteSession: " << e.what();
    }
    // Иначе уже открытый сокет продолжал бы получать события после выхода
    WSManager::instance().closeSession(tokenHash);
}

// id сессии для клиента: производный от хэша токена, по нему нельзя ни войти, ни найти строку в БД
static std::string publicId(const std::string& tokenHash) {
    return CryptoUtils::sha256Hex("session-id:" + tokenHash).substr(0, 16);
}

std::vector<SessionRecord> AppSessionManager::listSessions(int64_t userId, const std::string& currentToken) {
    const std::string currentHash = CryptoUtils::sha256Hex(currentToken);
    auto rows = drogon::app().getDbClient()->execSqlSync(
        "SELECT token, created_at, expires_at FROM sessions "
        "WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC, rowid DESC",
        userId);
    std::vector<SessionRecord> out;
    for (const auto& r : rows) {
        const std::string hash = r["token"].as<std::string>();
        out.push_back(SessionRecord{publicId(hash), r["created_at"].as<std::string>(),
                                    r["expires_at"].as<std::string>(), hash == currentHash});
    }
    return out;
}

int AppSessionManager::deleteOtherSessions(int64_t userId, const std::string& currentToken) {
    const std::string currentHash = CryptoUtils::sha256Hex(currentToken);
    auto rows = drogon::app().getDbClient()->execSqlSync(
        "DELETE FROM sessions WHERE user_id = ? AND token != ? RETURNING token", userId, currentHash);
    for (const auto& r : rows) WSManager::instance().closeSession(r["token"].as<std::string>());
    return static_cast<int>(rows.size());
}

bool AppSessionManager::deleteSessionById(int64_t userId, const std::string& id) {
    auto rows = drogon::app().getDbClient()->execSqlSync(
        "SELECT token FROM sessions WHERE user_id = ?", userId);
    for (const auto& r : rows) {
        const std::string hash = r["token"].as<std::string>();
        if (publicId(hash) != id) continue;
        deleteByHash(hash);
        return true;
    }
    return false;
}

void AppSessionManager::closeExpiredSessions() {
    auto db = drogon::app().getDbClient();
    try {
        db->execSqlSync("DELETE FROM sessions WHERE expires_at <= datetime('now')");
        for (const auto& hash : WSManager::instance().sessionHashes()) {
            auto r = db->execSqlSync("SELECT 1 FROM sessions WHERE token = ?", hash);
            if (r.empty()) WSManager::instance().closeSession(hash);
        }
    } catch (const std::exception& e) {
        LOG_WARN << "closeExpiredSessions: " << e.what();
    }
}
