#include "ThemeManager.h"
#include <QSettings>

ThemeManager::ThemeManager(QObject* parent) : QObject(parent) {
    load();
    applyTheme(m_currentTheme);
}

void ThemeManager::setTheme(Theme theme) {
    if (m_currentTheme != theme) {
        m_currentTheme = theme;
        applyTheme(theme);
        save();
        emit themeChanged();
    }
}

void ThemeManager::setAccentColor(const QColor& color) {
    if (!color.isValid()) return;
    m_customAccent = color;
    m_accentColor  = color;
    save();
    emit themeChanged();
}

void ThemeManager::resetAccentColor() {
    m_customAccent = QColor();      // invalid → акцент темы
    applyTheme(m_currentTheme);
    save();
    emit themeChanged();
}

void ThemeManager::applyTheme(Theme theme) {
    switch (theme) {
        case Theme::Black:
            m_bgColor     = QColor("#313338");   // фон чата Discord
            m_textColor   = QColor("#dbdee1");   // основной текст Discord
            m_accentColor = QColor("#5865f2");   // blurple
            break;
        case Theme::White:
            m_bgColor     = QColor("#f8f8f8");
            m_textColor   = QColor("#111111");
            m_accentColor = QColor("#222222");
            break;
    }
    // Кастомный акцент перекрывает акцент темы
    if (m_customAccent.isValid())
        m_accentColor = m_customAccent;
}

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
    switch (m_currentTheme) {
        case Theme::Black: return "Black";
        case Theme::White: return "White";
    }
    return "Black";
}

void ThemeManager::load() {
    QSettings s("Vicinity", "Vicinity");
    m_currentTheme = s.value("appearance/theme", 0).toInt() == 1 ? Theme::White : Theme::Black;
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
    s.setValue("appearance/theme", m_currentTheme == Theme::White ? 1 : 0);
    s.setValue("appearance/accent", m_customAccent.isValid() ? m_customAccent.name() : "");
    s.setValue("appearance/avatarRadius", m_avatarRadiusRatio);
    s.setValue("appearance/sidebarWidth", m_sidebarWidth);
    s.setValue("appearance/compact", m_compact);
    s.setValue("appearance/reducedMotion", m_reducedMotion);
    s.setValue("appearance/playAnimatedAvatars", m_playAnimatedAvatars);
    s.setValue("appearance/bgGradientEnabled", m_bgGradientEnabled);
    s.setValue("appearance/bgGradientJson", m_bgGradientJson);
}
