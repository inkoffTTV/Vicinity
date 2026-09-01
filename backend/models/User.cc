#include "User.h"
#include <drogon/drogon.h>

namespace UserModel {

static User rowToUser(const drogon::orm::Row& row) {
    User u;
    u.id           = row["id"].as<int64_t>();
    u.username     = row["username"].as<std::string>();
    u.passwordHash = row["password_hash"].as<std::string>();
    u.displayName  = row["display_name"].as<std::string>();
    if (!row["avatar_path"].isNull()) u.avatarPath = row["avatar_path"].as<std::string>();
    if (!row["bio"].isNull())          u.bio         = row["bio"].as<std::string>();
    if (!row["accent_color"].isNull()) u.accentColor = row["accent_color"].as<std::string>();
    if (!row["avatar_path"].isNull())  u.avatarPath  = row["avatar_path"].as<std::string>();
    if (!row["banner_path"].isNull())  u.bannerPath  = row["banner_path"].as<std::string>();
    if (!row["profile_json"].isNull()) u.profileJson = row["profile_json"].as<std::string>();
    if (!row["pronouns"].isNull())     u.pronouns    = row["pronouns"].as<std::string>();
    if (!row["presence"].isNull())     u.presence    = row["presence"].as<std::string>();
    u.createdAt        = row["created_at"].as<std::string>();
    u.subscriptionTier = row["subscription_tier"].as<int>();
    u.developer        = row["developer"].as<int>();
    return u;
}

std::optional<User> findByUsername(const std::string& username) {
    auto db = drogon::app().getDbClient();
    try {
        auto result = db->execSqlSync("SELECT * FROM users WHERE username = ?", username);
        if (result.empty()) return std::nullopt;
        return rowToUser(result[0]);
    } catch (...) { return std::nullopt; }
}

std::optional<User> findById(int64_t id) {
    auto db = drogon::app().getDbClient();
    try {
        auto result = db->execSqlSync("SELECT * FROM users WHERE id = ?", id);
        if (result.empty()) return std::nullopt;
        return rowToUser(result[0]);
    } catch (...) { return std::nullopt; }
}

int64_t create(const std::string& username,
               const std::string& passwordHash,
               const std::string& displayName) {
    auto db = drogon::app().getDbClient();
    db->execSqlSync(
        "INSERT INTO users(username, password_hash, display_name) VALUES(?, ?, ?)",
        username, passwordHash, displayName);
    auto res = db->execSqlSync("SELECT last_insert_rowid() AS id");
    return res[0]["id"].as<int64_t>();
}

bool updateDisplayName(int64_t id, const std::string& displayName) {
    auto db = drogon::app().getDbClient();
    try {
        db->execSqlSync("UPDATE users SET display_name = ? WHERE id = ?", displayName, id);
        return true;
    } catch (...) { return false; }
}

bool updatePath(int64_t id, const std::string& column, const std::string& path) {
    auto db = drogon::app().getDbClient();
    try {
        // column is controlled internally — no user input reaches here
        std::string sql = "UPDATE users SET " + column + " = ? WHERE id = ?";
        db->execSqlSync(sql, path, id);
        return true;
    } catch (...) { return false; }
}

} // namespace UserModel
