#pragma once
#include <cstdint>
#include <string>
#include <vector>

// Одноразовые коды двухфакторной аутентификации (TOTP, RFC 6238: HMAC-SHA1, шаг 30 с, 6 цифр) —
// совместимо с Google Authenticator, Яндекс Ключом, Aegis и т. п.
namespace Totp {
    // Новый секрет: 20 случайных байт в base32 (32 символа без '=')
    std::string newSecret();
    // otpauth://totp/Vicinity:<account>?secret=…&issuer=Vicinity — содержимое QR-кода
    std::string uri(const std::string& secret, const std::string& account);
    // Код верен для текущего шага ±1 (расхождение часов до 30 с)
    bool verify(const std::string& secret, const std::string& code);
    // Резервные коды: count штук вида xxxx-xxxx (буквы и цифры без похожих)
    std::vector<std::string> backupCodes(int count = 10);
}
