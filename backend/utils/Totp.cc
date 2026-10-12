#include "Totp.h"
#include "CryptoUtils.h"
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <cctype>
#include <ctime>
#include <stdexcept>

namespace Totp {

static const char* kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

static std::string base32Encode(const unsigned char* data, size_t len) {
    std::string out;
    int buffer = 0, bits = 0;
    for (size_t i = 0; i < len; ++i) {
        buffer = (buffer << 8) | data[i];
        bits += 8;
        while (bits >= 5) {
            out += kAlphabet[(buffer >> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += kAlphabet[(buffer << (5 - bits)) & 31];
    return out;
}

static std::vector<unsigned char> base32Decode(const std::string& s) {
    std::vector<unsigned char> out;
    int buffer = 0, bits = 0;
    for (char ch : s) {
        if (ch == '=' || ch == ' ' || ch == '-') continue;
        const char c = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
        int v = -1;
        if (c >= 'A' && c <= 'Z') v = c - 'A';
        else if (c >= '2' && c <= '7') v = c - '2' + 26;
        if (v < 0) return {};
        buffer = (buffer << 5) | v;
        bits += 5;
        if (bits >= 8) {
            out.push_back(static_cast<unsigned char>((buffer >> (bits - 8)) & 0xFF));
            bits -= 8;
        }
    }
    return out;
}

std::string newSecret() {
    unsigned char raw[20];
    if (RAND_bytes(raw, sizeof raw) != 1) throw std::runtime_error("RAND_bytes failed");
    return base32Encode(raw, sizeof raw);
}

static std::string urlEncode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += static_cast<char>(c);
        else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
    }
    return out;
}

std::string uri(const std::string& secret, const std::string& account) {
    return "otpauth://totp/Vicinity:" + urlEncode(account) + "?secret=" + secret + "&issuer=Vicinity&digits=6&period=30";
}

static int codeAt(const std::vector<unsigned char>& key, uint64_t counter) {
    unsigned char msg[8];
    for (int i = 7; i >= 0; --i) { msg[i] = static_cast<unsigned char>(counter & 0xFF); counter >>= 8; }
    unsigned char mac[20];
    unsigned int macLen = 0;
    if (!HMAC(EVP_sha1(), key.data(), static_cast<int>(key.size()), msg, sizeof msg, mac, &macLen) || macLen < 20)
        return -1;
    const int offset = mac[19] & 0x0F;
    const uint32_t bin = ((mac[offset] & 0x7F) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
    return static_cast<int>(bin % 1000000);
}

bool verify(const std::string& secret, const std::string& code) {
    std::string digits;
    for (char c : code) if (c >= '0' && c <= '9') digits += c;
    if (digits.size() != 6) return false;
    const auto key = base32Decode(secret);
    if (key.empty()) return false;
    const int want = std::stoi(digits);
    const uint64_t step = static_cast<uint64_t>(std::time(nullptr)) / 30;
    for (int d = -1; d <= 1; ++d)
        if (codeAt(key, step + d) == want) return true;
    return false;
}

std::vector<std::string> backupCodes(int count) {
    static const char* cs = "abcdefghjkmnpqrstuvwxyz23456789";
    std::vector<std::string> out;
    for (int i = 0; i < count; ++i) {
        std::string c;
        for (int j = 0; j < 8; ++j) {
            if (j == 4) c += '-';
            c += cs[CryptoUtils::randomBelow(31)];
        }
        out.push_back(c);
    }
    return out;
}

} // namespace Totp
