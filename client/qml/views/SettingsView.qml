import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"

// Настройки 1:1 как в Discord: ПОЛНОЭКРАННЫЙ оверлей, слева колонка-навигация
// с категориями (без иконок, нейтральная подсветка), справа контент с ESC-кружком.
// Открытие: settings.openAt(N) — 0=Аккаунт, 1=Профиль, 2=Внешний вид, 3=Голос, 4=Роли.
Popup {
    id: root
    parent: Overlay.overlay
    x: 0; y: 0
    width: parent ? parent.width : 800
    height: parent ? parent.height : 600
    modal: true; padding: 0
    closePolicy: Popup.CloseOnEscape

    // Discord-переход: контент чуть увеличен и прозрачен → на место
    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(160) }
        NumberAnimation { property: "scale"; from: 1.06; to: 1; duration: themeManager.animDuration(220); easing.type: Easing.OutCubic } }
    exit: Transition {
        NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(140) }
        NumberAnimation { property: "scale"; from: 1; to: 1.04; duration: themeManager.animDuration(140); easing.type: Easing.InCubic } }

    background: Rectangle { color: themeManager.backgroundColor }

    property int section: 0
    function openAt(sec) { section = sec; open() }
    onOpened: refresh()
    onSectionChanged: refresh()
    function refresh() {
        var it = [accountSection, profileSection, apprSection, voiceSection, rolesSection][section]
        if (it && it.reload) it.reload()
    }

    // Навигация: cat = заголовок категории, sec = индекс раздела, sep = разделитель
    readonly property var navModel: [
        { cat: "НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ" },
        { t: "Моя учётная запись", sec: 0 },
        { t: "Профиль",            sec: 1 },
        { sep: true },
        { cat: "НАСТРОЙКИ ПРИЛОЖЕНИЯ" },
        { t: "Внешний вид",        sec: 2 },
        { t: "Голос и видео",      sec: 3 },
        { sep: true },
        { t: "Роли",               sec: 4 },
        { sep: true },
        { logout: true }
    ]
    readonly property var sectionTitles:
        ["Моя учётная запись", "Профиль", "Внешний вид", "Голос и видео", "Роли"]

    contentItem: RowLayout {
        spacing: 0

        // ═══ ЛЕВАЯ ЗОНА НАВИГАЦИИ (тянется, сама колонка прижата вправо) ═══
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: Math.max(252, root.width * 0.5 - 380)
            color: themeManager.surfaceColor

            ScrollView {
                anchors.fill: parent
                contentWidth: availableWidth
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                ColumnLayout {
                    width: 218
                    x: parent.width - width - 12
                    spacing: 2

                    Item { Layout.preferredHeight: 58 }

                    Repeater {
                        model: root.navModel

                        delegate: Item {
                            Layout.fillWidth: true
                            Layout.preferredHeight: modelData.cat ? 28 : (modelData.sep ? 17 : 34)

                            // Заголовок категории
                            Text {
                                visible: !!modelData.cat
                                anchors { left: parent.left; leftMargin: 10; bottom: parent.bottom; bottomMargin: 6 }
                                text: modelData.cat || ""
                                color: themeManager.textFaintColor
                                font.pixelSize: 11; font.bold: true
                            }

                            // Разделитель
                            Rectangle {
                                visible: !!modelData.sep
                                anchors.centerIn: parent
                                width: parent.width - 20; height: 1
                                color: themeManager.borderColor
                            }

                            // Пункт навигации / выход
                            Rectangle {
                                visible: !!modelData.t || !!modelData.logout
                                anchors { fill: parent; bottomMargin: 2 }
                                radius: 4
                                property bool active: modelData.sec !== undefined && root.section === modelData.sec
                                // Активный пункт в Discord — нейтральный серый, не акцент
                                color: active
                                       ? Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                 themeManager.textColor.b, 0.10)
                                       : (navHov.containsMouse ? themeManager.hoverColor : "transparent")
                                Behavior on color { ColorAnimation { duration: themeManager.animDuration(100) } }

                                Text {
                                    anchors { left: parent.left; leftMargin: 10; verticalCenter: parent.verticalCenter }
                                    text: modelData.logout ? "Выйти" : (modelData.t || "")
                                    color: modelData.logout ? themeManager.dangerColor
                                           : (parent.active || navHov.containsMouse
                                              ? themeManager.textColor : themeManager.textMutedColor)
                                    font.pixelSize: 15
                                }
                                AppIcon {
                                    visible: !!modelData.logout
                                    anchors { right: parent.right; rightMargin: 10; verticalCenter: parent.verticalCenter }
                                    name: "logout"; size: 15; color: themeManager.dangerColor
                                }
                                MouseArea {
                                    id: navHov
                                    anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (modelData.logout) { root.close(); appState.clearUser() }
                                        else if (modelData.sec !== undefined) root.section = modelData.sec
                                    }
                                }
                            }
                        }
                    }

                    // Версия приложения (низ навигации, как в Discord)
                    Item { Layout.preferredHeight: 6 }
                    Text {
                        Layout.leftMargin: 10
                        text: "Vicinity · Qt " + "6.9"
                        color: themeManager.textFaintColor; font.pixelSize: 11
                    }
                    Item { Layout.preferredHeight: 40 }
                }
            }
        }

        // ═══ КОНТЕНТ ═══
        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            color: themeManager.backgroundColor
            clip: true

            // Заголовок раздела
            Text {
                id: pageTitle
                x: 40; y: 60
                text: root.sectionTitles[root.section]
                color: themeManager.textColor
                font.pixelSize: 20; font.bold: true
            }

            // Хост разделов
            Item {
                anchors { fill: parent; leftMargin: 40; topMargin: 100; rightMargin: 92; bottomMargin: 0 }

                AccountView       { id: accountSection; visible: root.section === 0
                    onEditProfile: root.section = 1 }
                ProfileEditor     { id: profileSection; visible: root.section === 1
                    onDone: root.close(); onOpenRoles: root.section = 4 }
                AppearanceView    { id: apprSection;    visible: root.section === 2 }
                VoiceSettingsView { id: voiceSection;   visible: root.section === 3 }
                RolesView         { id: rolesSection;   visible: root.section === 4 }
            }

            // ESC-кружок (как в Discord)
            Column {
                anchors { top: parent.top; right: parent.right; topMargin: 60; rightMargin: 28 }
                spacing: 6

                Rectangle {
                    width: 36; height: 36; radius: 18
                    anchors.horizontalCenter: parent.horizontalCenter
                    color: escHov.containsMouse ? themeManager.hoverColor : "transparent"
                    border.width: 2
                    border.color: escHov.containsMouse ? themeManager.textColor : themeManager.textMutedColor
                    Behavior on border.color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    AppIcon { anchors.centerIn: parent; name: "close"; size: 16
                        color: escHov.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                    MouseArea { id: escHov; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor; onClicked: root.close() }
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "ESC"; color: themeManager.textMutedColor
                    font.pixelSize: 12; font.bold: true
                }
            }
        }
    }
}
