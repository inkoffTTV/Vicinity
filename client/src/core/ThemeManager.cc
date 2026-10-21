#include "ThemeManager.h"
#include "ThemeTokens.h"
#include <QSettings>
#include <cmath>

namespace {

const char* const kThemeIds[] = { "dark", "light", "graphite", "black" };

const ThemeTable& tableFor(ThemeManager::Theme theme) {
    const char* id = kThemeIds[int(theme)];
    for (const ThemeTable& x : kThemes)
        if (qstrcmp(x.id, id) == 0) return x;
    return kThemes[0];
}

QColor withAlpha(QColor c, qreal a) { c.setAlphaF(a); return c; }

// Относительная светлота по WCAG — для выбора текста на пользовательском акценте
qreal luminance(const QColor& c) {
    auto lin = [](qreal v) { return v <= 0.03928 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c.redF()) + 0.7152 * lin(c.greenF()) + 0.0722 * lin(c.blueF());
}

// Альфы панелей в градиентной теме — константы характера, как в web/src/theme.css (data-gradient)
constexpr qreal kGradientPanelDark  = 0.52;
constexpr qreal kGradientPanelLight = 0.64;
constexpr qreal kGradientRaisedDark  = 0.06;
constexpr qreal kGradientRaisedLight = 0.6;
constexpr qreal kGradientInputDark  = 0.07;
constexpr qreal kGradientInputLight = 0.75;

} // namespace

ThemeManager::ThemeManager(QObject* parent) : QObject(parent) {
    load();
}

const ThemeTable& ThemeManager::t() const { return tableFor(m_currentTheme); }

void ThemeManager::setTheme(int theme) {
    if (theme < 0 || theme > int(Theme::Black)) return;
    if (m_currentTheme != Theme(theme)) {
        m_currentTheme = Theme(theme);
        save();
        emit themeChanged();
    }
}

void ThemeManager::setAccentColor(const QColor& color) {
    if (!color.isValid()) return;
    m_customAccent = color;
    save();
    emit themeChanged();
}

void ThemeManager::resetAccentColor() {
    m_customAccent = QColor();      // invalid → акцент темы
    save();
    emit themeChanged();
}

QColor ThemeManager::themePanelColor(int theme) const {
    if (theme < 0 || theme > int(Theme::Black)) return t().surfaceColor;
    return tableFor(Theme(theme)).surfaceColor;
}

// ── Поверхности ──
// В градиентной теме земля — градиент (рисует main.qml), панели полупрозрачные; окна остаются сплошными
QColor ThemeManager::backgroundColor() const { return t().backgroundColor; }
QColor ThemeManager::surfaceColor() const {
    if (!m_bgGradientEnabled) return t().surfaceColor;
    return lightTheme() ? withAlpha(t().surfaceColor, kGradientPanelLight)
                        : withAlpha(t().backgroundColor, kGradientPanelDark);
}
QColor ThemeManager::elevatedColor() const {
    if (!m_bgGradientEnabled) return t().elevatedColor;
    return lightTheme() ? withAlpha(t().surfaceColor, kGradientRaisedLight)
                        : withAlpha(t().textColor, kGradientRaisedDark);
}
QColor ThemeManager::inputColor() const {
    if (!m_bgGradientEnabled) return t().inputColor;
    return lightTheme() ? withAlpha(t().surfaceColor, kGradientInputLight)
                        : withAlpha(t().textColor, kGradientInputDark);
}
QColor ThemeManager::modalColor()   const { return t().modalColor; }
QColor ThemeManager::hoverColor()   const { return t().hoverColor; }
QColor ThemeManager::activeColor()  const { return t().activeColor; }
QColor ThemeManager::borderColor()  const { return t().borderColor; }
QColor ThemeManager::scrimColor()   const { return t().scrimColor; }
QColor ThemeManager::onScrimColor() const { return t().onScrimColor; }

// ── Текст ──
QColor ThemeManager::textColor()         const { return t().textColor; }
QColor ThemeManager::textMutedColor()    const { return t().textMutedColor; }
QColor ThemeManager::textFaintColor()    const { return t().textFaintColor; }
QColor ThemeManager::textDisabledColor() const { return t().textDisabledColor; }
QColor ThemeManager::linkColor()         const { return hasCustomAccent() ? m_customAccent : t().linkColor; }

// ── Акцент: пользовательский перекрывает акцент темы, производные считаются от него ──
QColor ThemeManager::accentColor()      const { return hasCustomAccent() ? m_customAccent : t().accentColor; }
QColor ThemeManager::accentHoverColor() const { return hasCustomAccent() ? m_customAccent.darker(118) : t().accentHoverColor; }
QColor ThemeManager::accentSoftColor()  const { return hasCustomAccent() ? withAlpha(m_customAccent, t().accentSoftColor.alphaF()) : t().accentSoftColor; }
QColor ThemeManager::accentTextColor()  const {
    if (!hasCustomAccent()) return t().accentTextColor;
    // Как onAccent в web/src/lib/prefs.ts: белый или тёмно-зелёный — что контрастнее к акценту
    const qreal l = luminance(m_customAccent);
    const bool white = 1.05 / (l + 0.05) >= (l + 0.05) / 0.06;
    return white ? tableFor(Theme::Light).accentTextColor : tableFor(Theme::Dark).accentTextColor;
}
QColor ThemeManager::mentionColor() const { return accentSoftColor(); }

// ── Статусы ──
QColor ThemeManager::onOkColor()       const { return t().onOkColor; }
QColor ThemeManager::dangerColor()     const { return t().dangerColor; }
QColor ThemeManager::dangerTextColor() const { return t().dangerTextColor; }
QColor ThemeManager::onDangerColor()   const { return t().onDangerColor; }
QColor ThemeManager::presenceOnline()  const { return t().presenceOnline; }
QColor ThemeManager::presenceIdle()    const { return t().presenceIdle; }
QColor ThemeManager::presenceDnd()     const { return t().presenceDnd; }
QColor ThemeManager::presenceOffline() const { return t().presenceOffline; }
QColor ThemeManager::speakingColor()   const { return t().speakingColor; }

// ── Размеры и движение ──
int ThemeManager::radiusXs()   const { return kRadiusXs; }
int ThemeManager::radiusSm()   const { return kRadiusSm; }
int ThemeManager::radiusMd()   const { return kRadiusMd; }
int ThemeManager::radiusLg()   const { return kRadiusLg; }
int ThemeManager::radiusPill() const { return kRadiusPill; }
int ThemeManager::space1()  const { return kSpace1; }
int ThemeManager::space2()  const { return kSpace2; }
int ThemeManager::space3()  const { return kSpace3; }
int ThemeManager::space4()  const { return kSpace4; }
int ThemeManager::space6()  const { return kSpace6; }
int ThemeManager::space8()  const { return kSpace8; }
int ThemeManager::space12() const { return kSpace12; }
int ThemeManager::durFast() const { return m_reducedMotion ? 0 : kDurFastMs; }
int ThemeManager::durBase() const { return m_reducedMotion ? 0 : kDurBaseMs; }
int ThemeManager::durSlow() const { return m_reducedMotion ? 0 : kDurSlowMs; }

void ThemeManager::setAvatarRadiusRatio(qreal v) {
    v = qBound(0.0, v, 0.5);
    if (!qFuzzyCompare(m_avatarRadiusRatio, v)) {
        m_avatarRadiusRatio = v;
        save();
        emit appearanceChanged();
    }
}

void ThemeManager::setSidebarWidth(int v) {
    v = qBound(200, v, 380);
    if (m_sidebarWidth != v) {
        m_sidebarWidth = v;
        save();
        emit appearanceChanged();
    }
}

void ThemeManager::setCompact(bool v) {
    if (m_compact != v) {
        m_compact = v;
        save();
        emit appearanceChanged();
    }
}

void ThemeManager::setReducedMotion(bool v) {
    if (m_reducedMotion != v) {
        m_reducedMotion = v;
        save();
        emit appearanceChanged();
    }
}

void ThemeManager::setPlayAnimatedAvatars(bool v) {
    if (m_playAnimatedAvatars != v) {
        m_playAnimatedAvatars = v;
        save();
        emit appearanceChanged();
    }
}

void ThemeManager::setBgGradientEnabled(bool v) {
    if (m_bgGradientEnabled != v) {
        m_bgGradientEnabled = v;
        save();
        emit appearanceChanged();
        emit themeChanged();    // панели меняют прозрачность
    }
}

void ThemeManager::setBgGradientJson(const QString& v) {
    if (m_bgGradientJson != v) {
        m_bgGradientJson = v;
        save();
        emit appearanceChanged();
    }
}

QString ThemeManager::colorToHex(const QColor& c) const {
    // #RRGGBB или #AARRGGBB если есть прозрачность
    return c.alpha() == 255 ? c.name(QColor::HexRgb) : c.name(QColor::HexArgb);
}

QColor ThemeManager::colorFromHex(const QString& hex) const {
    QColor c(hex.trimmed());
    return c;   // невалидный → QColor::isValid()==false, вызывающая сторона проверит
}

QColor ThemeManager::rgba(int r, int g, int b, qreal a) const {
    return QColor(qBound(0,r,255), qBound(0,g,255), qBound(0,b,255),
                  qBound(0, int(a * 255), 255));
}

QString ThemeManager::currentThemeName() const {
    return QString::fromLatin1(kThemeIds[int(m_currentTheme)]);
}

void ThemeManager::load() {
    QSettings s("Vicinity", "Vicinity");
    m_currentTheme = Theme(qBound(0, s.value("appearance/theme", 0).toInt(), int(Theme::Black)));
    QString accent = s.value("appearance/accent", "").toString();
    if (!accent.isEmpty()) m_customAccent = QColor(accent);
    m_avatarRadiusRatio   = s.value("appearance/avatarRadius", 0.5).toReal();
    m_sidebarWidth        = s.value("appearance/sidebarWidth", 260).toInt();
    m_compact             = s.value("appearance/compact", false).toBool();
    m_reducedMotion       = s.value("appearance/reducedMotion", false).toBool();
    m_playAnimatedAvatars = s.value("appearance/playAnimatedAvatars", true).toBool();
    m_bgGradientEnabled   = s.value("appearance/bgGradientEnabled", false).toBool();
    m_bgGradientJson      = s.value("appearance/bgGradientJson", m_bgGradientJson).toString();
}

void ThemeManager::save() {
    QSettings s("Vicinity", "Vicinity");
    s.setValue("appearance/theme", int(m_currentTheme));
    s.setValue("appearance/accent", m_customAccent.isValid() ? m_customAccent.name() : "");
    s.setValue("appearance/avatarRadius", m_avatarRadiusRatio);
    s.setValue("appearance/sidebarWidth", m_sidebarWidth);
    s.setValue("appearance/compact", m_compact);
    s.setValue("appearance/reducedMotion", m_reducedMotion);
    s.setValue("appearance/playAnimatedAvatars", m_playAnimatedAvatars);
    s.setValue("appearance/bgGradientEnabled", m_bgGradientEnabled);
    s.setValue("appearance/bgGradientJson", m_bgGradientJson);
}
