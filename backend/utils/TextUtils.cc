#include "TextUtils.h"
#include <cctype>
#include <cstdint>

namespace TextUtils {

bool isValidUtf8(std::string_view s) {
    size_t i = 0;
    const size_t n = s.size();
    while (i < n) {
        const auto c = static_cast<unsigned char>(s[i]);
        size_t len;
        uint32_t cp;
        if (c < 0x80)                { ++i; continue; }
        else if ((c & 0xE0) == 0xC0) { len = 2; cp = c & 0x1F; }
        else if ((c & 0xF0) == 0xE0) { len = 3; cp = c & 0x0F; }
        else if ((c & 0xF8) == 0xF0) { len = 4; cp = c & 0x07; }
        else return false;
        if (i + len > n) return false;
        for (size_t k = 1; k < len; ++k) {
            const auto cc = static_cast<unsigned char>(s[i + k]);
            if ((cc & 0xC0) != 0x80) return false;
            cp = (cp << 6) | (cc & 0x3F);
        }
        // overlong, суррогаты, за пределами Unicode
        if ((len == 2 && cp < 0x80) || (len == 3 && cp < 0x800) || (len == 4 && cp < 0x10000))
            return false;
        if ((cp >= 0xD800 && cp <= 0xDFFF) || cp > 0x10FFFF) return false;
        i += len;
    }
    return true;
}

size_t utf8Length(std::string_view s) {
    size_t count = 0;
    for (char ch : s)
        if ((static_cast<unsigned char>(ch) & 0xC0) != 0x80) ++count;   // не байт-продолжение
    return count;
}

std::string utf8Truncate(std::string_view s, size_t maxChars) {
    size_t chars = 0;
    for (size_t i = 0; i < s.size(); ++i) {
        if ((static_cast<unsigned char>(s[i]) & 0xC0) != 0x80) {
            if (chars == maxChars) return std::string(s.substr(0, i));
            ++chars;
        }
    }
    return std::string(s);
}

std::string trim(std::string_view s) {
    size_t b = 0, e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return std::string(s.substr(b, e - b));
}

bool hasControlChars(std::string_view s, bool allowNewlines) {
    for (char ch : s) {
        const auto c = static_cast<unsigned char>(ch);
        if (allowNewlines && (c == '\n' || c == '\r' || c == '\t')) continue;
        if (c < 0x20 || c == 0x7F) return true;
    }
    return false;
}

std::optional<std::string> cleanName(std::string_view raw, size_t maxChars, bool truncate) {
    if (!isValidUtf8(raw) || hasControlChars(raw)) return std::nullopt;
    std::string name = trim(raw);
    if (utf8Length(name) > maxChars) {
        if (!truncate) return std::nullopt;
        name = trim(utf8Truncate(name, maxChars));
    }
    if (name.empty()) return std::nullopt;
    return name;
}

bool isHexColor(std::string_view s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
    return true;
}

std::string escapeLike(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        if (c == '%' || c == '_' || c == '\\') out += '\\';
        out += c;
    }
    return out;
}

} // namespace TextUtils
