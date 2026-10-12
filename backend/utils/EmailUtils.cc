#include "EmailUtils.h"
#include <algorithm>
#include <cctype>
#include <unordered_set>

namespace EmailUtils {

bool looksValid(const std::string& email) {
    if (email.size() < 6 || email.size() > 254) return false;
    const auto at = email.find('@');
    if (at == std::string::npos || at == 0 || email.find('@', at + 1) != std::string::npos) return false;
    const std::string local = email.substr(0, at), domain = email.substr(at + 1);
    if (local.size() > 64 || domain.size() < 4) return false;
    for (unsigned char c : email)
        if (c <= 0x20 || c >= 0x7F || c == '<' || c == '>' || c == '"' || c == '(' || c == ')' ||
            c == ',' || c == ';' || c == ':' || c == '\\' || c == '[' || c == ']')
            return false;
    // домен: буквы/цифры/дефисы, точки только между частями, есть зона
    if (domain.front() == '.' || domain.back() == '.' || domain.find("..") != std::string::npos ||
        domain.find('.') == std::string::npos)
        return false;
    for (unsigned char c : domain)
        if (!std::isalnum(c) && c != '-' && c != '.') return false;
    if (local.front() == '.' || local.back() == '.' || local.find("..") != std::string::npos) return false;
    return true;
}

std::optional<std::string> normalize(const std::string& raw) {
    std::string email;
    // пробелы по краям — частая ошибка при вставке
    const auto first = raw.find_first_not_of(" \t");
    if (first == std::string::npos) return std::nullopt;
    email = raw.substr(first, raw.find_last_not_of(" \t") - first + 1);
    std::transform(email.begin(), email.end(), email.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (!looksValid(email)) return std::nullopt;

    const auto at = email.find('@');
    std::string local = email.substr(0, at), domain = email.substr(at + 1);
    if (const auto plus = local.find('+'); plus != std::string::npos) local.erase(plus);
    if (domain == "googlemail.com") domain = "gmail.com";
    if (domain == "gmail.com") local.erase(std::remove(local.begin(), local.end(), '.'), local.end());
    if (local.empty()) return std::nullopt;
    return local + "@" + domain;
}

bool isDisposable(const std::string& normalizedEmail) {
    static const std::unordered_set<std::string> domains = {
        "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com",
        "grr.la", "guerrillamailblock.com", "10minutemail.com", "10minutemail.net", "temp-mail.org",
        "temp-mail.io", "tempmail.com", "tempmail.net", "tempmail.dev", "tempmailo.com", "tempr.email",
        "yopmail.com", "yopmail.net", "yopmail.fr", "trashmail.com", "trashmail.de", "trashmail.net",
        "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com",
        "mohmal.com", "moakt.com", "emailondeck.com", "throwawaymail.com", "fakeinbox.com", "spamgourmet.com",
        "mailcatch.com", "mytemp.email", "tempinbox.com", "burnermail.io", "33mail.com", "inboxkitten.com",
        "1secmail.com", "1secmail.org", "1secmail.net", "emltmp.com", "dropmail.me", "10mail.org",
        "minuteinbox.com", "tmpmail.org", "tmpmail.net", "mail.tm", "mail.gw", "tmail.ws", "cryptogmail.com",
        "spambox.us", "mailpoof.com", "fextemp.com", "luxusmail.org", "byom.de", "harakirimail.com",
        "discard.email", "emailfake.com", "generator.email", "crazymailing.com", "vomoto.com",
        "linshiyouxiang.net", "tempmail.plus", "mailto.plus", "fexpost.com", "fexbox.org", "rover.info",
        "chitthi.in", "anonbox.net", "mail7.io", "getairmail.com", "zetmail.com",
    };
    const auto at = normalizedEmail.rfind('@');
    if (at == std::string::npos) return false;
    std::string domain = normalizedEmail.substr(at + 1);
    // поддомены одноразовых сервисов (x.mailinator.com) — тоже одноразовые
    for (;;) {
        if (domains.count(domain)) return true;
        const auto dot = domain.find('.');
        if (dot == std::string::npos || domain.find('.', dot + 1) == std::string::npos) return false;
        domain.erase(0, dot + 1);
    }
}

} // namespace EmailUtils
