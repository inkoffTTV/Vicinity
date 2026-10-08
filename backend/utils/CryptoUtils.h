#pragma once
#include <cstdint>
#include <string>

namespace CryptoUtils {
    // Хэш пароля медленным KDF (PBKDF2-HMAC-SHA256). Формат: "pbkdf2$<iters>$<salt>$<hash>"
    std::string hashPassword(const std::string& password);
    // Проверяет пароль. Понимает новый формат pbkdf2$..., и старый "salt$hash" (1 раунд SHA-256).
    bool verifyPassword(const std::string& password, const std::string& stored);
    // true, если хэш в старом (слабом) формате — стоит пере-хэшировать при логине.
    bool needsRehash(const std::string& stored);

    std::string generateToken(); // 64-символьный hex случайный токен (256 бит)
    std::string randomHex(int bytes); // криптостойкая случайная hex-строка (2*bytes символов)
    std::string sha256Hex(const std::string& input); // для хранения токенов сессий в виде хэша
    // base64(HMAC-SHA1(key, data)) — пароль временной учётки coturn (use-auth-secret)
    std::string hmacSha1Base64(const std::string& key, const std::string& data);
    // hex(HMAC-SHA256(key, data)) — подпись задачи капчи ALTCHA
    std::string hmacSha256Hex(const std::string& key, const std::string& data);
    // Сравнение строк в постоянном времени (подписи, коды подтверждения)
    bool constTimeEquals(const std::string& a, const std::string& b);
    // Криптостойкое случайное число в [0, bound) без перекоса по модулю
    uint64_t randomBelow(uint64_t bound);
}
