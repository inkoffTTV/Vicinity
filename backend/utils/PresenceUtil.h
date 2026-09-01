#pragma once
#include <drogon/drogon.h>
#include "../managers/WSManager.h"
#include <string>

// Эффективное присутствие: оффлайн, если нет WS-подключения или выбран "невидимка".
inline std::string effectivePresence(int64_t uid) {
    if (!WSManager::instance().isOnline(uid)) return "offline";
    try {
        auto db = drogon::app().getDbClient();
        auto r = db->execSqlSync("SELECT presence FROM users WHERE id = ?", uid);
        std::string p = r.empty() ? std::string("online") : r[0]["presence"].as<std::string>();
        return p == "invisible" ? std::string("offline") : p;
    } catch (...) { return "online"; }
}

// Статус дружбы между self и other: none | pending_out | pending_in | friends
inline std::string friendshipStatus(int64_t self, int64_t other) {
    try {
        auto db = drogon::app().getDbClient();
        auto r = db->execSqlSync(
            "SELECT requester_id, status FROM friendships "
            "WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) LIMIT 1",
            self, other, other, self);
        if (r.empty()) return "none";
        std::string st = r[0]["status"].as<std::string>();
        if (st == "accepted") return "friends";
        if (st == "declined") return "none";   // отклонённую заявку можно отправить заново
        return r[0]["requester_id"].as<int64_t>() == self ? "pending_out" : "pending_in";
    } catch (...) { return "none"; }
}
