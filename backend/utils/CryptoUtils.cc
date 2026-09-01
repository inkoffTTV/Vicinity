#include "CryptoUtils.h"
#include <openssl/sha.h>
#include <openssl/rand.h>
#include <openssl/evp.h>
#include <sstream>
#include <iomanip>
#include <vector>
#include <stdexcept>
#include <cstring>

namespace CryptoUtils {

// Кол-во раундов PBKDF2-HMAC-SHA256 (рекомендация OWASP). Хранится внутри хэша,
// поэтому можно поднимать в будущем без поломки старых записей.
static constexpr int PBKDF2_ITERS = 210000;
static constexpr int KEY_LEN      = 32;   // 256-бит ключ
static constexpr int SALT_LEN     = 16;

static std::string toHex(const unsigned char* data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i)
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(data[i]);
    return oss.str();
}

static std::vector<unsigned char> fromHex(const std::string& hex) {
    std::vector<unsigned char> out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i + 1 < hex.size(); i += 2)
        out.push_back(static_cast<unsigned char>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    return out;
}

static std::string randomHex(int bytes) {
    std::vector<unsigned char> buf(bytes);
    if (RAND_bytes(buf.data(), bytes) != 1)
        throw std::runtime_error("RAND_bytes failed");
    return toHex(buf.data(), bytes);
}

static std::string sha256(const std::string& input) {
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(input.data()), input.size(), digest);
    return toHex(digest, SHA256_DIGEST_LENGTH);
}

std::string sha256Hex(const std::string& input) { return sha256(input); }

// Сравнение в постоянном времени — против timing-атак.
static bool constTimeEq(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i)
        diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
    return diff == 0;
}

static std::string pbkdf2(const std::string& password, const std::vector<unsigned char>& salt, int iters) {
    unsigned char out[KEY_LEN];
    if (PKCS5_PBKDF2_HMAC(password.data(), static_cast<int>(password.size()),
                          salt.data(), static_cast<int>(salt.size()),
                          iters, EVP_sha256(), KEY_LEN, out) != 1)
        throw std::runtime_error("PBKDF2 failed");
    return toHex(out, KEY_LEN);
}

std::string hashPassword(const std::string& password) {
    std::string saltHex = randomHex(SALT_LEN);
    std::string hash    = pbkdf2(password, fromHex(saltHex), PBKDF2_ITERS);
    return "pbkdf2$" + std::to_string(PBKDF2_ITERS) + "$" + saltHex + "$" + hash;
}

bool verifyPassword(const std::string& password, const std::string& stored) {
    // Новый формат: pbkdf2$<iters>$<salt>$<hash>
    if (stored.rfind("pbkdf2$", 0) == 0) {
        std::vector<std::string> parts;
        std::string cur; std::istringstream ss(stored);
        while (std::getline(ss, cur, '$')) parts.push_back(cur);
        if (parts.size() != 4) return false;
        int iters = 0;
        try { iters = std::stoi(parts[1]); } catch (...) { return false; }
        if (iters <= 0) return false;
        std::string expected = parts[3];
        std::string actual   = pbkdf2(password, fromHex(parts[2]), iters);
        return constTimeEq(actual, expected);
    }
    // Старый формат: "salt$hash" (1 раунд SHA-256) — совместимость со старыми аккаунтами
    auto sep = stored.find('$');
    if (sep == std::string::npos) return false;
    std::string salt     = stored.substr(0, sep);
    std::string expected = stored.substr(sep + 1);
    return constTimeEq(sha256(salt + password), expected);
}

bool needsRehash(const std::string& stored) {
    return stored.rfind("pbkdf2$", 0) != 0;   // всё, что не pbkdf2 — слабое, пере-хэшировать
}

std::string generateToken() {
    return randomHex(32); // 64 hex chars
}

} // namespace CryptoUtils
