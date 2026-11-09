#include "Bots.h"
#include "CryptoUtils.h"
#include "JsonUtils.h"
#include "Messages.h"
#include "TextUtils.h"
#include "Uploads.h"
#include <drogon/drogon.h>
#include <cctype>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cctype>
#include <chrono>
#include <ctime>
#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <set>
#include <thread>
#include <unordered_map>
#include <vector>
#ifdef VICINITY_HAVE_CURL
#include <curl/curl.h>
#endif

using namespace drogon;

namespace {

constexpr int kQueueMax = 1000;          // обновлений в очереди на бота
constexpr long kWebhookTimeout = 10;     // секунд на один POST вебхука
constexpr long kWebhookConnect = 5;      // секунд на соединение
constexpr size_t kWebhookMaxBody = 16 * 1024;   // ответ вебхука дальше не читаем: нужен только код
constexpr int kWebhookBatch = 100;       // подряд одному боту, потом очередь других
constexpr int kWebhookWorkers = 4;
constexpr int kEphemeralTtl = 15 * 60;
// Эфемерные сообщения в памяти: не больше стольких записей и байт всего и на одного бота
constexpr size_t kEphMaxEntries = 10000;
constexpr size_t kEphMaxBytes = 32u << 20;
constexpr size_t kEphMaxPerBot = 500;
constexpr size_t kEphMaxBytesPerBot = 4u << 20;
// Отправитель сообщений вебхуков каналов в Bot API: не настоящий пользователь, id = база + id вебхука
constexpr int64_t kWebhookSenderBase = 9000000000000LL;

std::atomic<bool> gAllowPrivate{false};

// ---------- Длинный опрос ----------
struct Waiter {
    uint64_t id = 0;
    int64_t offset = 0;
    int limit = 100;
    std::function<void(const HttpResponsePtr&)> cb;
};
std::mutex gWaitMutex;
std::map<int64_t, Waiter> gWaiters;
std::atomic<uint64_t> gWaiterSeq{0};

// ---------- Эфемерные ----------
// Хранится только то, что нужно для нажатия кнопки: сжатый JSON сообщения. Вытесняются самые старые
using Clock = std::chrono::steady_clock;
struct EphSlot {
    int64_t botId = 0, userId = 0, channelId = 0;
    std::string message;   // JSON
    Clock::time_point at;
};
std::mutex gEphMutex;
std::unordered_map<std::string, EphSlot> gEphemeral;
std::deque<std::string> gEphOrder;                          // все id по времени (могут быть уже удалённые)
std::map<int64_t, std::deque<std::string>> gEphByBot;       // id каждого бота по времени
std::map<int64_t, std::pair<size_t, size_t>> gEphBotUsage;  // бот → {записей, байт}
size_t gEphBytes = 0;

// Убрать эфемерное (под gEphMutex); id в очередях порядка остаются и пропускаются позже
void dropEphemeral(const std::string& id) {
    auto it = gEphemeral.find(id);
    if (it == gEphemeral.end()) return;
    auto& usage = gEphBotUsage[it->second.botId];
    usage.first -= 1;
    usage.second -= it->second.message.size();
    gEphBytes -= it->second.message.size();
    gEphemeral.erase(it);
}

// Истёкшие и уже удалённые — из начала очередей (под gEphMutex)
void pruneEphemeral(Clock::time_point now) {
    const auto stale = [&](const std::string& id) {
        auto it = gEphemeral.find(id);
        return it == gEphemeral.end() || now - it->second.at > std::chrono::seconds(kEphemeralTtl);
    };
    while (!gEphOrder.empty() && stale(gEphOrder.front())) {
        dropEphemeral(gEphOrder.front());
        gEphOrder.pop_front();
    }
    for (auto it = gEphByBot.begin(); it != gEphByBot.end();) {
        auto& q = it->second;
        while (!q.empty() && stale(q.front())) {
            dropEphemeral(q.front());
            q.pop_front();
        }
        if (q.empty()) {
            gEphBotUsage.erase(it->first);
            it = gEphByBot.erase(it);
        } else {
            ++it;
        }
    }
}

// ---------- Доставка на вебхуки ботов ----------
// У каждого бота не больше одного запроса в полёте: обновления уходят строго по порядку update_id,
// ошибка — пауза с нарастанием и повтор с самого старого. Очередь ботов разбирают рабочие потоки.
struct Delivery {
    std::mutex m;
    std::condition_variable cv;
    std::deque<int64_t> queue;
    std::set<int64_t> queued, active, again;
    std::map<int64_t, std::pair<int, Clock::time_point>> backoff;   // бот → {ошибок подряд, не раньше}
} gDel;
std::atomic<bool> gDeliveryStarted{false};

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string str(const drogon::orm::Row& row, const char* col) {
    return row[col].isNull() ? std::string() : row[col].as<std::string>();
}

// «YYYY-MM-DD HH:MM:SS» (UTC, SQLite CURRENT_TIMESTAMP) → unix
int64_t unixTime(const std::string& ts) {
    std::tm tm{};
    if (sscanf(ts.c_str(), "%d-%d-%d %d:%d:%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday, &tm.tm_hour, &tm.tm_min,
               &tm.tm_sec) < 3)
        return static_cast<int64_t>(std::time(nullptr));
    tm.tm_year -= 1900;
    tm.tm_mon -= 1;
    return static_cast<int64_t>(timegm(&tm));
}

bool wordChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
}

// /cmd или /cmd@имя в начале текста; atName — имя после @ (пусто, если не указано). false — не команда
bool parseCommand(const std::string& text, std::string& cmd, std::string& atName) {
    if (text.size() < 2 || text[0] != '/') return false;
    size_t i = 1;
    while (i < text.size() && wordChar(text[i])) ++i;
    if (i == 1 || i - 1 > 32) return false;
    cmd = text.substr(1, i - 1);
    atName.clear();
    if (i < text.size() && text[i] == '@') {
        size_t j = i + 1;
        while (j < text.size() && wordChar(text[j])) ++j;
        atName = text.substr(i + 1, j - i - 1);
        i = j;
    }
    return i == text.size() || std::isspace(static_cast<unsigned char>(text[i]));
}

// Длина команды в начале текста (для entities bot_command); 0 — не команда
size_t commandLength(const std::string& text) {
    std::string cmd, at;
    if (!parseCommand(text, cmd, at)) return 0;
    return 1 + cmd.size() + (at.empty() ? 0 : at.size() + 1);
}

bool mentions(const std::string& text, const std::string& username) {
    if (username.empty()) return false;
    const std::string t = lower(text), needle = "@" + lower(username);
    for (size_t pos = 0; (pos = t.find(needle, pos)) != std::string::npos; ++pos) {
        const size_t end = pos + needle.size();
        if ((pos == 0 || !wordChar(t[pos - 1])) && (end == t.size() || !wordChar(t[end]))) return true;
    }
    return false;
}

std::string updateType(const Json::Value& update) {
    for (const char* k : {"message", "edited_message", "callback_query"})
        if (update.isMember(k)) return k;
    return "";
}

// ---------- Очередь ----------

// Отрицательный offset, как в Telegram: остаются только последние |offset| обновлений, более ранние
// забываются. Возвращает обычный offset — id первого оставшегося (0 — очередь пуста)
int64_t normalizeOffset(const drogon::orm::DbClientPtr& db, int64_t botId, int64_t offset) {
    if (offset >= 0) return offset;
    const int64_t keep = offset < -kQueueMax ? kQueueMax : -offset;
    auto r = db->execSqlSync("SELECT update_id FROM bot_updates WHERE bot_id = ? ORDER BY update_id DESC LIMIT 1 OFFSET ?",
                             botId, keep - 1);
    if (r.empty()) return 0;   // обновлений меньше |offset| — отдаются все
    const int64_t first = r[0]["update_id"].as<int64_t>();
    db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ? AND update_id < ?", botId, first);
    return first;
}

Json::Value fetch(const drogon::orm::DbClientPtr& db, int64_t botId, int64_t offset, int limit) {
    if (offset > 0) db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ? AND update_id < ?", botId, offset);
    Json::Value out(Json::arrayValue);
    auto rows = db->execSqlSync(
        "SELECT update_id, payload FROM bot_updates WHERE bot_id = ? AND update_id >= ? ORDER BY update_id LIMIT ?",
        botId, offset, static_cast<int64_t>(limit));
    for (const auto& row : rows) {
        Json::Value u;
        const int64_t id = row["update_id"].as<int64_t>();
        if (!JsonUtils::parse(row["payload"].as<std::string>(), u) || !u.isObject()) {
            db->execSqlSync("DELETE FROM bot_updates WHERE update_id = ?", id);
            continue;
        }
        u["update_id"] = static_cast<Json::Int64>(id);
        out.append(u);
    }
    return out;
}

std::optional<Waiter> takeWaiter(int64_t botId, uint64_t onlyId = 0) {
    std::lock_guard<std::mutex> lock(gWaitMutex);
    auto it = gWaiters.find(botId);
    if (it == gWaiters.end() || (onlyId && it->second.id != onlyId)) return std::nullopt;
    Waiter w = std::move(it->second);
    gWaiters.erase(it);
    return w;
}

void answerWaiter(int64_t botId, Waiter& w) {
    Json::Value result(Json::arrayValue);
    try {
        result = fetch(app().getDbClient(), botId, w.offset, w.limit);
    } catch (const std::exception& e) {
        LOG_WARN << "bots: getUpdates: " << e.what();
    }
    w.cb(Bots::ok(result));
}

void wake(int64_t botId) {
    if (auto w = takeWaiter(botId)) answerWaiter(botId, *w);
}

// ---------- Вебхук бота ----------

struct ParsedUrl {
    std::string scheme, host, origin, path;   // origin — scheme://host[:port]
};

bool parseUrl(const std::string& url, ParsedUrl& out) {
    const auto sep = url.find("://");
    if (sep == std::string::npos) return false;
    out.scheme = lower(url.substr(0, sep));
    const size_t start = sep + 3;
    size_t end = url.find_first_of("/?#", start);
    if (end == std::string::npos) end = url.size();
    const std::string authority = url.substr(start, end - start);
    if (authority.empty() || authority.find('@') != std::string::npos) return false;
    // Хост без порта; IPv6 — в квадратных скобках
    if (authority[0] == '[') {
        const auto close = authority.find(']');
        if (close == std::string::npos) return false;
        out.host = authority.substr(1, close - 1);
    } else {
        out.host = authority.substr(0, authority.find(':'));
    }
    out.host = lower(out.host);
    if (out.host.empty()) return false;
    out.origin = out.scheme + "://" + authority;
    std::string rest = url.substr(end);
    const auto hash = rest.find('#');
    if (hash != std::string::npos) rest = rest.substr(0, hash);
    if (rest.empty() || rest[0] == '?') rest = "/" + rest;
    out.path = rest;
    return true;
}

// Литерал частного, локального или служебного адреса (DNS не разрешаем — только явные IP и localhost)
bool privateHost(const std::string& host) {
    if (host == "localhost" || (host.size() > 10 && host.compare(host.size() - 10, 10, ".localhost") == 0)) return true;
    unsigned char b[16];
    if (inet_pton(AF_INET, host.c_str(), b) == 1) {
        return b[0] == 0 || b[0] == 10 || b[0] == 127 || (b[0] == 169 && b[1] == 254) ||
               (b[0] == 172 && (b[1] & 0xF0) == 16) || (b[0] == 192 && b[1] == 168) ||
               (b[0] == 100 && (b[1] & 0xC0) == 64) || b[0] >= 224;
    }
    if (inet_pton(AF_INET6, host.c_str(), b) == 1) {
        static const unsigned char zero[16] = {};
        const bool unspecified = std::equal(b, b + 16, zero);
        const bool loopback = std::equal(b, b + 15, zero) && b[15] == 1;
        const bool mapped = std::all_of(b, b + 10, [](unsigned char c) { return c == 0; }) && b[10] == 0xFF && b[11] == 0xFF;
        if (mapped) {
            char v4[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, b + 12, v4, sizeof v4);
            return privateHost(v4);
        }
        return unspecified || loopback || (b[0] & 0xFE) == 0xFC || (b[0] == 0xFE && (b[1] & 0xC0) == 0x80) ||
               b[0] == 0xFF;
    }
    return false;
}

void webhookError(int64_t botId, const std::string& why) {
    try {
        app().getDbClient()->execSqlSync(
            "UPDATE bots SET webhook_error = ?, webhook_error_at = CURRENT_TIMESTAMP WHERE user_id = ?", why, botId);
    } catch (...) {}
}

#ifdef VICINITY_HAVE_CURL
// Тело ответа вебхука не хранится: считаем байты и обрываем после kWebhookMaxBody
size_t discardBody(char*, size_t size, size_t n, void* user) {
    auto* total = static_cast<size_t*>(user);
    *total += size * n;
    return *total > kWebhookMaxBody ? 0 : size * n;
}

// Без allow_private_webhooks соединение с частным адресом не открывается, даже если имя
// хоста разрешилось в него уже после setWebhook
curl_socket_t openPublicSocket(void*, curlsocktype purpose, struct curl_sockaddr* a) {
    if (purpose == CURLSOCKTYPE_IPCXN && !gAllowPrivate) {
        char ip[INET6_ADDRSTRLEN] = {};
        if (a->family == AF_INET)
            inet_ntop(AF_INET, &reinterpret_cast<const sockaddr_in*>(&a->addr)->sin_addr, ip, sizeof ip);
        else if (a->family == AF_INET6)
            inet_ntop(AF_INET6, &reinterpret_cast<const sockaddr_in6*>(&a->addr)->sin6_addr, ip, sizeof ip);
        if (!*ip || privateHost(ip)) return CURL_SOCKET_BAD;
    }
    return socket(a->family, a->socktype, a->protocol);
}

// POST на вебхук; код ответа HTTP (0 — не дошло), why — причина для getWebhookInfo
long postJson(const std::string& url, const std::string& secret, const std::string& body, std::string& why) {
    CURL* curl = curl_easy_init();
    if (!curl) { why = "Нет соединения с адресом вебхука"; return 0; }
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Expect:");
    if (!secret.empty()) headers = curl_slist_append(headers, ("X-Telegram-Bot-Api-Secret-Token: " + secret).c_str());
    size_t received = 0;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discardBody);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &received);
    curl_easy_setopt(curl, CURLOPT_MAXFILESIZE, static_cast<long>(kWebhookMaxBody));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, kWebhookTimeout);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, kWebhookConnect);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_PROXY, "");   // как раньше: напрямую, без прокси из окружения
    curl_easy_setopt(curl, CURLOPT_OPENSOCKETFUNCTION, openPublicSocket);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
#else
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, static_cast<long>(CURLPROTO_HTTP | CURLPROTO_HTTPS));
#endif
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Vicinity-Bot-API/1.0");
    const CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    // Оборванное нами длинное тело — не ошибка: код ответа уже получен
    if (code >= 200 && code < 300) return code;
    if (code > 0) why = "Вебхук ответил кодом " + std::to_string(code);
    else why = res == CURLE_OPERATION_TIMEDOUT ? "Вебхук не ответил за 10 секунд" : "Нет соединения с адресом вебхука";
    return code;
}

// Тело файла, который бот попросил скачать по ссылке: копим до лимита, дальше обрываем
struct FetchBody {
    std::string* data = nullptr;
    int64_t max = 0;
    bool tooBig = false;
};
size_t collectBody(char* p, size_t size, size_t n, void* user) {
    auto* f = static_cast<FetchBody*>(user);
    const size_t len = size * n;
    if (static_cast<int64_t>(f->data->size() + len) > f->max) { f->tooBig = true; return 0; }
    f->data->append(p, len);
    return len;
}

enum class Delivered { Done, More, Failed };

// Отправить очередь бота по порядку; адрес перечитывается перед каждым обновлением,
// так что после setWebhook/deleteWebhook старый адрес больше не получает ничего
Delivered deliverBot(int64_t botId) {
    auto db = app().getDbClient();
    for (int n = 0; n < kWebhookBatch; ++n) {
        auto hook = db->execSqlSync("SELECT webhook_url, webhook_secret, webhook_error FROM bots WHERE user_id = ?", botId);
        if (hook.empty() || hook[0]["webhook_url"].isNull()) return Delivered::Done;
        auto row = db->execSqlSync(
            "SELECT update_id, payload FROM bot_updates WHERE bot_id = ? ORDER BY update_id LIMIT 1", botId);
        if (row.empty()) return Delivered::Done;
        const int64_t updateId = row[0]["update_id"].as<int64_t>();
        Json::Value u;
        if (!JsonUtils::parse(row[0]["payload"].as<std::string>(), u) || !u.isObject()) {
            db->execSqlSync("DELETE FROM bot_updates WHERE update_id = ?", updateId);
            continue;
        }
        u["update_id"] = static_cast<Json::Int64>(updateId);
        std::string why;
        const long code = postJson(hook[0]["webhook_url"].as<std::string>(), str(hook[0], "webhook_secret"),
                                   JsonUtils::write(u), why);
        if (code < 200 || code >= 300) {
            // Адрес вебхука не логируем: в нём может быть секрет владельца
            LOG_WARN << "bots: webhook of bot " << botId << " failed: " << why;
            webhookError(botId, why);
            return Delivered::Failed;
        }
        db->execSqlSync("DELETE FROM bot_updates WHERE update_id = ?", updateId);
        if (!hook[0]["webhook_error"].isNull())
            db->execSqlSync("UPDATE bots SET webhook_error = NULL, webhook_error_at = NULL WHERE user_id = ?", botId);
    }
    return Delivered::More;
}

// Пауза перед повтором после n ошибок подряд: 5, 10, 20, 40, потом 60 с
std::chrono::seconds retryPause(int failures) {
    return std::chrono::seconds(std::min(60, 5 << std::min(failures - 1, 4)));
}

void deliveryWorker() {
    for (;;) {
        int64_t botId = 0;
        {
            std::unique_lock<std::mutex> lock(gDel.m);
            gDel.cv.wait(lock, [] { return !gDel.queue.empty(); });
            botId = gDel.queue.front();
            gDel.queue.pop_front();
            gDel.queued.erase(botId);
            gDel.active.insert(botId);
            gDel.again.erase(botId);
        }
        Delivered r = Delivered::Failed;
        try {
            r = deliverBot(botId);
        } catch (const std::exception& e) {
            LOG_WARN << "bots: webhook delivery: " << e.what();
        }
        std::lock_guard<std::mutex> lock(gDel.m);
        gDel.active.erase(botId);
        if (r == Delivered::Failed) {
            auto& b = gDel.backoff[botId];
            b.first += 1;
            b.second = Clock::now() + retryPause(b.first);
        } else {
            gDel.backoff.erase(botId);
            // Пока шла доставка, пришло новое — или пачка не кончилась: в конец очереди, за другими ботами
            if ((r == Delivered::More || gDel.again.count(botId)) && gDel.queued.insert(botId).second) {
                gDel.queue.push_back(botId);
                gDel.cv.notify_one();
            }
        }
        gDel.again.erase(botId);
    }
}
#endif

// Поставить бота в очередь доставки. reset — новый адрес: ждать паузу после ошибок не нужно
void kick(int64_t botId, bool reset) {
#ifdef VICINITY_HAVE_CURL
    if (!gDeliveryStarted) return;
    std::lock_guard<std::mutex> lock(gDel.m);
    if (reset) gDel.backoff.erase(botId);
    if (gDel.active.count(botId)) { gDel.again.insert(botId); return; }
    auto b = gDel.backoff.find(botId);
    if (b != gDel.backoff.end() && Clock::now() < b->second.second) return;   // повторит таймер
    if (gDel.queued.insert(botId).second) {
        gDel.queue.push_back(botId);
        gDel.cv.notify_one();
    }
#else
    (void)botId;
    (void)reset;
#endif
}

// ---------- Разметка HTML ----------

std::string decodeEntity(const std::string& name) {
    if (name == "lt") return "<";
    if (name == "gt") return ">";
    if (name == "amp") return "&";
    if (name == "quot") return "\"";
    if (name == "apos") return "'";
    if (name == "nbsp") return "\xC2\xA0";
    if (name.size() > 1 && name[0] == '#') {
        long cp = 0;
        try {
            cp = (name[1] == 'x' || name[1] == 'X') ? std::stol(name.substr(2), nullptr, 16) : std::stol(name.substr(1));
        } catch (...) { return ""; }
        if (cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return "";
        std::string out;
        if (cp < 0x80) out += static_cast<char>(cp);
        else if (cp < 0x800) out += static_cast<char>(0xC0 | (cp >> 6)), out += static_cast<char>(0x80 | (cp & 0x3F));
        else if (cp < 0x10000)
            out += static_cast<char>(0xE0 | (cp >> 12)), out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)),
                out += static_cast<char>(0x80 | (cp & 0x3F));
        else
            out += static_cast<char>(0xF0 | (cp >> 18)), out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)),
                out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)), out += static_cast<char>(0x80 | (cp & 0x3F));
        return out;
    }
    return "&" + name + ";";
}

bool asciiAlnum(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) != 0;
}

// Буква или цифра перед позицией: латиница, цифры и любой не-ASCII символ (кириллица)
bool letterBefore(char c) {
    return asciiAlnum(c) || static_cast<unsigned char>(c) >= 0x80;
}

bool startsWithCI(const std::string& s, size_t i, const char* prefix) {
    for (size_t k = 0; prefix[k]; ++k)
        if (i + k >= s.size() || std::tolower(static_cast<unsigned char>(s[i + k])) != prefix[k]) return false;
    return true;
}

bool urlStart(const std::string& s, size_t i) {
    return startsWithCI(s, i, "https://") || startsWithCI(s, i, "http://");
}

// Адрес для [подпись](адрес) Vicinity: пробелы, скобки и угловые скобки кодируются
std::string encodeHref(const std::string& url) {
    std::string out;
    for (char c : url) {
        if (c == ' ') out += "%20";
        else if (c == '(') out += "%28";
        else if (c == ')') out += "%29";
        else if (c == '<') out += "%3C";
        else if (c == '>') out += "%3E";
        else out += c;
    }
    return out;
}

// Подпись ссылки — в одну строку
std::string oneLine(std::string s) {
    for (auto& c : s)
        if (c == '\n' || c == '\r') c = ' ';
    return s;
}

// Обычный текст HTML-режима — буквальный, как в Telegram: символы разметки Vicinity экранируются
// («2*3*4» не курсив, «[банк](https://…)» не ссылка, «# » в начале строки не заголовок).
// Адреса и @упоминания остаются как есть: внутри них разметки нет, а обратная косая их ломает
void appendText(std::string& out, const std::string& s, bool raw) {
    if (raw) {
        out += s;
        return;
    }
    size_t i = 0;
    while (i < s.size()) {
        const char c = s[i];
        const bool lineStart = out.empty() || out.back() == '\n';
        const bool afterLetter = i > 0 ? letterBefore(s[i - 1]) : !out.empty() && letterBefore(out.back());
        if ((c == 'h' || c == 'H') && !afterLetter && urlStart(s, i)) {
            size_t j = i;
            while (j < s.size() && !std::isspace(static_cast<unsigned char>(s[j])) && s[j] != '<') ++j;
            out.append(s, i, j - i);
            i = j;
            continue;
        }
        if (c == '@' && !(i > 0 ? asciiAlnum(s[i - 1]) : !out.empty() && asciiAlnum(out.back())) && i + 1 < s.size() &&
            (asciiAlnum(s[i + 1]) || s[i + 1] == '_')) {
            size_t j = i + 1;
            while (j < s.size() && (asciiAlnum(s[j]) || s[j] == '_' || s[j] == '.' || s[j] == '-')) ++j;
            out.append(s, i, j - i);
            i = j;
            continue;
        }
        if (lineStart && (c == '#' || c == '>' || c == '-')) {
            out += '\\';
            out += c;
            ++i;
            continue;
        }
        if (lineStart && std::isdigit(static_cast<unsigned char>(c))) {
            // «1. » в начале строки — нумерованный список: точку экранируем
            size_t j = i;
            while (j < s.size() && std::isdigit(static_cast<unsigned char>(s[j]))) ++j;
            if (j - i <= 9 && j + 1 < s.size() && s[j] == '.' && s[j + 1] == ' ') {
                out.append(s, i, j - i);
                out += "\\.";
                i = j + 1;
                continue;
            }
        }
        if (c == '\\' || c == '*' || c == '_' || c == '~' || c == '`' || c == '|' || c == '[' || c == ']' || c == '<')
            out += '\\';
        out += c;
        ++i;
    }
}

std::string attr(const std::string& tag, const std::string& name) {
    const std::string t = lower(tag);
    const auto pos = t.find(name + "=");
    if (pos == std::string::npos) return "";
    size_t i = pos + name.size() + 1;
    if (i >= tag.size()) return "";
    const char q = tag[i];
    if (q == '"' || q == '\'') {
        const auto end = tag.find(q, i + 1);
        return end == std::string::npos ? "" : tag.substr(i + 1, end - i - 1);
    }
    const auto end = tag.find_first_of(" \t\n>", i);
    return tag.substr(i, end == std::string::npos ? std::string::npos : end - i);
}

std::string decodeAll(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '&') {
            const auto semi = s.find(';', i);
            if (semi != std::string::npos && semi - i <= 10) {
                out += decodeEntity(s.substr(i + 1, semi - i - 1));
                i = semi;
                continue;
            }
        }
        out += s[i];
    }
    return out;
}

std::string fromHtml(const std::string& html) {
    // tag — смысл (span.tg-spoiler → tg-spoiler), raw — имя тега, как его закрывают
    struct Frame { std::string tag, raw; size_t start; std::string href, lang; };
    std::vector<Frame> stack;
    std::string out;
    std::string text;   // обычный текст до следующего тега (уже без сущностей)
    int rawDepth = 0;   // внутри code/pre разметка не экранируется
    const auto flush = [&] {
        appendText(out, text, rawDepth > 0);
        text.clear();
    };
    const auto mark = [](const std::string& t) -> std::string {
        if (t == "b" || t == "strong") return "**";
        if (t == "i" || t == "em") return "*";
        if (t == "u" || t == "ins") return "__";
        if (t == "s" || t == "strike" || t == "del") return "~~";
        if (t == "tg-spoiler") return "||";
        return "";
    };
    size_t i = 0;
    while (i < html.size()) {
        const char c = html[i];
        if (c == '<') {
            const auto close = html.find('>', i);
            if (close == std::string::npos) { text += html.substr(i); break; }
            flush();
            std::string inner = html.substr(i + 1, close - i - 1);
            i = close + 1;
            const bool closing = !inner.empty() && inner[0] == '/';
            if (closing) inner.erase(0, 1);
            const auto nameEnd = inner.find_first_of(" \t\n/");
            const std::string name = lower(inner.substr(0, nameEnd));
            if (!closing) {
                const bool spoiler = name == "span" && lower(attr(inner, "class")).find("tg-spoiler") != std::string::npos;
                Frame f{spoiler ? "tg-spoiler" : name, name, out.size(), "", ""};
                if (name == "a") f.href = decodeAll(attr(inner, "href"));
                if (name == "code" && !stack.empty() && stack.back().tag == "pre") {
                    const std::string cls = attr(inner, "class");
                    // class="language-cpp" → ```cpp; тег — первое слово, только символы, которые понимает клиент
                    if (cls.rfind("language-", 0) == 0) {
                        std::string lang;
                        for (size_t k = 9; k < cls.size() && lang.size() < 20; ++k) {
                            const char ch = cls[k];
                            if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '+' || ch == '#' || ch == '.' || ch == '-')
                                lang += ch;
                            else
                                break;
                        }
                        stack.back().lang = lang;
                    }
                    stack.push_back(f);
                    continue;
                }
                if (name == "code" || name == "pre") ++rawDepth;
                if (name == "br") { out += '\n'; continue; }
                stack.push_back(f);
                continue;
            }
            // Закрывающий тег: снимаем стек до него (незакрытые внутри — закрываем как есть)
            auto it = std::find_if(stack.rbegin(), stack.rend(), [&](const Frame& f) { return f.raw == name; });
            if (it == stack.rend()) continue;
            while (!stack.empty()) {
                Frame f = stack.back();
                stack.pop_back();
                std::string content = out.substr(f.start);
                out.erase(f.start);
                const bool inPre = !stack.empty() && stack.back().tag == "pre";
                if (f.tag == "code" && inPre) {
                    out += content;
                } else if (f.tag == "code") {
                    --rawDepth;
                    out += "`" + content + "`";
                } else if (f.tag == "pre") {
                    --rawDepth;
                    while (!content.empty() && content.back() == '\n') content.pop_back();
                    out += "```" + f.lang + "\n" + content + "\n```";
                } else if (f.tag == "a") {
                    const std::string href = f.href;
                    const std::string lh = lower(href);
                    if (lh.rfind("http://", 0) == 0 || lh.rfind("https://", 0) == 0) {
                        out += content.empty() || content == href ? href
                                                                  : "[" + oneLine(content) + "](" + encodeHref(href) + ")";
                    } else {
                        out += content;   // tg://user и прочие схемы — просто текст
                    }
                } else if (f.tag == "blockquote") {
                    std::string q = "> ";
                    for (char ch : content) {
                        q += ch;
                        if (ch == '\n') q += "> ";
                    }
                    out += q;
                } else {
                    const std::string m = mark(f.tag);
                    out += content.empty() ? content : m + content + m;
                }
                if (f.raw == name) break;
            }
            continue;
        }
        if (c == '&') {
            const auto semi = html.find(';', i);
            if (semi != std::string::npos && semi - i <= 10) {
                text += decodeEntity(html.substr(i + 1, semi - i - 1));
                i = semi + 1;
                continue;
            }
        }
        text += c;
        ++i;
    }
    flush();
    // Незакрытые теги в конце — разметку не достраиваем, текст остаётся
    return out;
}

// Позиция символа ch от from, пропуская экранированные «\x»; npos — нет (или раньше конец строки)
size_t findUnescaped(const std::string& s, size_t from, char ch) {
    for (size_t k = from; k < s.size(); ++k) {
        if (s[k] == '\\') { ++k; continue; }
        if (s[k] == '\n') return std::string::npos;
        if (s[k] == ch) return k;
    }
    return std::string::npos;
}

// MarkdownV2 и старый Markdown Telegram → разметка Vicinity. lineStart — текст начинается с новой строки
std::string fromMarkdown(const std::string& s, bool v2, bool lineStart = true) {
    std::string out;
    size_t i = 0;
    const auto vicinityEscapable = [](char c) {
        return c == '\\' || c == '*' || c == '_' || c == '~' || c == '`' || c == '|' || c == '>' || c == '[' ||
               c == ']' || c == '#' || c == '-' || c == '@' || c == ':' || c == '<';
    };
    while (i < s.size()) {
        const char c = s[i];
        if (c == '\\' && i + 1 < s.size()) {
            const char n = s[i + 1];
            if (vicinityEscapable(n)) out += '\\';
            out += n;
            i += 2;
            lineStart = false;
            continue;
        }
        if (c == '`') {
            // Код и блоки кода переносятся как есть (внутри экранированы только ` и \)
            const bool block = s.compare(i, 3, "```") == 0;
            const std::string fence = block ? "```" : "`";
            const auto end = s.find(fence, i + fence.size());
            if (end != std::string::npos) {
                std::string body = s.substr(i + fence.size(), end - i - fence.size());
                std::string clean;
                for (size_t k = 0; k < body.size(); ++k) {
                    if (body[k] == '\\' && k + 1 < body.size() && (body[k + 1] == '`' || body[k + 1] == '\\')) ++k;
                    clean += body[k];
                }
                out += fence + clean + fence;
                i = end + fence.size();
                lineStart = false;
                continue;
            }
        }
        if (lineStart && v2 && c == '>') {
            out += "> ";
            ++i;
            if (i < s.size() && s[i] == ' ') ++i;
            lineStart = false;
            continue;
        }
        // Голый адрес — как есть: экранирование MarkdownV2 внутри снимается, разметка обрывает адрес
        if ((c == 'h' || c == 'H') && !(i > 0 && letterBefore(s[i - 1])) && urlStart(s, i)) {
            size_t j = i;
            std::string url;
            while (j < s.size()) {
                const char d = s[j];
                if (d == '\\' && j + 1 < s.size() && !std::isspace(static_cast<unsigned char>(s[j + 1]))) {
                    url += s[j + 1];
                    j += 2;
                    continue;
                }
                if (std::isspace(static_cast<unsigned char>(d)) || d == '*' || d == '~' || d == '|' || d == '[' ||
                    d == ']' || d == '(' || d == ')' || d == '`' || d == '<' || d == '>' || (v2 && d == '_'))
                    break;
                url += d;
                ++j;
            }
            out += url;
            i = j;
            lineStart = false;
            continue;
        }
        // @имя — тоже как есть: «@helper\_bot» → «@helper_bot»
        if (c == '@' && !(i > 0 && asciiAlnum(s[i - 1]))) {
            size_t j = i + 1;
            std::string name;
            while (j < s.size()) {
                const char d = s[j];
                if (asciiAlnum(d)) { name += d; ++j; continue; }
                if (d == '\\' && j + 1 < s.size() && (s[j + 1] == '_' || s[j + 1] == '.' || s[j + 1] == '-')) {
                    name += s[j + 1];
                    j += 2;
                    continue;
                }
                if (!v2 && d == '_' && j + 1 < s.size() && asciiAlnum(s[j + 1])) { name += d; ++j; continue; }
                break;
            }
            if (!name.empty()) {
                out += "@" + name;
                i = j;
                lineStart = false;
                continue;
            }
        }
        // [подпись](адрес): подпись — разметка, адрес — как есть (снимаются только экранирования);
        // не http/https (tg://user?id=…) — остаётся одна подпись, как в HTML-режиме
        if (c == '[') {
            const size_t close = findUnescaped(s, i + 1, ']');
            if (close != std::string::npos && close + 1 < s.size() && s[close + 1] == '(') {
                const size_t end = findUnescaped(s, close + 2, ')');
                if (end != std::string::npos) {
                    const std::string label = fromMarkdown(s.substr(i + 1, close - i - 1), v2, false);
                    std::string url;
                    for (size_t k = close + 2; k < end; ++k) {
                        if (s[k] == '\\' && k + 1 < end) ++k;
                        url += s[k];
                    }
                    url = TextUtils::trim(url);
                    const std::string lu = lower(url);
                    if (lu.rfind("http://", 0) == 0 || lu.rfind("https://", 0) == 0)
                        out += label.empty() ? url : "[" + oneLine(label) + "](" + encodeHref(url) + ")";
                    else
                        out += label;
                    i = end + 1;
                    lineStart = false;
                    continue;
                }
            }
            out += "\\[";
            ++i;
            lineStart = false;
            continue;
        }
        if (c == '*') { out += "**"; ++i; lineStart = false; continue; }
        if (c == '_') {
            if (v2 && s.compare(i, 2, "__") == 0) { out += "__"; i += 2; }
            else { out += "*"; ++i; }
            lineStart = false;
            continue;
        }
        if (v2 && c == '~') { out += "~~"; ++i; lineStart = false; continue; }
        out += c;
        lineStart = c == '\n';
        ++i;
    }
    return out;
}

// Длина в единицах UTF-16 (offset и length в entities Bot API)
size_t utf16Len(const std::string& s, size_t from, size_t to) {
    size_t n = 0;
    for (size_t k = from; k < to && k < s.size(); ++k) {
        const unsigned char b = static_cast<unsigned char>(s[k]);
        if ((b & 0xC0) == 0x80) continue;
        n += b >= 0xF0 ? 2 : 1;
    }
    return n;
}

// entities входящего текста: bot_command в начале, mention для @имя, url для голых адресов
Json::Value textEntities(const std::string& text) {
    struct E { size_t from, to; const char* type; };
    std::vector<E> found;
    if (const size_t len = commandLength(text)) found.push_back({0, len, "bot_command"});
    for (size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (c == '@' && !(i > 0 && wordChar(text[i - 1]))) {
            size_t j = i + 1;
            while (j < text.size() && wordChar(text[j])) ++j;
            if (j - i - 1 >= 1 && j - i - 1 <= 32 && (found.empty() || found.back().to <= i)) found.push_back({i, j, "mention"});
            i = j - 1;
        } else if ((c == 'h' || c == 'H') && !(i > 0 && letterBefore(text[i - 1])) && urlStart(text, i)) {
            size_t j = i;
            while (j < text.size() && !std::isspace(static_cast<unsigned char>(text[j])) && text[j] != '<') ++j;
            // Хвостовая пунктуация к адресу не относится (как у клиента)
            while (j > i && std::string(".,:;!?\"')]").find(text[j - 1]) != std::string::npos) --j;
            const size_t scheme = startsWithCI(text, i, "https://") ? 8 : 7;
            if (j > i + scheme && (found.empty() || found.back().to <= i)) found.push_back({i, j, "url"});
            i = std::max(i, j - 1);
        }
    }
    Json::Value arr(Json::arrayValue);
    for (const auto& e : found) {
        Json::Value v;
        v["type"]   = e.type;
        v["offset"] = static_cast<Json::UInt>(utf16Len(text, 0, e.from));
        v["length"] = static_cast<Json::UInt>(utf16Len(text, e.from, e.to));
        arr.append(v);
    }
    return arr;
}

// Отправитель сообщения вебхука канала: не человек, создавший вебхук, а отдельный «бот» без username
Json::Value webhookSender(const Json::Value& hook, const Json::Value& name) {
    Json::Value u;
    u["id"]         = static_cast<Json::Int64>(kWebhookSenderBase + hook["id"].asInt64());
    u["is_bot"]     = true;
    u["first_name"] = name.isString() && !name.asString().empty() ? name.asString() : std::string("Вебхук");
    return u;
}

bool httpUrl(const std::string& url, size_t maxLen, bool httpsOnly = false) {
    if (url.empty() || url.size() > maxLen || !TextUtils::isValidUtf8(url) || TextUtils::hasControlChars(url) ||
        url.find(' ') != std::string::npos)
        return false;
    ParsedUrl u;
    if (!parseUrl(url, u)) return false;
    return u.scheme == "https" || (!httpsOnly && u.scheme == "http");
}

// Расширение файла по URL вложения (имя на сервере), в нижнем регистре
std::string urlExtension(const std::string& url) {
    const auto slash = url.rfind('/');
    const auto dot = url.rfind('.');
    if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "";
    return lower(url.substr(dot + 1));
}

// Вид вложения в Bot API: photo, animation, video, audio, voice или document. Бот выбрал его методом
// (meta.media); у людей — по типу и расширению, как делают клиенты Telegram
std::string mediaKind(const Json::Value& msg) {
    const std::string type = msg["attachment_type"].asString();
    if (msg["kind"].asString() == "voice") return "voice";
    const Json::Value& meta = msg["meta"];
    if (meta.isObject() && meta["media"].isString()) {
        const std::string m = meta["media"].asString();
        if (m == "photo" && type == "image") return m;
        if (m == "document" || m == "animation") return m;
        if ((m == "video" || m == "audio") && type == "file") return m;
    }
    const std::string ext = urlExtension(msg["attachment_url"].asString());
    if (type == "image") return ext == "gif" ? "animation" : "photo";
    // webm бывает и только звуком (запись голоса в Chrome) — без пометки бота это документ
    static const std::set<std::string> kVideo = {"mp4", "m4v", "mov", "mkv"};
    static const std::set<std::string> kAudio = {"mp3", "m4a", "ogg", "oga", "opus", "wav", "aac", "flac"};
    if (kVideo.count(ext)) return "video";
    if (kAudio.count(ext)) return "audio";
    return "document";
}

// Поля вложения в Message: photo | document | video | audio | voice | animation (+ document, как в Telegram)
void addMedia(Json::Value& m, const Json::Value& msg) {
    const std::string url = msg["attachment_url"].asString();
    const std::string id = Bots::fileId(url);
    if (id.empty()) return;
    const std::string kind = mediaKind(msg);
    const Json::Value& meta = msg["meta"];
    auto metaInt = [&meta](const char* k) -> Json::Int64 {
        return meta.isObject() && meta[k].isNumeric() ? static_cast<Json::Int64>(std::llround(meta[k].asDouble())) : 0;
    };
    Json::Value f;
    f["file_id"]        = id;
    f["file_unique_id"] = Bots::fileUniqueId(url);
    if (msg["attachment_size"].asInt64() > 0) f["file_size"] = msg["attachment_size"];
    if (kind == "photo") {
        const auto [w, h] = Uploads::imageSize(url);
        f["width"]  = w;
        f["height"] = h;
        Json::Value sizes(Json::arrayValue);
        sizes.append(f);
        m["photo"] = sizes;
        return;
    }
    std::string mime = Uploads::mimeType(url);
    // Контейнер общий для видео и звука (webm, mp4): у голосового и аудио — audio/…
    if ((kind == "voice" || kind == "audio") && mime.compare(0, 6, "video/") == 0) mime = "audio/" + mime.substr(6);
    f["mime_type"] = mime;
    if (kind == "voice") {
        f["duration"] = metaInt("duration");
        m["voice"] = f;
        return;
    }
    std::string name = msg["attachment_name"].asString();
    if (name.empty()) name = url.substr(url.rfind('/') + 1);
    f["file_name"] = name;
    if (kind == "document") {
        m["document"] = f;
        return;
    }
    if (kind == "audio") {
        f["duration"] = metaInt("duration");
        for (const char* k : {"performer", "title"})
            if (meta.isObject() && meta[k].isString() && !meta[k].asString().empty()) f[k] = meta[k];
        m["audio"] = f;
        return;
    }
    const Json::Value doc = f;
    Json::Int64 w = metaInt("width"), h = metaInt("height");
    if ((w <= 0 || h <= 0) && msg["attachment_type"].asString() == "image") {
        const auto size = Uploads::imageSize(url);
        w = size.first;
        h = size.second;
    }
    f["width"]    = w;
    f["height"]   = h;
    f["duration"] = metaInt("duration");
    m[kind] = f;   // video | animation
    if (kind == "animation") m["document"] = doc;
}

} // namespace

namespace Bots {

void init() {
    const Json::Value& cfg = app().getCustomConfig()["bots"];
    const Json::Value& v = cfg["allow_private_webhooks"];
    gAllowPrivate = v.isBool() ? v.asBool()
                    : v.isString() ? (v.asString() == "1" || lower(v.asString()) == "true")
                    : v.isIntegral() ? v.asInt() != 0 : false;
#ifdef VICINITY_HAVE_CURL
    if (!gDeliveryStarted.exchange(true))
        for (int k = 0; k < kWebhookWorkers; ++k) std::thread(deliveryWorker).detach();
    // Повторы: боты с вебхуком и непустой очередью снова в доставку (kick сам выдерживает паузу после ошибок)
    app().getLoop()->runEvery(5.0, [] {
        try {
            for (const auto& r : app().getDbClient()->execSqlSync(
                     "SELECT b.user_id FROM bots b WHERE b.webhook_url IS NOT NULL "
                     "AND EXISTS (SELECT 1 FROM bot_updates q WHERE q.bot_id = b.user_id)"))
                kick(r["user_id"].as<int64_t>(), false);
        } catch (const std::exception& e) {
            LOG_WARN << "bots: webhook retry: " << e.what();
        }
    });
#endif
    // Очередь — не старше суток, нажатия кнопок — 15 минут, эфемерные — 15 минут
    app().getLoop()->runEvery(600.0, [] {
        try {
            auto db = app().getDbClient();
            db->execSqlSync("DELETE FROM bot_updates WHERE created_at < datetime('now', '-1 day')");
            db->execSqlSync("DELETE FROM bot_callbacks WHERE created_at < datetime('now', '-15 minutes')");
            db->execSqlSync("DELETE FROM bot_webapp_queries WHERE created_at < datetime('now', '-1 hour')");
        } catch (const std::exception& e) {
            LOG_WARN << "bots: cleanup: " << e.what();
        }
        std::lock_guard<std::mutex> lock(gEphMutex);
        pruneEphemeral(Clock::now());
    });
}

bool allowPrivateWebhooks() { return gAllowPrivate; }

// ---------- Мини-приложения ----------

std::string webAppKey(const std::string& token) { return CryptoUtils::hmacSha256Hex("WebAppData", token); }

// Браузер разбирает адрес по WHATWG URL: «\» там — тот же «/», %-коды и полноширинные цифры в хосте раскрываются,
// а «127.1», «0x7f000001» или «2130706433» — это IPv4. Такие записи не пропускаем вовсе: иначе проверка частных адресов
// видела бы одно имя, а браузер открыл бы другое
std::string webAppHost(const std::string& url) {
    if (url.find('\\') != std::string::npos) return "";
    ParsedUrl u;
    if (!parseUrl(url, u)) return "";
    std::string h = u.host;
    if (u.origin.compare(u.scheme.size() + 3, 1, "[") == 0) {
        unsigned char b[16];
        return inet_pton(AF_INET6, h.c_str(), b) == 1 ? h : "";
    }
    if (!h.empty() && h.back() == '.') h.pop_back();
    if (h.empty() || h.size() > 253) return "";
    for (unsigned char c : h)
        if (!(std::isalnum(c) || c == '-' || c == '.' || c == '_')) return "";
    // Последняя метка — число (десятичное или 0x…): для браузера это IPv4, принимаем только каноничный a.b.c.d
    const std::string last = h.substr(h.rfind('.') == std::string::npos ? 0 : h.rfind('.') + 1);
    const bool decimal = !last.empty() && std::all_of(last.begin(), last.end(), [](unsigned char c) { return std::isdigit(c); });
    const bool hex = last.size() >= 2 && last[0] == '0' && last[1] == 'x' &&
                     std::all_of(last.begin() + 2, last.end(), [](unsigned char c) { return std::isxdigit(c); });
    if (decimal || hex) {
        unsigned char b[4];
        if (inet_pton(AF_INET, h.c_str(), b) != 1) return "";
    }
    return h;
}

std::string requestHost(const std::string& hostHeader) {
    std::string h = lower(hostHeader);
    if (!h.empty() && h[0] == '[') {
        const auto close = h.find(']');
        return close == std::string::npos ? std::string() : h.substr(1, close - 1);
    }
    h = h.substr(0, h.find(':'));
    if (!h.empty() && h.back() == '.') h.pop_back();
    return h;
}

bool webAppUrlOk(const std::string& url) {
    if (!httpUrl(url, 512)) return false;
    const std::string host = webAppHost(url);
    if (host.empty()) return false;
    const std::string scheme = lower(url.substr(0, url.find("://")));
    if (scheme == "https") return gAllowPrivate || !privateHost(host);
    return gAllowPrivate;   // http — только для разработки и e2e
}

bool parseMenuButton(const Json::Value& in, Json::Value& out, std::string& err) {
    if (!in.isObject()) { err = "menu_button must be an object"; return false; }
    const std::string type = JsonUtils::getStr(in, "type");
    out = Json::Value(Json::objectValue);
    if (type == "default" || type == "commands") {
        out["type"] = type;
        return true;
    }
    if (type != "web_app") { err = "unsupported menu button type"; return false; }
    const std::string text = TextUtils::trim(JsonUtils::getStr(in, "text"));
    if (text.empty() || !TextUtils::isValidUtf8(text) || TextUtils::utf8Length(text) > 64 || TextUtils::hasControlChars(text)) {
        err = "menu button text must be 1-64 characters";
        return false;
    }
    const std::string url = in["web_app"].isObject() ? JsonUtils::getStr(in["web_app"], "url") : std::string();
    if (!webAppUrlOk(url)) { err = "BUTTON_URL_INVALID: web_app.url must be an https link"; return false; }
    out["type"] = "web_app";
    out["text"] = text;
    out["web_app"]["url"] = url;
    return true;
}

Json::Value menuButton(const drogon::orm::DbClientPtr& db, int64_t botId, int64_t channelId) {
    auto r = db->execSqlSync("SELECT button FROM bot_menu_buttons WHERE bot_id = ? AND channel_id IN (0, ?) "
                             "ORDER BY channel_id DESC LIMIT 1", botId, channelId);
    Json::Value b;
    if (r.empty() || !JsonUtils::parse(r[0]["button"].as<std::string>(), b) || !b.isObject()) {
        b = Json::Value(Json::objectValue);
        b["type"] = "default";
    }
    return b;
}

std::string urlEncode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    out.reserve(s.size() * 3);
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out += static_cast<char>(c);
        } else {
            out += '%';
            out += hex[c >> 4];
            out += hex[c & 15];
        }
    }
    return out;
}

std::string signInitData(const std::vector<std::pair<std::string, std::string>>& fields, const std::string& keyHex) {
    std::string query;
    for (const auto& [k, v] : fields) {
        if (!query.empty()) query += '&';
        query += k + "=" + urlEncode(v);
    }
    if (keyHex.size() != 64) return query;
    std::string key;
    key.reserve(32);
    for (size_t i = 0; i < 64; i += 2) key += static_cast<char>(std::stoi(keyHex.substr(i, 2), nullptr, 16));
    auto sorted = fields;
    std::sort(sorted.begin(), sorted.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    std::string check;
    for (const auto& [k, v] : sorted) {
        if (!check.empty()) check += '\n';
        check += k + "=" + v;
    }
    return query + "&hash=" + CryptoUtils::hmacSha256Hex(key, check);
}

Token newToken(int64_t botId) {
    Token t;
    t.token = std::to_string(botId) + ":" + CryptoUtils::randomHex(24);
    t.hash = CryptoUtils::sha256Hex(t.token);
    t.hint = t.token.substr(t.token.size() - 4);
    t.webappKey = webAppKey(t.token);
    return t;
}

int64_t authenticate(const drogon::orm::DbClientPtr& db, const std::string& token) {
    const auto colon = token.find(':');
    if (colon == std::string::npos || colon == 0 || token.size() > 128) return 0;
    std::string hash = CryptoUtils::sha256Hex(token);
    // Бот перестаёт работать, если заблокирован он сам или его владелец
    auto r = db->execSqlSync("SELECT b.user_id, b.webapp_key IS NULL AS no_key FROM bots b JOIN users u ON u.id = b.user_id "
                             "JOIN users o ON o.id = b.owner_id "
                             "WHERE b.token_hash = ? AND u.banned = 0 AND o.banned = 0", hash);
    if (r.empty()) return 0;
    const int64_t id = r[0]["user_id"].as<int64_t>();
    // Номер в начале токена должен совпадать с ботом (как в Telegram)
    if (token.substr(0, colon) != std::to_string(id)) return 0;
    // Бот создан до мини-приложений: открытый токен виден только сейчас — выводим ключ подписи initData
    if (r[0]["no_key"].as<int>() != 0) {
        std::string key = webAppKey(token);
        db->execSqlSync("UPDATE bots SET webapp_key = ? WHERE user_id = ? AND webapp_key IS NULL", key, id);
    }
    return id;
}

bool isBot(const drogon::orm::DbClientPtr& db, int64_t userId) {
    auto r = db->execSqlSync("SELECT is_bot FROM users WHERE id = ?", userId);
    return !r.empty() && !r[0]["is_bot"].isNull() && r[0]["is_bot"].as<int>() != 0;
}

std::string usernameProblem(const std::string& username) {
    if (username.size() < 5 || username.size() > 32) return "Имя бота — от 5 до 32 символов";
    for (char c : username)
        if (!(std::islower(static_cast<unsigned char>(c)) || std::isdigit(static_cast<unsigned char>(c)) || c == '_'))
            return "В имени бота допустимы только латинские буквы, цифры и _";
    if (username.compare(username.size() - 3, 3, "bot") != 0) return "Имя бота должно оканчиваться на bot";
    return "";
}

Json::Value botObject(const drogon::orm::DbClientPtr& db, int64_t botId) {
    auto r = db->execSqlSync(
        "SELECT u.id, u.username, u.display_name, u.avatar_path, b.description, b.token_hint, b.read_all, "
        "b.webhook_url, b.webhook_error, b.commands, b.owner_id, b.created_at FROM bots b JOIN users u ON u.id = b.user_id "
        "WHERE b.user_id = ?", botId);
    if (r.empty()) return Json::Value(Json::nullValue);
    const auto& row = r[0];
    Json::Value b;
    b["id"]            = static_cast<Json::Int64>(row["id"].as<int64_t>());
    b["username"]      = row["username"].as<std::string>();
    b["display_name"]  = row["display_name"].as<std::string>();
    b["avatar_path"]   = str(row, "avatar_path");
    b["description"]   = str(row, "description");
    b["token_hint"]    = str(row, "token_hint");
    b["read_all"]      = row["read_all"].as<int>() != 0;
    b["webhook_url"]   = str(row, "webhook_url");
    b["webhook_error"] = str(row, "webhook_error");
    b["owner_id"]      = static_cast<Json::Int64>(row["owner_id"].as<int64_t>());
    b["created_at"]    = str(row, "created_at");
    Json::Value commands(Json::arrayValue);
    if (!JsonUtils::parse(str(row, "commands"), commands) || !commands.isArray()) commands = Json::Value(Json::arrayValue);
    b["commands"] = commands;
    Json::Value servers(Json::arrayValue);
    for (const auto& s : db->execSqlSync("SELECT s.id, s.name FROM servers s JOIN server_members m ON m.server_id = s.id "
                                         "WHERE m.user_id = ? ORDER BY s.name COLLATE NOCASE", botId)) {
        Json::Value v;
        v["id"]   = static_cast<Json::Int64>(s["id"].as<int64_t>());
        v["name"] = s["name"].as<std::string>();
        servers.append(v);
    }
    b["servers"] = servers;
    return b;
}

Json::Value tgUser(const drogon::orm::DbClientPtr& db, int64_t userId) {
    Json::Value u;
    u["id"] = static_cast<Json::Int64>(userId);
    auto r = db->execSqlSync("SELECT username, display_name, is_bot FROM users WHERE id = ?", userId);
    u["is_bot"]     = !r.empty() && r[0]["is_bot"].as<int>() != 0;
    u["first_name"] = r.empty() ? std::string("Удалённый пользователь") : r[0]["display_name"].as<std::string>();
    if (!r.empty()) u["username"] = r[0]["username"].as<std::string>();
    if (!u["is_bot"].asBool()) u["language_code"] = "ru";
    return u;
}

Json::Value tgChat(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t botId) {
    Json::Value c;
    c["id"] = static_cast<Json::Int64>(channelId);
    auto ch = db->execSqlSync("SELECT type, name, server_id FROM channels WHERE id = ?", channelId);
    if (ch.empty()) {
        c["type"] = "group";
        return c;
    }
    const std::string type = ch[0]["type"].as<std::string>();
    const std::string name = str(ch[0], "name");
    if (!ch[0]["server_id"].isNull()) {
        auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", ch[0]["server_id"].as<int64_t>());
        c["type"]  = "supergroup";
        c["title"] = "#" + name + (s.empty() ? std::string() : " · " + s[0]["name"].as<std::string>());
    } else if (type == "dm") {
        c["type"] = "private";
        auto peer = db->execSqlSync(
            "SELECT u.username, u.display_name FROM channel_members m JOIN users u ON u.id = m.user_id "
            "WHERE m.channel_id = ? AND m.user_id != ? LIMIT 1", channelId, botId);
        if (!peer.empty()) {
            c["first_name"] = peer[0]["display_name"].as<std::string>();
            c["username"]   = peer[0]["username"].as<std::string>();
        }
    } else {
        c["type"]  = "group";
        c["title"] = name;
    }
    return c;
}

namespace {
Json::Value buildMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t botId, bool edited,
                         const Json::Value* chat);
}

Json::Value tgMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t botId, bool edited) {
    return buildMessage(db, msg, botId, edited, nullptr);
}

namespace {
// chat — уже построенный Chat (для reply_to_message того же чата), nullptr — построить
Json::Value buildMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t botId, bool edited,
                         const Json::Value* chat) {
    Json::Value m;
    const int64_t channelId = msg["channel_id"].asInt64();
    m["message_id"] = msg["id"];
    m["from"] = msg["webhook"].isObject() ? webhookSender(msg["webhook"], msg["author_name"])
                                          : tgUser(db, msg["author_id"].asInt64());
    m["chat"] = chat ? *chat : tgChat(db, channelId, botId);
    m["date"] = static_cast<Json::Int64>(unixTime(msg["created_at"].asString()));
    const std::string text = msg["text"].asString();
    if (!text.empty()) {
        m["text"] = text;
        const Json::Value entities = textEntities(text);
        if (!entities.empty()) m["entities"] = entities;
    }
    if (edited || msg["edited"].asBool()) m["edit_date"] = static_cast<Json::Int64>(std::time(nullptr));
    // Ответ: исходное сообщение целиком (с photo/document и caption, как в Telegram), без своего reply_to_message
    Json::Value replied(Json::nullValue);
    if (msg["reply"].isObject() && msg["reply"]["id"].asInt64() > 0) {
        replied = Messages::load(db, msg["reply"]["id"].asInt64());
        if (replied.isObject() && replied["channel_id"].asInt64() == channelId) {
            replied["reply"] = Json::Value(Json::nullValue);
            m["reply_to_message"] = buildMessage(db, replied, botId, false, &m["chat"]);
        } else {
            replied = Json::Value(Json::nullValue);
        }
    }
    if (msg["reply"].isObject() && replied.isNull()) {
        Json::Value r;
        r["message_id"] = msg["reply"]["id"];
        r["from"]       = msg["reply"]["webhook"].isObject()
                              ? webhookSender(msg["reply"]["webhook"], msg["reply"]["author_name"])
                              : tgUser(db, msg["reply"]["author_id"].asInt64());
        r["chat"]       = m["chat"];
        r["date"]       = 0;
        if (!msg["reply"]["text"].asString().empty()) r["text"] = msg["reply"]["text"];
        m["reply_to_message"] = r;
    }
    if (msg["reply_markup"].isObject()) m["reply_markup"] = msg["reply_markup"];
    // Альбом sendMediaGroup: общий media_group_id у всех его сообщений
    if (msg["meta"].isObject() && msg["meta"]["media_group_id"].isString())
        m["media_group_id"] = msg["meta"]["media_group_id"];
    // Вложение: photo/document/… с file_id (§21.7), текст становится подписью
    if (!msg["attachment_url"].asString().empty()) {
        addMedia(m, msg);
        if (m.isMember("text")) {
            m["caption"] = m["text"];
            m.removeMember("text");
            if (m.isMember("entities")) {
                m["caption_entities"] = m["entities"];
                m.removeMember("entities");
            }
        }
    }
    // Расширение Vicinity: вложение сообщения (файл или картинка) ссылкой
    if (!msg["attachment_url"].asString().empty()) {
        Json::Value a;
        a["url"]  = msg["attachment_url"];
        a["name"] = msg["attachment_name"];
        a["size"] = msg["attachment_size"];
        a["type"] = msg["attachment_type"];
        m["attachment"] = a;
    }
    return m;
}
} // namespace

HttpResponsePtr ok(const Json::Value& result) {
    Json::Value v;
    v["ok"] = true;
    v["result"] = result;
    return HttpResponse::newHttpJsonResponse(v);
}

HttpResponsePtr fail(int code, const std::string& description, int retryAfter) {
    Json::Value v;
    v["ok"] = false;
    v["error_code"] = code;
    v["description"] = description;
    if (retryAfter > 0) v["parameters"]["retry_after"] = retryAfter;
    auto resp = HttpResponse::newHttpJsonResponse(v);
    resp->setStatusCode(static_cast<HttpStatusCode>(code));
    return resp;
}

std::string convertText(const std::string& text, const std::string& parseMode) {
    const std::string mode = lower(parseMode);
    if (mode == "html") return fromHtml(text);
    if (mode == "markdownv2") return fromMarkdown(text, true);
    if (mode == "markdown") return fromMarkdown(text, false);
    return text;
}

bool parseMarkup(const Json::Value& in, Json::Value& out, std::string& err, bool webhookOnly) {
    out = Json::Value(Json::nullValue);
    Json::Value m = in;
    if (m.isNull()) return true;
    if (m.isString()) {
        if (m.asString().empty()) return true;
        if (!JsonUtils::parse(m.asString(), m)) { err = "can't parse reply keyboard markup JSON object"; return false; }
    }
    if (!m.isObject()) { err = "can't parse reply keyboard markup JSON object"; return false; }
    if (!m.isMember("inline_keyboard")) return true;   // reply/remove/force_reply — не поддерживаются, игнорируем
    const Json::Value& rows = m["inline_keyboard"];
    if (!rows.isArray()) { err = "field \"inline_keyboard\" of the InlineKeyboardMarkup should be an Array"; return false; }
    Json::Value clean(Json::arrayValue);
    int total = 0;
    for (const auto& row : rows) {
        if (!row.isArray()) { err = "inline keyboard row should be an Array"; return false; }
        if (row.empty()) continue;
        if (row.size() > 8) { err = "too many buttons in a row (at most 8)"; return false; }
        Json::Value cleanRow(Json::arrayValue);
        for (const auto& b : row) {
            if (!b.isObject()) { err = "inline keyboard button should be an Object"; return false; }
            const std::string text = JsonUtils::getStr(b, "text");
            if (text.empty() || !TextUtils::isValidUtf8(text) || TextUtils::utf8Length(text) > 64 ||
                TextUtils::hasControlChars(text)) {
                err = "button text must be 1-64 characters";
                return false;
            }
            Json::Value cb;
            cb["text"] = text;
            int kinds = 0;
            if (b.isMember("callback_data")) {
                ++kinds;
                const std::string data = JsonUtils::getStr(b, "callback_data");
                if (data.empty() || data.size() > 64 || !TextUtils::isValidUtf8(data)) {
                    err = "BUTTON_DATA_INVALID: callback_data must be 1-64 bytes";
                    return false;
                }
                cb["callback_data"] = data;
            }
            if (b.isMember("url")) {
                ++kinds;
                const std::string url = JsonUtils::getStr(b, "url");
                if (!httpUrl(url, 512)) { err = "BUTTON_URL_INVALID: only http and https links up to 512 characters"; return false; }
                cb["url"] = url;
            }
            if (b.isMember("copy_text")) {
                ++kinds;
                const std::string t = JsonUtils::getStr(b["copy_text"], "text");
                if (t.empty() || !TextUtils::isValidUtf8(t) || TextUtils::utf8Length(t) > 256) {
                    err = "copy_text.text must be 1-256 characters";
                    return false;
                }
                cb["copy_text"]["text"] = t;
            }
            if (b.isMember("web_app")) {
                ++kinds;
                const std::string url = JsonUtils::getStr(b["web_app"], "url");
                if (!webAppUrlOk(url)) { err = "web_app.url must be an https link"; return false; }
                cb["web_app"]["url"] = url;
            }
            if (kinds == 0) {
                err = "unsupported inline keyboard button: use callback_data, url, copy_text or web_app";
                return false;
            }
            if (kinds > 1) { err = "inline keyboard button must have exactly one action"; return false; }
            if (webhookOnly && (cb.isMember("callback_data") || cb.isMember("web_app"))) {
                err = "Вебхук может добавлять только кнопки-ссылки (url) и копирование (copy_text)";
                return false;
            }
            cleanRow.append(cb);
            ++total;
        }
        clean.append(cleanRow);
    }
    if (clean.size() > 10) { err = "too many rows in inline keyboard (at most 10)"; return false; }
    if (total > 50) { err = "too many buttons in inline keyboard (at most 50)"; return false; }
    if (clean.empty()) return true;
    out["inline_keyboard"] = clean;
    return true;
}

bool markupHasCallback(const Json::Value& markup, const std::string& data) {
    if (!markup.isObject() || !markup["inline_keyboard"].isArray()) return false;
    for (const auto& row : markup["inline_keyboard"])
        if (row.isArray())
            for (const auto& b : row)
                if (b.isObject() && b["callback_data"].isString() && b["callback_data"].asString() == data) return true;
    return false;
}

std::string webhookUrlProblem(const std::string& url) {
#ifndef VICINITY_HAVE_CURL
    (void)url;
    return "bad webhook: webhooks are not supported on this server, use getUpdates";
#endif
    if (url.size() > 1024 || !TextUtils::isValidUtf8(url) || TextUtils::hasControlChars(url) ||
        url.find(' ') != std::string::npos)
        return "bad webhook: invalid URL";
    ParsedUrl u;
    if (!parseUrl(url, u)) return "bad webhook: invalid URL";
    if (u.scheme != "https" && !(u.scheme == "http" && gAllowPrivate))
        return "bad webhook: An HTTPS URL must be provided for webhook";
    if (u.scheme != "https" && u.scheme != "http") return "bad webhook: An HTTPS URL must be provided for webhook";
    if (!gAllowPrivate && privateHost(u.host)) return "bad webhook: IP address is reserved or private";
    return "";
}

// ---------- Файлы ----------

std::string fileId(const std::string& url) {
    const std::string type = Uploads::attachmentType(url);
    if (type.empty()) return "";
    return std::string("vc") + (type == "image" ? "a" : "f") + "_" + url.substr(url.rfind('/') + 1);
}

std::string fileUniqueId(const std::string& url) {
    const std::string id = fileId(url);
    if (id.empty()) return "";
    // Один и тот же файл у копий (повтор по file_id — жёсткая ссылка, Uploads::duplicate), как в Telegram
    if (const std::string same = Uploads::fileIdentity(url); !same.empty())
        return "vu" + CryptoUtils::sha256Hex("file:" + same).substr(0, 20);
    // Файла уже нет: имя — 32 hex случайных, первые 20 однозначно указывают на него
    return "vu" + id.substr(4, 20);
}

std::string urlFromFileId(const std::string& id) {
    if (id.size() < 6 || id.size() > 64 || id.compare(0, 2, "vc") != 0 || id[3] != '_') return "";
    const std::string dir = id[2] == 'a' ? "attachments" : id[2] == 'f' ? "files" : "";
    if (dir.empty()) return "";
    const std::string url = "/uploads/" + dir + "/" + id.substr(4);
    return Uploads::isUploadUrl(url, dir) ? url : "";
}

std::string filePath(const std::string& url) {
    if (Uploads::attachmentType(url).empty()) return "";
    return url.substr(std::string("/uploads/").size());
}

bool canFetchUrls() {
#ifdef VICINITY_HAVE_CURL
    return true;
#else
    return false;
#endif
}

std::string fetchUrlProblem(const std::string& url) {
    if (url.size() > 2048 || !TextUtils::isValidUtf8(url) || TextUtils::hasControlChars(url) ||
        url.find(' ') != std::string::npos)
        return "wrong file identifier/HTTP URL specified";
    ParsedUrl u;
    if (!parseUrl(url, u) || (u.scheme != "https" && u.scheme != "http"))
        return "wrong file identifier/HTTP URL specified";
    if (!gAllowPrivate && privateHost(u.host)) return "wrong HTTP URL specified: the address is private or local";
    return "";
}

bool fetchUrl(const std::string& url, int64_t maxBytes, std::string& data, std::string& contentType, std::string& why,
              long timeoutMs) {
#ifdef VICINITY_HAVE_CURL
    if (const std::string p = fetchUrlProblem(url); !p.empty()) { why = p; return false; }
    if (timeoutMs <= 0 || maxBytes <= 0) {
        why = timeoutMs <= 0 ? "failed to get HTTP URL content" : "file is too big";
        return false;
    }
    CURL* curl = curl_easy_init();
    if (!curl) { why = "failed to get HTTP URL content"; return false; }
    data.clear();
    FetchBody body{&data, maxBytes};
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, collectBody);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_MAXFILESIZE_LARGE, static_cast<curl_off_t>(maxBytes));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, std::min(timeoutMs, kFetchTimeoutMs));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, kWebhookConnect);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    // Перенаправления — да, но каждое новое соединение проходит openPublicSocket: частный адрес
    // не откроется ни напрямую, ни через перенаправление, ни через DNS
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 3L);
    curl_easy_setopt(curl, CURLOPT_PROXY, "");
    curl_easy_setopt(curl, CURLOPT_OPENSOCKETFUNCTION, openPublicSocket);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
#else
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, static_cast<long>(CURLPROTO_HTTP | CURLPROTO_HTTPS));
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, static_cast<long>(CURLPROTO_HTTP | CURLPROTO_HTTPS));
#endif
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Vicinity-Bot-API/1.0");
    const CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    char* ct = nullptr;
    curl_easy_getinfo(curl, CURLINFO_CONTENT_TYPE, &ct);
    contentType = ct ? ct : "";
    curl_easy_cleanup(curl);
    if (body.tooBig || res == CURLE_FILESIZE_EXCEEDED) {
        why = "file is too big";
        data.clear();
        return false;
    }
    if (res != CURLE_OK || code < 200 || code >= 300) {
        why = "failed to get HTTP URL content";
        data.clear();
        return false;
    }
    if (data.empty()) { why = "file must be non-empty"; return false; }
    return true;
#else
    (void)url; (void)maxBytes; (void)data; (void)contentType; (void)timeoutMs;
    why = "sending files by URL is not supported on this server";
    return false;
#endif
}

void onMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t channelId, bool edited) {
    try {
        auto ch = db->execSqlSync("SELECT type, server_id FROM channels WHERE id = ?", channelId);
        if (ch.empty()) return;
        const bool server = !ch[0]["server_id"].isNull();
        const std::string type = ch[0]["type"].as<std::string>();
        auto bots = server
            ? db->execSqlSync("SELECT b.user_id, u.username, b.read_all FROM bots b JOIN users u ON u.id = b.user_id "
                              "JOIN server_members sm ON sm.user_id = b.user_id AND sm.server_id = ?",
                              ch[0]["server_id"].as<int64_t>())
            : db->execSqlSync("SELECT b.user_id, u.username, b.read_all FROM bots b JOIN users u ON u.id = b.user_id "
                              "JOIN channel_members cm ON cm.user_id = b.user_id AND cm.channel_id = ?",
                              channelId);
        if (bots.empty()) return;
        const int64_t author = msg["author_id"].asInt64();
        const std::string text = msg["text"].asString();
        std::string cmd, at;
        const bool command = parseCommand(text, cmd, at);
        const int64_t replyAuthor = msg["reply"].isObject() ? msg["reply"]["author_id"].asInt64() : 0;
        for (const auto& b : bots) {
            const int64_t botId = b["user_id"].as<int64_t>();
            if (botId == author) continue;
            const std::string username = b["username"].as<std::string>();
            const bool deliver = (!server && type == "dm") || b["read_all"].as<int>() != 0 ||
                                 (command && (at.empty() || lower(at) == lower(username))) ||
                                 mentions(text, username) || replyAuthor == botId;
            if (!deliver) continue;
            Json::Value update;
            update[edited ? "edited_message" : "message"] = tgMessage(db, msg, botId, edited);
            enqueue(db, botId, update);
        }
    } catch (const std::exception& e) {
        LOG_WARN << "bots: onMessage: " << e.what();
    }
}

void enqueue(const drogon::orm::DbClientPtr& db, int64_t botId, const Json::Value& update) {
    try {
        auto hook = db->execSqlSync("SELECT webhook_url, allowed_updates FROM bots WHERE user_id = ?", botId);
        if (hook.empty()) return;
        // allowed_updates (getUpdates или setWebhook) действует на обновления, созданные после вызова
        Json::Value allowed;
        if (JsonUtils::parse(str(hook[0], "allowed_updates"), allowed) && allowed.isArray() && !allowed.empty()) {
            bool match = false;
            for (const auto& t : allowed) match = match || (t.isString() && t.asString() == updateType(update));
            if (!match) return;
        }
        auto ins = db->execSqlSync("INSERT INTO bot_updates(bot_id, payload) VALUES(?, ?) RETURNING update_id", botId,
                                   JsonUtils::write(update));
        const int64_t updateId = ins[0]["update_id"].as<int64_t>();
        // Очередь не больше kQueueMax: старые выпадают
        db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ? AND update_id <= "
                        "(SELECT update_id FROM bot_updates WHERE bot_id = ? ORDER BY update_id DESC LIMIT 1 OFFSET ?)",
                        botId, botId, static_cast<int64_t>(kQueueMax));
        (void)updateId;
        if (!str(hook[0], "webhook_url").empty()) {
            kick(botId, false);
            return;
        }
        wake(botId);
    } catch (const std::exception& e) {
        LOG_WARN << "bots: enqueue: " << e.what();
    }
}

void getUpdates(int64_t botId, int64_t offset, int limit, int timeout, const std::optional<Json::Value>& allowed,
                std::function<void(const HttpResponsePtr&)>&& cb) {
    auto db = app().getDbClient();
    if (allowed) setAllowedUpdates(db, botId, *allowed);
    offset = normalizeOffset(db, botId, offset);
    Json::Value now = fetch(db, botId, offset, limit);
    if (!now.empty() || timeout <= 0) {
        cb(ok(now));
        return;
    }
    Waiter w;
    w.id = ++gWaiterSeq;
    w.offset = offset;
    w.limit = limit;
    w.cb = std::move(cb);
    const uint64_t id = w.id;
    std::optional<Waiter> previous;
    {
        std::lock_guard<std::mutex> lock(gWaitMutex);
        auto it = gWaiters.find(botId);
        if (it != gWaiters.end()) previous = std::move(it->second);
        gWaiters[botId] = std::move(w);
    }
    // Новый опрос того же бота завершает предыдущий пустым ответом
    if (previous) previous->cb(ok(Json::Value(Json::arrayValue)));
    app().getLoop()->runAfter(static_cast<double>(timeout), [botId, id] {
        if (auto w = takeWaiter(botId, id)) w->cb(ok(Json::Value(Json::arrayValue)));
    });
    // Обновление могло прийти между первой выборкой и постановкой в ожидание
    try {
        auto again = db->execSqlSync("SELECT 1 FROM bot_updates WHERE bot_id = ? AND update_id >= ? LIMIT 1", botId, offset);
        if (!again.empty())
            if (auto w = takeWaiter(botId, id)) answerWaiter(botId, *w);
    } catch (...) {}
}

void cancelWaiter(int64_t botId, const HttpResponsePtr& resp) {
    if (auto w = takeWaiter(botId)) w->cb(resp);
}

void flushToWebhook(int64_t botId) {
    kick(botId, true);
}

void setAllowedUpdates(const drogon::orm::DbClientPtr& db, int64_t botId, const Json::Value& list) {
    if (!list.isArray()) return;
    Json::Value clean(Json::arrayValue);
    for (const auto& t : list)
        if (t.isString() && t.asString().size() <= 64 && clean.size() < 32) clean.append(t.asString());
    std::optional<std::string> stored;
    if (!clean.empty()) {
        std::string w = JsonUtils::write(clean);
        while (!w.empty() && w.back() == '\n') w.pop_back();
        stored = w;
    }
    db->execSqlSync("UPDATE bots SET allowed_updates = ? WHERE user_id = ?", stored, botId);
}

void forget(int64_t botId, const HttpResponsePtr& resp) {
    cancelWaiter(botId, resp);
#ifdef VICINITY_HAVE_CURL
    {
        std::lock_guard<std::mutex> lock(gDel.m);
        gDel.backoff.erase(botId);
        gDel.again.erase(botId);
    }
#endif
    std::lock_guard<std::mutex> lock(gEphMutex);
    auto it = gEphByBot.find(botId);
    if (it == gEphByBot.end()) return;
    for (const auto& id : it->second) {
        auto e = gEphemeral.find(id);
        if (e == gEphemeral.end()) continue;
        gEphBytes -= e->second.message.size();
        gEphemeral.erase(e);
    }
    gEphByBot.erase(it);
    gEphBotUsage.erase(botId);
}

void rememberEphemeral(const std::string& id, const Ephemeral& e) {
    // Для нажатия нужны только id, автор, текст и кнопки — остальное не храним
    Json::Value m;
    for (const char* k : {"id", "channel_id", "author_id", "author_name", "created_at", "text", "reply_markup",
                          "ephemeral", "ephemeral_id"})
        if (e.message.isMember(k)) m[k] = e.message[k];
    std::string json = JsonUtils::write(m);
    std::lock_guard<std::mutex> lock(gEphMutex);
    const auto now = Clock::now();
    pruneEphemeral(now);
    auto& usage = gEphBotUsage[e.botId];
    auto& mine = gEphByBot[e.botId];
    // Сначала свои старые: один бот не вытесняет эфемерные других ботов
    while (!mine.empty() && (usage.first + 1 > kEphMaxPerBot || usage.second + json.size() > kEphMaxBytesPerBot)) {
        dropEphemeral(mine.front());
        mine.pop_front();
    }
    while (!gEphOrder.empty() && (gEphemeral.size() + 1 > kEphMaxEntries || gEphBytes + json.size() > kEphMaxBytes)) {
        dropEphemeral(gEphOrder.front());
        gEphOrder.pop_front();
    }
    gEphBytes += json.size();
    usage.first += 1;
    usage.second += json.size();
    gEphemeral[id] = EphSlot{e.botId, e.userId, e.channelId, std::move(json), now};
    gEphOrder.push_back(id);
    mine.push_back(id);
}

std::optional<Ephemeral> findEphemeral(const std::string& id) {
    std::lock_guard<std::mutex> lock(gEphMutex);
    auto it = gEphemeral.find(id);
    if (it == gEphemeral.end() || Clock::now() - it->second.at > std::chrono::seconds(kEphemeralTtl))
        return std::nullopt;
    Ephemeral e;
    e.botId = it->second.botId;
    e.userId = it->second.userId;
    e.channelId = it->second.channelId;
    if (!JsonUtils::parse(it->second.message, e.message)) return std::nullopt;
    return e;
}

} // namespace Bots
