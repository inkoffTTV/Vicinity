import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

// Мини-карточка профиля (поповер). Открывается: card.openFor(userId)
Popup {
    id: root
    modal: true
    dim: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    padding: 0
    width: 340
    height: Math.max(160, Math.min(col.implicitHeight, 640))
    anchors.centerIn: Overlay.overlay

    property var  prof: ({})
    property int  reqId: 0
    property bool loading: true
    property int  contextServerId: 0    // активный сервер (для «Добавить на сервер»)
    property int  contextChannelId: 0   // активная беседа (для «Добавить в беседу»)
    property string feedback: ""
    property bool   feedbackError: false
    signal openFull(int userId)

    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(160) }
        NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: themeManager.animDuration(190); easing.type: Easing.OutCubic }
    }
    exit: Transition {
        NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(120) }
    }

    function openFor(userId) {
        root.reqId = userId
        root.loading = true
        root.prof = ({})
        root.feedback = ""
        appState.loadUserProfile(userId)
        open()
    }

    // Разобранные данные
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
    function presenceLabel(p) {
        return p === "online" ? "В сети" : p === "idle" ? "Не активен"
             : p === "dnd" ? "Не беспокоить" : "Не в сети"
    }

    Connections {
        target: appState
        function onUserProfileReady(p) {
            if (parseInt(p.id) === root.reqId) { root.prof = p; root.loading = false }
        }
        function onMemberAdded(msg)  { if (root.visible) { root.feedback = msg; root.feedbackError = false } }
        function onActionError(msg)  { if (root.visible) { root.feedback = msg; root.feedbackError = true } }
    }

    background: Rectangle {
        radius: 14
        color: themeManager.elevatedColor
        border.color: themeManager.borderColor; border.width: 1
    }

    contentItem: Item {
        implicitHeight: col.height
        clip: true

        ColumnLayout {
            id: col
            width: parent.width
            spacing: 0

            // ── Баннер ──
            Item {
                Layout.fillWidth: true
                implicitHeight: 80
                ProfileBanner {
                    anchors.fill: parent
                    type:  root.pj.banner ? root.pj.banner.type : "solid"
                    solid: root.pj.banner && root.pj.banner.color ? Qt.color(root.pj.banner.color) : root.cardAccent
                    gradient: root.pj.banner ? root.pj.banner.gradient : null
                    image: root.prof.banner_path ? appState.mediaUrl(root.prof.banner_path) : ""
                }
                // скругление верхних углов
                Rectangle { anchors.fill: parent; color: "transparent"; radius: 14
                    border.color: "transparent" }
            }

            // ── Аватар + presence + действия ──
            Item {
                Layout.fillWidth: true
                implicitHeight: 44
                // Аватар внахлёст
                Rectangle {
                    x: 16; y: -34; width: 76; height: 76; radius: width/2
                    color: themeManager.elevatedColor
                    AnimatedAvatar {
                        anchors { fill: parent; margins: 4 }
                        displayName: root.prof.display_name ? root.prof.display_name : "?"
                        source: root.prof.avatar_path ? appState.mediaUrl(root.prof.avatar_path) : ""
                        accentColor: root.cardAccent
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: { var uid = parseInt(root.prof.id); if (uid > 0) { root.openFull(uid); root.close() } } }
                    // индикатор присутствия
                    Rectangle {
                        width: 20; height: 20; radius: 10
                        anchors { right: parent.right; bottom: parent.bottom; rightMargin: 2; bottomMargin: 2 }
                        color: themeManager.elevatedColor
                        Rectangle {
                            anchors.centerIn: parent; width: 14; height: 14; radius: 7
                            color: root.presenceColor(root.presence)
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(160) } }
                        }
                    }
                }
                // быстрые действия справа
                Row {
                    anchors { right: parent.right; rightMargin: 14; top: parent.top; topMargin: 8 }
                    spacing: 8
                    // Написать
                    Rectangle {
                        width: 34; height: 34; radius: 8; visible: root.prof.friendship_status !== "self"
                        color: msgHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        AppIcon { anchors.centerIn: parent; name: "message"; size: 18; color: themeManager.textColor }
                        MouseArea { id: msgHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: { appState.startDm(parseInt(root.prof.id)); root.close() } }
                    }
                    // Добавить в друзья / статус
                    Rectangle {
                        width: 34; height: 34; radius: 8
                        visible: root.prof.friendship_status === "none"
                        color: addHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        AppIcon { anchors.centerIn: parent; name: "person-add"; size: 18; color: themeManager.textColor }
                        MouseArea { id: addHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: appState.sendFriendRequest(parseInt(root.prof.id)) }
                    }
                }
            }

            // ── Информация ──
            ColumnLayout {
                Layout.fillWidth: true
                Layout.leftMargin: 16; Layout.rightMargin: 16; Layout.bottomMargin: 14
                spacing: 8

                // Имя + хэндл
                ColumnLayout {
                    spacing: 0
                    Text { text: root.prof.display_name ? root.prof.display_name : ""
                        color: themeManager.textColor; font.pixelSize: 18; font.bold: true
                        Layout.fillWidth: true; elide: Text.ElideRight }
                    Text { text: root.prof.username ? "@" + root.prof.username : ""
                        color: themeManager.textMutedColor; font.pixelSize: 13
                        Layout.fillWidth: true; elide: Text.ElideRight }
                }

                // Местоимения
                Text {
                    visible: !!(root.prof.pronouns && root.prof.pronouns.length > 0)
                    text: root.prof.pronouns ? root.prof.pronouns : ""
                    color: themeManager.textFaintColor; font.pixelSize: 12
                }

                // Бейджи
                Flow {
                    Layout.fillWidth: true; spacing: 6
                    visible: !!(root.prof.badges && root.prof.badges.length > 0)
                    Repeater {
                        model: root.prof.badges ? root.prof.badges : []
                        Rectangle {
                            height: 20; radius: 6; width: bt.implicitWidth + 14
                            color: Qt.rgba(Qt.color(modelData.color).r, Qt.color(modelData.color).g,
                                           Qt.color(modelData.color).b, 0.18)
                            Text { id: bt; anchors.centerIn: parent; text: modelData.label
                                color: Qt.color(modelData.color); font.pixelSize: 10; font.bold: true }
                        }
                    }
                }

                Rectangle { Layout.fillWidth: true; height: 1; color: themeManager.borderColor }

                // Кастомный статус
                Row {
                    Layout.fillWidth: true; spacing: 6
                    visible: !!(root.pj.showStatus !== false && root.pj.statusText && root.pj.statusText.length > 0)
                    Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
                        color: root.pj.statusColor ? Qt.color(root.pj.statusColor) : themeManager.successColor }
                    Text { text: root.pj.statusText ? root.pj.statusText : ""
                        color: themeManager.textColor; font.pixelSize: 13
                        anchors.verticalCenter: parent.verticalCenter }
                }

                // Обо мне
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 4
                    visible: !!(root.pj.showBio !== false && root.prof.bio && root.prof.bio.length > 0)
                    Text { text: "ОБО МНЕ"; color: themeManager.textFaintColor; font.pixelSize: 10; font.bold: true }
                    Text {
                        Layout.fillWidth: true; wrapMode: Text.WordWrap
                        textFormat: Text.StyledText
                        text: Fmt.bio(root.prof.bio ? root.prof.bio : "")
                        color: themeManager.textMutedColor; font.pixelSize: 12
                        onLinkActivated: function(l){ Qt.openUrlExternally(l) }
                    }
                }

                // Ссылки
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 3
                    visible: !!(root.pj.showLinks !== false && root.pj.links && root.pj.links.length > 0)
                    Repeater {
                        model: root.pj.links ? root.pj.links : []
                        Row { spacing: 6
                            AppIcon { name: "link"; size: 13; color: root.cardAccent
                                anchors.verticalCenter: parent.verticalCenter }
                            Text { text: modelData.label && modelData.label.length > 0 ? modelData.label : modelData.url
                                color: root.cardAccent; font.pixelSize: 12
                                anchors.verticalCenter: parent.verticalCenter
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: Qt.openUrlExternally(modelData.url) } }
                        }
                    }
                }

                // Участник с / общие
                Text {
                    visible: !!(root.prof.created_at && root.prof.created_at.length > 0)
                    text: "Участник с " + Fmt.memberSince(root.prof.created_at)
                    color: themeManager.textFaintColor; font.pixelSize: 11
                }
                Text {
                    visible: !!((root.prof.mutual_servers && root.prof.mutual_servers.length > 0)
                          || (root.prof.mutual_friends && root.prof.mutual_friends.length > 0))
                    text: {
                        var s = root.prof.mutual_servers ? root.prof.mutual_servers.length : 0
                        var f = root.prof.mutual_friends ? root.prof.mutual_friends.length : 0
                        var parts = []
                        if (s>0) parts.push(s + (s===1?" общий сервер":" общих серверов"))
                        if (f>0) parts.push(f + (f===1?" общий друг":" общих друзей"))
                        return parts.join(" · ")
                    }
                    color: themeManager.textFaintColor; font.pixelSize: 11
                }

                // Добавить на сервер / в беседу
                Flow {
                    Layout.fillWidth: true; spacing: 8
                    visible: root.prof.friendship_status !== "self" && parseInt(root.prof.id) > 0
                             && (root.contextServerId > 0 || root.contextChannelId > 0)
                    Rectangle {
                        visible: root.contextServerId > 0
                        width: srvT.implicitWidth + 34; height: 30; radius: 8
                        color: srvHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        Row { anchors.centerIn: parent; spacing: 6
                            AppIcon { name: "plus"; size: 13; color: themeManager.textColor
                                anchors.verticalCenter: parent.verticalCenter }
                            Text { id: srvT; text: "На сервер"; color: themeManager.textColor; font.pixelSize: 12
                                anchors.verticalCenter: parent.verticalCenter } }
                        MouseArea { id: srvHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: appState.addToServer(root.contextServerId, parseInt(root.prof.id)) }
                    }
                    Rectangle {
                        visible: root.contextChannelId > 0
                        width: chT.implicitWidth + 34; height: 30; radius: 8
                        color: chHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                        Row { anchors.centerIn: parent; spacing: 6
                            AppIcon { name: "plus"; size: 13; color: themeManager.textColor
                                anchors.verticalCenter: parent.verticalCenter }
                            Text { id: chT; text: "В беседу"; color: themeManager.textColor; font.pixelSize: 12
                                anchors.verticalCenter: parent.verticalCenter } }
                        MouseArea { id: chHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: appState.addToChannel(root.contextChannelId, parseInt(root.prof.id)) }
                    }
                }

                // Результат действия
                Text {
                    visible: root.feedback.length > 0
                    Layout.fillWidth: true; wrapMode: Text.WordWrap
                    text: root.feedback
                    color: root.feedbackError ? themeManager.dangerColor : themeManager.successColor
                    font.pixelSize: 11
                }

                // Заявка в друзья (входящая)
                Row {
                    Layout.fillWidth: true; spacing: 8
                    visible: root.prof.friendship_status === "pending_in"
                    Rectangle {
                        width: 120; height: 32; radius: 8; color: themeManager.accentColor
                        Text { anchors.centerIn: parent; text: "Принять"; color: themeManager.accentTextColor
                            font.pixelSize: 12; font.bold: true }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: { appState.respondFriendRequest(parseInt(root.prof.id), true); root.close() } }
                    }
                    Rectangle {
                        width: 100; height: 32; radius: 8; color: themeManager.inputColor
                        Text { anchors.centerIn: parent; text: "Отклонить"; color: themeManager.textColor; font.pixelSize: 12 }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: { appState.respondFriendRequest(parseInt(root.prof.id), false); root.close() } }
                    }
                }
                Text {
                    visible: root.prof.friendship_status === "pending_out"
                    text: "Заявка отправлена"; color: themeManager.textFaintColor; font.pixelSize: 11
                }
                Text {
                    visible: root.prof.friendship_status === "friends"
                    text: "✓ У вас в друзьях"; color: themeManager.successColor; font.pixelSize: 11
                }
            }
        }

        // индикатор загрузки
        Rectangle {
            anchors.fill: parent; visible: root.loading; color: themeManager.elevatedColor; radius: 14
            Text { anchors.centerIn: parent; text: "Загрузка…"; color: themeManager.textMutedColor; font.pixelSize: 13 }
        }
    }
}
