#pragma once
#include <drogon/HttpRequest.h>
#include <json/json.h>
#include <trantor/net/InetAddress.h>
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace NetUtils {

// Подсеть вида "10.0.0.0/8", "fd00::/8" или одиночный адрес "203.0.113.5"
struct Cidr {
    bool                     v6 = false;
    std::array<uint8_t, 16>  addr{};
    int                      prefix = 0;
};

// Разбор строки; false — некорректная запись
bool parseCidr(const std::string& text, Cidr& out);

// Список подсетей из JSON-массива строк (некорректные записи пропускаются с предупреждением в лог)
std::vector<Cidr> parseCidrList(const Json::Value& arr);

// Попадает ли адрес в одну из подсетей (IPv4-mapped IPv6 сравнивается как IPv4)
bool contains(const std::vector<Cidr>& list, const trantor::InetAddress& addr);

// IP клиента: X-Real-IP от доверенного прокси (custom_config.trusted_proxies), иначе адрес соединения
std::string clientIp(const drogon::HttpRequestPtr& req);

} // namespace NetUtils
