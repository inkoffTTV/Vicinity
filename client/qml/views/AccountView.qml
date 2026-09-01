import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

// Раздел «Моя учётная запись» (1:1 как в Discord): карточка профиля с баннером,
// аватаром и строками «Отображаемое имя / Имя пользователя / ID» + кнопки.
Item {
    id: root
    anchors.fill: parent
    signal editProfile()   // → раздел «Профиль»

    function reload() {}   // всё на биндингах от appState

    function presenceColor(p) {
        return p === "online" ? themeManager.presenceOnline
             : p === "idle"   ? themeManager.presenceIdle
             : p === "dnd"    ? themeManager.presenceDnd
             : themeManager.presenceOffline
    }
    readonly property var pj: Fmt.parse(appState.profileJson, {})

    // Кнопки в стиле Discord
    component AccentBtn: Rectangle {
        property alias label: t.text
        signal clicked()
        implicitWidth: t.implicitWidth + 32; implicitHeight: 32; radius: 3
        color: h.containsMouse ? Qt.darker(themeManager.accentColor, 1.15) : themeManager.accentColor
        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
        Text { id: t; anchors.centerIn: parent; color: themeManager.accentTextColor
            font.pixelSize: 13; font.bold: true }
        MouseArea { id: h; anchors.fill: parent; hoverEnabled: true
            cursorShape: Qt.PointingHandCursor; onClicked: parent.clicked() }
    }
    component GreyBtn: Rectangle {
        property alias label: t2.text
        signal clicked()
        implicitWidth: t2.implicitWidth + 32; implicitHeight: 32; radius: 3
        color: h2.containsMouse ? Qt.lighter(themeManager.inputColor, 1.35) : themeManager.inputColor
        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
        Text { id: t2; anchors.centerIn: parent; color: themeManager.textColor; font.pixelSize: 13 }
        MouseArea { id: h2; anchors.fill: parent; hoverEnabled: true
            cursorShape: Qt.PointingHandCursor; onClicked: parent.clicked() }
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(660, parent.width)
            spacing: 0

            // ═══ КАРТОЧКА ПРОФИЛЯ ═══
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: cardCol.implicitHeight
                radius: 8; color: themeManager.surfaceColor; clip: true

                ColumnLayout {
                    id: cardCol
                    anchors { left: parent.left; right: parent.right }
                    spacing: 0

                    // Баннер (спека из профиля)
                    ProfileBanner {
                        Layout.fillWidth: true; Layout.preferredHeight: 100
                        type: root.pj.banner && root.pj.banner.type ? root.pj.banner.type : "solid"
                        solid: root.pj.banner && root.pj.banner.color
                               ? Qt.color(root.pj.banner.color)
                               : (appState.accentColor.length ? Qt.color(appState.accentColor)
                                                              : themeManager.accentColor)
                        gradient: root.pj.banner && root.pj.banner.gradient ? root.pj.banner.gradient : null
                        image: root.pj.banner && root.pj.banner.type === "image"
                               ? appState.mediaUrl(appState.bannerPath) : ""
                    }

                    // Аватар + имя + кнопка
                    Item {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 76

                        Rectangle {   // подложка аватара
                            x: 16; y: -46; width: 92; height: 92; radius: width / 2
                            color: themeManager.surfaceColor
                            AnimatedAvatar {
                                anchors { fill: parent; margins: 6 }
                                displayName: appState.displayName
                                source: appState.avatarPath
                                accentColor: appState.accentColor.length
                                             ? Qt.color(appState.accentColor) : themeManager.accentColor
                            }
                            Rectangle {   // presence
                                width: 26; height: 26; radius: 13
                                anchors { right: parent.right; bottom: parent.bottom; rightMargin: 2; bottomMargin: 2 }
                                color: themeManager.surfaceColor
                                Rectangle { anchors.centerIn: parent; width: 16; height: 16; radius: 8
                                    color: root.presenceColor(appState.presence) }
                            }
                        }

                        RowLayout {
                            anchors { left: parent.left; right: parent.right; top: parent.top
                                      leftMargin: 122; rightMargin: 16; topMargin: 10 }
                            spacing: 8
                            ColumnLayout {
                                spacing: 0
                                Layout.fillWidth: true
                                Text { text: appState.displayName; color: themeManager.textColor
                                    font.pixelSize: 20; font.bold: true; elide: Text.ElideRight
                                    Layout.fillWidth: true }
                                Text { text: "@" + appState.username; color: themeManager.textMutedColor
                                    font.pixelSize: 13 }
                            }
                            AccentBtn { label: "Изменить профиль"; onClicked: root.editProfile() }
                        }
                    }

                    // ═══ Внутренний блок с полями ═══
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.margins: 16
                        Layout.preferredHeight: fieldsCol.implicitHeight + 16
                        radius: 8; color: themeManager.railColor

                        ColumnLayout {
                            id: fieldsCol
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                            spacing: 18

                            component FieldRow: RowLayout {
                                property string caption: ""
                                property string value: ""
                                property string btnLabel: "Изменить"
                                signal act()
                                Layout.fillWidth: true
                                spacing: 8
                                ColumnLayout {
                                    spacing: 2; Layout.fillWidth: true
                                    Text { text: caption; color: themeManager.textFaintColor
                                        font.pixelSize: 11; font.bold: true }
                                    Text { text: value; color: themeManager.textColor
                                        font.pixelSize: 14; elide: Text.ElideRight; Layout.fillWidth: true }
                                }
                                GreyBtn { label: btnLabel; onClicked: act() }
                            }

                            FieldRow { caption: "ОТОБРАЖАЕМОЕ ИМЯ"; value: appState.displayName
                                onAct: root.editProfile() }
                            FieldRow { caption: "ИМЯ ПОЛЬЗОВАТЕЛЯ"; value: "@" + appState.username
                                btnLabel: "Копировать"
                                onAct: appState.copyToClipboard(appState.username) }
                            FieldRow { caption: "ID ПОЛЬЗОВАТЕЛЯ"; value: appState.userId
                                btnLabel: "Копировать"
                                onAct: appState.copyToClipboard("" + appState.userId) }
                        }
                    }
                }
            }

            Item { Layout.preferredHeight: 28 }

            // ═══ Подписка / прочее ═══
            Text { text: "ПОДПИСКА"; color: themeManager.textFaintColor
                font.pixelSize: 11; font.bold: true; Layout.bottomMargin: 8 }
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 56
                radius: 8; color: themeManager.surfaceColor
                RowLayout {
                    anchors { fill: parent; leftMargin: 16; rightMargin: 16 }
                    spacing: 10
                    AppIcon { name: "star"; size: 18; color: themeManager.accentColor }
                    Text {
                        Layout.fillWidth: true
                        text: ["Free", "Basic", "Standard", "Ultra"][appState.subscriptionTier] || "Free"
                        color: themeManager.textColor; font.pixelSize: 14; font.bold: true
                    }
                    Text { text: appState.isDeveloper ? "разработчик" : ""
                        color: themeManager.textFaintColor; font.pixelSize: 12 }
                }
            }

            Item { Layout.preferredHeight: 40 }
        }
    }
}
