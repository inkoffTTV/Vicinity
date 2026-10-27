// Vicinity — generated from tokens.json; не редактировать руками
#pragma once
#include <QColor>
#include <QString>

struct ThemeTable {
    const char* id;
    QColor backgroundColor;
    QColor surfaceColor;
    QColor elevatedColor;
    QColor inputColor;
    QColor modalColor;
    QColor hoverColor;
    QColor activeColor;
    QColor borderColor;
    QColor textColor;
    QColor textMutedColor;
    QColor textFaintColor;
    QColor textDisabledColor;
    QColor accentColor;
    QColor accentHoverColor;
    QColor accentSoftColor;
    QColor accentTextColor;
    QColor linkColor;
    QColor presenceOnline;
    QColor presenceIdle;
    QColor presenceDnd;
    QColor presenceOffline;
    QColor onOkColor;
    QColor dangerColor;
    QColor dangerTextColor;
    QColor onDangerColor;
    QColor scrimColor;
    QColor onScrimColor;
    QColor mentionColor;
    QColor speakingColor;
};

static const ThemeTable kThemes[] = {
    { "dark",
      /* bg-ground    */ QColor(11, 15, 20, 255),
      /* bg-panel     */ QColor(16, 22, 31, 255),
      /* bg-raised    */ QColor(24, 32, 41, 255),
      /* bg-input     */ QColor(24, 32, 41, 255),
      /* bg-modal     */ QColor(18, 26, 36, 255),
      /* bg-hover     */ QColor(255, 255, 255, 15),
      /* bg-active    */ QColor(255, 255, 255, 26),
      /* border       */ QColor(255, 255, 255, 20),
      /* text         */ QColor(237, 242, 247, 255),
      /* text-2       */ QColor(167, 179, 194, 255),
      /* text-3       */ QColor(140, 151, 166, 255),
      /* text-faint   */ QColor(111, 118, 134, 255),
      /* accent       */ QColor(43, 224, 184, 255),
      /* accent-hover */ QColor(35, 196, 161, 255),
      /* accent-soft  */ QColor(43, 224, 184, 41),
      /* on-accent    */ QColor(6, 35, 28, 255),
      /* link         */ QColor(125, 240, 214, 255),
      /* ok           */ QColor(61, 214, 140, 255),
      /* idle         */ QColor(255, 181, 71, 255),
      /* dnd          */ QColor(240, 97, 109, 255),
      /* offline      */ QColor(107, 114, 128, 255),
      /* on-ok        */ QColor(6, 35, 28, 255),
      /* danger       */ QColor(229, 72, 77, 255),
      /* danger-text  */ QColor(242, 112, 122, 255),
      /* on-danger    */ QColor(255, 255, 255, 255),
      /* scrim        */ QColor(0, 0, 0, 153),
      /* on-scrim     */ QColor(255, 255, 255, 255),
      /* mention      */ QColor(43, 224, 184, 41),
      /* speaking     */ QColor(61, 214, 140, 255),
    },
    { "light",
      /* bg-ground    */ QColor(233, 236, 241, 255),
      /* bg-panel     */ QColor(255, 255, 255, 255),
      /* bg-raised    */ QColor(244, 245, 248, 255),
      /* bg-input     */ QColor(240, 242, 245, 255),
      /* bg-modal     */ QColor(255, 255, 255, 255),
      /* bg-hover     */ QColor(15, 20, 30, 13),
      /* bg-active    */ QColor(15, 20, 30, 23),
      /* border       */ QColor(15, 20, 30, 23),
      /* text         */ QColor(20, 22, 27, 255),
      /* text-2       */ QColor(74, 80, 92, 255),
      /* text-3       */ QColor(95, 101, 115, 255),
      /* text-faint   */ QColor(114, 120, 134, 255),
      /* accent       */ QColor(17, 122, 102, 255),
      /* accent-hover */ QColor(14, 102, 85, 255),
      /* accent-soft  */ QColor(17, 122, 102, 31),
      /* on-accent    */ QColor(255, 255, 255, 255),
      /* link         */ QColor(15, 115, 96, 255),
      /* ok           */ QColor(26, 154, 90, 255),
      /* idle         */ QColor(183, 121, 31, 255),
      /* dnd          */ QColor(210, 60, 72, 255),
      /* offline      */ QColor(138, 144, 156, 255),
      /* on-ok        */ QColor(6, 35, 28, 255),
      /* danger       */ QColor(209, 44, 56, 255),
      /* danger-text  */ QColor(192, 38, 47, 255),
      /* on-danger    */ QColor(255, 255, 255, 255),
      /* scrim        */ QColor(15, 20, 30, 128),
      /* on-scrim     */ QColor(255, 255, 255, 255),
      /* mention      */ QColor(17, 122, 102, 31),
      /* speaking     */ QColor(26, 154, 90, 255),
    },
    { "graphite",
      /* bg-ground    */ QColor(26, 27, 31, 255),
      /* bg-panel     */ QColor(35, 36, 41, 255),
      /* bg-raised    */ QColor(44, 45, 51, 255),
      /* bg-input     */ QColor(44, 45, 51, 255),
      /* bg-modal     */ QColor(38, 39, 44, 255),
      /* bg-hover     */ QColor(255, 255, 255, 13),
      /* bg-active    */ QColor(255, 255, 255, 23),
      /* border       */ QColor(255, 255, 255, 20),
      /* text         */ QColor(236, 236, 241, 255),
      /* text-2       */ QColor(176, 179, 189, 255),
      /* text-3       */ QColor(149, 153, 165, 255),
      /* text-faint   */ QColor(118, 123, 137, 255),
      /* accent       */ QColor(43, 198, 164, 255),
      /* accent-hover */ QColor(34, 168, 139, 255),
      /* accent-soft  */ QColor(43, 198, 164, 41),
      /* on-accent    */ QColor(6, 35, 28, 255),
      /* link         */ QColor(127, 227, 204, 255),
      /* ok           */ QColor(61, 214, 140, 255),
      /* idle         */ QColor(242, 179, 61, 255),
      /* dnd          */ QColor(240, 97, 109, 255),
      /* offline      */ QColor(107, 114, 128, 255),
      /* on-ok        */ QColor(6, 35, 28, 255),
      /* danger       */ QColor(229, 72, 77, 255),
      /* danger-text  */ QColor(242, 112, 122, 255),
      /* on-danger    */ QColor(255, 255, 255, 255),
      /* scrim        */ QColor(0, 0, 0, 153),
      /* on-scrim     */ QColor(255, 255, 255, 255),
      /* mention      */ QColor(43, 198, 164, 41),
      /* speaking     */ QColor(61, 214, 140, 255),
    },
    { "black",
      /* bg-ground    */ QColor(0, 0, 0, 255),
      /* bg-panel     */ QColor(11, 11, 13, 255),
      /* bg-raised    */ QColor(22, 23, 26, 255),
      /* bg-input     */ QColor(22, 23, 26, 255),
      /* bg-modal     */ QColor(15, 16, 18, 255),
      /* bg-hover     */ QColor(255, 255, 255, 15),
      /* bg-active    */ QColor(255, 255, 255, 26),
      /* border       */ QColor(255, 255, 255, 20),
      /* text         */ QColor(240, 241, 244, 255),
      /* text-2       */ QColor(169, 173, 184, 255),
      /* text-3       */ QColor(143, 148, 161, 255),
      /* text-faint   */ QColor(108, 113, 128, 255),
      /* accent       */ QColor(43, 198, 164, 255),
      /* accent-hover */ QColor(34, 168, 139, 255),
      /* accent-soft  */ QColor(43, 198, 164, 41),
      /* on-accent    */ QColor(6, 35, 28, 255),
      /* link         */ QColor(127, 227, 204, 255),
      /* ok           */ QColor(61, 214, 140, 255),
      /* idle         */ QColor(242, 179, 61, 255),
      /* dnd          */ QColor(240, 97, 109, 255),
      /* offline      */ QColor(107, 114, 128, 255),
      /* on-ok        */ QColor(6, 35, 28, 255),
      /* danger       */ QColor(229, 72, 77, 255),
      /* danger-text  */ QColor(242, 112, 122, 255),
      /* on-danger    */ QColor(255, 255, 255, 255),
      /* scrim        */ QColor(0, 0, 0, 179),
      /* on-scrim     */ QColor(255, 255, 255, 255),
      /* mention      */ QColor(43, 198, 164, 41),
      /* speaking     */ QColor(61, 214, 140, 255),
    },
};

static constexpr int kSpace1 = 4;
static constexpr int kSpace2 = 8;
static constexpr int kSpace3 = 12;
static constexpr int kSpace4 = 16;
static constexpr int kSpace6 = 24;
static constexpr int kSpace8 = 32;
static constexpr int kSpace12 = 48;
static constexpr int kRadiusXs = 4;
static constexpr int kRadiusSm = 8;
static constexpr int kRadiusMd = 12;
static constexpr int kRadiusLg = 18;
static constexpr int kRadiusPill = 999;
static constexpr int kRailWidth = 68;
static constexpr int kRailItem = 44;
static constexpr int kAvatarSm = 24;
static constexpr int kAvatarMd = 40;
static constexpr int kAvatarLg = 80;
static constexpr int kControlH = 36;
static constexpr int kHitMin = 32;
static constexpr int kMessageMax = 640;
static constexpr int kDurFastMs = 120;
static constexpr int kDurBaseMs = 180;
static constexpr int kDurSlowMs = 260;
static constexpr int kDurEnterMs = 350;
