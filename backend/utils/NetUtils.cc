#include "NetUtils.h"
#include <trantor/utils/Logger.h>
#ifdef _WIN32
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#endif
#include <cstring>

namespace NetUtils {

bool parseCidr(const std::string& text, Cidr& out) {
    std::string ip = text;
    int prefix = -1;
    auto slash = text.find('/');
    if (slash != std::string::npos) {
        ip = text.substr(0, slash);
        const std::string p = text.substr(slash + 1);
        if (p.empty() || p.size() > 3 || p.find_first_not_of("0123456789") != std::string::npos)
            return false;
        prefix = std::stoi(p);
    }
    Cidr c;
    if (inet_pton(AF_INET, ip.c_str(), c.addr.data()) == 1) {
        c.v6 = false;
        if (prefix < 0) prefix = 32;
        if (prefix > 32) return false;
    } else if (inet_pton(AF_INET6, ip.c_str(), c.addr.data()) == 1) {
        c.v6 = true;
        if (prefix < 0) prefix = 128;
        if (prefix > 128) return false;
    } else {
        return false;
    }
    c.prefix = prefix;
    out = c;
    return true;
}

std::vector<Cidr> parseCidrList(const Json::Value& arr) {
    std::vector<Cidr> out;
    if (!arr.isArray()) return out;
    for (const auto& v : arr) {
        Cidr c;
        if (v.isString() && parseCidr(v.asString(), c)) out.push_back(c);
        else LOG_WARN << "Ignoring invalid subnet in config: " << v.toStyledString();
    }
    return out;
}

static bool prefixMatch(const uint8_t* a, const uint8_t* b, int bits) {
    const int full = bits / 8;
    if (std::memcmp(a, b, full) != 0) return false;
    const int rest = bits % 8;
    if (rest == 0) return true;
    const auto mask = static_cast<uint8_t>(0xFF << (8 - rest));
    return (a[full] & mask) == (b[full] & mask);
}

bool contains(const std::vector<Cidr>& list, const trantor::InetAddress& addr) {
    if (list.empty()) return false;
    uint8_t bytes[16] = {};
    bool v6 = addr.isIpV6();
    const sockaddr* sa = addr.getSockAddr();
    if (v6) {
        std::memcpy(bytes, &reinterpret_cast<const sockaddr_in6*>(sa)->sin6_addr, 16);
        // ::ffff:a.b.c.d — это IPv4-клиент на dual-stack сокете
        static const uint8_t mapped[12] = {0,0,0,0,0,0,0,0,0,0,0xFF,0xFF};
        if (std::memcmp(bytes, mapped, 12) == 0) {
            std::memmove(bytes, bytes + 12, 4);
            v6 = false;
        }
    } else {
        std::memcpy(bytes, &reinterpret_cast<const sockaddr_in*>(sa)->sin_addr, 4);
    }
    for (const auto& c : list)
        if (c.v6 == v6 && prefixMatch(bytes, c.addr.data(), c.prefix)) return true;
    return false;
}

} // namespace NetUtils
