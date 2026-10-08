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
    // Удаляет сессию и закрывает открытые с ней WS-подключения
    void deleteSession(const std::string& token);

    // Закрыть WS-подключения истёкших/удалённых сессий и вычистить истёкшие сессии из БД
    // (вызывается по таймеру: токен проверяется только при подключении к /ws)
    void closeExpiredSessions();

private:
    AppSessionManager() = default;
};
