#include "SessionManager.h"
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
    auto db = drogon::app().getDbClient();
    try {
        db->execSqlSync("DELETE FROM sessions WHERE token = ?", CryptoUtils::sha256Hex(token));
    } catch (const std::exception& e) {
        LOG_WARN << "deleteSession: " << e.what();
    }
}
