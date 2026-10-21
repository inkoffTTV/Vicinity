#pragma once
#include <QObject>
#include <QColor>
#include <QString>

struct ThemeTable;

// Источник дизайн-токенов приложения. Значения — из ThemeTokens.h (генерируется из design/tokens.json),
// в компонентах цветов нет. Пользовательские настройки (акцент, аватары, градиент) живут здесь же.
class ThemeManager : public QObject {
    Q_OBJECT
    // ── Поверхности ──
    Q_PROPERTY(QColor backgroundColor READ backgroundColor NOTIFY themeChanged)   // bg-ground
    Q_PROPERTY(QColor surfaceColor    READ surfaceColor    NOTIFY themeChanged)   // bg-panel
    Q_PROPERTY(QColor barColor        READ surfaceColor    NOTIFY themeChanged)   // алиас bg-panel
    Q_PROPERTY(QColor railColor       READ surfaceColor    NOTIFY themeChanged)   // алиас bg-panel
    Q_PROPERTY(QColor elevatedColor   READ elevatedColor   NOTIFY themeChanged)   // bg-raised
    Q_PROPERTY(QColor inputColor      READ inputColor      NOTIFY themeChanged)   // bg-input
    Q_PROPERTY(QColor modalColor      READ modalColor      NOTIFY themeChanged)   // bg-modal
    Q_PROPERTY(QColor hoverColor      READ hoverColor      NOTIFY themeChanged)   // bg-hover
    Q_PROPERTY(QColor activeColor     READ activeColor     NOTIFY themeChanged)   // bg-active
    Q_PROPERTY(QColor borderColor     READ borderColor     NOTIFY themeChanged)
    Q_PROPERTY(QColor scrimColor      READ scrimColor      NOTIFY themeChanged)
    Q_PROPERTY(QColor onScrimColor    READ onScrimColor    NOTIFY themeChanged)
    // ── Текст ──
    Q_PROPERTY(QColor textColor         READ textColor         NOTIFY themeChanged)
    Q_PROPERTY(QColor textMutedColor    READ textMutedColor    NOTIFY themeChanged)   // text-2
    Q_PROPERTY(QColor textFaintColor    READ textFaintColor    NOTIFY themeChanged)   // text-3
    Q_PROPERTY(QColor textDisabledColor READ textDisabledColor NOTIFY themeChanged)   // text-faint
    Q_PROPERTY(QColor linkColor         READ linkColor         NOTIFY themeChanged)
    // ── Акцент ──
    Q_PROPERTY(QColor accentColor      READ accentColor      NOTIFY themeChanged)
    Q_PROPERTY(QColor accentHoverColor READ accentHoverColor NOTIFY themeChanged)
    Q_PROPERTY(QColor accentSoftColor  READ accentSoftColor  NOTIFY themeChanged)
    Q_PROPERTY(QColor accentTextColor  READ accentTextColor  NOTIFY themeChanged)   // on-accent
    Q_PROPERTY(QColor mentionColor     READ mentionColor     NOTIFY themeChanged)
    // ── Статусы ──
    Q_PROPERTY(QColor successColor    READ presenceOnline  NOTIFY themeChanged)   // = ok
    Q_PROPERTY(QColor onOkColor       READ onOkColor       NOTIFY themeChanged)
    Q_PROPERTY(QColor warningColor    READ presenceIdle    NOTIFY themeChanged)   // = idle
    Q_PROPERTY(QColor dangerColor     READ dangerColor     NOTIFY themeChanged)
    Q_PROPERTY(QColor dangerTextColor READ dangerTextColor NOTIFY themeChanged)
    Q_PROPERTY(QColor onDangerColor   READ onDangerColor   NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceOnline  READ presenceOnline  NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceIdle    READ presenceIdle    NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceDnd     READ presenceDnd     NOTIFY themeChanged)
    Q_PROPERTY(QColor presenceOffline READ presenceOffline NOTIFY themeChanged)
    Q_PROPERTY(QColor speakingColor   READ speakingColor   NOTIFY themeChanged)
    // ── Тема ──
    Q_PROPERTY(QString currentThemeName READ currentThemeName NOTIFY themeChanged)
    Q_PROPERTY(bool    hasCustomAccent  READ hasCustomAccent  NOTIFY themeChanged)
    // ── Размеры (константы системы) ──
    Q_PROPERTY(int radiusXs   READ radiusXs   CONSTANT)
    Q_PROPERTY(int radiusSm   READ radiusSm   CONSTANT)
    Q_PROPERTY(int radiusMd   READ radiusMd   CONSTANT)
    Q_PROPERTY(int radiusLg   READ radiusLg   CONSTANT)
    Q_PROPERTY(int radiusPill READ radiusPill CONSTANT)
    Q_PROPERTY(int space1  READ space1  CONSTANT)
    Q_PROPERTY(int space2  READ space2  CONSTANT)
    Q_PROPERTY(int space3  READ space3  CONSTANT)
    Q_PROPERTY(int space4  READ space4  CONSTANT)
    Q_PROPERTY(int space6  READ space6  CONSTANT)
    Q_PROPERTY(int space8  READ space8  CONSTANT)
    Q_PROPERTY(int space12 READ space12 CONSTANT)
    // ── Движение: 0 при reducedMotion ──
    Q_PROPERTY(int durFast READ durFast NOTIFY appearanceChanged)
    Q_PROPERTY(int durBase READ durBase NOTIFY appearanceChanged)
    Q_PROPERTY(int durSlow READ durSlow NOTIFY appearanceChanged)
    // ── Внешний вид / раскладка (настройки пользователя) ──
    Q_PROPERTY(qreal avatarRadiusRatio    READ avatarRadiusRatio    WRITE setAvatarRadiusRatio    NOTIFY appearanceChanged)
    Q_PROPERTY(int   sidebarWidth         READ sidebarWidth         WRITE setSidebarWidth         NOTIFY appearanceChanged)
    Q_PROPERTY(bool  compact              READ compact              WRITE setCompact              NOTIFY appearanceChanged)
    Q_PROPERTY(bool  reducedMotion        READ reducedMotion        WRITE setReducedMotion        NOTIFY appearanceChanged)
    Q_PROPERTY(bool  playAnimatedAvatars  READ playAnimatedAvatars  WRITE setPlayAnimatedAvatars  NOTIFY appearanceChanged)
    Q_PROPERTY(bool    bgGradientEnabled  READ bgGradientEnabled    WRITE setBgGradientEnabled    NOTIFY appearanceChanged)
    Q_PROPERTY(QString bgGradientJson     READ bgGradientJson       WRITE setBgGradientJson       NOTIFY appearanceChanged)

public:
    // Порядок — как в design/tokens.json; число сохраняется в настройках (0 = тёмная, 1 = светлая)
    enum class Theme { Dark = 0, Light = 1, Graphite = 2, Black = 3 };
    Q_ENUM(Theme)

    explicit ThemeManager(QObject* parent = nullptr);

    Q_INVOKABLE void setTheme(int theme);
    Q_INVOKABLE void setAccentColor(const QColor& color);
    Q_INVOKABLE void resetAccentColor();
    // Цвет панели темы по номеру — для образцов в переключателе тем
    Q_INVOKABLE QColor themePanelColor(int theme) const;
    // Длительность анимации с учётом reduced-motion (0 = мгновенно); новые места берут durFast/durBase/durSlow
    Q_INVOKABLE int  animDuration(int base) const { return m_reducedMotion ? 0 : base; }
    // Утилиты для пикеров (HEX/RGBA)
    Q_INVOKABLE QString colorToHex(const QColor& c) const;
    Q_INVOKABLE QColor  colorFromHex(const QString& hex) const;
    Q_INVOKABLE bool    isHexColor(const QString& hex) const { return QColor(hex.trimmed()).isValid(); }
    Q_INVOKABLE QColor  rgba(int r, int g, int b, qreal a) const;

    QColor backgroundColor() const;
    QColor surfaceColor() const;
    QColor elevatedColor() const;
    QColor inputColor() const;
    QColor modalColor() const;
    QColor hoverColor() const;
    QColor activeColor() const;
    QColor borderColor() const;
    QColor scrimColor() const;
    QColor onScrimColor() const;
    QColor textColor() const;
    QColor textMutedColor() const;
    QColor textFaintColor() const;
    QColor textDisabledColor() const;
    QColor linkColor() const;
    QColor accentColor() const;
    QColor accentHoverColor() const;
    QColor accentSoftColor() const;
    QColor accentTextColor() const;
    QColor mentionColor() const;
    QColor onOkColor() const;
    QColor dangerColor() const;
    QColor dangerTextColor() const;
    QColor onDangerColor() const;
    QColor presenceOnline() const;
    QColor presenceIdle() const;
    QColor presenceDnd() const;
    QColor presenceOffline() const;
    QColor speakingColor() const;

    QString currentThemeName() const;
    bool    hasCustomAccent()  const { return m_customAccent.isValid(); }

    int radiusXs() const;
    int radiusSm() const;
    int radiusMd() const;
    int radiusLg() const;
    int radiusPill() const;
    int space1() const;
    int space2() const;
    int space3() const;
    int space4() const;
    int space6() const;
    int space8() const;
    int space12() const;
    int durFast() const;
    int durBase() const;
    int durSlow() const;

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
    const ThemeTable& t() const;
    bool lightTheme() const { return m_currentTheme == Theme::Light; }
    void load();
    void save();

    Theme  m_currentTheme = Theme::Dark;
    QColor m_customAccent;

    qreal m_avatarRadiusRatio   = 0.5;    // круглые аватары
    int   m_sidebarWidth        = 260;
    bool  m_compact             = false;
    bool  m_reducedMotion       = false;
    bool  m_playAnimatedAvatars = true;
    bool  m_bgGradientEnabled   = false;
    // Градиент по умолчанию — данные пользовательской настройки, не токен (как COLOR_THEMES в web/src/lib/themes.ts)
    QString m_bgGradientJson    = "{\"type\":\"linear\",\"angle\":135,"
        "\"stops\":[{\"pos\":0,\"color\":\"#1a1a2e\"},{\"pos\":1,\"color\":\"#16213e\"}]}";
};
