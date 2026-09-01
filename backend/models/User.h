#pragma once
#include <string>
#include <cstdint>
#include <optional>

struct User {
    int64_t     id           = 0;
    std::string username;
    std::string passwordHash;
    std::string displayName;
    std::string bio;
    std::string accentColor;
    std::string avatarPath;
    std::string bannerPath;
    std::string createdAt;
    std::string profileJson;
    std::string pronouns;
    std::string presence = "online";
    int         subscriptionTier = 0;
    int         developer        = 0;
};

namespace UserModel {
    std::optional<User> findByUsername(const std::string& username);
    std::optional<User> findById(int64_t id);
    int64_t create(const std::string& username,
                   const std::string& passwordHash,
                   const std::string& displayName);
    bool updateDisplayName(int64_t id, const std::string& displayName);
    bool updatePath(int64_t id, const std::string& column, const std::string& path);
}
