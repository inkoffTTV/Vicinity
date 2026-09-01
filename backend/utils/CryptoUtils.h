#pragma once
#include <string>

namespace CryptoUtils {
    // Хэш пароля медленным KDF (PBKDF2-HMAC-SHA256). Формат: "pbkdf2$<iters>$<salt>$<hash>"
    std::string hashPassword(const std::string& password);
    // Проверяет пароль. Понимает новый формат pbkdf2$..., и старый "salt$hash" (1 раунд SHA-256).
    bool verifyPassword(const std::string& password, const std::string& stored);
    // true, если хэш в старом (слабом) формате — стоит пере-хэшировать при логине.
    bool needsRehash(const std::string& stored);

    std::string generateToken(); // 64-символьный hex случайный токен (256 бит)
    std::string sha256Hex(const std::string& input); // для хранения токенов сессий в виде хэша
}
