import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import "qrc:/qml/components"

Dialog {
    id: root
    modal: true
    width: 790
    height: 590
    anchors.centerIn: Overlay.overlay
    enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 220; easing.type: Easing.OutCubic }
        NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 260; easing.type: Easing.OutCubic } }
    exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 160; easing.type: Easing.InCubic }
        NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 160; easing.type: Easing.InCubic } }

    // Локальные копии — обновляют предпросмотр в реальном времени
    property string localName:      appState.displayName
    property string localBio:       appState.bio
    property string localAccent:    appState.accentColor
    property string localAvatarUrl: appState.avatarPath
    property string localBannerUrl: ""

    // Конструктор профиля
    property string localStatusText:  ""
    property string localStatusColor: "#57f287"
    property bool   localShowStatus:  false
    property bool   localShowBio:     true
    property bool   localShowLinks:   true

    ListModel { id: linkModel }

    // Сброс при открытии
    onOpened: {
        localName      = appState.displayName
        localBio       = appState.bio
        localAccent    = appState.accentColor
        localAvatarUrl = appState.avatarPath
        localBannerUrl = appState.bannerPath
        loadProfileJson()
    }

    function loadProfileJson() {
        linkModel.clear()
        var statusText = "", statusColor = "#57f287"
        var showStatus = false, showBio = true, showLinks = true
        var links = []
        try {
            if (appState.profileJson && appState.profileJson.length > 0) {
                var p = JSON.parse(appState.profileJson)
                if (p.statusText  !== undefined) statusText  = p.statusText
                if (p.statusColor !== undefined) statusColor = p.statusColor
                if (p.showStatus  !== undefined) showStatus  = p.showStatus
                if (p.showBio     !== undefined) showBio     = p.showBio
                if (p.showLinks   !== undefined) showLinks   = p.showLinks
                if (p.links instanceof Array)    links       = p.links
            }
        } catch (e) { console.log("profileJson parse error:", e) }
        root.localStatusText  = statusText
        root.localStatusColor = statusColor
        root.localShowStatus  = showStatus
        root.localShowBio     = showBio
        root.localShowLinks   = showLinks
        for (var i = 0; i < links.length; i++)
            linkModel.append({ lbl: links[i].label || "", url: links[i].url || "" })
    }

    function buildProfileJson() {
        var links = []
        for (var i = 0; i < linkModel.count; i++) {
            var it = linkModel.get(i)
            if ((it.lbl && it.lbl.length > 0) || (it.url && it.url.length > 0))
                links.push({ label: it.lbl, url: it.url })
        }
        return JSON.stringify({
            statusText:  root.localStatusText,
            statusColor: root.localStatusColor,
            showStatus:  root.localShowStatus,
            showBio:     root.localShowBio,
            showLinks:   root.localShowLinks,
            links:       links
        })
    }

    background: Rectangle {
        radius: 14
        color: Qt.darker(themeManager.backgroundColor, 1.08)
        border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                               themeManager.accentColor.b, 0.25)
        border.width: 1
    }

    header: Rectangle {
        height: 52; radius: 14
        color: Qt.darker(themeManager.backgroundColor, 1.22)
        RowLayout {
            anchors { fill: parent; leftMargin: 20; rightMargin: 14 }
            Text {
                text: "Редактирование профиля"
                color: themeManager.textColor; font.pixelSize: 15; font.bold: true
                Layout.fillWidth: true
            }
            Rectangle {
                width: 28; height: 28; radius: 6
                color: xBtn.containsMouse ? Qt.rgba(1, 0.42, 0.42, 0.2) : "transparent"
                Text { anchors.centerIn: parent; text: "✕"; color: "#ff6b6b"; font.pixelSize: 14 }
                MouseArea { id: xBtn; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: root.close() }
            }
        }
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ══ ЛЕВАЯ ПАНЕЛЬ — форма ════════════════════════════════
        ScrollView {
            Layout.preferredWidth: 370
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true

            Column {
                width: parent.width
                spacing: 0
                leftPadding: 20; rightPadding: 20

                Item { height: 16 }

                // ОТОБРАЖАЕМОЕ ИМЯ
                Text { text: "ОТОБРАЖАЕМОЕ ИМЯ"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 6 }
                Rectangle {
                    width: parent.width - 40; height: 42; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.07)
                    border.color: nameField.activeFocus ? themeManager.accentColor
                                  : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                            themeManager.textColor.b, 0.14)
                    border.width: 1
                    TextField {
                        id: nameField; anchors.fill: parent; leftPadding: 14
                        text: root.localName; color: themeManager.textColor
                        font.pixelSize: 14; background: Item {}
                        onTextChanged: root.localName = text
                    }
                }

                Item { height: 16 }

                // ОБО МНЕ (free)
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter
                    Text { text: "ОБО МНЕ"; font.pixelSize: 10; font.bold: true
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.5); width: parent.width - 60 }
                    Text { text: "Бесплатно"; color: "#57f287"; font.pixelSize: 9; font.bold: true
                        anchors.verticalCenter: parent.children[0].verticalCenter }
                }
                Item { height: 6 }
                Rectangle {
                    width: parent.width - 40; height: 90; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.07)
                    border.color: bioArea.activeFocus ? themeManager.accentColor
                                  : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                            themeManager.textColor.b, 0.14)
                    border.width: 1
                    TextArea {
                        id: bioArea
                        anchors { fill: parent; leftMargin: 10; rightMargin: 10; topMargin: 8; bottomMargin: 18 }
                        text: root.localBio; wrapMode: Text.WordWrap
                        placeholderText: "Расскажите о себе..."
                        color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                        onTextChanged: { if (length <= 190) root.localBio = text
                                         else { text = text.substring(0,190); cursorPosition = 190 } }
                    }
                    Text {
                        anchors { right: parent.right; bottom: parent.bottom; margins: 6 }
                        text: bioArea.length + "/190"
                        color: bioArea.length > 170 ? "#f23f43"
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.35)
                        font.pixelSize: 9
                    }
                }

                Item { height: 16 }

                // ЦВЕТ ПРОФИЛЯ (Standard+)
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter; spacing: 8
                    Text { text: "ЦВЕТ ПРОФИЛЯ"; font.pixelSize: 10; font.bold: true
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.5)
                        anchors.verticalCenter: parent.children[1].verticalCenter }
                    Rectangle {
                        height: 18; radius: 9; width: stdLbl.implicitWidth + 14
                        color: "#1565c0"; visible: appState.subscriptionTier < 2
                        Text { id: stdLbl; anchors.centerIn: parent
                            text: "🔒 Standard+"; color: "#fff"; font.pixelSize: 9; font.bold: true }
                    }
                }
                Item { height: 8 }
                Flow {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter; spacing: 7
                    Repeater {
                        model: ["#f23f43","#e67e22","#f1c40f","#57f287",
                                "#1abc9c","#00b0f4","#5865f2","#9b59b6",
                                "#eb459e","#95a5a6","#f0f0f0","#ffd700"]
                        Rectangle {
                            width: 28; height: 28; radius: 14; color: modelData
                            border.color: root.localAccent === modelData ? "#fff" : "transparent"
                            border.width: 2
                            opacity: appState.subscriptionTier >= 2 ? 1.0 : 0.38
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: { if (appState.subscriptionTier >= 2) root.localAccent = modelData } }
                        }
                    }
                }

                Item { height: 16 }

                // МЕДИА
                Text { text: "МЕДИА"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 6 }
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter; spacing: 8
                    // Аватар (бесплатно)
                    Rectangle {
                        width: (parent.width - 8) / 2; height: 38; radius: 8
                        color: avaMa.containsMouse
                               ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                         themeManager.accentColor.b, 0.18)
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.07)
                        border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                               themeManager.accentColor.b, 0.3); border.width: 1
                        Text { anchors.centerIn: parent; text: "🖼  Аватар"
                            color: themeManager.textColor; font.pixelSize: 12 }
                        MouseArea { id: avaMa; anchors.fill: parent
                            hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                            onClicked: avatarDialog.open() }
                    }
                    // Баннер (Basic+)
                    Rectangle {
                        width: (parent.width - 8) / 2; height: 38; radius: 8
                        opacity: appState.subscriptionTier >= 1 ? 1.0 : 0.48
                        color: banMa.containsMouse && appState.subscriptionTier >= 1
                               ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                         themeManager.accentColor.b, 0.18)
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.07)
                        border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                               themeManager.accentColor.b, 0.3); border.width: 1
                        Row { anchors.centerIn: parent; spacing: 4
                            Text { text: "🎞  Баннер"; color: themeManager.textColor; font.pixelSize: 12 }
                            Text { text: "🔒"; font.pixelSize: 10; visible: appState.subscriptionTier < 1 }
                        }
                        MouseArea { id: banMa; anchors.fill: parent; hoverEnabled: true
                            cursorShape: appState.subscriptionTier >= 1 ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: { if (appState.subscriptionTier >= 1) bannerDialog.open() } }
                    }
                }

                Item { height: 16 }

                // ═══ КОНСТРУКТОР ПРОФИЛЯ ═══════════════════════════════
                Text { text: "КОНСТРУКТОР ПРОФИЛЯ"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 8 }

                // — Статус —
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 10
                    Text { text: "Статус (показывать)"; font.pixelSize: 12
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.7)
                        width: parent.width - 50; anchors.verticalCenter: parent.verticalCenter }
                    Rectangle {
                        width: 40; height: 22; radius: 11; anchors.verticalCenter: parent.verticalCenter
                        color: root.localShowStatus ? themeManager.accentColor
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.2)
                        Rectangle { width: 18; height: 18; radius: 9; color: "#fff"
                            anchors.verticalCenter: parent.verticalCenter
                            x: root.localShowStatus ? parent.width - 20 : 2
                            Behavior on x { NumberAnimation { duration: 120 } } }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: root.localShowStatus = !root.localShowStatus }
                    }
                }
                Item { height: 6 }
                Rectangle {
                    width: parent.width - 40; height: 38; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.07)
                    border.color: statusField.activeFocus ? themeManager.accentColor
                                  : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                            themeManager.textColor.b, 0.14)
                    border.width: 1
                    TextField {
                        id: statusField; anchors.fill: parent; leftPadding: 12
                        text: root.localStatusText; placeholderText: "Напр.: В сети, AFK, играю..."
                        color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                        placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                      themeManager.textColor.b, 0.35)
                        onTextChanged: root.localStatusText = text
                    }
                }
                Item { height: 6 }
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter; spacing: 8
                    Repeater {
                        model: ["#57f287","#f1c40f","#f23f43","#00b0f4","#9b59b6","#95a5a6"]
                        Rectangle {
                            width: 24; height: 24; radius: 12; color: modelData
                            border.color: root.localStatusColor === modelData ? "#fff" : "transparent"
                            border.width: 2
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: root.localStatusColor = modelData }
                        }
                    }
                }

                Item { height: 14 }

                // — Видимость элементов —
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 10
                    Text { text: "Показывать «Обо мне»"; font.pixelSize: 12
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.7)
                        width: parent.width - 50; anchors.verticalCenter: parent.verticalCenter }
                    Rectangle {
                        width: 40; height: 22; radius: 11; anchors.verticalCenter: parent.verticalCenter
                        color: root.localShowBio ? themeManager.accentColor
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.2)
                        Rectangle { width: 18; height: 18; radius: 9; color: "#fff"
                            anchors.verticalCenter: parent.verticalCenter
                            x: root.localShowBio ? parent.width - 20 : 2
                            Behavior on x { NumberAnimation { duration: 120 } } }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: root.localShowBio = !root.localShowBio }
                    }
                }
                Item { height: 8 }
                Row {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 10
                    Text { text: "Показывать ссылки"; font.pixelSize: 12
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.7)
                        width: parent.width - 50; anchors.verticalCenter: parent.verticalCenter }
                    Rectangle {
                        width: 40; height: 22; radius: 11; anchors.verticalCenter: parent.verticalCenter
                        color: root.localShowLinks ? themeManager.accentColor
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.2)
                        Rectangle { width: 18; height: 18; radius: 9; color: "#fff"
                            anchors.verticalCenter: parent.verticalCenter
                            x: root.localShowLinks ? parent.width - 20 : 2
                            Behavior on x { NumberAnimation { duration: 120 } } }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: root.localShowLinks = !root.localShowLinks }
                    }
                }

                Item { height: 14 }

                // — Ссылки —
                Text { text: "ССЫЛКИ"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 6 }
                Column {
                    width: parent.width - 40; anchors.horizontalCenter: parent.horizontalCenter; spacing: 6
                    Repeater {
                        model: linkModel
                        Row {
                            width: parent.width; spacing: 6
                            Rectangle {
                                width: parent.width * 0.34; height: 34; radius: 7
                                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                               themeManager.textColor.b, 0.07)
                                border.color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                      themeManager.textColor.b, 0.14); border.width: 1
                                TextField {
                                    anchors.fill: parent; leftPadding: 8
                                    text: lbl; placeholderText: "название"
                                    color: themeManager.textColor; font.pixelSize: 12; background: Item {}
                                    placeholderTextColor: Qt.rgba(themeManager.textColor.r,
                                        themeManager.textColor.g, themeManager.textColor.b, 0.35)
                                    onTextChanged: linkModel.setProperty(index, "lbl", text)
                                }
                            }
                            Rectangle {
                                width: parent.width * 0.66 - 40; height: 34; radius: 7
                                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                               themeManager.textColor.b, 0.07)
                                border.color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                      themeManager.textColor.b, 0.14); border.width: 1
                                TextField {
                                    anchors.fill: parent; leftPadding: 8
                                    text: url; placeholderText: "https://..."
                                    color: themeManager.textColor; font.pixelSize: 12; background: Item {}
                                    placeholderTextColor: Qt.rgba(themeManager.textColor.r,
                                        themeManager.textColor.g, themeManager.textColor.b, 0.35)
                                    onTextChanged: linkModel.setProperty(index, "url", text)
                                }
                            }
                            Rectangle {
                                width: 34; height: 34; radius: 7
                                color: delMa.containsMouse ? Qt.rgba(1, 0.42, 0.42, 0.2) : "transparent"
                                border.color: Qt.rgba(1, 0.42, 0.42, 0.3); border.width: 1
                                Text { anchors.centerIn: parent; text: "✕"; color: "#ff6b6b"; font.pixelSize: 12 }
                                MouseArea { id: delMa; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: linkModel.remove(index) }
                            }
                        }
                    }
                    Rectangle {
                        width: parent.width; height: 34; radius: 7
                        color: addLinkMa.containsMouse
                               ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                         themeManager.accentColor.b, 0.18)
                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                         themeManager.textColor.b, 0.07)
                        border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                              themeManager.accentColor.b, 0.3); border.width: 1
                        Text { anchors.centerIn: parent; text: "+ добавить ссылку"
                            color: themeManager.accentColor; font.pixelSize: 12; font.bold: true }
                        MouseArea { id: addLinkMa; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: linkModel.append({ lbl: "", url: "" }) }
                    }
                }

                Item { height: 16 }

                // РОЛИ
                Text { text: "РОЛИ"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 6 }
                Rectangle {
                    width: parent.width - 40; height: 40; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    color: rolesMa.containsMouse
                           ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                     themeManager.accentColor.b, 0.18)
                           : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                     themeManager.textColor.b, 0.07)
                    border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                           themeManager.accentColor.b, 0.3); border.width: 1
                    Row {
                        anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter
                            leftMargin: 14; rightMargin: 14 }
                        Text {
                            text: appState.roleName !== "" ? "Роль: " + appState.roleName : "Управление ролями"
                            color: appState.roleColor !== "" ? appState.roleColor : themeManager.textColor
                            font.pixelSize: 13; width: parent.width - 20
                            elide: Text.ElideRight
                        }
                        Text { text: "→"; color: themeManager.accentColor; font.pixelSize: 14 }
                    }
                    MouseArea { id: rolesMa; anchors.fill: parent
                        hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: rolesDialog.open() }
                }

                Item { height: 16 }

                // ПОДПИСКА
                Text { text: "VICINITY ПОДПИСКА"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }
                Item { height: 6 }
                Rectangle {
                    width: parent.width - 40; height: 44; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0.0
                            color: appState.subscriptionTier === 0
                                   ? Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                             themeManager.textColor.b, 0.07)
                                   : appState.subscriptionTier === 1 ? "#424242"
                                   : appState.subscriptionTier === 2 ? "#0d47a1" : "#4a148c" }
                        GradientStop { position: 1.0
                            color: appState.subscriptionTier === 0
                                   ? Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                             themeManager.textColor.b, 0.07)
                                   : appState.subscriptionTier === 1 ? "#9e9e9e"
                                   : appState.subscriptionTier === 2 ? "#1976d2" : "#9c27b0" }
                    }
                    border.color: appState.subscriptionTier > 0 ? Qt.rgba(1,1,1,0.2)
                                  : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                            themeManager.textColor.b, 0.14)
                    border.width: 1
                    Row {
                        anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter
                            leftMargin: 14; rightMargin: 14 }
                        Text {
                            text: ["Нет подписки","Vicinity Basic","Vicinity Standard","Vicinity Ultra"]
                                  [appState.subscriptionTier]
                            color: appState.subscriptionTier > 0 ? "#fff"
                                   : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                             themeManager.textColor.b, 0.55)
                            font.pixelSize: 13; font.bold: appState.subscriptionTier > 0
                            width: parent.width - 30
                        }
                        Text { text: ["","★","★★","★★★"][appState.subscriptionTier]
                            color: "#ffd700"; font.pixelSize: 14 }
                    }
                }

                Item { height: 32 }

                // СОХРАНИТЬ
                Rectangle {
                    width: parent.width - 40; height: 44; radius: 8; anchors.horizontalCenter: parent.horizontalCenter
                    color: saveMa.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1)
                                                : themeManager.accentColor
                    Behavior on color { ColorAnimation { duration: 100 } }
                    Text { anchors.centerIn: parent; text: "Сохранить изменения"
                        color: "#fff"; font.pixelSize: 14; font.bold: true }
                    MouseArea { id: saveMa; anchors.fill: parent
                        hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            appState.setDisplayName(root.localName)
                            appState.setBio(root.localBio)
                            if (appState.subscriptionTier >= 2)
                                appState.setAccentColor(root.localAccent)
                            // Если выбран локальный файл — загружаем на сервер
                            if (root.localAvatarUrl.startsWith("file:///"))
                                appState.uploadAvatar(root.localAvatarUrl)
                            if (root.localBannerUrl.startsWith("file:///"))
                                appState.uploadBanner(root.localBannerUrl)
                            appState.saveProfileCustomization(root.buildProfileJson())
                            root.close()
                        }
                    }
                }
                Item { height: 20 }
            }
        }

        // Разделитель
        Rectangle {
            width: 1; Layout.fillHeight: true
            color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                           themeManager.textColor.b, 0.1)
        }

        // ══ ПРАВАЯ ПАНЕЛЬ — предпросмотр ════════════════════════
        Item {
            Layout.fillWidth: true; Layout.fillHeight: true

            Column {
                anchors { top: parent.top; left: parent.left; right: parent.right; margins: 20 }
                spacing: 0

                Text { text: "ПРЕДПРОСМОТР"; font.pixelSize: 10; font.bold: true
                    topPadding: 14; bottomPadding: 10
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.45) }

                // Карточка профиля (скругление баннера повторяет форму аватарок)
                Rectangle {
                    width: parent.width
                    radius: 6 + themeManager.avatarRadiusRatio * 36
                    Behavior on radius { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
                    height: previewBanner.height + previewAvaRow.height + previewInfo.height + 16
                    color: Qt.darker(themeManager.backgroundColor, 1.15); clip: true

                    // Баннер
                    Rectangle {
                        id: previewBanner
                        width: parent.width; height: 80
                        color: root.localAccent !== ""
                               ? root.localAccent
                               : Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                         themeManager.accentColor.b, 0.55)
                        clip: true
                        AnimatedImage {
                            anchors.fill: parent; fillMode: Image.PreserveAspectCrop
                            source: root.localBannerUrl; playing: true
                            visible: root.localBannerUrl !== ""
                        }
                    }

                    // Строка аватар + badge
                    Item {
                        id: previewAvaRow
                        anchors.top: previewBanner.bottom
                        width: parent.width; height: 44

                        // Аватар (поверх баннера) — рамка повторяет форму аватарок
                        Rectangle {
                            x: 16; y: -22; width: 62; height: 62
                            radius: 62 * themeManager.avatarRadiusRatio
                            Behavior on radius { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
                            color: Qt.darker(themeManager.backgroundColor, 1.15)
                            border.color: Qt.darker(themeManager.backgroundColor, 1.15); border.width: 4
                            AnimatedAvatar {
                                anchors { fill: parent; margins: 4 }
                                displayName: root.localName.length > 0 ? root.localName : "?"
                                source: root.localAvatarUrl
                                accentColor: root.localAccent !== ""
                                             ? Qt.color(root.localAccent) : themeManager.accentColor
                            }
                        }

                        // Бейдж подписки
                        Rectangle {
                            visible: appState.subscriptionTier > 0
                            anchors { right: parent.right; rightMargin: 14; top: parent.top; topMargin: 8 }
                            height: 20; radius: 10; width: badgeTxt.implicitWidth + 16
                            gradient: Gradient {
                                orientation: Gradient.Horizontal
                                GradientStop { position: 0.0
                                    color: appState.subscriptionTier === 1 ? "#616161"
                                         : appState.subscriptionTier === 2 ? "#1565c0" : "#6a1b9a" }
                                GradientStop { position: 1.0
                                    color: appState.subscriptionTier === 1 ? "#9e9e9e"
                                         : appState.subscriptionTier === 2 ? "#42a5f5" : "#ce93d8" }
                            }
                            Text { id: badgeTxt; anchors.centerIn: parent
                                text: ["","BASIC","STANDARD","ULTRA"][appState.subscriptionTier]
                                color: "#fff"; font.pixelSize: 9; font.bold: true }
                        }
                    }

                    // Имя + роль + bio
                    Column {
                        id: previewInfo
                        anchors { top: previewAvaRow.bottom; left: parent.left; right: parent.right }
                        leftPadding: 16; rightPadding: 16; bottomPadding: 14; spacing: 6

                        Text {
                            text: root.localName.length > 0 ? root.localName : "Имя пользователя"
                            color: themeManager.textColor; font.pixelSize: 16; font.bold: true
                            width: parent.width - 32; elide: Text.ElideRight
                        }

                        Row {
                            visible: appState.roleName !== ""; spacing: 6
                            Rectangle { width: 10; height: 10; radius: 5; anchors.verticalCenter: parent.children[1].verticalCenter
                                color: appState.roleColor !== "" ? appState.roleColor : themeManager.accentColor }
                            Text { text: appState.roleName; font.pixelSize: 12; font.bold: true
                                color: appState.roleColor !== "" ? appState.roleColor : themeManager.accentColor }
                        }

                        // Статус
                        Row {
                            visible: root.localShowStatus && root.localStatusText !== ""
                            spacing: 6
                            Rectangle { width: 9; height: 9; radius: 5
                                anchors.verticalCenter: parent.children[1].verticalCenter
                                color: root.localStatusColor }
                            Text { text: root.localStatusText; font.pixelSize: 12
                                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                               themeManager.textColor.b, 0.85) }
                        }

                        Rectangle {
                            width: parent.width - 32; height: 1
                            visible: root.localShowBio && root.localBio !== ""
                            color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                           themeManager.textColor.b, 0.1)
                        }

                        Text {
                            text: root.localBio
                            visible: root.localShowBio && root.localBio !== ""
                            width: parent.width - 32; wrapMode: Text.WordWrap; font.pixelSize: 12
                            color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                           themeManager.textColor.b, 0.75)
                        }

                        // Ссылки
                        Column {
                            visible: root.localShowLinks && linkModel.count > 0
                            width: parent.width - 32; spacing: 4
                            Repeater {
                                model: linkModel
                                Text {
                                    width: parent.width
                                    text: "🔗 " + (lbl && lbl.length > 0 ? lbl : url)
                                    visible: (lbl && lbl.length > 0) || (url && url.length > 0)
                                    color: themeManager.accentColor; font.pixelSize: 12
                                    elide: Text.ElideRight
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    FileDialog {
        id: avatarDialog; title: "Выберите аватар (GIF/PNG/JPG)"
        nameFilters: ["Изображения (*.gif *.png *.jpg *.jpeg)"]
        onAccepted: root.localAvatarUrl = selectedFile.toString()
    }
    FileDialog {
        id: bannerDialog; title: "Выберите баннер"
        nameFilters: ["Изображения (*.gif *.png *.jpg *.jpeg)"]
        onAccepted: root.localBannerUrl = selectedFile.toString()
    }

    RolesView { id: rolesDialog }
}
