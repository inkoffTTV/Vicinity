import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

// Раздел настроек «Профиль» (встраивается в SettingsView)
Item {
    id: root
    anchors.fill: parent
    signal done()   // сохранили/отменили — закрыть настройки

    // ── Локальное состояние ──
    property string localName: ""
    property string localPronouns: ""
    property string localBio: ""
    property string localAccent: "#5865f2"
    property string localPresence: "online"
    property string localStatusText: ""
    property string localStatusColor: "#57f287"
    property string localStatusIcon: ""
    property int    localStatusTimer: 0     // минуты, 0 = не сбрасывать
    property bool   localShowBio: true
    property bool   localShowLinks: true
    property bool   localShowStatus: true
    // баннер
    property string localBannerType: "solid"   // solid | gradient | image
    property string localBannerColor: "#5865f2"
    property var    localBannerGradient: ({ type:"linear", angle:90, stops:[{pos:0,color:"#5865f2"},{pos:1,color:"#eb459e"}] })
    property string avatarFile: ""             // file:// если выбран новый
    property bool   avatarCleared: false
    property string bannerFile: ""
    property string errorMsg: ""
    signal openRoles()

    ListModel { id: linkModel }

    function reload() { load() }

    function load() {
        errorMsg = ""
        localName     = appState.displayName
        localPronouns = appState.pronouns !== undefined ? appState.pronouns : ""
        localBio      = appState.bio
        localAccent   = appState.accentColor && appState.accentColor.length > 0 ? appState.accentColor : "#5865f2"
        avatarFile = ""; avatarCleared = false; bannerFile = ""
        var pj = Fmt.parse(appState.profileJson, {})
        localShowBio    = pj.showBio    !== false
        localShowLinks  = pj.showLinks  !== false
        localShowStatus = pj.showStatus !== false
        localStatusText  = pj.statusText  ? pj.statusText  : ""
        localStatusColor = pj.statusColor ? pj.statusColor : "#57f287"
        localStatusIcon  = pj.statusIcon  ? pj.statusIcon  : ""
        localStatusTimer = 0
        localBannerType  = pj.banner && pj.banner.type ? pj.banner.type : "solid"
        localBannerColor = pj.banner && pj.banner.color ? pj.banner.color : "#5865f2"
        if (pj.banner && pj.banner.gradient) localBannerGradient = pj.banner.gradient
        linkModel.clear()
        if (pj.links instanceof Array)
            for (var i = 0; i < pj.links.length; i++)
                linkModel.append({ lbl: pj.links[i].label || "", url: pj.links[i].url || "" })
    }

    function buildJson() {
        var links = []
        for (var i = 0; i < linkModel.count; i++) {
            var it = linkModel.get(i)
            if ((it.lbl && it.lbl.length) || (it.url && it.url.length))
                links.push({ label: it.lbl, url: it.url })
        }
        var expires = localStatusTimer > 0 ? (Date.now() + localStatusTimer * 60000) : 0
        return JSON.stringify({
            showBio: localShowBio, showLinks: localShowLinks, showStatus: localShowStatus,
            statusText: localStatusText, statusColor: localStatusColor,
            statusIcon: localStatusIcon, statusExpires: expires,
            links: links,
            banner: { type: localBannerType, color: localBannerColor, gradient: localBannerGradient }
        })
    }

    function save() {
        var n = localName.trim()
        if (n.length < 1) { errorMsg = "Введите отображаемое имя"; return }
        if (n.length > 32) { errorMsg = "Имя не длиннее 32 символов"; return }
        if (localBio.length > 190) { errorMsg = "«Обо мне» не длиннее 190 символов"; return }
        // медиа
        if (avatarFile.startsWith("file:")) appState.uploadAvatar(avatarFile)
        else if (avatarCleared) appState.clearAvatar()
        if (localBannerType === "image" && bannerFile.startsWith("file:")) appState.uploadBanner(bannerFile)
        // остальное одним запросом
        appState.saveProfile(n, localBio, localAccent, localPronouns.trim(), localPresence, buildJson())
        root.done()
    }

    function presenceColor(p) {
        return p === "online" ? themeManager.presenceOnline
             : p === "idle"   ? themeManager.presenceIdle
             : p === "dnd"    ? themeManager.presenceDnd
             : themeManager.presenceOffline
    }

    Connections {
        target: appState
        function onUploadError(msg) { root.errorMsg = msg }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        RowLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 0

            // ══ ЛЕВО: форма ══
            ScrollView {
                Layout.preferredWidth: 540; Layout.fillHeight: true
                clip: true; contentWidth: availableWidth

                ColumnLayout {
                    width: parent.width
                    spacing: 16

                    Item { Layout.preferredHeight: 4 }

                    // ── 2.1 АВАТАР ──
                    Text { text: "АВАТАР"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    RowLayout {
                        Layout.leftMargin: 20; Layout.rightMargin: 20; spacing: 14
                        AnimatedAvatar {
                            width: 72; height: 72
                            displayName: root.localName.length ? root.localName : "?"
                            source: root.avatarFile.length ? root.avatarFile
                                    : (root.avatarCleared ? "" : appState.avatarPath)
                            accentColor: Qt.color(root.localAccent)
                        }
                        ColumnLayout {
                            spacing: 6
                            RowLayout {
                                spacing: 8
                                Rectangle { width: 120; height: 34; radius: 8; color: themeManager.accentColor
                                    Text { anchors.centerIn: parent; text: "Загрузить"; color: themeManager.accentTextColor
                                        font.pixelSize: 12; font.bold: true }
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                        onClicked: avatarDialog.open() } }
                                Rectangle { width: 100; height: 34; radius: 8; color: themeManager.inputColor
                                    Text { anchors.centerIn: parent; text: "Удалить"; color: themeManager.textColor; font.pixelSize: 12 }
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                        onClicked: { root.avatarFile=""; root.avatarCleared=true } } }
                            }
                            Text { text: "PNG, JPG или GIF · до 5 МБ. GIF сохраняет анимацию."
                                color: themeManager.textFaintColor; font.pixelSize: 11; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                        }
                    }

                    // ── 2.2 БАННЕР ──
                    Text { text: "БАННЕР"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    RowLayout {
                        Layout.leftMargin: 20; spacing: 8
                        Repeater {
                            model: [{l:"Цвет",t:"solid"},{l:"Градиент",t:"gradient"},{l:"Картинка",t:"image"}]
                            Rectangle {
                                width: 96; height: 32; radius: 8
                                property bool sel: root.localBannerType === modelData.t
                                color: sel ? themeManager.accentSoftColor : themeManager.inputColor
                                border.color: sel ? themeManager.accentColor : themeManager.borderColor; border.width: 1
                                Text { anchors.centerIn: parent; text: modelData.l; font.pixelSize: 12
                                    color: sel ? themeManager.accentColor : themeManager.textColor }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: root.localBannerType = modelData.t }
                            }
                        }
                    }
                    ColorPicker {
                        visible: root.localBannerType === "solid"
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        showAlpha: false
                        Component.onCompleted: value = root.localBannerColor
                        onValueChanged: root.localBannerColor = themeManager.colorToHex(value)
                    }
                    GradientPicker {
                        visible: root.localBannerType === "gradient"
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        Component.onCompleted: spec = root.localBannerGradient
                        onSpecChanged: root.localBannerGradient = spec
                    }
                    RowLayout {
                        visible: root.localBannerType === "image"
                        Layout.leftMargin: 20; Layout.rightMargin: 20; spacing: 8
                        Rectangle { width: 120; height: 34; radius: 8; color: themeManager.accentColor
                            Text { anchors.centerIn: parent; text: "Загрузить"; color: themeManager.accentTextColor
                                font.pixelSize: 12; font.bold: true }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: bannerDialog.open() } }
                        Text { text: "Картинка/GIF · до 5 МБ"; color: themeManager.textFaintColor
                            font.pixelSize: 11; Layout.alignment: Qt.AlignVCenter }
                    }

                    // ── 2.3 ТЕКСТ ──
                    Text { text: "ИМЯ И ОПИСАНИЕ"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    // Display name
                    EditorField { Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        label: "Отображаемое имя"; text: root.localName; maxLen: 32
                        onEdited: root.localName = value }
                    EditorField { Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        label: "Местоимения (напр. he/him)"; text: root.localPronouns; maxLen: 40
                        onEdited: root.localPronouns = value }
                    // Bio
                    ColumnLayout {
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true; spacing: 4
                        RowLayout {
                            Layout.fillWidth: true
                            Text { text: "Обо мне"; color: themeManager.textMutedColor; font.pixelSize: 12; Layout.fillWidth: true }
                            Text { text: root.localBio.length + "/190"
                                color: root.localBio.length > 190 ? themeManager.dangerColor : themeManager.textFaintColor
                                font.pixelSize: 11 }
                        }
                        Rectangle {
                            Layout.fillWidth: true; Layout.preferredHeight: 84; radius: 8
                            color: themeManager.inputColor
                            border.width: 1
                            border.color: bioArea.activeFocus ? themeManager.accentColor : themeManager.borderColor
                            ScrollView {
                                anchors { fill: parent; margins: 8 }
                                clip: true
                                TextArea {
                                    id: bioArea
                                    text: root.localBio
                                    wrapMode: Text.WordWrap
                                    placeholderText: "Поддерживается **жирный**, *курсив*, __подчёркнутый__, ссылки"
                                    color: themeManager.textColor; font.pixelSize: 13
                                    background: Rectangle { color: "transparent" }
                                    placeholderTextColor: themeManager.textFaintColor
                                    onTextChanged: {
                                        if (length <= 190) root.localBio = text
                                        else { text = text.substring(0, 190); cursorPosition = 190 }
                                    }
                                }
                            }
                        }
                        Text { text: "Форматирование: **жирный** · *курсив* · __подчёркнутый__ · ссылки автоматически"
                            color: themeManager.textFaintColor; font.pixelSize: 10; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                    }
                    // Ссылки
                    ColumnLayout {
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true; spacing: 6
                        Text { text: "ССЫЛКИ"; font.pixelSize: 10; font.bold: true; color: themeManager.textFaintColor }
                        Repeater {
                            model: linkModel
                            RowLayout {
                                Layout.fillWidth: true; spacing: 6
                                EditorField { Layout.preferredWidth: 140; label: "название"; text: lbl
                                    onEdited: linkModel.setProperty(index, "lbl", value) }
                                EditorField { Layout.fillWidth: true; label: "https://…"; text: url
                                    onEdited: linkModel.setProperty(index, "url", value) }
                                Rectangle { width: 34; height: 34; radius: 7
                                    color: dh.containsMouse ? themeManager.rgba(255,107,107,0.18) : "transparent"
                                    AppIcon { anchors.centerIn: parent; name: "close"; size: 13; color: themeManager.dangerColor }
                                    MouseArea { id: dh; anchors.fill: parent; hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor; onClicked: linkModel.remove(index) } }
                            }
                        }
                        Rectangle {
                            visible: linkModel.count < 5
                            Layout.fillWidth: true; height: 32; radius: 8
                            color: ah.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                            border.color: themeManager.borderColor; border.width: 1
                            Row { anchors.centerIn: parent; spacing: 6
                                AppIcon { name: "plus"; size: 13; color: themeManager.accentColor; anchors.verticalCenter: parent.verticalCenter }
                                Text { text: "Добавить ссылку"; color: themeManager.accentColor; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter } }
                            MouseArea { id: ah; anchors.fill: parent; hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor; onClicked: linkModel.append({lbl:"",url:""}) }
                        }
                    }

                    // ── 2.4 СТАТУС ──
                    Text { text: "СТАТУС"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    // presence
                    RowLayout {
                        Layout.leftMargin: 20; spacing: 8
                        Repeater {
                            model: [{id:"online",l:"В сети"},{id:"idle",l:"Не активен"},
                                    {id:"dnd",l:"Не беспокоить"},{id:"invisible",l:"Невидимка"}]
                            Rectangle {
                                height: 30; radius: 8; width: pl.implicitWidth + 28
                                property bool sel: root.localPresence === modelData.id
                                color: sel ? themeManager.accentSoftColor : themeManager.inputColor
                                border.color: sel ? themeManager.accentColor : themeManager.borderColor; border.width: 1
                                Row { anchors.centerIn: parent; spacing: 6
                                    Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
                                        color: root.presenceColor(modelData.id) }
                                    Text { id: pl; text: modelData.l; font.pixelSize: 11
                                        color: sel ? themeManager.accentColor : themeManager.textColor
                                        anchors.verticalCenter: parent.verticalCenter } }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: { root.localPresence = modelData.id
                                                 if (networkManager) networkManager.sendMessage(JSON.stringify({type:"set_presence",presence:modelData.id})) } }
                            }
                        }
                    }
                    // custom status text + icon
                    EditorField { Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        label: "Кастомный статус"; text: root.localStatusText; maxLen: 60
                        onEdited: root.localStatusText = value }
                    RowLayout {
                        Layout.leftMargin: 20; spacing: 6
                        Text { text: "Иконка:"; color: themeManager.textMutedColor; font.pixelSize: 12; Layout.alignment: Qt.AlignVCenter }
                        Repeater {
                            model: ["", "smile", "gamepad", "star", "clock", "headphones"]
                            Rectangle {
                                width: 32; height: 32; radius: 7
                                property bool sel: root.localStatusIcon === modelData
                                color: sel ? themeManager.accentSoftColor : themeManager.inputColor
                                border.color: sel ? themeManager.accentColor : themeManager.borderColor; border.width: 1
                                AppIcon { visible: modelData !== ""; anchors.centerIn: parent; name: modelData; size: 16
                                    color: themeManager.textColor }
                                Text { visible: modelData === ""; anchors.centerIn: parent; text: "—"; color: themeManager.textFaintColor }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: root.localStatusIcon = modelData }
                            }
                        }
                    }
                    // timer
                    RowLayout {
                        Layout.leftMargin: 20; spacing: 6
                        Text { text: "Сброс:"; color: themeManager.textMutedColor; font.pixelSize: 12; Layout.alignment: Qt.AlignVCenter }
                        Repeater {
                            model: [{m:0,l:"Никогда"},{m:30,l:"30м"},{m:60,l:"1ч"},{m:240,l:"4ч"}]
                            Rectangle {
                                height: 28; radius: 7; width: tl2.implicitWidth + 20
                                property bool sel: root.localStatusTimer === modelData.m
                                color: sel ? themeManager.accentSoftColor : themeManager.inputColor
                                border.color: sel ? themeManager.accentColor : themeManager.borderColor; border.width: 1
                                Text { id: tl2; anchors.centerIn: parent; text: modelData.l; font.pixelSize: 11
                                    color: sel ? themeManager.accentColor : themeManager.textColor }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: root.localStatusTimer = modelData.m }
                            }
                        }
                    }

                    // ── 2.5 ЦВЕТ ПРОФИЛЯ ──
                    Text { text: "АКЦЕНТНЫЙ ЦВЕТ ПРОФИЛЯ"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    ColorPicker {
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        showAlpha: false
                        Component.onCompleted: value = Qt.color(root.localAccent)
                        onValueChanged: root.localAccent = themeManager.colorToHex(value)
                    }

                    // ── РОЛИ ──
                    Text { text: "РОЛИ"; Layout.leftMargin: 20; font.pixelSize: 10; font.bold: true
                        color: themeManager.textFaintColor }
                    Rectangle {
                        Layout.leftMargin: 20; Layout.rightMargin: 20; Layout.fillWidth: true
                        height: 40; radius: 8
                        color: rolesHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
                        border.color: themeManager.borderColor; border.width: 1
                        RowLayout {
                            anchors { fill: parent; leftMargin: 14; rightMargin: 14 }
                            AppIcon { name: "star"; size: 16; color: themeManager.accentColor }
                            Text { text: "Управление ролями"; color: themeManager.textColor; font.pixelSize: 13
                                Layout.fillWidth: true; leftPadding: 8 }
                            AppIcon { name: "chevron-right"; size: 16; color: themeManager.textMutedColor }
                        }
                        MouseArea { id: rolesHov; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.openRoles() }
                    }

                    Item { Layout.preferredHeight: 8 }
                }
            }

            // Разделитель
            Rectangle { Layout.preferredWidth: 1; Layout.fillHeight: true; color: themeManager.borderColor }

            // ══ ПРАВО: живое превью ══
            ColumnLayout {
                Layout.fillWidth: true; Layout.fillHeight: true; spacing: 0
                Text { text: "ПРЕДПРОСМОТР"; Layout.margins: 16; font.pixelSize: 10; font.bold: true
                    color: themeManager.textFaintColor }

                // карточка-превью
                Rectangle {
                    Layout.leftMargin: 16; Layout.rightMargin: 16; Layout.fillWidth: true
                    Layout.preferredHeight: previewCol.height
                    radius: 14; color: themeManager.surfaceColor
                    border.color: themeManager.borderColor; border.width: 1; clip: true

                    ColumnLayout {
                        id: previewCol; width: parent.width; spacing: 0
                        ProfileBanner {
                            Layout.fillWidth: true; Layout.preferredHeight: 80
                            type: root.localBannerType
                            solid: Qt.color(root.localBannerColor)
                            gradient: root.localBannerGradient
                            image: root.localBannerType === "image"
                                   ? (root.bannerFile.length ? root.bannerFile : appState.mediaUrl(appState.bannerPath)) : ""
                        }
                        Item {
                            Layout.fillWidth: true; Layout.preferredHeight: 44
                            Rectangle {
                                x: 16; y: -34; width: 72; height: 72; radius: width/2; color: themeManager.surfaceColor
                                AnimatedAvatar { anchors { fill: parent; margins: 4 }
                                    displayName: root.localName.length ? root.localName : "?"
                                    source: root.avatarFile.length ? root.avatarFile
                                            : (root.avatarCleared ? "" : appState.avatarPath)
                                    accentColor: Qt.color(root.localAccent) }
                                Rectangle { width: 18; height: 18; radius: 9
                                    anchors { right: parent.right; bottom: parent.bottom; rightMargin: 3; bottomMargin: 3 }
                                    color: themeManager.surfaceColor
                                    Rectangle { anchors.centerIn: parent; width: 12; height: 12; radius: 6
                                        color: root.presenceColor(root.localPresence) } }
                            }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true; Layout.leftMargin: 16; Layout.rightMargin: 16
                            Layout.bottomMargin: 14; spacing: 6
                            RowLayout { spacing: 6
                                Text { text: root.localName.length ? root.localName : "Имя"
                                    color: themeManager.textColor; font.pixelSize: 17; font.bold: true }
                                Text { text: root.localPronouns; visible: root.localPronouns.length>0
                                    color: themeManager.textFaintColor; font.pixelSize: 12 } }
                            Text { text: "@" + appState.username; color: themeManager.textMutedColor; font.pixelSize: 12 }
                            Rectangle { Layout.fillWidth: true; height: 1; color: themeManager.borderColor }
                            Row { spacing: 6; visible: root.localShowStatus && root.localStatusText.length>0
                                AppIcon { visible: root.localStatusIcon !== ""; name: root.localStatusIcon; size: 14
                                    color: themeManager.textColor; anchors.verticalCenter: parent.verticalCenter }
                                Rectangle { visible: root.localStatusIcon === ""; width: 8; height: 8; radius: 4
                                    color: Qt.color(root.localStatusColor); anchors.verticalCenter: parent.verticalCenter }
                                Text { text: root.localStatusText; color: themeManager.textColor; font.pixelSize: 13
                                    anchors.verticalCenter: parent.verticalCenter } }
                            Text { visible: root.localShowBio && root.localBio.length>0
                                Layout.fillWidth: true; wrapMode: Text.WordWrap; textFormat: Text.StyledText
                                text: Fmt.bio(root.localBio); color: themeManager.textMutedColor; font.pixelSize: 12 }
                        }
                    }
                }

                Item { Layout.fillHeight: true }
            }
        }

        // ═══ Плашка сохранения (1:1 как в Discord) ═══
        Text { text: root.errorMsg; visible: root.errorMsg.length>0; color: themeManager.dangerColor
            Layout.leftMargin: 20; Layout.rightMargin: 20; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true }
        Rectangle {
            Layout.fillWidth: true
            Layout.leftMargin: 20; Layout.rightMargin: 20
            Layout.topMargin: 8; Layout.bottomMargin: 16
            Layout.preferredHeight: 56
            radius: 8; color: themeManager.railColor

            RowLayout {
                anchors { fill: parent; leftMargin: 16; rightMargin: 10 }
                spacing: 12
                Text {
                    Layout.fillWidth: true
                    text: "Осторожно — не забудь сохранить изменения!"
                    color: themeManager.textColor; font.pixelSize: 14
                    elide: Text.ElideRight
                }
                Text {
                    text: "Сбросить"
                    color: resetHov.containsMouse ? themeManager.textColor : themeManager.textMutedColor
                    font.pixelSize: 13; font.underline: resetHov.containsMouse
                    MouseArea { id: resetHov; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor; onClicked: root.load() }
                }
                Rectangle {
                    implicitWidth: saveTxt.implicitWidth + 32; implicitHeight: 36; radius: 3
                    color: saveHov.containsMouse ? Qt.darker(themeManager.successColor, 1.25)
                                                 : Qt.darker(themeManager.successColor, 1.45)
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    Text { id: saveTxt; anchors.centerIn: parent; text: "Сохранить изменения"
                        color: "#ffffff"; font.pixelSize: 13; font.bold: true }
                    MouseArea { id: saveHov; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor; onClicked: root.save() }
                }
            }
        }
    }

    FileDialog {
        id: avatarDialog; title: "Выберите аватар (PNG/JPG/GIF)"
        nameFilters: ["Изображения (*.png *.jpg *.jpeg *.gif)"]
        onAccepted: { root.avatarFile = selectedFile.toString(); root.avatarCleared = false }
    }
    FileDialog {
        id: bannerDialog; title: "Выберите баннер (PNG/JPG/GIF)"
        nameFilters: ["Изображения (*.png *.jpg *.jpeg *.gif)"]
        onAccepted: root.bannerFile = selectedFile.toString()
    }
}
