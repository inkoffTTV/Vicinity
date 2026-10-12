#include "AccountController.h"
#include "../models/User.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/EmailUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Mailer.h"
#include "../utils/TextUtils.h"
#include "../utils/Totp.h"
#include "../utils/TwoFactor.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <cctype>
#include <cstdio>

using namespace drogon;

static constexpr int USERNAME_COOLDOWN_DAYS = 7;   // логин можно менять раз в неделю
static constexpr int CODE_TTL_MIN           = 15;
static constexpr int RESEND_COOLDOWN        = 60;

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

static int64_t uid(const HttpRequestPtr& req) { return req->attributes()->get<int64_t>("user_id"); }

static bool validUsername(const std::string& u) {
    if (u.size() < static_cast<size_t>(Vicinity::MIN_USERNAME_LEN) || u.size() > static_cast<size_t>(Vicinity::MAX_USERNAME_LEN))
        return false;
    for (unsigned char c : u)
        if (!std::isalnum(c) && c != '_' && c != '.' && c != '-') return false;
    return true;
}

static bool usernameFree(const std::string& u) { return !UserModel::findByUsername(u); }

// *********@gmail.com — адрес без имени ящика
static std::string maskEmail(const std::string& email) {
    const auto at = email.find('@');
    if (at == std::string::npos) return email;
    return std::string(9, '*') + email.substr(at);
}

static std::string newCode() {
    char buf[24];
    std::snprintf(buf, sizeof buf, "%06llu", static_cast<unsigned long long>(CryptoUtils::randomBelow(1000000)));
    return buf;
}

static std::string codeHash(int64_t userId, const std::string& code) {
    return CryptoUtils::sha256Hex("email-change:" + std::to_string(userId) + ":" + code);
}

static std::string strOf(const drogon::orm::Field& f) { return f.isNull() ? std::string() : f.as<std::string>(); }

// Секунд до следующей смены логина (0 — можно сейчас)
static int64_t usernameWait(int64_t userId) {
    auto r = app().getDbClient()->execSqlSync(
        "SELECT CAST(strftime('%s', username_changed_at, '+" + std::to_string(USERNAME_COOLDOWN_DAYS) +
            " days') - strftime('%s', 'now') AS INTEGER) AS wait FROM users WHERE id = ? AND username_changed_at IS NOT NULL",
        userId);
    if (r.empty() || r[0]["wait"].isNull()) return 0;
    const int64_t w = r[0]["wait"].as<int64_t>();
    return w > 0 ? w : 0;
}

// GET /api/v1/account → {username, email_masked, has_email, totp_enabled, username_wait, password_changed_at, mail}
void AccountController::info(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    try {
        auto r = app().getDbClient()->execSqlSync(
            "SELECT username, email, email_display, totp_secret, password_changed_at FROM users WHERE id = ?", uid(req));
        if (r.empty()) { cb(error("User not found", k404NotFound)); return; }
        const std::string email = strOf(r[0]["email_display"]).empty() ? strOf(r[0]["email"]) : strOf(r[0]["email_display"]);
        Json::Value v;
        v["username"]            = strOf(r[0]["username"]);
        v["has_email"]           = !email.empty();
        v["email_masked"]        = email.empty() ? "" : maskEmail(email);
        v["totp_enabled"]        = !strOf(r[0]["totp_secret"]).empty();
        v["username_wait"]       = static_cast<Json::Int64>(usernameWait(uid(req)));
        v["password_changed_at"] = strOf(r[0]["password_changed_at"]);
        v["mail"]                = Mailer::configured();
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/account/username/check?u= → {available, reason, suggestions[]}
void AccountController::checkUsername(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const std::string u = TextUtils::trim(req->getParameter("u"));
    Json::Value v;
    v["suggestions"] = Json::Value(Json::arrayValue);
    auto me = UserModel::findById(uid(req));
    if (me && me->username == u) { v["available"] = false; v["reason"] = "same"; cb(jsonResp(std::move(v))); return; }
    if (!validUsername(u)) { v["available"] = false; v["reason"] = "invalid"; cb(jsonResp(std::move(v))); return; }
    if (usernameFree(u)) { v["available"] = true; v["reason"] = ""; cb(jsonResp(std::move(v))); return; }
    v["available"] = false;
    v["reason"]    = "taken";
    // Свободные варианты рядом с занятым
    const std::string base = u.substr(0, Vicinity::MAX_USERNAME_LEN - 4);
    for (const std::string& s : {base + ".dev", base + "_off", base + std::to_string(10 + CryptoUtils::randomBelow(89)),
                                 base + ".vc", base + "_" + std::to_string(100 + CryptoUtils::randomBelow(899))}) {
        if (v["suggestions"].size() >= 3) break;
        if (validUsername(s) && usernameFree(s)) v["suggestions"].append(s);
    }
    cb(jsonResp(std::move(v)));
}

// POST /api/v1/account/username {username, password} — раз в 7 дней
void AccountController::setUsername(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    const std::string u = TextUtils::trim(JsonUtils::getStr(*json, "username"));
    auto me = UserModel::findById(uid(req));
    if (!me) { cb(error("User not found", k404NotFound)); return; }
    if (!CryptoUtils::verifyPassword(JsonUtils::getStr(*json, "password"), me->passwordHash)) {
        cb(error("Неверный пароль", k403Forbidden)); return;
    }
    if (!validUsername(u)) { cb(error("Логин: 3–32 символа, латиница, цифры и . _ -", k400BadRequest)); return; }
    if (u == me->username) { cb(error("Это ваш текущий логин", k400BadRequest)); return; }
    try {
        const int64_t wait = usernameWait(me->id);
        if (wait > 0) {
            const int64_t days = (wait + 86399) / 86400;
            cb(error("Логин можно менять раз в 7 дней — следующая смена через " + std::to_string(days) + " дн.", k429TooManyRequests));
            return;
        }
        if (!usernameFree(u)) { cb(error("Этот логин уже занят", k409Conflict)); return; }
        app().getDbClient()->execSqlSync(
            "UPDATE users SET username = ?, username_changed_at = CURRENT_TIMESTAMP WHERE id = ?", u, me->id);
        Json::Value v;
        v["username"] = u;
        cb(jsonResp(std::move(v)));
        Broadcast::userUpdated(me->id);
    } catch (const drogon::orm::DrogonDbException&) {
        cb(error("Этот логин уже занят", k409Conflict));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// GET /api/v1/account/email → {email} — полностью, только самому пользователю
void AccountController::email(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    try {
        auto r = app().getDbClient()->execSqlSync("SELECT email, email_display FROM users WHERE id = ?", uid(req));
        Json::Value v;
        v["email"] = r.empty() ? "" : (strOf(r[0]["email_display"]).empty() ? strOf(r[0]["email"]) : strOf(r[0]["email_display"]));
        auto resp = jsonResp(std::move(v));
        resp->addHeader("Cache-Control", "no-store");
        cb(resp);
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

static void sendEmailCode(const std::string& to, const std::string& code) {
    Mailer::sendAsync(to, "Код подтверждения почты Vicinity: " + code,
                      "Здравствуйте!\n\nКод для смены почты в Vicinity:\n\n    " + code + "\n\n"
                      "Код действует " + std::to_string(CODE_TTL_MIN) + " минут. Если это были не вы — смените пароль.\n");
}

// POST /api/v1/account/email/start {email, password} → {email_masked, resend_in}
void AccountController::emailStart(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    if (!Mailer::configured()) { cb(error("Отправка почты на сервере не настроена — сообщите администратору", k503ServiceUnavailable)); return; }
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    auto me = UserModel::findById(uid(req));
    if (!me) { cb(error("User not found", k404NotFound)); return; }
    if (!CryptoUtils::verifyPassword(JsonUtils::getStr(*json, "password"), me->passwordHash)) {
        cb(error("Неверный пароль", k403Forbidden)); return;
    }
    const std::string sendTo = TextUtils::trim(JsonUtils::getStr(*json, "email"));
    const auto norm = EmailUtils::normalize(sendTo);
    if (!norm || !EmailUtils::looksValid(sendTo)) { cb(error("Некорректный адрес почты", k400BadRequest)); return; }
    if (EmailUtils::isDisposable(*norm)) { cb(error("Одноразовая почта не подходит", k400BadRequest)); return; }
    if (*norm == me->email) { cb(error("Это ваша текущая почта", k400BadRequest)); return; }
    try {
        auto db = app().getDbClient();
        if (!db->execSqlSync("SELECT 1 FROM users WHERE email = ? AND id != ?", *norm, me->id).empty()) {
            cb(error("Эта почта уже привязана к другому аккаунту", k409Conflict)); return;
        }
        const std::string code = newCode();
        db->execSqlSync(
            "INSERT INTO email_changes(user_id, email, send_to, code_hash, attempts, last_sent_at, expires_at) "
            "VALUES(?, ?, ?, ?, 0, CURRENT_TIMESTAMP, datetime('now', '+' || ? || ' minutes')) "
            "ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, send_to = excluded.send_to, "
            "code_hash = excluded.code_hash, attempts = 0, last_sent_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at",
            me->id, *norm, sendTo, codeHash(me->id, code), CODE_TTL_MIN);
        sendEmailCode(sendTo, code);
        Json::Value v;
        v["email_masked"] = maskEmail(sendTo);
        v["send_to"]      = sendTo;
        v["resend_in"]    = RESEND_COOLDOWN;
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/account/email/verify {code} → {email}
void AccountController::emailVerify(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    std::string code;
    for (char c : JsonUtils::getStr(*json, "code")) if (c >= '0' && c <= '9') code += c;
    const int64_t id = uid(req);
    try {
        auto db = app().getDbClient();
        auto r = db->execSqlSync("SELECT email, send_to, code_hash, attempts FROM email_changes "
                                 "WHERE user_id = ? AND expires_at > datetime('now')", id);
        if (r.empty()) { cb(error("Код устарел — начните заново", k410Gone)); return; }
        if (code.size() != 6 || !CryptoUtils::constTimeEquals(codeHash(id, code), r[0]["code_hash"].as<std::string>())) {
            const int left = 4 - r[0]["attempts"].as<int>();
            if (left <= 0) {
                db->execSqlSync("DELETE FROM email_changes WHERE user_id = ?", id);
                cb(error("Попытки закончились — начните заново", k429TooManyRequests));
            } else {
                db->execSqlSync("UPDATE email_changes SET attempts = attempts + 1 WHERE user_id = ?", id);
                cb(error("Неверный код. Осталось попыток: " + std::to_string(left), k400BadRequest));
            }
            return;
        }
        const std::string norm = r[0]["email"].as<std::string>(), sendTo = r[0]["send_to"].as<std::string>();
        auto old = db->execSqlSync("SELECT email, email_display FROM users WHERE id = ?", id);
        const std::string oldTo = old.empty() ? "" : (strOf(old[0]["email_display"]).empty() ? strOf(old[0]["email"]) : strOf(old[0]["email_display"]));
        db->execSqlSync("UPDATE users SET email = ?, email_display = ? WHERE id = ?", norm, sendTo, id);
        db->execSqlSync("DELETE FROM email_changes WHERE user_id = ?", id);
        // Уведомление на прежний адрес: если меняли не вы — есть шанс заметить
        if (!oldTo.empty())
            Mailer::sendAsync(oldTo, "Почта аккаунта Vicinity изменена",
                              "Почта вашего аккаунта Vicinity изменена на " + maskEmail(sendTo) +
                                  ".\n\nЕсли это были не вы — срочно смените пароль и напишите администратору.\n");
        Json::Value v;
        v["email"] = sendTo;
        cb(jsonResp(std::move(v)));
    } catch (const drogon::orm::DrogonDbException&) {
        cb(error("Эта почта уже привязана к другому аккаунту", k409Conflict));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/account/email/resend → {resend_in}
void AccountController::emailResend(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    const int64_t id = uid(req);
    try {
        auto db = app().getDbClient();
        auto r = db->execSqlSync("SELECT send_to, CAST(strftime('%s','now') - strftime('%s', last_sent_at) AS INTEGER) AS ago "
                                 "FROM email_changes WHERE user_id = ? AND expires_at > datetime('now')", id);
        if (r.empty()) { cb(error("Код устарел — начните заново", k410Gone)); return; }
        const int64_t ago = r[0]["ago"].as<int64_t>();
        if (ago < RESEND_COOLDOWN) {
            cb(error("Отправить снова можно через " + std::to_string(RESEND_COOLDOWN - ago) + " с", k429TooManyRequests)); return;
        }
        const std::string code = newCode();
        db->execSqlSync("UPDATE email_changes SET code_hash = ?, attempts = 0, last_sent_at = CURRENT_TIMESTAMP, "
                        "expires_at = datetime('now', '+' || ? || ' minutes') WHERE user_id = ?",
                        codeHash(id, code), CODE_TTL_MIN, id);
        sendEmailCode(r[0]["send_to"].as<std::string>(), code);
        Json::Value v;
        v["resend_in"] = RESEND_COOLDOWN;
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/account/2fa/setup {password} → {secret, uri} — секрет ждёт подтверждения кодом
void AccountController::totpSetup(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    auto me = UserModel::findById(uid(req));
    if (!me) { cb(error("User not found", k404NotFound)); return; }
    if (!json || !CryptoUtils::verifyPassword(JsonUtils::getStr(*json, "password"), me->passwordHash)) {
        cb(error("Неверный пароль", k403Forbidden)); return;
    }
    if (TwoFactor::enabled(me->id)) { cb(error("Двухфакторная аутентификация уже включена", k409Conflict)); return; }
    try {
        std::string secret = Totp::newSecret();
        app().getDbClient()->execSqlSync("UPDATE users SET totp_pending = ? WHERE id = ?", secret, me->id);
        Json::Value v;
        v["secret"] = secret;
        v["uri"]    = Totp::uri(secret, me->username);
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/account/2fa/enable {code} → {backup_codes[10]} — показываются один раз
void AccountController::totpEnable(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    const int64_t id = uid(req);
    try {
        auto db = app().getDbClient();
        auto r = db->execSqlSync("SELECT totp_pending FROM users WHERE id = ?", id);
        if (r.empty() || r[0]["totp_pending"].isNull()) { cb(error("Начните настройку заново", k410Gone)); return; }
        const std::string secret = r[0]["totp_pending"].as<std::string>();
        if (!json || !Totp::verify(secret, JsonUtils::getStr(*json, "code"))) {
            cb(error("Код не подошёл. Проверьте время на телефоне и введите новый код.", k400BadRequest)); return;
        }
        const auto codes = Totp::backupCodes(10);
        std::string hashes = TwoFactor::hashBackupCodes(codes);
        db->execSqlSync("UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_backup = ? WHERE id = ?", secret, hashes, id);
        Json::Value v;
        v["backup_codes"] = Json::Value(Json::arrayValue);
        for (const auto& c : codes) v["backup_codes"].append(c);
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/account/2fa/disable {code} — код из приложения или резервный
void AccountController::totpDisable(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    auto json = req->getJsonObject();
    const int64_t id = uid(req);
    if (!TwoFactor::enabled(id)) { cb(error("Двухфакторная аутентификация не включена", k409Conflict)); return; }
    try {
        if (!json || !TwoFactor::check(id, JsonUtils::getStr(*json, "code"))) { cb(error("Неверный код", k400BadRequest)); return; }
        app().getDbClient()->execSqlSync(
            "UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_backup = NULL WHERE id = ?", id);
        Json::Value v;
        v["status"] = "ok";
        cb(jsonResp(std::move(v)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
