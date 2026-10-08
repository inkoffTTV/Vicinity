#include "Mailer.h"
#include "CryptoUtils.h"
#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <trantor/utils/Logger.h>
#include <atomic>
#include <cstring>
#include <ctime>
#include <thread>
#ifdef VICINITY_HAVE_CURL
#include <curl/curl.h>
#endif

namespace Mailer {

struct SmtpConfig {
    std::string host;
    int         port = 465;
    std::string user;
    std::string password;
    std::string from;      // адрес отправителя (обычно совпадает с user)
    bool        implicitTls = true;   // 465 — TLS сразу; 587/25 — STARTTLS
};

static const SmtpConfig& config() {
    static const SmtpConfig cfg = [] {
        SmtpConfig c;
        const Json::Value& s = drogon::app().getCustomConfig()["smtp"];
        if (!s.isObject()) return c;
        c.host     = s.get("host", "").asString();
        c.user     = s.get("user", "").asString();
        c.password = s.get("password", "").asString();
        c.from     = s.get("from", "").asString();
        if (c.from.empty()) c.from = c.user;
        const Json::Value& port = s["port"];
        if (port.isIntegral()) c.port = port.asInt();
        else if (port.isString() && !port.asString().empty()) {
            try { c.port = std::stoi(port.asString()); } catch (...) {}
        }
        const std::string security = s.get("security", "").asString();
        c.implicitTls = security.empty() ? c.port == 465 : security == "ssl";
        return c;
    }();
    return cfg;
}

bool configured() {
#ifdef VICINITY_HAVE_CURL
    return !config().host.empty() && !config().from.empty();
#else
    return false;
#endif
}

#ifdef VICINITY_HAVE_CURL
// Заголовок в UTF-8 по RFC 2047: =?UTF-8?B?...?=
static std::string encodeHeader(const std::string& text) {
    return "=?UTF-8?B?" + drogon::utils::base64Encode(text) + "?=";
}

// base64 тела письма строками по 76 символов (RFC 2045)
static std::string encodeBody(const std::string& text) {
    const std::string b64 = drogon::utils::base64Encode(text);
    std::string out;
    for (size_t i = 0; i < b64.size(); i += 76) out += b64.substr(i, 76) + "\r\n";
    return out;
}

static std::string rfc2822Date() {
    char buf[64];
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::strftime(buf, sizeof buf, "%a, %d %b %Y %H:%M:%S +0000", &tm);
    return buf;
}

static std::string domainOf(const std::string& address) {
    const auto at = address.rfind('@');
    return at == std::string::npos ? "localhost" : address.substr(at + 1);
}

struct Upload {
    const std::string* data;
    size_t             pos = 0;
};

static size_t readPayload(char* ptr, size_t size, size_t nmemb, void* userp) {
    auto* up = static_cast<Upload*>(userp);
    const size_t room = size * nmemb;
    const size_t left = up->data->size() - up->pos;
    const size_t n = left < room ? left : room;
    std::memcpy(ptr, up->data->data() + up->pos, n);
    up->pos += n;
    return n;
}

static void sendNow(const std::string& to, const std::string& subject, const std::string& body) {
    const SmtpConfig& c = config();
    const std::string message =
        "Date: " + rfc2822Date() + "\r\n"
        "From: " + encodeHeader("Vicinity") + " <" + c.from + ">\r\n"
        "To: <" + to + ">\r\n"
        "Subject: " + encodeHeader(subject) + "\r\n"
        "Message-ID: <" + CryptoUtils::randomHex(16) + "@" + domainOf(c.from) + ">\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: text/plain; charset=UTF-8\r\n"
        "Content-Transfer-Encoding: base64\r\n"
        "\r\n" + encodeBody(body);

    CURL* curl = curl_easy_init();
    if (!curl) { LOG_ERROR << "SMTP: curl_easy_init failed"; return; }
    const std::string url = std::string(c.implicitTls ? "smtps://" : "smtp://") + c.host + ":" + std::to_string(c.port);
    const std::string from = "<" + c.from + ">";
    const std::string rcpt = "<" + to + ">";
    curl_slist* recipients = curl_slist_append(nullptr, rcpt.c_str());
    Upload upload{&message};

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    if (!c.implicitTls) curl_easy_setopt(curl, CURLOPT_USE_SSL, static_cast<long>(CURLUSESSL_ALL));
    if (!c.user.empty()) {
        curl_easy_setopt(curl, CURLOPT_USERNAME, c.user.c_str());
        curl_easy_setopt(curl, CURLOPT_PASSWORD, c.password.c_str());
    }
    curl_easy_setopt(curl, CURLOPT_MAIL_FROM, from.c_str());
    curl_easy_setopt(curl, CURLOPT_MAIL_RCPT, recipients);
    curl_easy_setopt(curl, CURLOPT_READFUNCTION, readPayload);
    curl_easy_setopt(curl, CURLOPT_READDATA, &upload);
    curl_easy_setopt(curl, CURLOPT_UPLOAD, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    const CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK)
        LOG_ERROR << "SMTP: не удалось отправить письмо (" << c.host << ":" << c.port << "): "
                  << curl_easy_strerror(res);
    curl_slist_free_all(recipients);
    curl_easy_cleanup(curl);
}
#endif

void sendAsync(const std::string& to, const std::string& subject, const std::string& body) {
#ifdef VICINITY_HAVE_CURL
    if (!configured()) return;
    // Не больше 8 писем одновременно: всплеск запросов не плодит сотни потоков
    static std::atomic<int> inFlight{0};
    if (inFlight.fetch_add(1) >= 8) {
        inFlight.fetch_sub(1);
        LOG_WARN << "SMTP: слишком много писем одновременно, письмо не отправлено";
        return;
    }
    std::thread([to, subject, body] {
        try { sendNow(to, subject, body); }
        catch (const std::exception& e) { LOG_ERROR << "SMTP: " << e.what(); }
        inFlight.fetch_sub(1);
    }).detach();
#else
    (void)to; (void)subject; (void)body;
    LOG_WARN << "SMTP: сервер собран без libcurl — письма не отправляются";
#endif
}

} // namespace Mailer
