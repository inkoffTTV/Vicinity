import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

// Раздел настроек «Внешний вид» (встраивается в SettingsView)
Item {
    id: root
    anchors.fill: parent
    function reload() {}   // вызывается при показе раздела

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        Column {
            width: parent.width
            leftPadding: 20; rightPadding: 20; topPadding: 16; bottomPadding: 20
            spacing: 16

            // ── ТЕМА ──────────────────────────────────────────────
            Text { text: "ТЕМА"; font.pixelSize: 10; font.bold: true
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.5) }
            Row {
                spacing: 10
                Repeater {
                    model: [
                        { label: "⚫  Чёрная", theme: 0, name: "Black" },
                        { label: "⚪  Белая",  theme: 1, name: "White" }
                    ]
                    Rectangle {
                        width: 130; height: 44; radius: 10
                        property bool active: themeManager.currentThemeName === modelData.name
                        color: active ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                                themeManager.accentColor.b, 0.22)
                                      : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                themeManager.textColor.b, 0.07)
                        border.color: active ? themeManager.accentColor : "transparent"; border.width: 1
                        Text { anchors.centerIn: parent; text: modelData.label
                            color: themeManager.textColor; font.pixelSize: 13; font.bold: active }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: themeManager.setTheme(modelData.theme) }
                    }
                }
            }

            // ── АКЦЕНТНЫЙ ЦВЕТ ────────────────────────────────────
            Text { text: "АКЦЕНТНЫЙ ЦВЕТ"; font.pixelSize: 10; font.bold: true
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.5) }
            Flow {
                width: parent.width - 40; spacing: 8
                Repeater {
                    model: ["#5865f2","#f23f43","#e67e22","#f1c40f","#57f287",
                            "#1abc9c","#00b0f4","#9b59b6","#eb459e","#ffffff"]
                    Rectangle {
                        width: 30; height: 30; radius: 15; color: modelData
                        border.color: themeManager.hasCustomAccent &&
                                      Qt.colorEqual(themeManager.accentColor, modelData)
                                      ? themeManager.accentTextColor : Qt.rgba(0,0,0,0.25)
                        border.width: 2
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: themeManager.setAccentColor(modelData) }
                    }
                }
                // Сброс к акценту темы
                Rectangle {
                    width: 30; height: 30; radius: 15
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.12)
                    border.color: themeManager.hasCustomAccent ? "transparent" : themeManager.accentTextColor; border.width: 2
                    AppIcon { anchors.centerIn: parent; name: "minus"; size: 14; color: themeManager.textColor }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: { themeManager.resetAccentColor(); accentPicker.value = themeManager.accentColor } }
                }
            }
            // Точный ввод акцента (HEX / RGB)
            ColorPicker {
                id: accentPicker
                width: parent.width - 40
                showAlpha: false
                Component.onCompleted: value = themeManager.accentColor
                onValueChanged: if (!Qt.colorEqual(value, themeManager.accentColor))
                                    themeManager.setAccentColor(value)
            }

            // ── ФОРМА АВАТАРОК ────────────────────────────────────
            Text { text: "ФОРМА АВАТАРОК"; font.pixelSize: 10; font.bold: true
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.5) }
            Row {
                spacing: 12
                Repeater {
                    model: [
                        { label: "Квадрат",     ratio: 0.0 },
                        { label: "Скруглённый", ratio: 0.22 },
                        { label: "Круг",        ratio: 0.5 }
                    ]
                    Column {
                        spacing: 6
                        property bool active: Math.abs(themeManager.avatarRadiusRatio - modelData.ratio) < 0.02
                        Rectangle {
                            width: 56; height: 56; anchors.horizontalCenter: parent.horizontalCenter
                            radius: 56 * modelData.ratio
                            color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                           themeManager.accentColor.b, 0.3)
                            border.color: parent.active ? themeManager.accentColor : "transparent"
                            border.width: 2
                            Text { anchors.centerIn: parent; text: "А"; color: themeManager.textColor
                                font.pixelSize: 22; font.bold: true }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: themeManager.avatarRadiusRatio = modelData.ratio }
                        }
                        Text { text: modelData.label; anchors.horizontalCenter: parent.horizontalCenter
                            color: parent.active ? themeManager.accentColor
                                   : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                             themeManager.textColor.b, 0.6)
                            font.pixelSize: 11; font.bold: parent.active }
                    }
                }
            }

            // ── ШИРИНА БОКОВОЙ ПАНЕЛИ ─────────────────────────────
            Text { text: "ШИРИНА БОКОВОЙ ПАНЕЛИ: " + themeManager.sidebarWidth + " px"
                font.pixelSize: 10; font.bold: true
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.5) }
            Slider {
                width: parent.width - 40
                from: 200; to: 380; stepSize: 5
                value: themeManager.sidebarWidth
                onMoved: themeManager.sidebarWidth = value
            }

            // ── ПЛОТНОСТЬ ─────────────────────────────────────────
            Text { text: "ПЛОТНОСТЬ ИНТЕРФЕЙСА"; font.pixelSize: 10; font.bold: true
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.5) }
            Row {
                width: parent.width - 40; spacing: 10
                Text { text: "Компактный режим"; font.pixelSize: 13
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.8)
                    width: parent.width - 56; anchors.verticalCenter: parent.verticalCenter }
                Rectangle {
                    width: 46; height: 24; radius: 12; anchors.verticalCenter: parent.verticalCenter
                    color: themeManager.compact ? themeManager.accentColor
                           : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                     themeManager.textColor.b, 0.2)
                    Rectangle { width: 20; height: 20; radius: 10; color: themeManager.accentTextColor
                        anchors.verticalCenter: parent.verticalCenter
                        x: themeManager.compact ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: 120 } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: themeManager.compact = !themeManager.compact }
                }
            }
            // Уменьшить анимацию (reduced-motion)
            Row {
                width: parent.width - 40; spacing: 10
                Text { text: "Уменьшить анимацию"; font.pixelSize: 13
                    color: themeManager.textColor; width: parent.width - 56
                    anchors.verticalCenter: parent.verticalCenter }
                Rectangle {
                    width: 46; height: 24; radius: 12; anchors.verticalCenter: parent.verticalCenter
                    color: themeManager.reducedMotion ? themeManager.accentColor : themeManager.rgba(themeManager.textColor.r*255, themeManager.textColor.g*255, themeManager.textColor.b*255, 0.2)
                    Rectangle { width: 20; height: 20; radius: 10; color: themeManager.accentTextColor
                        anchors.verticalCenter: parent.verticalCenter
                        x: themeManager.reducedMotion ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: themeManager.animDuration(120) } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: themeManager.reducedMotion = !themeManager.reducedMotion }
                }
            }
            // Проигрывать анимированные аватары/баннеры
            Row {
                width: parent.width - 40; spacing: 10
                Text { text: "Анимированные аватары"; font.pixelSize: 13
                    color: themeManager.textColor; width: parent.width - 56
                    anchors.verticalCenter: parent.verticalCenter }
                Rectangle {
                    width: 46; height: 24; radius: 12; anchors.verticalCenter: parent.verticalCenter
                    color: themeManager.playAnimatedAvatars ? themeManager.accentColor : themeManager.rgba(themeManager.textColor.r*255, themeManager.textColor.g*255, themeManager.textColor.b*255, 0.2)
                    Rectangle { width: 20; height: 20; radius: 10; color: themeManager.accentTextColor
                        anchors.verticalCenter: parent.verticalCenter
                        x: themeManager.playAnimatedAvatars ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: themeManager.animDuration(120) } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: themeManager.playAnimatedAvatars = !themeManager.playAnimatedAvatars }
                }
            }

            // ── ФОН ИНТЕРФЕЙСА (градиент) ──────────────────────────
            Text { text: "ФОН ИНТЕРФЕЙСА"; font.pixelSize: 10; font.bold: true
                color: themeManager.textFaintColor }
            Row {
                width: parent.width - 40; spacing: 10
                Text { text: "Градиентный фон"; font.pixelSize: 13
                    color: themeManager.textColor; width: parent.width - 56
                    anchors.verticalCenter: parent.verticalCenter }
                Rectangle {
                    width: 46; height: 24; radius: 12; anchors.verticalCenter: parent.verticalCenter
                    color: themeManager.bgGradientEnabled ? themeManager.accentColor : themeManager.borderColor
                    Rectangle { width: 20; height: 20; radius: 10; color: themeManager.accentTextColor
                        anchors.verticalCenter: parent.verticalCenter
                        x: themeManager.bgGradientEnabled ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: themeManager.animDuration(120) } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: themeManager.bgGradientEnabled = !themeManager.bgGradientEnabled }
                }
            }
            GradientPicker {
                id: bgGrad
                visible: themeManager.bgGradientEnabled
                width: parent.width - 40
                Component.onCompleted: spec = Fmt.parse(themeManager.bgGradientJson, spec)
                onSpecChanged: themeManager.bgGradientJson = JSON.stringify(spec)
            }

            Item { height: 8 }
        }
    }
}
