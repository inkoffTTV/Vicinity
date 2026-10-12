#include "AuthController.h"
#include "../models/User.h"
#include "../managers/SessionManager.h"
#include "../utils/CryptoUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/TextUtils.h"
#include "../utils/Altcha.h"
#include "../utils/EmailUtils.h"
#include "../utils/Mailer.h"
#include "../utils/NetUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/HttpResponse.h>
#include <drogon/drogon.h>
#include <cctype>
#include <cstdio>
#include <optional>

using namespace drogon;

// Разрешённые символы логина: латиница/цифры/._- — чтобы не было пробелов, HTML и т.п.
static bool validUsername(const std::string& u) {
    for (unsigned char c : u)
        if (!std::isalnum(c) && c != '_' && c != '.' && c != '-') return false;
    return true;
}

static HttpResponsePtr jsonResp(Json::Value body, HttpStatusCode code = k200OK) {
    auto resp = HttpResponse::newHttpJsonResponse(std::move(body));
    resp->setStatusCode(code);
    return resp;
}

static HttpResponsePtr error(const std::string& msg, HttpStatusCode code) {
    Json::Value v;
    v["error"] = msg;
    return jsonResp(std::move(v), code);
}

// ── Регистрация (docs/API.md §0) ─────────────────────────────────────────────
// Режимы (custom_config.registration.mode, в Docker — VICINITY_REGISTRATION):
//   email   — капча ALTCHA + код из письма (по умолчанию, если настроен SMTP)
//   captcha — только капча (по умолчанию без SMTP)
//   open    — как раньше, без проверок (локальный сервер, тесты)
//   closed  — регистрация закрыта
struct RegistrationSettings {
    std::string mode;
    int         perIpPerDay = 3;   // успешных регистраций с одного IP за сутки; 0 — без лимита
    std::string siteUrl;           // адрес сайта для писем и подсказки десктопу
};

static const RegistrationSettings& registration() {
    static const RegistrationSettings s = [] {
        RegistrationSettings r;
        const Json::Value& cfg = drogon::app().getCustomConfig()["registration"];
        if (cfg.isObject()) {
            r.mode    = cfg.get("mode", "").asString();
            r.siteUrl = cfg.get("site_url", "").asString();
            const Json::Value& limit = cfg["signups_per_ip_per_day"];
            if (limit.isIntegral()) r.perIpPerDay = limit.asInt();
            else if (limit.isString() && !limit.asString().empty()) {
                try { r.perIpPerDay = std::stoi(limit.asString()); } catch (...) {}
            }
        }
        if (r.mode != "email" && r.mode != "captcha" && r.mode != "open" && r.mode != "closed") {
            if (!r.mode.empty()) LOG_WARN << "registration.mode '" << r.mode << "' не распознан — выбираю по SMTP";
            r.mode = Mailer::configured() ? "email" : "captcha";
        }
        if (r.mode == "email" && !Mailer::configured())
            LOG_WARN << "registration.mode = email, но SMTP не настроен: регистрация не сможет отправить код";
        while (!r.siteUrl.empty() && r.siteUrl.back() == '/') r.siteUrl.pop_back();
        LOG_INFO << "Регистрация: режим " << r.mode << ", лимит с одного IP в сутки " << r.perIpPerDay;
        return r;
    }();
    return s;
}

static constexpr int CODE_TTL_MIN      = 15;   // срок кода из письма
static constexpr int CODE_MAX_ATTEMPTS = 5;    // неверных вводов кода до сброса регистрации
static constexpr int RESEND_COOLDOWN   = 60;   // секунд между письмами
static constexpr int MAX_SENDS         = 5;    // писем на одну регистрацию
static constexpr int PENDING_PER_IP_HOUR = 10; // начатых регистраций с одного IP в час

// Поля аккаунта из запроса регистрации; текст ошибки или nullopt
static std::optional<std::string> readAccount(const Json::Value& json, std::string& username,
                                              std::string& password, std::string& displayName) {
    username = JsonUtils::getStr(json, "username");
    password = JsonUtils::getStr(json, "password");
    if (username.size() < Vicinity::MIN_USERNAME_LEN || username.size() > Vicinity::MAX_USERNAME_LEN)
        return std::string("Username must be 3-32 characters");
    if (!validUsername(username)) return std::string("Username: only a-z, 0-9, . _ - allowed");
    if (password.size() < Vicinity::MIN_PASSWORD_LEN) return std::string("Password must be at least 8 characters");
    if (password.size() > 1024) return std::string("Password is too long");
    // Имя: без управляющих символов, до 32 символов (длинное обрезается по границе символа);
    // не задано или пустое — берём логин
    displayName = username;
    const std::string rawName = JsonUtils::getStr(json, "display_name");
    if (!TextUtils::trim(rawName).empty()) {
        auto clean = TextUtils::cleanName(rawName, Vicinity::MAX_DISPLAY_NAME_LEN, true);
        if (!clean) return std::string("Invalid display name");
        displayName = *clean;
    }
    return std::nullopt;
}

static bool ipBlocked(const std::string& ip) {
    try {
        return !drogon::app().getDbClient()->execSqlSync("SELECT 1 FROM blocked_ips WHERE ip = ?", ip).empty();
    } catch (...) { return false; }
}

// Лимит успешных регистраций с одного IP за сутки; текст ошибки или nullopt
static std::optional<std::string> checkIpLimit(const std::string& ip) {
    const int limit = registration().perIpPerDay;
    if (limit <= 0) return std::nullopt;
    auto r = drogon::app().getDbClient()->execSqlSync(
        "SELECT COUNT(*) AS n FROM users WHERE signup_ip = ? AND created_at > datetime('now', '-1 day')", ip);
    if (r[0]["n"].as<int64_t>() >= limit)
        return "С вашего адреса за сутки уже зарегистрировано " + std::to_string(limit) +
               " аккаунта — это максимум. Попробуйте завтра.";
    return std::nullopt;
}

// i***@gmail.com — чтобы показать, куда ушло письмо, не раскрывая адрес целиком
static std::string maskEmail(const std::string& email) {
    const auto at = email.find('@');
    if (at == std::string::npos || at == 0) return email;
    const std::string local = email.substr(0, at);
    const size_t keep = local.size() <= 2 ? 1 : 2;
    return local.substr(0, keep) + "***" + email.substr(at);
}

static std::string newCode() {
    char buf[24];
    std::snprintf(buf, sizeof buf, "%06llu", static_cast<unsigned long long>(CryptoUtils::randomBelow(1000000)));
    return buf;
}

static std::string codeHash(const std::string& pendingId, const std::string& code) {
    return CryptoUtils::sha256Hex(pendingId + ":" + code);
}

static void sendCode(const std::string& to, const std::string& username, const std::string& code) {
    std::string body =
        "Здравствуйте!\n\n"
        "Код для регистрации в Vicinity (логин @" + username + "):\n\n"
        "    " + code + "\n\n"
        "Код действует " + std::to_string(CODE_TTL_MIN) + " минут. "
        "Если вы не регистрировались — просто проигнорируйте это письмо.\n";
    if (!registration().siteUrl.empty()) body += "\n" + registration().siteUrl + "\n";
    Mailer::sendAsync(to, "Код подтверждения Vicinity: " + code, body);
}

// Создать аккаунт и сессию; ответ 201 {token, user_id, display_name}
static HttpResponsePtr createAccount(const std::string& username, const std::string& hash,
                                     const std::string& displayName, const std::string& email,
                                     const std::string& ip) {
    try {
        int64_t id = UserModel::create(username, hash, displayName, email, ip);
        std::string token = AppSessionManager::instance().createSession(id);
        Json::Value resp;
        resp["token"]        = token;
        resp["user_id"]      = static_cast<Json::Int64>(id);
        resp["display_name"] = displayName;
        return jsonResp(std::move(resp), k201Created);
    } catch (const drogon::orm::DrogonDbException& e) {
        // Параллельная регистрация того же логина или почты: проверка уже прошла, сработал UNIQUE
        if (UserModel::findByUsername(username)) return error("Username already taken", k409Conflict);
        if (!email.empty()) return error("Эта почта уже привязана к другому аккаунту", k409Conflict);
        return error(e.base().what(), k500InternalServerError);
    } catch (const std::exception& e) {
        return error(e.what(), k500InternalServerError);
    }
}

// GET /api/v1/auth/registration — что нужно для регистрации (форма сайта подстраивается)
void AuthController::registrationInfo(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb) {
    const std::string& mode = registration().mode;
    Json::Value resp;
    resp["mode"]    = mode;
    resp["captcha"] = mode == "email" || mode == "captcha";
    resp["email"]   = mode == "email";
    resp["open"]    = mode != "closed";
    cb(jsonResp(std::move(resp)));
}

// GET /api/v1/auth/challenge — задача капчи ALTCHA
void AuthController::challenge(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb) {
    try {
        auto resp = jsonResp(Altcha::createChallenge());
        resp->addHeader("Cache-Control", "no-store");
        cb(resp);
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/auth/register — старый путь (десктоп-клиенты): без капчи работает только в режиме open
void AuthController::registerUser(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb) {
    if (registration().mode != "open") {
        std::string msg = registration().mode == "closed"
            ? "Регистрация закрыта"
            : "Регистрация теперь проходит на сайте" +
                  (registration().siteUrl.empty() ? std::string() : " " + registration().siteUrl) +
                  " (с проверкой «я не робот» и подтверждением почты). Потом войдите здесь.";
        cb(error(msg, k403Forbidden));
        return;
    }
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string username, password, displayName;
    if (auto err = readAccount(*json, username, password, displayName)) { cb(error(*err, k400BadRequest)); return; }
    const std::string ip = NetUtils::clientIp(req);
    if (ipBlocked(ip)) { cb(error("Регистрация с этого адреса запрещена", k403Forbidden)); return; }
    if (UserModel::findByUsername(username)) { cb(error("Username already taken", k409Conflict)); return; }
    cb(createAccount(username, CryptoUtils::hashPassword(password), displayName, "", ip));
}

// POST /api/v1/auth/register/start {username, password, display_name, email, altcha, website}
//   режим email   → 202 {pending_id, email, expires_in, resend_in}: код ушёл на почту
//   режим captcha → 201 {token, user_id, display_name}: аккаунт создан
void AuthController::registerStart(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb) {
    const std::string& mode = registration().mode;
    if (mode == "closed") { cb(error("Регистрация закрыта", k403Forbidden)); return; }
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }

    // Ловушка для ботов: поле скрыто от людей, заполняют его только автоматические формы
    if (!JsonUtils::getStr(*json, "website").empty()) { cb(error("Проверка не пройдена", k400BadRequest)); return; }

    std::string username, password, displayName;
    if (auto err = readAccount(*json, username, password, displayName)) { cb(error(*err, k400BadRequest)); return; }

    if (mode != "open" && !Altcha::verify(JsonUtils::getStr(*json, "altcha"))) {
        cb(error("Проверка «я не робот» не пройдена или устарела — попробуйте ещё раз", k400BadRequest));
        return;
    }

    const std::string ip = NetUtils::clientIp(req);
    try {
        if (ipBlocked(ip)) { cb(error("Регистрация с этого адреса запрещена", k403Forbidden)); return; }
        if (auto err = checkIpLimit(ip)) { cb(error(*err, k429TooManyRequests)); return; }
        if (UserModel::findByUsername(username)) { cb(error("Username already taken", k409Conflict)); return; }

        if (mode != "email") {
            cb(createAccount(username, CryptoUtils::hashPassword(password), displayName, "", ip));
            return;
        }

        const std::string sendTo = TextUtils::trim(JsonUtils::getStr(*json, "email"));
        const auto email = EmailUtils::normalize(sendTo);
        if (!email || !EmailUtils::looksValid(sendTo)) { cb(error("Некорректный адрес почты", k400BadRequest)); return; }
        if (EmailUtils::isDisposable(*email)) {
            cb(error("Одноразовая почта не подходит — укажите свой постоянный ящик", k400BadRequest));
            return;
        }
        if (!Mailer::configured()) {
            cb(error("Отправка почты на сервере не настроена — сообщите администратору", k503ServiceUnavailable));
            return;
        }

        auto db = drogon::app().getDbClient();
        if (!db->execSqlSync("SELECT 1 FROM users WHERE email = ?", *email).empty()) {
            cb(error("Эта почта уже привязана к другому аккаунту", k409Conflict)); return;
        }
        db->execSqlSync("DELETE FROM pending_signups WHERE expires_at <= datetime('now')");
        auto recent = db->execSqlSync(
            "SELECT COUNT(*) AS n FROM pending_signups WHERE ip = ? AND created_at > datetime('now', '-1 hour')", ip);
        if (recent[0]["n"].as<int64_t>() >= PENDING_PER_IP_HOUR) {
            cb(error("Слишком много попыток регистрации — попробуйте через час", k429TooManyRequests)); return;
        }
        // Повторный старт с той же почтой заменяет прежний (недоделанную регистрацию)
        db->execSqlSync("DELETE FROM pending_signups WHERE email = ?", *email);

        const std::string id   = CryptoUtils::randomHex(16);
        const std::string code = newCode();
        db->execSqlSync(
            "INSERT INTO pending_signups(id, username, password_hash, display_name, email, send_to, code_hash, ip, "
            "expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))",
            id, username, CryptoUtils::hashPassword(password), displayName, *email, sendTo,
            codeHash(id, code), ip, CODE_TTL_MIN);
        sendCode(sendTo, username, code);

        Json::Value resp;
        resp["pending_id"] = id;
        resp["email"]      = maskEmail(sendTo);
        resp["expires_in"] = CODE_TTL_MIN * 60;
        resp["resend_in"]  = RESEND_COOLDOWN;
        cb(jsonResp(std::move(resp), k202Accepted));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/auth/register/verify {pending_id, code} → 201 {token, user_id, display_name}
void AuthController::registerVerify(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string id   = JsonUtils::getStr(*json, "pending_id");
    std::string code;
    for (char c : JsonUtils::getStr(*json, "code")) if (c >= '0' && c <= '9') code += c;   // «123 456» тоже годится
    if (id.empty() || id.size() > 64) { cb(error("Регистрация не найдена", k404NotFound)); return; }

    try {
        auto db = drogon::app().getDbClient();
        auto rows = db->execSqlSync(
            "SELECT username, password_hash, display_name, email, code_hash, attempts, ip FROM pending_signups "
            "WHERE id = ? AND expires_at > datetime('now')", id);
        if (rows.empty()) { cb(error("Код устарел — начните регистрацию заново", k410Gone)); return; }
        const auto& p = rows[0];
        const int attempts = p["attempts"].as<int>();
        if (attempts >= CODE_MAX_ATTEMPTS) {
            db->execSqlSync("DELETE FROM pending_signups WHERE id = ?", id);
            cb(error("Слишком много неверных попыток — начните регистрацию заново", k429TooManyRequests)); return;
        }
        if (code.size() != 6 || !CryptoUtils::constTimeEquals(codeHash(id, code), p["code_hash"].as<std::string>())) {
            db->execSqlSync("UPDATE pending_signups SET attempts = attempts + 1 WHERE id = ?", id);
            const int left = CODE_MAX_ATTEMPTS - attempts - 1;
            if (left <= 0) {
                db->execSqlSync("DELETE FROM pending_signups WHERE id = ?", id);
                cb(error("Неверный код. Попытки закончились — начните регистрацию заново", k429TooManyRequests));
            } else {
                cb(error("Неверный код. Осталось попыток: " + std::to_string(left), k400BadRequest));
            }
            return;
        }

        const std::string ip = p["ip"].isNull() ? NetUtils::clientIp(req) : p["ip"].as<std::string>();
        if (auto err = checkIpLimit(ip)) { cb(error(*err, k429TooManyRequests)); return; }
        const std::string username = p["username"].as<std::string>();
        auto resp = createAccount(username, p["password_hash"].as<std::string>(),
                                  p["display_name"].as<std::string>(), p["email"].as<std::string>(), ip);
        // Аккаунт создан или логин/почту успели занять — эта регистрация больше не нужна
        if (resp->statusCode() == k201Created || resp->statusCode() == k409Conflict)
            db->execSqlSync("DELETE FROM pending_signups WHERE id = ?", id);
        cb(resp);
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/auth/register/resend {pending_id} → 200 {resend_in, expires_in}: новый код на ту же почту
void AuthController::registerResend(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string id = JsonUtils::getStr(*json, "pending_id");
    if (id.empty() || id.size() > 64) { cb(error("Регистрация не найдена", k404NotFound)); return; }
    try {
        auto db = drogon::app().getDbClient();
        auto rows = db->execSqlSync(
            "SELECT username, send_to, sends, "
            "CAST(strftime('%s','now') - strftime('%s', last_sent_at) AS INTEGER) AS ago "
            "FROM pending_signups WHERE id = ? AND expires_at > datetime('now')", id);
        if (rows.empty()) { cb(error("Регистрация устарела — начните заново", k410Gone)); return; }
        const auto& p = rows[0];
        const int64_t ago = p["ago"].as<int64_t>();
        if (ago < RESEND_COOLDOWN) {
            cb(error("Отправить снова можно через " + std::to_string(RESEND_COOLDOWN - ago) + " с", k429TooManyRequests));
            return;
        }
        if (p["sends"].as<int>() >= MAX_SENDS) {
            cb(error("Писем отправлено слишком много — проверьте папку «Спам» или начните заново", k429TooManyRequests));
            return;
        }
        const std::string code = newCode();
        db->execSqlSync(
            "UPDATE pending_signups SET code_hash = ?, attempts = 0, sends = sends + 1, "
            "last_sent_at = CURRENT_TIMESTAMP, expires_at = datetime('now', '+' || ? || ' minutes') WHERE id = ?",
            codeHash(id, code), CODE_TTL_MIN, id);
        sendCode(p["send_to"].as<std::string>(), p["username"].as<std::string>(), code);
        Json::Value resp;
        resp["resend_in"]  = RESEND_COOLDOWN;
        resp["expires_in"] = CODE_TTL_MIN * 60;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

void AuthController::login(const HttpRequestPtr& req,
                           std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string username = JsonUtils::getStr(*json, "username");
    std::string password = JsonUtils::getStr(*json, "password");

    auto user = UserModel::findByUsername(username);
    if (!user || !CryptoUtils::verifyPassword(password, user->passwordHash)) {
        cb(error("Invalid credentials", k401Unauthorized)); return;
    }
    // Только после проверки пароля: иначе по ответу можно было бы узнать, что аккаунт существует
    if (user->banned) { cb(error("Аккаунт заблокирован администратором", k403Forbidden)); return; }

    // Бесшовный апгрейд старого слабого хэша (SHA-256) на PBKDF2 при успешном входе.
    if (CryptoUtils::needsRehash(user->passwordHash)) {
        try {
            std::string fresh = CryptoUtils::hashPassword(password);
            drogon::app().getDbClient()->execSqlAsync(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                [](const drogon::orm::Result&) {},
                [](const drogon::orm::DrogonDbException&) {},
                fresh, user->id);
        } catch (...) { /* апгрейд best-effort, на вход не влияет */ }
    }

    std::string token;
    try {
        token = AppSessionManager::instance().createSession(user->id);
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError)); return;
    }

    Json::Value resp;
    resp["token"]             = token;
    resp["user_id"]           = static_cast<Json::Int64>(user->id);
    resp["display_name"]      = user->displayName;
    resp["avatar_path"]       = user->avatarPath;
    resp["bio"]               = user->bio;
    resp["accent_color"]      = user->accentColor;
    resp["banner_path"]       = user->bannerPath;
    resp["profile_json"]      = user->profileJson;
    resp["subscription_tier"] = user->subscriptionTier;
    resp["developer"]         = user->developer;
    cb(jsonResp(std::move(resp)));
}

void AuthController::logout(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb) {
    std::string token = req->attributes()->get<std::string>("token");
    AppSessionManager::instance().deleteSession(token);
    Json::Value resp;
    resp["status"] = "ok";
    cb(jsonResp(std::move(resp)));
}

void AuthController::me(const HttpRequestPtr& req,
                        std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto user = UserModel::findById(userId);
    if (!user) { cb(error("User not found", k404NotFound)); return; }

    Json::Value resp;
    resp["user_id"]           = static_cast<Json::Int64>(user->id);
    resp["username"]          = user->username;
    resp["display_name"]      = user->displayName;
    resp["avatar_path"]       = user->avatarPath;
    resp["bio"]               = user->bio;
    resp["accent_color"]      = user->accentColor;
    resp["banner_path"]       = user->bannerPath;
    resp["profile_json"]      = user->profileJson;
    resp["pronouns"]          = user->pronouns;
    resp["presence"]          = user->presence;
    resp["created_at"]        = user->createdAt;
    resp["subscription_tier"] = user->subscriptionTier;
    resp["developer"]         = user->developer;
    cb(jsonResp(std::move(resp)));
}

// POST /api/v1/auth/password {old_password, new_password} — сменить пароль; остальные сессии завершаются
void AuthController::changePassword(const HttpRequestPtr& req,
                                    std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const std::string token = req->attributes()->get<std::string>("token");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }

    std::string oldPassword = JsonUtils::getStr(*json, "old_password");
    std::string newPassword = JsonUtils::getStr(*json, "new_password");
    if (newPassword.size() < Vicinity::MIN_PASSWORD_LEN) {
        cb(error("Password must be at least 8 characters", k400BadRequest)); return;
    }
    auto user = UserModel::findById(userId);
    if (!user) { cb(error("User not found", k404NotFound)); return; }
    // Не 401: клиент воспринял бы его как конец сессии
    if (!CryptoUtils::verifyPassword(oldPassword, user->passwordHash)) {
        cb(error("Неверный текущий пароль", k403Forbidden)); return;
    }
    try {
        drogon::app().getDbClient()->execSqlSync("UPDATE users SET password_hash = ? WHERE id = ?",
                                                 CryptoUtils::hashPassword(newPassword), userId);
        // Кто знал старый пароль, теряет доступ на всех остальных устройствах
        const int revoked = AppSessionManager::instance().deleteOtherSessions(userId, token);
        Json::Value resp;
        resp["status"]  = "ok";
        resp["revoked"] = revoked;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/auth/sessions — действующие сессии (устройства) пользователя
void AuthController::sessions(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const std::string token = req->attributes()->get<std::string>("token");
    try {
        Json::Value arr(Json::arrayValue);
        for (const auto& s : AppSessionManager::instance().listSessions(userId, token)) {
            Json::Value item;
            item["id"]         = s.id;
            item["created_at"] = s.createdAt;
            item["expires_at"] = s.expiresAt;
            item["current"]    = s.current;
            arr.append(item);
        }
        Json::Value resp;
        resp["sessions"] = arr;
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/auth/sessions/others — выйти на всех остальных устройствах
void AuthController::revokeOthers(const HttpRequestPtr& req,
                                  std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const std::string token = req->attributes()->get<std::string>("token");
    try {
        Json::Value resp;
        resp["status"]  = "ok";
        resp["revoked"] = AppSessionManager::instance().deleteOtherSessions(userId, token);
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/auth/sessions/{id} — завершить одну сессию (в том числе текущую)
void AuthController::revokeSession(const HttpRequestPtr& req,
                                   std::function<void(const HttpResponsePtr&)>&& cb,
                                   const std::string& id) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    try {
        if (!AppSessionManager::instance().deleteSessionById(userId, id)) {
            cb(error("Сессия не найдена", k404NotFound)); return;
        }
        Json::Value resp;
        resp["status"] = "ok";
        cb(jsonResp(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
