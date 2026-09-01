#pragma once
#include <QObject>
#include <QColor>

// Источник дизайн-токенов приложения. Все цвета UI берутся ОТСЮДА
// (никаких хардкод-цветов в компонентах), чтобы темизация действовала глобально.
class ThemeManager : public QObject {
    Q_OBJECT
    // ── Базовые токены темы ──
    Q_PROPERTY(QColor  backgroundColor  READ backgroundColor  NOTIFY themeChanged)
    Q_PROPERTY(QColor  textColor        READ textColor        NOTIFY themeChanged)
    Q_PROPERTY(QColor  accentColor      READ accentColor      NOTIFY themeChanged)
    Q_PROPERTY(QString currentThemeName READ currentThemeName NOTIFY themeChanged)
    Q_PROPERTY(bool    hasCustomAccent  READ hasCustomAccent  NOTIFY themeChanged)
    // ── Производные семантические токены ──
    Q_PROPERTY(QColor surfaceColor     READ surfaceColor     NOTIFY themeChanged)
    Q_PROPERTY(QColor elevatedColor    READ elevatedColor    NOTIFY themeChanged)
    Q_PROPERTY(QColor barColor         READ barColor         NOTIFY themeChanged)
    Q_PROPERTY(QColor railColor        READ railColor        NOTIFY themeChanged)
    Q_PROPERTY(QColor inputColor       READ inputColor       NOTIFY themeChanged)
    Q_PROPERTY(QColor hoverColor       READ hoverColor       NOTIFY themeChanged)
    Q_PROPERTY(QColor borderColor      READ borderColor      NOTIFY themeChanged)
    Q_PROPERTY(QColor textMutedColor   READ textMutedColor   NOTIFY themeChanged)
    Q_PROPERTY(QColor textFaintColor   READ textFaintColor   NOTIFY themeChanged)
    Q_PROPERTY(QColor accentTextColor  READ accentTextColor  NOTIFY themeChanged)
    Q_PROPERTY(QColor accentSoftColor  READ accentSoftColor  NOTIFY themeChanged)
    Q_PROPERTY(QColor dangerColor      READ dangerColor      NOTIFY themeChanged)
    Q_PROPERTY(QColor successColor     READ successColor     NOTIFY themeChanged)
    Q_PROPERTY(QColor warningColor     READ warningColor     NOTIFY themeChanged)
    // ── Токены присутствия (presence) ──
    Q_PROPERTY(QColor presenceOnline   READ presenceOnline   NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceIdle     READ presenceIdle     NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceDnd      READ presenceDnd      NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceOffline  READ presenceOffline  NOTIFY themeChanged)
    // ── Внешний вид / раскладка ──
    Q_PROPERTY(qreal avatarRadiusRatio    READ avatarRadiusRatio    WRITE setAvatarRadiusRatio    NOTIFY appearanceChanged)
    Q_PROPERTY(int   sidebarWidth         READ sidebarWidth         WRITE setSidebarWidth         NOTIFY appearanceChanged)
    Q_PROPERTY(bool  compact              READ compact              WRITE setCompact              NOTIFY appearanceChanged)
    Q_PROPERTY(bool  reducedMotion        READ reducedMotion        WRITE setReducedMotion        NOTIFY appearanceChanged)
    Q_PROPERTY(bool  playAnimatedAvatars  READ playAnimatedAvatars  WRITE setPlayAnimatedAvatars  NOTIFY appearanceChanged)
    Q_PROPERTY(bool    bgGradientEnabled  READ bgGradientEnabled    WRITE setBgGradientEnabled    NOTIFY appearanceChanged)
    Q_PROPERTY(QString bgGradientJson     READ bgGradientJson       WRITE setBgGradientJson       NOTIFY appearanceChanged)

public:
    enum class Theme { Black, White };
    Q_ENUM(Theme)

    explicit ThemeManager(QObject* parent = nullptr);

    Q_INVOKABLE void setTheme(Theme theme);
    Q_INVOKABLE void setAccentColor(const QColor& color);
    Q_INVOKABLE void resetAccentColor();
    // Длительность анимации с учётом reduced-motion (0 = мгновенно)
    Q_INVOKABLE int  animDuration(int base) const { return m_reducedMotion ? 0 : base; }
    // Утилиты для пикеров (HEX/RGBA)
    Q_INVOKABLE QString colorToHex(const QColor& c) const;
    Q_INVOKABLE QColor  colorFromHex(const QString& hex) const;
    Q_INVOKABLE bool    isHexColor(const QString& hex) const { return QColor(hex.trimmed()).isValid(); }
    Q_INVOKABLE QColor  rgba(int r, int g, int b, qreal a) const;

    QColor  backgroundColor()  const { return m_bgColor; }
    QColor  textColor()        const { return m_textColor; }
    QColor  accentColor()      const { return m_accentColor; }
    QString currentThemeName() const;
    bool    hasCustomAccent()  const { return m_customAccent.isValid(); }

    QColor surfaceColor()    const { return m_bgColor.darker(114); }   // сайдбар ≈ #2b2d31
    QColor elevatedColor()   const { return m_bgColor.darker(108); }   // карточки/попапы ≈ #35373c
    QColor barColor()        const { return m_bgColor.darker(140); }   // верхние бары ≈ #262829
    QColor railColor()       const { return m_bgColor.darker(165); }   // рельса/низ профиля ≈ #1e1f22
    QColor inputColor()      const { return alpha(m_textColor, 0.07); }
    QColor hoverColor()      const { return alpha(m_textColor, 0.05); }
    QColor borderColor()     const { return alpha(m_textColor, 0.08); }
    QColor textMutedColor()  const { return alpha(m_textColor, 0.65); }
    QColor textFaintColor()  const { return alpha(m_textColor, 0.42); }
    QColor accentTextColor() const { return QColor("#ffffff"); }
    QColor accentSoftColor() const { return alpha(m_accentColor, 0.20); }
    QColor dangerColor()     const { return QColor("#ff6b6b"); }
    QColor successColor()    const { return QColor("#57f287"); }
    QColor warningColor()    const { return QColor("#f1c40f"); }
    QColor presenceOnline()  const { return QColor("#3ba55d"); }
    QColor presenceIdle()    const { return QColor("#faa61a"); }
    QColor presenceDnd()     const { return QColor("#ed4245"); }
    QColor presenceOffline() const { return QColor("#747f8d"); }

    qreal avatarRadiusRatio()   const { return m_avatarRadiusRatio; }
    int   sidebarWidth()        const { return m_sidebarWidth; }
    bool  compact()             const { return m_compact; }
    bool  reducedMotion()       const { return m_reducedMotion; }
    bool  playAnimatedAvatars() const { return m_playAnimatedAvatars; }
    bool    bgGradientEnabled() const { return m_bgGradientEnabled; }
    QString bgGradientJson()    const { return m_bgGradientJson; }

    void setAvatarRadiusRatio(qreal v);
    void setSidebarWidth(int v);
    void setCompact(bool v);
    void setReducedMotion(bool v);
    void setPlayAnimatedAvatars(bool v);
    void setBgGradientEnabled(bool v);
    void setBgGradientJson(const QString& v);

signals:
    void themeChanged();
    void appearanceChanged();

private:
    static QColor alpha(const QColor& c, qreal a) { QColor r = c; r.setAlphaF(a); return r; }
    void applyTheme(Theme theme);
    void load();
    void save();

    QColor m_bgColor;
    QColor m_textColor;
    QColor m_accentColor;
    QColor m_customAccent;
    Theme  m_currentTheme = Theme::Black;

    qreal m_avatarRadiusRatio   = 0.5;    // Discord = круглые аватары
    int   m_sidebarWidth        = 260;
    bool  m_compact             = false;
    bool  m_reducedMotion       = false;
    bool  m_playAnimatedAvatars = true;
    bool  m_bgGradientEnabled   = false;
    QString m_bgGradientJson    = "{\"type\":\"linear\",\"angle\":135,"
        "\"stops\":[{\"pos\":0,\"color\":\"#1a1a2e\"},{\"pos\":1,\"color\":\"#16213e\"}]}";
};
