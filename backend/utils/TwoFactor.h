#pragma once
#include <cstdint>
#include <string>
#include <vector>

// Двухфакторная аутентификация аккаунта (users.totp_secret, users.totp_backup) — для входа и настроек
namespace TwoFactor {
    bool enabled(int64_t userId);
    // Код из приложения (TOTP) или резервный код; резервный после использования сгорает
    bool check(int64_t userId, const std::string& code);
    // sha256 резервных кодов для хранения (сами коды показываются пользователю один раз)
    std::string hashBackupCodes(const std::vector<std::string>& codes);

    // Вход с 2FA: пароль верен → билет на 5 минут, по нему вводят код (5 попыток)
    std::string issueTicket(int64_t userId);
    // id пользователя по билету или 0 (билета нет или он истёк)
    int64_t ticketUser(const std::string& ticket);
    // Неверный код по билету; false — попытки кончились, билет сгорел
    bool ticketFailed(const std::string& ticket);
    void dropTicket(const std::string& ticket);
}
