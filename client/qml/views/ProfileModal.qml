import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

// Полный профиль (модалка с вкладками). Открытие: modal.openFor(userId)
Dialog {
    id: root
    modal: true
    width: 560
    height: 640
    anchors.centerIn: Overlay.overlay
    padding: 0

    property var  prof: ({})
    property int  reqId: 0
    property int  tab: 0   // 0=Обо мне, 1=Серверы, 2=Друзья

    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(180) }
        NumberAnimation { property: "scale"; from: 0.94; to: 1; duration: themeManager.animDuration(220); easing.type: Easing.OutCubic }
    }
    exit: Transition {
        NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(140) }
    }

    function openFor(userId) {
        root.reqId = userId; root.tab = 0; root.prof = ({})
        appState.loadUserProfile(userId)
        open()
    }

    readonly property var    pj: Fmt.parse(prof.profile_json, {})
    readonly property string presence: prof.presence ? prof.presence : "offline"
    readonly property color  cardAccent: (prof.accent_color && prof.accent_color.length > 0)
                                         ? Qt.color(prof.accent_color) : themeManager.accentColor
    function presenceColor(p) {
        return p === "online" ? themeManager.presenceOnline
             : p === "idle"   ? themeManager.presenceIdle
             : p === "dnd"    ? themeManager.presenceDnd
             : themeManager.presenceOffline
    }

    Connections {
        target: appState
        function onUserProfileReady(p) {
            if (parseInt(p.id) === root.reqId) root.prof = p
        }
    }

    background: Rectangle {
        radius: 16
        color: themeManager.elevatedColor
        border.color: themeManager.borderColor; border.width: 1
    }

    contentItem: ColumnLayout {
        id: cl
        spacing: 0

        // Баннер (с кнопкой закрытия поверх)
        ProfileBanner {
            Layout.fillWidth: true; Layout.preferredHeight: 160
            type:  root.pj.banner ? root.pj.banner.type : "solid"
            solid: root.pj.banner && root.pj.banner.color ? Qt.color(root.pj.banner.color) : root.cardAccent
            gradient: root.pj.banner ? root.pj.banner.gradient : null
            image: root.prof.banner_path ? appState.mediaUrl(root.prof.banner_path) : ""

            Rectangle {
                z: 5; width: 30; height: 30; radius: 8
                anchors { right: parent.right; top: parent.top; rightMargin: 12; topMargin: 12 }
                color: xb.containsMouse ? themeManager.rgba(255,107,107,0.2) : themeManager.rgba(0,0,0,0.3)
                AppIcon { anchors.centerIn: parent; name: "close"; size: 16; color: "#ffffff" }
                MouseArea { id: xb; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: root.close() }
            }
        }

        // Аватар + действия
        Item {
            Layout.fillWidth: true; Layout.preferredHeight: 58
            Rectangle {
                x: 24; y: -52; width: 104; height: 104; radius: width/2
                color: themeManager.elevatedColor
                AnimatedAvatar {
                    anchors { fill: parent; margins: 5 }
                    displayName: root.prof.display_name ? root.prof.display_name : "?"
                    source: root.prof.avatar_path ? appState.mediaUrl(root.prof.avatar_path) : ""
                    accentColor: root.cardAccent
                }
                Rectangle {
                    width: 28; height: 28; radius: 14
                    anchors { right: parent.right; bottom: parent.bottom; rightMargin: 4; bottomMargin: 4 }
                    color: themeManager.elevatedColor
                    Rectangle { anchors.centerIn: parent; width: 20; height: 20; radius: 10
                        color: root.presenceColor(root.presence)
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(160) } } }
                }
            }
            Row {
                anchors { right: parent.right; rightMargin: 20; top: parent.top; topMargin: 10 }
                spacing: 8
                Rectangle {
                    width: 110; height: 36; radius: 8; visible: root.prof.friendship_status !== "self"
                    color: msgMa.pressed ? Qt.darker(themeManager.accentColor, 1.2)
                           : (msgMa.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor)
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    scale: msgMa.pressed ? 0.96 : 1.0
                    Behavior on scale { NumberAnimation { duration: themeManager.animDuration(130); easing.type: Easing.OutCubic } }
                    Row { anchors.centerIn: parent; spacing: 6
                        AppIcon { name: "message"; size: 16; color: themeManager.accentTextColor
                            anchors.verticalCenter: parent.verticalCenter }
                        Text { text: "Написать"; color: themeManager.accentTextColor
                            font.pixelSize: 13; font.bold: true; anchors.verticalCenter: parent.verticalCenter } }
                    MouseArea { id: msgMa; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: { appState.startDm(parseInt(root.prof.id)); root.close() } }
                }
                Rectangle {
                    width: 36; height: 36; radius: 8; visible: root.prof.friendship_status === "none"
                    color: addMa.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    scale: addMa.pressed ? 0.94 : 1.0
                    Behavior on scale { NumberAnimation { duration: themeManager.animDuration(130); easing.type: Easing.OutCubic } }
                    AppIcon { anchors.centerIn: parent; name: "person-add"; size: 18
                        color: addMa.containsMouse ? themeManager.accentColor : themeManager.textColor }
                    MouseArea { id: addMa; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: appState.sendFriendRequest(parseInt(root.prof.id)) }
                }
            }
        }

        // Имя / хэндл / местоимения / бейджи
        ColumnLayout {
            Layout.fillWidth: true; Layout.leftMargin: 24; Layout.rightMargin: 24; spacing: 5
            RowLayout { spacing: 8
                Text { text: root.prof.display_name ? root.prof.display_name : ""
                    color: themeManager.textColor; font.pixelSize: 22; font.bold: true }
                Text { text: root.prof.pronouns ? root.prof.pronouns : ""
                    visible: !!(root.prof.pronouns && root.prof.pronouns.length > 0)
                    color: themeManager.textFaintColor; font.pixelSize: 13 }
            }
            Text { text: root.prof.username ? "@" + root.prof.username : ""
                color: themeManager.textMutedColor; font.pixelSize: 14 }
            Flow { Layout.fillWidth: true; spacing: 6
                visible: !!(root.prof.badges && root.prof.badges.length > 0)
                Repeater {
                    model: root.prof.badges ? root.prof.badges : []
                    Rectangle {
                        height: 22; radius: 6; width: bt.implicitWidth + 16
                        color: Qt.rgba(Qt.color(modelData.color).r, Qt.color(modelData.color).g,
                                       Qt.color(modelData.color).b, 0.18)
                        Text { id: bt; anchors.centerIn: parent; text: modelData.label
                            color: Qt.color(modelData.color); font.pixelSize: 11; font.bold: true }
                    }
                }
            }
        }

        Item { Layout.preferredHeight: 12 }

        // Вкладки
        RowLayout {
            Layout.fillWidth: true; Layout.leftMargin: 24; Layout.rightMargin: 24; spacing: 4
            Repeater {
                model: [{l:"Обо мне",i:0},
                        {l:"Серверы ("+(root.prof.mutual_servers?root.prof.mutual_servers.length:0)+")",i:1},
                        {l:"Друзья ("+(root.prof.mutual_friends?root.prof.mutual_friends.length:0)+")",i:2}]
                Rectangle {
                    height: 32; radius: 8; Layout.preferredWidth: tl.implicitWidth + 22
                    color: root.tab === modelData.i ? themeManager.accentSoftColor : "transparent"
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    Text { id: tl; anchors.centerIn: parent; text: modelData.l
                        color: root.tab === modelData.i ? themeManager.accentColor : themeManager.textMutedColor
                        font.pixelSize: 13; font.bold: root.tab === modelData.i }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: root.tab = modelData.i }
                }
            }
            Item { Layout.fillWidth: true }
        }
        Rectangle { Layout.fillWidth: true; Layout.leftMargin: 24; Layout.rightMargin: 24
            Layout.topMargin: 8; height: 1; color: themeManager.borderColor }

        // Содержимое вкладок
        ScrollView {
            Layout.fillWidth: true; Layout.fillHeight: true
            Layout.leftMargin: 24; Layout.rightMargin: 16
            Layout.topMargin: 12; Layout.bottomMargin: 16
            clip: true; contentWidth: availableWidth

            // Обо мне
            Column {
                visible: root.tab === 0
                width: parent.width; spacing: 10
                Column { width: parent.width; spacing: 4
                    visible: !!(root.pj.showStatus !== false && root.pj.statusText && root.pj.statusText.length > 0)
                    Text { text: "СТАТУС"; color: themeManager.textFaintColor; font.pixelSize: 10; font.bold: true }
                    Row { spacing: 6
                        Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
                            color: root.pj.statusColor ? Qt.color(root.pj.statusColor) : themeManager.successColor }
                        Text { text: root.pj.statusText ? root.pj.statusText : ""
                            color: themeManager.textColor; font.pixelSize: 13 } }
                }
                Column { width: parent.width; spacing: 4
                    visible: !!(root.pj.showBio !== false && root.prof.bio && root.prof.bio.length > 0)
                    Text { text: "ОБО МНЕ"; color: themeManager.textFaintColor; font.pixelSize: 10; font.bold: true }
                    Text { width: parent.width; wrapMode: Text.WordWrap; textFormat: Text.StyledText
                        text: Fmt.bio(root.prof.bio ? root.prof.bio : "")
                        color: themeManager.textMutedColor; font.pixelSize: 13
                        onLinkActivated: function(l){ Qt.openUrlExternally(l) } }
                }
                Column { width: parent.width; spacing: 4
                    visible: !!(root.pj.showLinks !== false && root.pj.links && root.pj.links.length > 0)
                    Text { text: "ССЫЛКИ"; color: themeManager.textFaintColor; font.pixelSize: 10; font.bold: true }
                    Repeater { model: root.pj.links ? root.pj.links : []
                        Row { spacing: 6
                            AppIcon { name: "link"; size: 14; color: root.cardAccent
                                anchors.verticalCenter: parent.verticalCenter }
                            Text { text: modelData.label && modelData.label.length>0 ? modelData.label : modelData.url
                                color: root.cardAccent; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: Qt.openUrlExternally(modelData.url) } } }
                    }
                }
                Text { text: "Участник с " + Fmt.memberSince(root.prof.created_at)
                    visible: !!(root.prof.created_at && root.prof.created_at.length > 0)
                    color: themeManager.textFaintColor; font.pixelSize: 12 }
            }

            // Общие серверы
            Column {
                visible: root.tab === 1
                width: parent.width; spacing: 6
                Repeater { model: root.prof.mutual_servers ? root.prof.mutual_servers : []
                    Rectangle {
                        width: parent.width; height: 48; radius: 10
                        color: msHov.containsMouse ? themeManager.hoverColor : "transparent"
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        Row { anchors { left: parent.left; leftMargin: 8; verticalCenter: parent.verticalCenter }
                            spacing: 11
                            Rectangle { width: 34; height: 34; radius: 9; color: themeManager.accentSoftColor
                                anchors.verticalCenter: parent.verticalCenter
                                Text { anchors.centerIn: parent; text: modelData.name.charAt(0).toUpperCase()
                                    color: themeManager.accentColor; font.pixelSize: 15; font.bold: true } }
                            Text { text: modelData.name; color: themeManager.textColor; font.pixelSize: 14
                                anchors.verticalCenter: parent.verticalCenter } }
                        MouseArea { id: msHov; anchors.fill: parent; hoverEnabled: true }
                    }
                }
                Text { visible: !root.prof.mutual_servers || root.prof.mutual_servers.length === 0
                    text: "Нет общих серверов"; color: themeManager.textFaintColor; font.pixelSize: 13 }
            }

            // Общие друзья
            Column {
                visible: root.tab === 2
                width: parent.width; spacing: 6
                Repeater { model: root.prof.mutual_friends ? root.prof.mutual_friends : []
                    Rectangle {
                        width: parent.width; height: 48; radius: 10
                        color: mfHov.containsMouse ? themeManager.hoverColor : "transparent"
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        Row { anchors { left: parent.left; leftMargin: 8; verticalCenter: parent.verticalCenter }
                            spacing: 11
                            AnimatedAvatar { width: 34; height: 34; displayName: modelData.display_name
                                source: appState.mediaUrl(modelData.avatar_path)
                                anchors.verticalCenter: parent.verticalCenter }
                            Text { text: modelData.display_name; color: themeManager.textColor; font.pixelSize: 14
                                anchors.verticalCenter: parent.verticalCenter } }
                        MouseArea { id: mfHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.openFor(parseInt(modelData.id)) }
                    }
                }
                Text { visible: !root.prof.mutual_friends || root.prof.mutual_friends.length === 0
                    text: "Нет общих друзей"; color: themeManager.textFaintColor; font.pixelSize: 13 }
            }
        }
    }
}
