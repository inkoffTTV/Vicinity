#pragma once
#include <string>
#include <cstdint>
#include <optional>

struct SessionInfo {
    std::string token;
    int64_t     userId;
    std::string expiresAt;
};

class AppSessionManager {
public:
    static AppSessionManager& instance();

    std::string createSession(int64_t userId);
    std::optional<SessionInfo> validate(const std::string& token);
    void deleteSession(const std::string& token);

private:
    AppSessionManager() = default;
};
