#include "WebPush.h"
#include "../managers/WSManager.h"
#include "Broadcast.h"
#include "JsonUtils.h"
#include "TextUtils.h"
#include <drogon/drogon.h>
#include <openssl/bn.h>
#include <openssl/ec.h>
#include <openssl/ecdsa.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/x509.h>
#include <cctype>
#include <condition_variable>
#include <map>
#include <cstring>
#include <ctime>
#include <deque>
#include <mutex>
#include <set>
#include <thread>
#include <vector>
#ifdef VICINITY_HAVE_CURL
#include <curl/curl.h>
#endif

using namespace drogon;

namespace {

using Bytes = std::vector<unsigned char>;

// ── base64url без выравнивания (RFC 7515) ──

const char* const kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

std::string b64url(const unsigned char* data, size_t len) {
    std::string out;
    out.reserve((len + 2) / 3 * 4);
    for (size_t i = 0; i < len; i += 3) {
        const unsigned v = (data[i] << 16) | (i + 1 < len ? data[i + 1] << 8 : 0) | (i + 2 < len ? data[i + 2] : 0);
        out += kB64[(v >> 18) & 63];
        out += kB64[(v >> 12) & 63];
        if (i + 1 < len) out += kB64[(v >> 6) & 63];
        if (i + 2 < len) out += kB64[v & 63];
    }
    return out;
}
std::string b64url(const Bytes& b) { return b64url(b.data(), b.size()); }
std::string b64url(const std::string& s) { return b64url(reinterpret_cast<const unsigned char*>(s.data()), s.size()); }

// Принимает и base64url, и обычный base64 (ключи подписки браузеры отдают в base64url)
Bytes fromB64(const std::string& s) {
    Bytes out;
    unsigned v = 0;
    int bits = 0;
    for (const char c : s) {
        int d;
        if (c >= 'A' && c <= 'Z') d = c - 'A';
        else if (c >= 'a' && c <= 'z') d = c - 'a' + 26;
        else if (c >= '0' && c <= '9') d = c - '0' + 52;
        else if (c == '-' || c == '+') d = 62;
        else if (c == '_' || c == '/') d = 63;
        else if (c == '=') break;
        else return {};
        v = (v << 6) | static_cast<unsigned>(d);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<unsigned char>((v >> bits) & 0xff));
        }
    }
    return out;
}

// ── Криптография (OpenSSL) ──

struct KeyDeleter { void operator()(EVP_PKEY* k) const { EVP_PKEY_free(k); } };
using Key = std::unique_ptr<EVP_PKEY, KeyDeleter>;

Key generateP256() {
    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, nullptr);
    EVP_PKEY* pkey = nullptr;
    if (ctx && EVP_PKEY_keygen_init(ctx) > 0 &&
        EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx, NID_X9_62_prime256v1) > 0)
        EVP_PKEY_keygen(ctx, &pkey);
    EVP_PKEY_CTX_free(ctx);
    return Key(pkey);
}

// Несжатая точка (65 байт) — хвост DER SubjectPublicKeyInfo: он у P-256 всегда одинаковой длины
Bytes rawPublic(EVP_PKEY* key) {
    unsigned char* der = nullptr;
    const int len = i2d_PUBKEY(key, &der);
    Bytes out;
    if (len >= 65) out.assign(der + len - 65, der + len);
    OPENSSL_free(der);
    return out;
}

// Публичный ключ браузера (65 байт) → EVP_PKEY через тот же DER-префикс P-256
Key publicFromRaw(const Bytes& raw) {
    static const unsigned char kPrefix[] = {0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
                                            0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00};
    if (raw.size() != 65 || raw[0] != 0x04) return nullptr;
    Bytes der(kPrefix, kPrefix + sizeof kPrefix);
    der.insert(der.end(), raw.begin(), raw.end());
    const unsigned char* p = der.data();
    return Key(d2i_PUBKEY(nullptr, &p, static_cast<long>(der.size())));
}

std::string toPem(EVP_PKEY* key) {
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PrivateKey(bio, key, nullptr, nullptr, 0, nullptr, nullptr);
    char* data = nullptr;
    const long len = BIO_get_mem_data(bio, &data);
    std::string pem(data, data + len);
    BIO_free(bio);
    return pem;
}

Key fromPem(const std::string& pem) {
    BIO* bio = BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size()));
    Key key(PEM_read_bio_PrivateKey(bio, nullptr, nullptr, nullptr));
    BIO_free(bio);
    return key;
}

Bytes ecdh(EVP_PKEY* priv, EVP_PKEY* peer) {
    Bytes out;
    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(priv, nullptr);
    size_t len = 0;
    if (ctx && EVP_PKEY_derive_init(ctx) > 0 && EVP_PKEY_derive_set_peer(ctx, peer) > 0 &&
        EVP_PKEY_derive(ctx, nullptr, &len) > 0) {
        out.resize(len);
        if (EVP_PKEY_derive(ctx, out.data(), &len) <= 0) out.clear();
        out.resize(len);
    }
    EVP_PKEY_CTX_free(ctx);
    return out;
}

Bytes hmacSha256(const Bytes& key, const Bytes& data) {
    Bytes out(EVP_MAX_MD_SIZE);
    unsigned len = 0;
    HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()), data.data(), data.size(), out.data(), &len);
    out.resize(len);
    return out;
}

// HKDF-SHA256 (RFC 5869) для выходов не длиннее одного блока — больше Web Push не нужно
Bytes hkdf(const Bytes& salt, const Bytes& ikm, const Bytes& info, size_t len) {
    const Bytes prk = hmacSha256(salt, ikm);
    Bytes in = info;
    in.push_back(1);
    Bytes out = hmacSha256(prk, in);
    out.resize(len);
    return out;
}

Bytes bytesOf(const char* s) { return Bytes(s, s + std::strlen(s)); }

// JWT ES256 для заголовка Authorization: vapid
std::string signJwt(EVP_PKEY* key, const std::string& aud, const std::string& sub) {
    const std::string header = b64url(R"({"typ":"JWT","alg":"ES256"})");
    Json::Value claims;
    claims["aud"] = aud;
    claims["exp"] = static_cast<Json::Int64>(std::time(nullptr) + 12 * 3600);
    claims["sub"] = sub;
    const std::string input = header + "." + b64url(JsonUtils::write(claims));

    EVP_MD_CTX* md = EVP_MD_CTX_new();
    Bytes der;
    size_t len = 0;
    if (md && EVP_DigestSignInit(md, nullptr, EVP_sha256(), nullptr, key) > 0 &&
        EVP_DigestSign(md, nullptr, &len, reinterpret_cast<const unsigned char*>(input.data()), input.size()) > 0) {
        der.resize(len);
        if (EVP_DigestSign(md, der.data(), &len, reinterpret_cast<const unsigned char*>(input.data()), input.size()) <= 0)
            der.clear();
        der.resize(len);
    }
    EVP_MD_CTX_free(md);
    if (der.empty()) return "";
    // DER (r, s) → 64 байта r||s, как требует JWS
    const unsigned char* p = der.data();
    ECDSA_SIG* sig = d2i_ECDSA_SIG(nullptr, &p, static_cast<long>(der.size()));
    if (!sig) return "";
    const BIGNUM *r = nullptr, *s = nullptr;
    ECDSA_SIG_get0(sig, &r, &s);
    unsigned char raw[64];
    BN_bn2binpad(r, raw, 32);
    BN_bn2binpad(s, raw + 32, 32);
    ECDSA_SIG_free(sig);
    return input + "." + b64url(raw, 64);
}

// Шифрование полезной нагрузки aes128gcm (RFC 8291 + RFC 8188), одна запись
Bytes encrypt(const Bytes& uaPublic, const Bytes& auth, const std::string& plaintext) {
    Key peer = publicFromRaw(uaPublic);
    Key eph  = generateP256();
    if (!peer || !eph || auth.size() != 16) return {};
    const Bytes asPublic = rawPublic(eph.get());
    const Bytes secret   = ecdh(eph.get(), peer.get());
    if (asPublic.size() != 65 || secret.empty()) return {};

    Bytes keyInfo = bytesOf("WebPush: info");
    keyInfo.push_back(0);
    keyInfo.insert(keyInfo.end(), uaPublic.begin(), uaPublic.end());
    keyInfo.insert(keyInfo.end(), asPublic.begin(), asPublic.end());
    const Bytes ikm = hkdf(auth, secret, keyInfo, 32);

    Bytes salt(16);
    RAND_bytes(salt.data(), 16);
    Bytes cekInfo = bytesOf("Content-Encoding: aes128gcm");
    cekInfo.push_back(0);
    Bytes nonceInfo = bytesOf("Content-Encoding: nonce");
    nonceInfo.push_back(0);
    const Bytes cek   = hkdf(salt, ikm, cekInfo, 16);
    const Bytes nonce = hkdf(salt, ikm, nonceInfo, 12);

    Bytes padded(plaintext.begin(), plaintext.end());
    padded.push_back(2);   // разделитель последней записи
    Bytes cipher(padded.size() + 16);
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    int outLen = 0, total = 0;
    bool ok = ctx && EVP_EncryptInit_ex(ctx, EVP_aes_128_gcm(), nullptr, cek.data(), nonce.data()) > 0 &&
              EVP_EncryptUpdate(ctx, cipher.data(), &outLen, padded.data(), static_cast<int>(padded.size())) > 0;
    total = outLen;
    ok = ok && EVP_EncryptFinal_ex(ctx, cipher.data() + total, &outLen) > 0;
    total += outLen;
    ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, cipher.data() + total) > 0;
    EVP_CIPHER_CTX_free(ctx);
    if (!ok) return {};
    cipher.resize(total + 16);

    // Заголовок записи: salt(16) | rs(4) | idlen(1) | публичный ключ сервера(65)
    Bytes body = salt;
    const uint32_t rs = 4096;
    for (int i = 3; i >= 0; --i) body.push_back(static_cast<unsigned char>((rs >> (8 * i)) & 0xff));
    body.push_back(65);
    body.insert(body.end(), asPublic.begin(), asPublic.end());
    body.insert(body.end(), cipher.begin(), cipher.end());
    return body;
}

// ── Очередь отправки ──

struct Job {
    int64_t     subId = 0;
    std::string endpoint, p256dh, auth, payload;
    int         ttl = 86400;
    bool        urgent = false;
};

std::mutex              gMutex;
std::condition_variable gCv;
std::deque<Job>         gQueue;
Key                     gKey;
std::string             gPublic;
std::string             gSubject = "mailto:admin@vicinity.local";
bool                    gStarted = false;

void forget(int64_t subId) {
    app().getLoop()->queueInLoop([subId] {
        try {
            app().getDbClient()->execSqlSync("DELETE FROM push_subscriptions WHERE id = ?", subId);
        } catch (const std::exception& e) {
            LOG_WARN << "push: не удалось удалить подписку " << subId << ": " << e.what();
        }
    });
}

#ifdef VICINITY_HAVE_CURL
size_t discard(char*, size_t size, size_t n, void*) { return size * n; }

// true — подписка мертва (404/410), её надо удалить
bool deliver(const Job& job) {
    const Bytes body = encrypt(fromB64(job.p256dh), fromB64(job.auth), job.payload);
    if (body.empty()) { LOG_WARN << "push: не удалось зашифровать для " << job.subId; return true; }
    std::string aud;
    try {
        const auto slash = job.endpoint.find('/', 8);
        aud = job.endpoint.substr(0, slash);
    } catch (...) { return true; }
    const std::string jwt = signJwt(gKey.get(), aud, gSubject);
    if (jwt.empty()) { LOG_ERROR << "push: подпись VAPID не удалась"; return false; }

    CURL* curl = curl_easy_init();
    if (!curl) return false;
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/octet-stream");
    headers = curl_slist_append(headers, "Content-Encoding: aes128gcm");
    headers = curl_slist_append(headers, ("TTL: " + std::to_string(job.ttl)).c_str());
    headers = curl_slist_append(headers, job.urgent ? "Urgency: high" : "Urgency: normal");
    headers = curl_slist_append(headers, ("Authorization: vapid t=" + jwt + ", k=" + gPublic).c_str());
    curl_easy_setopt(curl, CURLOPT_URL, job.endpoint.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Vicinity/1.0");
    const CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    if (res != CURLE_OK) { LOG_WARN << "push: " << curl_easy_strerror(res); return false; }
    if (code == 404 || code == 410) return true;
    if (code < 200 || code >= 300) LOG_WARN << "push: сервис ответил " << code;
    return false;
}
#else
bool deliver(const Job&) { return false; }
#endif

void worker() {
    for (;;) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(gMutex);
            gCv.wait(lock, [] { return !gQueue.empty(); });
            job = std::move(gQueue.front());
            gQueue.pop_front();
        }
        if (deliver(job)) forget(job.subId);
    }
}

void enqueue(Job job) {
    if (!gStarted) return;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gQueue.size() > 5000) return;   // сервис пушей недоступен — не копим бесконечно
        gQueue.push_back(std::move(job));
    }
    gCv.notify_one();
}

// Подписки пользователей: id, user_id, endpoint, p256dh, auth, prefs
struct Sub {
    int64_t     id = 0, userId = 0;
    std::string endpoint, p256dh, auth;
    Json::Value prefs;
};

std::vector<Sub> subscriptionsOf(const std::set<int64_t>& users) {
    std::vector<Sub> out;
    if (users.empty()) return out;
    std::string in;
    for (const int64_t u : users) in += (in.empty() ? "" : ",") + std::to_string(u);
    auto rows = app().getDbClient()->execSqlSync(
        "SELECT id, user_id, endpoint, p256dh, auth, prefs FROM push_subscriptions WHERE user_id IN (" + in + ")");
    for (const auto& r : rows) {
        Sub s;
        s.id       = r["id"].as<int64_t>();
        s.userId   = r["user_id"].as<int64_t>();
        s.endpoint = r["endpoint"].as<std::string>();
        s.p256dh   = r["p256dh"].as<std::string>();
        s.auth     = r["auth"].as<std::string>();
        if (!r["prefs"].isNull()) JsonUtils::parse(r["prefs"].as<std::string>(), s.prefs);
        out.push_back(std::move(s));
    }
    return out;
}

void send(const Sub& s, const Json::Value& payload, int ttl, bool urgent) {
    Job job;
    job.subId    = s.id;
    job.endpoint = s.endpoint;
    job.p256dh   = s.p256dh;
    job.auth     = s.auth;
    job.payload  = JsonUtils::write(payload);
    job.ttl      = ttl;
    job.urgent   = urgent;
    enqueue(std::move(job));
}

bool mentions(const std::string& text, const std::string& username) {
    if (username.empty()) return false;
    const std::string needle = "@" + username;
    size_t pos = 0;
    while ((pos = text.find(needle, pos)) != std::string::npos) {
        const size_t end = pos + needle.size();
        const bool boundary = end == text.size() || !(std::isalnum(static_cast<unsigned char>(text[end])) || text[end] == '_');
        if (boundary) return true;
        pos = end;
    }
    return text.find("@everyone") != std::string::npos || text.find("@here") != std::string::npos;
}

} // namespace

namespace WebPush {

void init() {
    auto db = app().getDbClient();
    try {
        const Json::Value& custom = app().getCustomConfig();
        if (custom["push"]["subject"].isString() && !custom["push"]["subject"].asString().empty())
            gSubject = custom["push"]["subject"].asString();
        auto rows = db->execSqlSync("SELECT value FROM kv WHERE key = 'vapid_private_pem'");
        if (!rows.empty()) gKey = fromPem(rows[0]["value"].as<std::string>());
        if (!gKey) {
            gKey = generateP256();
            if (!gKey) { LOG_ERROR << "push: не удалось создать ключ VAPID"; return; }
            db->execSqlSync("INSERT OR REPLACE INTO kv(key, value) VALUES('vapid_private_pem', ?)", toPem(gKey.get()));
            LOG_INFO << "push: создан новый ключ VAPID";
        }
        gPublic = b64url(rawPublic(gKey.get()));
    } catch (const std::exception& e) {
        LOG_ERROR << "push: инициализация не удалась: " << e.what();
        return;
    }
#ifdef VICINITY_HAVE_CURL
    std::thread(worker).detach();
    gStarted = true;
#else
    LOG_WARN << "push: сервер собран без libcurl — уведомления не отправляются";
#endif
}

std::string publicKey() { return gPublic; }

void notifyMessage(const Json::Value& msg, int64_t channelId) {
    if (!gStarted) return;
    try {
        auto db = app().getDbClient();
        const int64_t author = msg["author_id"].asInt64();
        std::set<int64_t> audience = Broadcast::channelAudience(channelId);
        audience.erase(author);
        std::set<int64_t> offline;
        for (const int64_t u : audience)
            if (!WSManager::instance().isOnline(u)) offline.insert(u);
        if (offline.empty()) return;
        const auto subs = subscriptionsOf(offline);
        if (subs.empty()) return;

        auto ch = db->execSqlSync("SELECT type, name, server_id FROM channels WHERE id = ?", channelId);
        if (ch.empty()) return;
        const std::string chType = ch[0]["type"].as<std::string>();
        const int64_t serverId = ch[0]["server_id"].isNull() ? 0 : ch[0]["server_id"].as<int64_t>();
        const std::string chName = ch[0]["name"].isNull() ? "" : ch[0]["name"].as<std::string>();
        std::string serverName;
        if (serverId) {
            auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", serverId);
            if (!s.empty()) serverName = s[0]["name"].as<std::string>();
        }
        // Имена получателей — для @упоминаний
        std::map<int64_t, std::string> usernames;
        for (const auto& r : db->execSqlSync(
                 "SELECT id, username FROM users WHERE id IN (SELECT user_id FROM push_subscriptions)"))
            usernames[r["id"].as<int64_t>()] = r["username"].as<std::string>();

        const std::string text = msg["text"].asString();
        const std::string kind = msg["kind"].asString();
        const std::string authorName = msg["author_name"].asString();
        std::string body;
        if (kind == "voice") body = "Голосовое сообщение";
        else if (kind == "call") body = "Пропущенный звонок";
        else if (!text.empty()) body = TextUtils::utf8Truncate(text, 160);
        else body = msg["attachment_type"].asString() == "file" ? "Файл: " + msg["attachment_name"].asString() : "Изображение";

        for (const Sub& s : subs) {
            const Json::Value& p = s.prefs;
            bool muted = false;
            for (const auto& m : p["muted"])
                if (m.isIntegral() && m.asInt64() == channelId) muted = true;
            if (muted) continue;
            const bool mentioned = mentions(text, usernames[s.userId]);
            if (serverId) {
                std::string level = "mentions";
                const Json::Value& lv = p["servers"][std::to_string(serverId)];
                if (lv.isString()) level = lv.asString();
                if (level == "none" || (level == "mentions" && !mentioned)) continue;
            }
            Json::Value payload;
            payload["t"]     = "msg";
            payload["title"] = mentioned ? authorName + " упоминает вас" : serverId ? authorName + " · #" + chName : chType == "group" ? authorName + " · " + chName : authorName;
            payload["body"]  = body;
            payload["icon"]  = msg["author_avatar"].asString();
            payload["tag"]   = "ch-" + std::to_string(channelId);
            payload["url"]   = serverId ? "/channels/" + std::to_string(serverId) + "/" + std::to_string(channelId)
                                        : "/channels/@me/" + std::to_string(channelId);
            send(s, payload, 86400, mentioned || !serverId);
        }
    } catch (const std::exception& e) {
        LOG_WARN << "push: notifyMessage: " << e.what();
    }
}

void notifyCall(int64_t toUserId, int64_t fromUserId, const std::string& fromName) {
    if (!gStarted) return;
    try {
        auto db = app().getDbClient();
        const auto subs = subscriptionsOf({toUserId});
        if (subs.empty()) return;
        auto ch = db->execSqlSync(
            "SELECT c.id FROM channels c "
            "JOIN channel_members m1 ON c.id = m1.channel_id AND m1.user_id = ? "
            "JOIN channel_members m2 ON c.id = m2.channel_id AND m2.user_id = ? "
            "WHERE c.type = 'dm' AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2 "
            "ORDER BY c.id LIMIT 1", toUserId, fromUserId);
        auto av = db->execSqlSync("SELECT avatar_path FROM users WHERE id = ?", fromUserId);
        Json::Value payload;
        payload["t"]     = "call";
        payload["title"] = "Входящий звонок";
        payload["body"]  = fromName;
        payload["icon"]  = av.empty() || av[0]["avatar_path"].isNull() ? "" : av[0]["avatar_path"].as<std::string>();
        payload["tag"]   = "call";
        payload["url"]   = ch.empty() ? "/channels/@me" : "/channels/@me/" + std::to_string(ch[0]["id"].as<int64_t>());
        payload["from"]  = static_cast<Json::Int64>(fromUserId);
        for (const Sub& s : subs) send(s, payload, 60, true);
    } catch (const std::exception& e) {
        LOG_WARN << "push: notifyCall: " << e.what();
    }
}

} // namespace WebPush
