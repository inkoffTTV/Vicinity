#include "AppState.h"
#include <QJsonObject>
#include <QJsonArray>
#include <QSettings>
#include <QUrl>
#include <QGuiApplication>
#include <QClipboard>

AppState& AppState::instance() {
    static AppState inst;
    return inst;
}

// ── Вспомогательные ──────────────────────────────────────────────────────────

QString AppState::serverBase() const {
    return m_serverOrigin;                          // "http://127.0.0.1:8080"
}

QString AppState::wsUrl() const {
    QString ws = m_serverOrigin;
    if (ws.startsWith("https://")) ws.replace(0, 8, "wss://");
    else if (ws.startsWith("http://")) ws.replace(0, 7, "ws://");
    return ws + "/ws";
}

static QString normalizeOrigin(QString addr) {
    addr = addr.trimmed();
    if (addr.isEmpty()) return QStringLiteral("http://127.0.0.1:8080");
    while (addr.endsWith('/')) addr.chop(1);
    // Убираем случайно вставленный путь /api/v1
    if (addr.endsWith("/api/v1")) addr.chop(7);
    if (!addr.contains("://")) addr = "http://" + addr;
    return addr;
}

void AppState::loadServerAddress() {
    QSettings s("Vicinity", "Vicinity");
    QString origin = normalizeOrigin(s.value("server/address", "http://127.0.0.1:8080").toString());
    m_serverOrigin = origin;
    ApiClient::instance().setBaseUrl(origin + "/api/v1");
    emit serverChanged();
}

void AppState::setServerAddress(const QString& addr) {
    QString origin = normalizeOrigin(addr);
    if (origin == m_serverOrigin) return;
    m_serverOrigin = origin;
    QSettings s("Vicinity", "Vicinity");
    s.setValue("server/address", origin);
    ApiClient::instance().setBaseUrl(origin + "/api/v1");
    emit serverChanged();
}

// ── Сохранение/восстановление сессии ─────────────────────────────────────────

void AppState::saveSession() {
    QSettings s("Vicinity", "Vicinity");
    s.setValue("user/token",            m_sessionToken);
    s.setValue("user/id",               static_cast<qlonglong>(m_userId));
    s.setValue("user/username",         m_username);
    s.setValue("user/displayName",      m_displayName);
    s.setValue("user/subscriptionTier", m_subscriptionTier);
    s.setValue("user/developer",        m_developer);
    s.setValue("user/avatarPath",       m_avatarPath);
    s.setValue("user/bio",              m_bio);
    s.setValue("user/accentColor",      m_accentColor);
    s.setValue("user/bannerPath",       m_bannerPath);
    s.setValue("user/profileJson",      m_profileJson);
    s.setValue("user/pronouns",         m_pronouns);
    s.setValue("user/presence",         m_presence);
}

void AppState::clearSession() {
    QSettings s("Vicinity", "Vicinity");
    s.remove("user");
}

void AppState::tryAutoLogin() {
    QSettings s("Vicinity", "Vicinity");
    QString token = s.value("user/token").toString();
    if (token.isEmpty()) return;

    m_sessionToken     = token;
    m_userId           = s.value("user/id").toLongLong();
    m_username         = s.value("user/username").toString();
    m_displayName      = s.value("user/displayName").toString();
    m_subscriptionTier = s.value("user/subscriptionTier", 0).toInt();
    m_developer        = s.value("user/developer", false).toBool();
    m_avatarPath       = s.value("user/avatarPath").toString();
    m_bio              = s.value("user/bio").toString();
    m_accentColor      = s.value("user/accentColor").toString();
    m_bannerPath       = s.value("user/bannerPath").toString();
    m_profileJson      = s.value("user/profileJson").toString();
    m_pronouns         = s.value("user/pronouns").toString();
    m_presence         = s.value("user/presence", "online").toString();
    m_authenticated    = true;

    ApiClient::instance().setToken(m_sessionToken);
    emit userChanged();
    emit authChanged();

    syncProfile();
}

// ── Синхронизация с сервером ──────────────────────────────────────────────────

void AppState::syncProfile() {
    ApiClient::instance().get("/auth/me", [this](bool ok, const QJsonObject& data) {
        if (!ok) {
            if (data.value("error").toString() == "Unauthorized") clearUser();
            return;
        }
        bool changed = false;

        QString displayName = data.value("display_name").toString();
        if (!displayName.isEmpty() && m_displayName != displayName) {
            m_displayName = displayName; changed = true;
        }

        int tier = data.value("subscription_tier").toInt(m_subscriptionTier);
        if (m_subscriptionTier != tier) { m_subscriptionTier = tier; changed = true; }

        bool dev = data.value("developer").toInt(0) == 1;
        if (m_developer != dev) { m_developer = dev; changed = true; }

        QString avatarPath = data.value("avatar_path").toString();
        if (!avatarPath.isEmpty()) {
            QString fullUrl = avatarPath.startsWith("http") ? avatarPath : serverBase() + avatarPath;
            if (m_avatarPath != fullUrl) { m_avatarPath = fullUrl; changed = true; }
        }

        QString bio = data.value("bio").toString();
        if (m_bio != bio) { m_bio = bio; changed = true; }

        QString accent = data.value("accent_color").toString();
        if (m_accentColor != accent) { m_accentColor = accent; changed = true; }

        QString banner = data.value("banner_path").toString();
        if (!banner.isEmpty()) {
            QString fullBanner = banner.startsWith("http") ? banner : serverBase() + banner;
            if (m_bannerPath != fullBanner) { m_bannerPath = fullBanner; changed = true; }
        }

        QString pj = data.value("profile_json").toString();
        if (m_profileJson != pj) { m_profileJson = pj; changed = true; }

        QString pron = data.value("pronouns").toString();
        if (m_pronouns != pron) { m_pronouns = pron; changed = true; }

        QString pres = data.value("presence").toString();
        if (!pres.isEmpty() && m_presence != pres) { m_presence = pres; changed = true; }

        if (changed) { saveSession(); emit userChanged(); }
    });
}

// ── Авторизация ───────────────────────────────────────────────────────────────

void AppState::setUser(int64_t id, const QString& username,
                       const QString& displayName, const QString& token,
                       const QString& avatarPath, int subscriptionTier, bool developer) {
    m_userId           = id;
    m_username         = username;
    m_displayName      = displayName;
    m_sessionToken     = token;
    m_subscriptionTier = subscriptionTier;
    m_developer        = developer;
    m_authenticated    = true;

    // Prefer server avatar if provided, otherwise keep saved local one
    if (!avatarPath.isEmpty())
        m_avatarPath = avatarPath.startsWith("http") ? avatarPath : serverBase() + avatarPath;

    ApiClient::instance().setToken(token);
    saveSession();
    emit userChanged();
    emit authChanged();
}

void AppState::login(const QString& username, const QString& password) {
    m_loginPending = true;
    m_loginError.clear();
    emit authChanged();

    QJsonObject body;
    body["username"] = username;
    body["password"] = password;

    ApiClient::instance().post("/auth/login", body,
        [this, username](bool ok, const QJsonObject& data) {
            m_loginPending = false;
            if (ok) {
                m_loginError.clear();
                m_bio         = data.value("bio").toString();
                m_accentColor = data.value("accent_color").toString();
                m_profileJson = data.value("profile_json").toString();
                m_pronouns    = data.value("pronouns").toString();
                if (!data.value("presence").toString().isEmpty())
                    m_presence = data.value("presence").toString();
                QString banner = data.value("banner_path").toString();
                m_bannerPath = (banner.isEmpty() || banner.startsWith("http"))
                               ? banner : serverBase() + banner;
                setUser(
                    static_cast<int64_t>(data["user_id"].toInteger()),
                    username,
                    data["display_name"].toString(),
                    data["token"].toString(),
                    data.value("avatar_path").toString(),
                    data.value("subscription_tier").toInt(0),
                    data.value("developer").toInt(0) == 1
                );
            } else {
                m_loginError = data.value("error").toString("Ошибка подключения к серверу");
            }
            emit authChanged();
        });
}

void AppState::registerUser(const QString& username,
                            const QString& password,
                            const QString& displayName) {
    m_loginPending = true;
    m_loginError.clear();
    emit authChanged();

    QJsonObject body;
    body["username"]     = username;
    body["password"]     = password;
    body["display_name"] = displayName.isEmpty() ? username : displayName;

    ApiClient::instance().post("/auth/register", body,
        [this, username](bool ok, const QJsonObject& data) {
            m_loginPending = false;
            if (ok) {
                m_loginError.clear();
                setUser(
                    static_cast<int64_t>(data["user_id"].toInteger()),
                    username,
                    data["display_name"].toString(),
                    data["token"].toString(),
                    QString{}, 0, false
                );
            } else {
                m_loginError = data.value("error").toString("Ошибка регистрации");
            }
            emit authChanged();
        });
}

void AppState::clearUser() {
    m_userId           = 0;
    m_username.clear(); m_displayName.clear();
    m_sessionToken.clear(); m_avatarPath.clear();
    m_bio.clear(); m_accentColor.clear();
    m_bannerPath.clear(); m_profileJson.clear();
    m_subscriptionTier = 0;
    m_roleColor.clear(); m_roleName.clear();
    m_developer        = false;
    m_loginPending     = false;
    m_loginError.clear();
    m_authenticated    = false;
    ApiClient::instance().setToken(QString{});
    clearSession();
    emit userChanged();
    emit authChanged();
}

// ── Профиль ───────────────────────────────────────────────────────────────────

void AppState::setDisplayName(const QString& name) {
    if (m_displayName != name) { m_displayName = name; saveSession(); emit userChanged(); }
}

void AppState::setAvatarPath(const QString& path) {
    if (m_avatarPath != path) { m_avatarPath = path; saveSession(); emit userChanged(); }
}

void AppState::setBannerPath(const QString& path) {
    if (m_bannerPath != path) { m_bannerPath = path; saveSession(); emit userChanged(); }
}

void AppState::clearAvatar() {
    QJsonObject body; body["field"] = QString("avatar");
    ApiClient::instance().post("/profile/clear_media", body, [this](bool ok, const QJsonObject&) {
        if (ok) setAvatarPath("");
    });
}

void AppState::clearBanner() {
    QJsonObject body; body["field"] = QString("banner");
    ApiClient::instance().post("/profile/clear_media", body, [this](bool ok, const QJsonObject&) {
        if (ok) setBannerPath("");
    });
}

void AppState::setBio(const QString& bio) {
    if (m_bio != bio) { m_bio = bio; emit userChanged(); }
}

void AppState::setAccentColor(const QString& color) {
    if (m_accentColor != color) { m_accentColor = color; emit userChanged(); }
}

void AppState::setRole(const QString& name, const QString& color) {
    m_roleName  = name;
    m_roleColor = color;
    emit userChanged();
}

void AppState::setDeveloper(bool value) {
    if (m_developer != value) { m_developer = value; emit userChanged(); }
}

void AppState::uploadAvatar(const QString& localPath) {
    ApiClient::instance().postMultipart("/profile/upload", localPath, "avatar",
        [this](bool ok, const QJsonObject& data) {
            if (!ok) { emit uploadError(data.value("error").toString("Не удалось загрузить аватар")); return; }
            QString url = data["file_url"].toString();
            if (!url.isEmpty()) {
                QString fullUrl = url.startsWith("http") ? url : serverBase() + url;
                setAvatarPath(fullUrl);
                emit avatarUploaded();
            }
        });
}

void AppState::uploadBanner(const QString& localPath) {
    ApiClient::instance().postMultipart("/profile/upload", localPath, "banner",
        [this](bool ok, const QJsonObject& data) {
            if (!ok) { emit uploadError(data.value("error").toString("Не удалось загрузить баннер")); return; }
            QString url = data["file_url"].toString();
            if (!url.isEmpty()) {
                QString fullUrl = url.startsWith("http") ? url : serverBase() + url;
                setBannerPath(fullUrl);
                emit bannerUploaded();
            }
        });
}

void AppState::saveProfileCustomization(const QString& profileJson) {
    QJsonObject body;
    body["profile_json"] = profileJson;
    ApiClient::instance().post("/profile/customize", body,
        [this, profileJson](bool ok, const QJsonObject&) {
            if (!ok) return;
            m_profileJson = profileJson;
            saveSession();
            emit userChanged();
        });
}

// ── Каналы и сообщения ───────────────────────────────────────────────────────

void AppState::createChannel(const QString& name) {
    QJsonObject body;
    body["type"] = QString("channel");
    body["name"] = name;
    ApiClient::instance().post("/channels", body, [this](bool ok, const QJsonObject&) {
        if (ok) loadChannels();
    });
}

void AppState::loadChannels() {
    ApiClient::instance().get("/channels", [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& val : data["channels"].toArray()) {
            auto ch = val.toObject();
            QVariantMap m;
            m["id"]   = static_cast<qlonglong>(ch["id"].toInteger());
            m["name"] = ch["name"].toString();
            m["type"] = ch["type"].toString();
            list.append(m);
        }
        emit channelsReady(list);
    });
}

void AppState::loadMessages(int channelId) {
    QString path = "/channels/" + QString::number(channelId) + "/messages";
    ApiClient::instance().get(path, [this, channelId](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        auto arr = data["messages"].toArray();
        for (const auto& val : arr) {
            auto msg = val.toObject();
            QVariantMap m;
            m["author"]   = msg["author_name"].toString();
            m["authorId"] = static_cast<qlonglong>(msg["author_id"].toInteger());
            m["txt"]      = msg["text"].toString();
            QString ts = msg["created_at"].toString();
            m["ts"]  = ts.length() >= 16 ? ts.mid(11, 5) : ts;
            m["own"] = msg["author_id"].toInteger() == m_userId;
            m["av"]  = mediaUrl(msg["author_avatar"].toString());
            m["rc"]  = QString{};
            m["msgId"]  = static_cast<qlonglong>(msg["id"].toInteger());
            m["edited"] = msg["edited"].toBool();
            QString att = msg["attachment"].toString();
            m["attach"] = att.isEmpty() ? QString() : mediaUrl(att);
            // Реакции: [{emoji,count,users[]}] → JSON-строка [{emoji,count,me}] для модели
            QJsonArray rx;
            for (const auto& rv : msg["reactions"].toArray()) {
                auto r = rv.toObject();
                bool me = false;
                for (const auto& uv : r["users"].toArray())
                    if (uv.toInteger() == m_userId) { me = true; break; }
                QJsonObject o; o["emoji"] = r["emoji"].toString();
                o["count"] = r["count"].toInt(); o["me"] = me;
                rx.append(o);
            }
            m["rx"] = QString::fromUtf8(QJsonDocument(rx).toJson(QJsonDocument::Compact));
            list.append(m);
        }
        emit messagesReady(channelId, list);
    });
}

void AppState::sendChatMessage(int channelId, const QString& text, const QString& attachment) {
    if (channelId == 0 || (text.trimmed().isEmpty() && attachment.isEmpty())) return;
    QString path = "/channels/" + QString::number(channelId) + "/messages";
    QJsonObject body;
    body["text"] = text;
    if (!attachment.isEmpty()) body["attachment"] = attachment;
    ApiClient::instance().post(path, body,
                               [this, channelId, attachment](bool ok, const QJsonObject& d) {
        // Доставка получателям — через WebSocket-рассылку сервера.
        // Отправителю отдаём id: без него не отредактировать/удалить своё же сообщение.
        if (!ok) return;
        qlonglong id = static_cast<qlonglong>(d["id"].toInteger());
        if (attachment.isEmpty()) emit messageSent(channelId, id);
        else                      emit attachmentSent(channelId, id, mediaUrl(attachment));
    });
}

void AppState::editMessage(int channelId, qlonglong msgId, const QString& text) {
    if (channelId == 0 || msgId == 0 || text.trimmed().isEmpty()) return;
    QString path = "/channels/" + QString::number(channelId) + "/messages/"
                   + QString::number(msgId) + "/edit";
    QJsonObject body; body["text"] = text;
    ApiClient::instance().post(path, body, [](bool, const QJsonObject&) {
        // Обновление придёт всем (и себе) по WS message_edited
    });
}

void AppState::deleteMessage(int channelId, qlonglong msgId) {
    if (channelId == 0 || msgId == 0) return;
    ApiClient::instance().del("/channels/" + QString::number(channelId) + "/messages/"
                              + QString::number(msgId), [](bool, const QJsonObject&) {});
}

void AppState::toggleReaction(int channelId, qlonglong msgId, const QString& emoji) {
    if (channelId == 0 || msgId == 0 || emoji.isEmpty()) return;
    QString path = "/channels/" + QString::number(channelId) + "/messages/"
                   + QString::number(msgId) + "/react";
    QJsonObject body; body["emoji"] = emoji;
    ApiClient::instance().post(path, body, [](bool, const QJsonObject&) {
        // Состояние реакций придёт по WS reaction_update
    });
}

void AppState::sendAttachment(int channelId, const QString& localFileUrl) {
    if (channelId == 0 || localFileUrl.isEmpty()) return;
    QString path = "/channels/" + QString::number(channelId) + "/attachments";
    ApiClient::instance().postMultipart(path, localFileUrl, "file",
                                        [this, channelId](bool ok, const QJsonObject& d) {
        if (!ok) { emit uploadError(d["error"].toString()); return; }
        sendChatMessage(channelId, QString(), d["url"].toString());
    });
}

// ── Поиск пользователей и личные чаты ─────────────────────────────────────────

void AppState::searchUsers(const QString& query) {
    QString path = "/users/search?q=" + QString(QUrl::toPercentEncoding(query));
    ApiClient::instance().get(path, [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["users"].toArray()) {
            auto u = v.toObject();
            QVariantMap m;
            m["id"]          = static_cast<qlonglong>(u["id"].toInteger());
            m["username"]    = u["username"].toString();
            m["displayName"] = u["display_name"].toString();
            QString av = u["avatar_path"].toString();
            m["avatar"] = av.isEmpty() || av.startsWith("http") ? av : serverBase() + av;
            list.append(m);
        }
        emit usersFound(list);
    });
}

void AppState::startDm(qlonglong userId) {
    QJsonObject body;
    body["user_id"] = static_cast<qint64>(userId);
    ApiClient::instance().post("/dms", body, [this, userId](bool ok, const QJsonObject& data) {
        if (!ok) return;
        qlonglong chId = static_cast<qlonglong>(data["channel_id"].toInteger());
        emit dmStarted(chId, data["display_name"].toString(), userId);
        loadDms();
    });
}

void AppState::loadDms() {
    ApiClient::instance().get("/dms", [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["dms"].toArray()) {
            auto d = v.toObject();
            QVariantMap m;
            m["channelId"]   = static_cast<qlonglong>(d["channel_id"].toInteger());
            m["userId"]      = static_cast<qlonglong>(d["user_id"].toInteger());
            m["username"]    = d["username"].toString();
            m["displayName"] = d["display_name"].toString();
            QString av = d["avatar_path"].toString();
            m["avatar"] = av.isEmpty() || av.startsWith("http") ? av : serverBase() + av;
            list.append(m);
        }
        emit dmsReady(list);
    });
}

// ── Серверы-гильдии ───────────────────────────────────────────────────────────

void AppState::copyToClipboard(const QString& text) {
    if (auto* cb = QGuiApplication::clipboard()) cb->setText(text);
}

void AppState::loadServers() {
    ApiClient::instance().get("/servers", [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["servers"].toArray()) {
            auto s = v.toObject();
            QVariantMap m;
            m["id"]         = static_cast<qlonglong>(s["id"].toInteger());
            m["name"]       = s["name"].toString();
            m["ownerId"]    = static_cast<qlonglong>(s["owner_id"].toInteger());
            m["inviteCode"] = s["invite_code"].toString();
            list.append(m);
        }
        emit serversReady(list);
    });
}

void AppState::loadServerMembers(qlonglong serverId) {
    QString p = "/servers/" + QString::number(serverId) + "/members";
    ApiClient::instance().get(p, [this, serverId](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["members"].toArray()) {
            auto u = v.toObject();
            QVariantMap m;
            m["id"]          = static_cast<qlonglong>(u["id"].toInteger());
            m["displayName"] = u["display_name"].toString();
            m["username"]    = u["username"].toString();
            m["avatar"]      = mediaUrl(u["avatar_path"].toString());
            m["presence"]    = u["presence"].toString();
            m["isOwner"]     = u["is_owner"].toBool();
            QVariantList roles;
            for (const auto& rv : u["roles"].toArray()) {
                auto ro = rv.toObject();
                roles.append(QVariantMap{ {"name", ro["name"].toString()},
                                          {"color", ro["color"].toString()} });
            }
            m["roles"] = roles;
            list.append(m);
        }
        emit serverMembersReady(serverId, list);
    });
}

void AppState::kickMember(qlonglong serverId, qlonglong userId) {
    QString p = "/servers/" + QString::number(serverId) + "/members/" + QString::number(userId);
    ApiClient::instance().del(p, [this, serverId](bool ok, const QJsonObject& data) {
        if (ok) loadServerMembers(serverId);
        else    emit uploadError(data.value("error").toString("Не удалось удалить участника"));
    });
}

void AppState::assignRoleTo(int roleId, qlonglong userId) {
    QString p = "/roles/" + QString::number(roleId) + "/assign";
    QJsonObject body; body["user_id"] = static_cast<qint64>(userId);
    ApiClient::instance().post(p, body, [this](bool ok, const QJsonObject& data) {
        if (ok) emit membersChanged();
        else    emit uploadError(data.value("error").toString("Не удалось выдать роль"));
    });
}

void AppState::unassignRoleFrom(int roleId, qlonglong userId) {
    QString p = "/roles/" + QString::number(roleId) + "/assign?user_id=" + QString::number(userId);
    ApiClient::instance().del(p, [this](bool ok, const QJsonObject& data) {
        if (ok) emit membersChanged();
        else    emit uploadError(data.value("error").toString("Не удалось снять роль"));
    });
}

void AppState::createServer(const QString& name) {
    QJsonObject body;
    body["name"] = name;
    ApiClient::instance().post("/servers", body, [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        qlonglong sid = static_cast<qlonglong>(data["server_id"].toInteger());
        loadServers();
        emit serverCreated(sid, data["name"].toString());
    });
}

void AppState::joinServer(qlonglong serverId) {
    QString path = "/servers/" + QString::number(serverId) + "/join";
    ApiClient::instance().post(path, QJsonObject{}, [this](bool ok, const QJsonObject&) {
        if (ok) loadServers();
    });
}

void AppState::joinServerByCode(const QString& code) {
    QJsonObject body;
    body["code"] = code;
    ApiClient::instance().post("/servers/join", body, [this](bool ok, const QJsonObject& data) {
        if (ok) {
            loadServers();
            emit serverCreated(static_cast<qlonglong>(data["server_id"].toInteger()),
                               data["name"].toString());
        } else {
            emit serverJoinError(data.value("error").toString("Не удалось войти"));
        }
    });
}

void AppState::loadServerChannels(qlonglong serverId) {
    QString path = "/servers/" + QString::number(serverId) + "/channels";
    ApiClient::instance().get(path, [this, serverId](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["channels"].toArray()) {
            auto c = v.toObject();
            QVariantMap m;
            m["id"]      = static_cast<qlonglong>(c["id"].toInteger());
            m["name"]    = c["name"].toString();
            m["isVoice"] = c["is_voice"].toInt() == 1;
            list.append(m);
        }
        emit serverChannelsReady(serverId, list);
    });
}

void AppState::createServerChannel(qlonglong serverId, const QString& name, bool isVoice) {
    QString path = "/servers/" + QString::number(serverId) + "/channels";
    QJsonObject body;
    body["name"]     = name;
    body["is_voice"] = isVoice ? 1 : 0;
    ApiClient::instance().post(path, body, [this, serverId](bool ok, const QJsonObject&) {
        if (ok) loadServerChannels(serverId);
    });
}

// ── Профиль / друзья / presence ───────────────────────────────────────────────

QString AppState::mediaUrl(const QString& path) const {
    if (path.isEmpty() || path.startsWith("http")) return path;
    return serverBase() + (path.startsWith("/") ? path : "/" + path);
}

void AppState::loadUserProfile(qlonglong userId) {
    QString p = "/users/" + QString::number(userId) + "/profile";
    ApiClient::instance().get(p, [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        emit userProfileReady(data.toVariantMap());
    });
}

void AppState::loadFriends() {
    ApiClient::instance().get("/friends", [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        QVariantList list;
        for (const auto& v : data["friends"].toArray()) {
            auto f = v.toObject();
            QVariantMap m;
            m["id"]          = static_cast<qlonglong>(f["id"].toInteger());
            m["username"]    = f["username"].toString();
            m["displayName"] = f["display_name"].toString();
            m["avatar"]      = mediaUrl(f["avatar_path"].toString());
            m["presence"]    = f["presence"].toString();
            list.append(m);
        }
        emit friendsReady(list);
    });
}

void AppState::loadFriendRequests() {
    ApiClient::instance().get("/friends/pending", [this](bool ok, const QJsonObject& data) {
        if (!ok) return;
        auto conv = [this](const QJsonArray& arr) {
            QVariantList list;
            for (const auto& v : arr) {
                auto f = v.toObject();
                QVariantMap m;
                m["id"]          = static_cast<qlonglong>(f["id"].toInteger());
                m["username"]    = f["username"].toString();
                m["displayName"] = f["display_name"].toString();
                m["avatar"]      = mediaUrl(f["avatar_path"].toString());
                list.append(m);
            }
            return list;
        };
        emit friendRequestsReady(conv(data["incoming"].toArray()),
                                 conv(data["outgoing"].toArray()));
    });
}

void AppState::sendFriendRequest(qlonglong userId) {
    QJsonObject body; body["user_id"] = userId;
    ApiClient::instance().post("/friends/request", body, [this](bool ok, const QJsonObject&) {
        if (ok) { loadFriendRequests(); emit friendsChanged(); }
    });
}

void AppState::respondFriendRequest(qlonglong userId, bool accept) {
    QJsonObject body; body["user_id"] = userId; body["accept"] = accept;
    ApiClient::instance().post("/friends/respond", body, [this](bool ok, const QJsonObject&) {
        if (ok) { loadFriendRequests(); loadFriends(); emit friendsChanged(); }
    });
}

void AppState::removeFriend(qlonglong userId) {
    QString p = "/friends/" + QString::number(userId);
    ApiClient::instance().del(p, [this](bool ok, const QJsonObject&) {
        if (ok) { loadFriends(); loadFriendRequests(); emit friendsChanged(); }
    });
}

void AppState::addToServer(qlonglong serverId, qlonglong userId) {
    if (serverId <= 0 || userId <= 0) { emit actionError("Не выбран сервер"); return; }
    QString p = "/servers/" + QString::number(serverId) + "/members";
    QJsonObject body; body["user_id"] = userId;
    ApiClient::instance().post(p, body, [this](bool ok, const QJsonObject& data) {
        if (ok) emit memberAdded("Пользователь добавлен на сервер");
        else    emit actionError(data.value("error").toString("Не удалось добавить на сервер"));
    });
}

void AppState::addToChannel(qlonglong channelId, qlonglong userId) {
    if (channelId <= 0 || userId <= 0) { emit actionError("Не выбран канал"); return; }
    QString p = "/channels/" + QString::number(channelId) + "/members";
    QJsonObject body; body["user_id"] = userId;
    ApiClient::instance().post(p, body, [this](bool ok, const QJsonObject& data) {
        if (ok) emit memberAdded("Пользователь добавлен в беседу");
        else    emit actionError(data.value("error").toString("Не удалось добавить в беседу"));
    });
}

void AppState::saveProfile(const QString& displayName, const QString& bio,
                           const QString& accent, const QString& pronouns,
                           const QString& presence, const QString& profileJson) {
    QJsonObject body;
    body["display_name"] = displayName;
    body["bio"]          = bio;
    body["accent_color"] = accent;
    body["pronouns"]     = pronouns;
    body["presence"]     = presence;
    body["profile_json"] = profileJson;
    ApiClient::instance().post("/profile/customize", body,
        [this, displayName, bio, accent, pronouns, presence, profileJson](bool ok, const QJsonObject&) {
            if (!ok) return;
            if (!displayName.isEmpty()) m_displayName = displayName;
            m_bio         = bio;
            m_accentColor = accent;
            m_pronouns    = pronouns;
            m_presence    = presence;
            m_profileJson = profileJson;
            saveSession();
            emit userChanged();
        });
}

// ── Роли ─────────────────────────────────────────────────────────────────────

void AppState::loadRoles() {
    ApiClient::instance().get("/roles", [this](bool ok, const QJsonObject& rolesData) {
        if (!ok) return;
        ApiClient::instance().get("/roles/mine", [this, rolesData](bool ok2, const QJsonObject& myData) {
            QList<qlonglong> myIds;
            if (ok2) {
                for (const auto& v : myData["roles"].toArray())
                    myIds.append(static_cast<qlonglong>(v.toObject()["id"].toInteger()));
            }
            QVariantList list;
            for (const auto& v : rolesData["roles"].toArray()) {
                auto r = v.toObject();
                QVariantMap m;
                m["id"]        = static_cast<qlonglong>(r["id"].toInteger());
                m["name"]      = r["name"].toString();
                m["color"]     = r["color"].toString();
                m["icon"]      = r["icon"].toString();
                m["isPremium"] = r["is_premium"].toInt();
                m["assigned"]  = myIds.contains(static_cast<qlonglong>(r["id"].toInteger()));
                list.append(m);
            }
            emit rolesReady(list);
        });
    });
}

void AppState::createRole(const QString& name, const QString& color,
                          const QString& icon, int isPremium) {
    QJsonObject body;
    body["name"]       = name;
    body["color"]      = color;
    body["icon"]       = icon;
    body["is_premium"] = isPremium;
    ApiClient::instance().post("/roles", body, [this](bool ok, const QJsonObject& data) {
        if (ok) loadRoles();
        else emit roleError(data.value("error").toString("Не удалось создать роль"));
    });
}

void AppState::assignRole(int roleId) {
    QString path = "/roles/" + QString::number(roleId) + "/assign";
    ApiClient::instance().post(path, QJsonObject{}, [this](bool ok, const QJsonObject&) {
        if (ok) loadRoles();
    });
}

void AppState::unassignRole(int roleId) {
    QString path = "/roles/" + QString::number(roleId) + "/assign";
    ApiClient::instance().del(path, [this](bool ok, const QJsonObject&) {
        if (ok) loadRoles();
    });
}
