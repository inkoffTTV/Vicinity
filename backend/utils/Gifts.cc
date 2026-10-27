#include "Gifts.h"
#include "Broadcast.h"
#include "CryptoUtils.h"
#include "Tiers.h"
#include <drogon/drogon.h>
#include <cctype>

using namespace drogon;

namespace {
// Без похожих символов (0/O, 1/I/L)
const char* const kAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

std::string generate() {
    std::string out;
    for (int i = 0; i < 12; ++i) out += kAlphabet[CryptoUtils::randomBelow(31)];
    return out;
}

const char* tierName(int tier) {
    static const char* names[] = {"Бесплатно", "Basic", "Standard", "Ultra"};
    return names[Tiers::clamp(tier)];
}

std::string pretty(const std::string& code) { return code.substr(0, 4) + "-" + code.substr(4, 4) + "-" + code.substr(8, 4); }
} // namespace

namespace Gifts {

std::string normalize(const std::string& raw) {
    std::string out;
    for (const char c : raw) {
        if (c == '-' || c == ' ') continue;
        out += static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    }
    if (out.size() != 12) return "";
    for (const char c : out) if (!std::isalnum(static_cast<unsigned char>(c))) return "";
    return out;
}

Json::Value create(int64_t adminId, int tier, int days, int count, const std::string& note) {
    Json::Value list(Json::arrayValue);
    auto db = app().getDbClient();
    for (int i = 0; i < count; ++i) {
        const std::string code = generate();
        db->execSqlSync("INSERT INTO gift_codes(code, tier, days, note, created_by) VALUES(?, ?, ?, ?, ?)", code, tier, days, note, adminId);
        Json::Value g;
        g["code"] = pretty(code); g["tier"] = tier; g["days"] = days;
        list.append(g);
    }
    return list;
}

Json::Value list() {
    Json::Value out(Json::arrayValue);
    auto rows = app().getDbClient()->execSqlSync(
        "SELECT g.code, g.tier, g.days, g.note, g.created_at, g.redeemed_by, g.redeemed_at, u.username AS redeemed_name "
        "FROM gift_codes g LEFT JOIN users u ON u.id = g.redeemed_by ORDER BY g.created_at DESC LIMIT 200");
    for (const auto& r : rows) {
        Json::Value g;
        g["code"]        = pretty(r["code"].as<std::string>());
        g["tier"]        = r["tier"].as<int>();
        g["days"]        = r["days"].as<int>();
        g["note"]        = r["note"].isNull() ? "" : r["note"].as<std::string>();
        g["created_at"]  = r["created_at"].isNull() ? "" : r["created_at"].as<std::string>();
        g["redeemed_by"] = r["redeemed_by"].isNull() ? 0 : r["redeemed_by"].as<int64_t>();
        g["redeemed_by_name"] = r["redeemed_name"].isNull() ? "" : r["redeemed_name"].as<std::string>();
        g["redeemed_at"] = r["redeemed_at"].isNull() ? "" : r["redeemed_at"].as<std::string>();
        out.append(g);
    }
    return out;
}

bool info(const std::string& raw, Json::Value& out) {
    const std::string code = normalize(raw);
    if (code.empty()) return false;
    auto r = app().getDbClient()->execSqlSync("SELECT tier, days, redeemed_by FROM gift_codes WHERE code = ?", code);
    if (r.empty()) return false;
    out["code"]     = pretty(code);
    out["tier"]     = r[0]["tier"].as<int>();
    out["name"]     = tierName(r[0]["tier"].as<int>());
    out["days"]     = r[0]["days"].as<int>();
    out["redeemed"] = !r[0]["redeemed_by"].isNull();
    return true;
}

bool redeem(int64_t userId, const std::string& raw, Json::Value& out, std::string& error, int& status) {
    const std::string code = normalize(raw);
    if (code.empty()) { error = "Код выглядит иначе: 12 букв и цифр, например VIC2-ABCD-EFGH"; status = 400; return false; }
    auto db = app().getDbClient();
    auto r = db->execSqlSync("SELECT tier, days, redeemed_by FROM gift_codes WHERE code = ?", code);
    if (r.empty()) { error = "Такого кода нет"; status = 404; return false; }
    if (!r[0]["redeemed_by"].isNull()) { error = "Этот код уже активирован"; status = 409; return false; }
    const int tier = Tiers::clamp(r[0]["tier"].as<int>());
    const int days = r[0]["days"].as<int>();
    auto u = db->execSqlSync("SELECT subscription_tier, subscription_until FROM users WHERE id = ?", userId);
    if (u.empty()) { error = "Пользователь не найден"; status = 404; return false; }
    const int cur = u[0]["subscription_tier"].as<int>();
    const bool hasUntil = !u[0]["subscription_until"].isNull();
    if (cur > tier) { error = "У вас уже подписка выше — " + std::string(tierName(cur)); status = 409; return false; }
    if (cur == tier && !hasUntil && cur > 0) { error = "У вас уже бессрочная подписка " + std::string(tierName(cur)); status = 409; return false; }
    // Тот же уровень с датой окончания — продлеваем от неё (если она в будущем), иначе от сегодня
    const bool extend = cur == tier && hasUntil;
    const std::string shift = "+" + std::to_string(days) + " days";
    // Сначала занимаем код одним условным UPDATE: два одновременных запроса не активируют его дважды
    auto taken = db->execSqlSync("UPDATE gift_codes SET redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code = ? AND redeemed_by IS NULL RETURNING code", userId, code);
    if (taken.empty()) { error = "Этот код уже активирован"; status = 409; return false; }
    if (extend)
        db->execSqlSync("UPDATE users SET subscription_until = datetime(MAX(subscription_until, CURRENT_TIMESTAMP), ?) WHERE id = ?", shift, userId);
    else
        db->execSqlSync("UPDATE users SET subscription_tier = ?, subscription_until = datetime(CURRENT_TIMESTAMP, ?) WHERE id = ?", tier, shift, userId);
    auto after = db->execSqlSync("SELECT subscription_tier, subscription_until FROM users WHERE id = ?", userId);
    out["tier"]  = after[0]["subscription_tier"].as<int>();
    out["name"]  = tierName(out["tier"].asInt());
    out["until"] = after[0]["subscription_until"].isNull() ? "" : after[0]["subscription_until"].as<std::string>();
    out["days"]  = days;
    Broadcast::userUpdated(userId);
    return true;
}

void expire() {
    try {
        auto db = app().getDbClient();
        auto rows = db->execSqlSync("SELECT id FROM users WHERE subscription_until IS NOT NULL AND subscription_until < CURRENT_TIMESTAMP");
        if (rows.empty()) return;
        db->execSqlSync("UPDATE users SET subscription_tier = 0, subscription_until = NULL WHERE subscription_until IS NOT NULL AND subscription_until < CURRENT_TIMESTAMP");
        for (const auto& r : rows) Broadcast::userUpdated(r["id"].as<int64_t>());
    } catch (const std::exception& e) {
        LOG_WARN << "gifts expire: " << e.what();
    }
}

} // namespace Gifts
