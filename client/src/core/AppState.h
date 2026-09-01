#pragma once
#include <QObject>
#include <QString>
#include <QVariantList>
#include <QVariantMap>
#include <cstdint>
#include "../network/ApiClient.h"

class AppState : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool      authenticated    READ authenticated    NOTIFY authChanged)
    Q_PROPERTY(qlonglong userId           READ userIdQ          NOTIFY userChanged)
    Q_PROPERTY(QString   username         READ username         NOTIFY userChanged)
    Q_PROPERTY(QString   displayName      READ displayName      NOTIFY userChanged)
    Q_PROPERTY(QString   avatarPath       READ avatarPath       NOTIFY userChanged)
    Q_PROPERTY(QString   bio              READ bio              NOTIFY userChanged)
    Q_PROPERTY(QString   accentColor      READ accentColor      NOTIFY userChanged)
    Q_PROPERTY(QString   bannerPath       READ bannerPath       NOTIFY userChanged)
    Q_PROPERTY(QString   profileJson      READ profileJson      NOTIFY userChanged)
    Q_PROPERTY(QString   pronouns         READ pronouns         NOTIFY userChanged)
    Q_PROPERTY(QString   presence         READ presence         NOTIFY userChanged)
    Q_PROPERTY(int       subscriptionTier READ subscriptionTier NOTIFY userChanged)
    Q_PROPERTY(QString   roleColor        READ roleColor        NOTIFY userChanged)
    Q_PROPERTY(QString   roleName         READ roleName         NOTIFY userChanged)
    Q_PROPERTY(bool      isDeveloper      READ isDeveloper      NOTIFY userChanged)
    Q_PROPERTY(bool      loginPending     READ loginPending     NOTIFY authChanged)
    Q_PROPERTY(QString   loginError       READ loginError       NOTIFY authChanged)
    Q_PROPERTY(QString   serverAddress    READ serverAddress    NOTIFY serverChanged)

public:
    static AppState& instance();

    bool      authenticated()    const { return m_authenticated; }
    int64_t   userId()           const { return m_userId; }
    qlonglong userIdQ()          const { return static_cast<qlonglong>(m_userId); }
    QString   username()         const { return m_username; }
    QString   displayName()      const { return m_displayName; }
    QString   avatarPath()       const { return m_avatarPath; }
    QString   bio()              const { return m_bio; }
    QString   accentColor()      const { return m_accentColor; }
    QString   bannerPath()       const { return m_bannerPath; }
    QString   profileJson()      const { return m_profileJson; }
    QString   pronouns()         const { return m_pronouns; }
    QString   presence()         const { return m_presence; }
    int       subscriptionTier() const { return m_subscriptionTier; }
    QString   roleColor()        const { return m_roleColor; }
    QString   roleName()         const { return m_roleName; }
    bool      isDeveloper()      const { return m_developer; }
    bool      loginPending()     const { return m_loginPending; }
    QString   loginError()       const { return m_loginError; }
    QString   sessionToken()     const { return m_sessionToken; }
    QString   serverAddress()    const { return m_serverOrigin; }

    Q_INVOKABLE void loadServerAddress();
    Q_INVOKABLE void setServerAddress(const QString& addr);
    Q_INVOKABLE QString wsUrl()      const;
    Q_INVOKABLE QString authToken()  const { return m_sessionToken; }

    Q_INVOKABLE void setUser(int64_t id, const QString& username,
                             const QString& displayName, const QString& token,
                             const QString& avatarPath = {},
                             int subscriptionTier = 0,
                             bool developer = false);
    Q_INVOKABLE void setDisplayName(const QString& name);
    Q_INVOKABLE void setAvatarPath(const QString& path);
    Q_INVOKABLE void setBannerPath(const QString& path);
    Q_INVOKABLE void setBio(const QString& bio);
    Q_INVOKABLE void setAccentColor(const QString& color);
    Q_INVOKABLE void setRole(const QString& name, const QString& color);
    Q_INVOKABLE void setDeveloper(bool value);
    Q_INVOKABLE void login(const QString& username, const QString& password);
    Q_INVOKABLE void registerUser(const QString& username,
                                  const QString& password,
                                  const QString& displayName);
    Q_INVOKABLE void tryAutoLogin();
    Q_INVOKABLE void syncProfile();
    Q_INVOKABLE void loadChannels();
    Q_INVOKABLE void createChannel(const QString& name);
    Q_INVOKABLE void loadMessages(int channelId);
    Q_INVOKABLE void sendChatMessage(int channelId, const QString& text,
                                     const QString& attachment = QString());
    Q_INVOKABLE void editMessage(int channelId, qlonglong msgId, const QString& text);
    Q_INVOKABLE void deleteMessage(int channelId, qlonglong msgId);
    Q_INVOKABLE void toggleReaction(int channelId, qlonglong msgId, const QString& emoji);
    Q_INVOKABLE void sendAttachment(int channelId, const QString& localFileUrl);
    Q_INVOKABLE void clearUser();

    Q_INVOKABLE void uploadAvatar(const QString& localPath);
    Q_INVOKABLE void uploadBanner(const QString& localPath);
    Q_INVOKABLE void clearAvatar();
    Q_INVOKABLE void clearBanner();
    Q_INVOKABLE void saveProfileCustomization(const QString& profileJson);
    Q_INVOKABLE void searchUsers(const QString& query);
    Q_INVOKABLE void startDm(qlonglong userId);
    Q_INVOKABLE void loadDms();
    Q_INVOKABLE void copyToClipboard(const QString& text);
    Q_INVOKABLE void loadServers();
    Q_INVOKABLE void createServer(const QString& name);
    Q_INVOKABLE void joinServer(qlonglong serverId);
    Q_INVOKABLE void joinServerByCode(const QString& code);
    Q_INVOKABLE void loadServerChannels(qlonglong serverId);
    Q_INVOKABLE void createServerChannel(qlonglong serverId, const QString& name, bool isVoice);
    Q_INVOKABLE void loadServerMembers(qlonglong serverId);
    Q_INVOKABLE void kickMember(qlonglong serverId, qlonglong userId);
    Q_INVOKABLE void assignRoleTo(int roleId, qlonglong userId);
    Q_INVOKABLE void unassignRoleFrom(int roleId, qlonglong userId);

    // ── Профиль / друзья / presence ──
    Q_INVOKABLE void loadUserProfile(qlonglong userId);
    Q_INVOKABLE void loadFriends();
    Q_INVOKABLE void loadFriendRequests();
    Q_INVOKABLE void sendFriendRequest(qlonglong userId);
    Q_INVOKABLE void respondFriendRequest(qlonglong userId, bool accept);
    Q_INVOKABLE void removeFriend(qlonglong userId);
    Q_INVOKABLE void addToServer(qlonglong serverId, qlonglong userId);
    Q_INVOKABLE void addToChannel(qlonglong channelId, qlonglong userId);
    Q_INVOKABLE void saveProfile(const QString& displayName, const QString& bio,
                                 const QString& accent, const QString& pronouns,
                                 const QString& presence, const QString& profileJson);
    Q_INVOKABLE QString mediaUrl(const QString& path) const;
    Q_INVOKABLE void loadRoles();
    Q_INVOKABLE void createRole(const QString& name, const QString& color,
                                const QString& icon, int isPremium);
    Q_INVOKABLE void assignRole(int roleId);
    Q_INVOKABLE void unassignRole(int roleId);

signals:
    void authChanged();
    void userChanged();
    void serverChanged();
    void channelsReady(QVariantList channels);
    void messagesReady(int channelId, QVariantList messages);
    void messageSent(int channelId, qlonglong msgId);                       // свой текст получил id
    void attachmentSent(int channelId, qlonglong msgId, QString attachUrl); // своё вложение отправлено
    void rolesReady(QVariantList roles);
    void roleError(QString message);
    void usersFound(QVariantList users);
    void dmsReady(QVariantList dms);
    void dmStarted(qlonglong channelId, QString displayName, qlonglong userId);
    void serversReady(QVariantList servers);
    void serverChannelsReady(qlonglong serverId, QVariantList channels);
    void serverMembersReady(qlonglong serverId, QVariantList members);
    void membersChanged();   // роль выдана/снята — перезагрузить участников активного сервера
    void serverCreated(qlonglong serverId, QString name);
    void serverJoinError(QString message);
    void userProfileReady(QVariantMap profile);
    void friendsReady(QVariantList friends);
    void friendRequestsReady(QVariantList incoming, QVariantList outgoing);
    void friendsChanged();   // что-то изменилось (заявка/принятие) → перезагрузить списки
    void uploadError(QString message);
    void avatarUploaded();
    void bannerUploaded();
    void memberAdded(QString message);   // успех добавления на сервер/в канал
    void actionError(QString message);   // общая ошибка действия

private:
    explicit AppState(QObject* parent = nullptr) : QObject(parent) {}
    void saveSession();
    void clearSession();
    QString serverBase() const;

    bool      m_authenticated   = false;
    int64_t   m_userId          = 0;
    QString   m_username;
    QString   m_displayName;
    QString   m_avatarPath;
    QString   m_bio;
    QString   m_accentColor;
    QString   m_bannerPath;
    QString   m_profileJson;
    QString   m_pronouns;
    QString   m_presence = "online";
    int       m_subscriptionTier = 0;
    bool      m_developer        = false;
    QString   m_roleColor;
    QString   m_roleName;
    bool      m_loginPending     = false;
    QString   m_loginError;
    QString   m_sessionToken;
    QString   m_serverOrigin     = "http://127.0.0.1:8080";
};
