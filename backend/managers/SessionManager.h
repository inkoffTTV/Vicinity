#pragma once
#include <string>
#include <cstdint>
#include <optional>
#include <vector>

struct SessionInfo {
    std::string token;
    int64_t     userId;
    std::string expiresAt;
};

// Сессия в списке устройств пользователя (docs/API.md §9)
struct SessionRecord {
    std::string id;          // короткий непрозрачный идентификатор (не токен и не его хэш)
    std::string createdAt;
    std::string expiresAt;
    bool        current = false;
};

class AppSessionManager {
public:
    static AppSessionManager& instance();

    std::string createSession(int64_t userId);
    std::optional<SessionInfo> validate(const std::string& token);
    // Удаляет сессию и закрывает открытые с ней WS-подключения
    void deleteSession(const std::string& token);

    // Действующие сессии пользователя, новые первыми; current — сессия с этим токеном
    std::vector<SessionRecord> listSessions(int64_t userId, const std::string& currentToken);
    // Завершить все сессии пользователя, кроме текущей (с закрытием их WS). Возвращает число завершённых.
    int deleteOtherSessions(int64_t userId, const std::string& currentToken);
    // Завершить все сессии пользователя (блокировка аккаунта). Возвращает число завершённых.
    int deleteAllSessions(int64_t userId);
    // Завершить сессию пользователя по её id из listSessions. false — такой нет.
    bool deleteSessionById(int64_t userId, const std::string& id);

    // Закрыть WS-подключения истёкших/удалённых сессий и вычистить истёкшие сессии из БД
    // (вызывается по таймеру: токен проверяется только при подключении к /ws)
    void closeExpiredSessions();

private:
    AppSessionManager() = default;
    // Удалить сессию по хэшу токена и закрыть её WS-подключения
    void deleteByHash(const std::string& tokenHash);
};
