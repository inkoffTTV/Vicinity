import QtQuick 2.15
import QtQuick.Controls 2.15

// Плоская строка сообщения в стиле Discord (без пузырей, всё слева).
// grouped = это сообщение того же автора подряд → без аватара и шапки.
// Поддерживает: реакции (чипы + пикер), инлайн-редактирование своих,
// удаление/копирование через "…", картинку-вложение, метку (изменено).
Item {
    id: root
    width: parent ? parent.width : 0

    property string authorName:   ""
    property string messageText:  ""
    property string timestamp:    ""
    property bool   isOwn:        false
    property string avatarSource: ""
    property string roleColor:    ""
    property int    authorId:     0
    property bool   grouped:      false
    property var    msgId:        0        // id сообщения на сервере (0 = ещё не присвоен)
    property bool   edited:       false
    property string rxJson:       "[]"     // реакции: [{emoji,count,me}]
    property string attachment:   ""       // URL картинки-вложения ("" = нет)

    signal openProfile(int userId)
    signal react(string emoji)
    signal editSubmit(string newText)
    signal deleteRequested()

    property bool editing: false
    readonly property var rxList: { try { return JSON.parse(rxJson || "[]") } catch (e) { return [] } }
    readonly property bool actionable: msgId > 0

    readonly property int  leftPad:  16
    readonly property int  avatarCol: 40
    readonly property int  rightPad: 48
    readonly property real textX:    leftPad + avatarCol + 12
    readonly property real topGap:   grouped ? (themeManager.compact ? 1 : 3)
                                             : (themeManager.compact ? 8 : 17)

    // «пол» по высоте, чтобы строки не наезжали пока высота досчитывается
    height: topGap + Math.max(textCol.implicitHeight, grouped ? 0 : avatarCol) + 4

    // Подсветка строки при наведении (Discord)
    Rectangle {
        anchors.fill: parent
        color: hov.hovered ? themeManager.rgba(0, 0, 0, 0.10) : "transparent"
        Behavior on color { ColorAnimation { duration: themeManager.animDuration(80) } }
    }
    HoverHandler { id: hov }

    // Аватар (только у первого сообщения группы)
    AnimatedAvatar {
        id: av
        x: root.leftPad
        y: root.topGap
        width: root.avatarCol; height: root.avatarCol
        visible: !root.grouped
        displayName: root.authorName
        source: root.avatarSource
        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
            enabled: root.authorId > 0
            onClicked: root.openProfile(root.authorId) }
    }

    // У сгруппированных при наведении — мелкий таймстамп на месте аватара
    Text {
        visible: root.grouped && hov.hovered
        x: root.leftPad; width: root.avatarCol
        y: root.topGap + 1
        horizontalAlignment: Text.AlignHCenter
        text: root.timestamp
        color: themeManager.textFaintColor
        font.pixelSize: 10
    }

    // Имя + время + текст + вложение + реакции
    Column {
        id: textCol
        x: root.textX
        y: root.topGap
        width: root.width - root.textX - root.rightPad
        spacing: 2

        Row {
            spacing: 8
            visible: !root.grouped
            Text {
                id: nameT
                text: root.authorName
                color: root.roleColor !== "" ? root.roleColor : themeManager.textColor
                font.pixelSize: 15; font.bold: true
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    enabled: root.authorId > 0
                    onClicked: root.openProfile(root.authorId) }
            }
            Text {
                text: root.timestamp
                color: themeManager.textFaintColor
                font.pixelSize: 11
                anchors.bottom: nameT.bottom; anchors.bottomMargin: 1
            }
        }

        // Обычный текст (+ метка «изменено»)
        Text {
            visible: !root.editing && root.messageText.length > 0
            width: parent.width
            text: root.messageText
                  + (root.edited ? " <font color=\"" + themeManager.textFaintColor + "\" size=\"1\">(изменено)</font>" : "")
            textFormat: root.edited ? Text.StyledText : Text.PlainText
            color: themeManager.textColor
            font.pixelSize: 15
            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
        }

        // Инлайн-редактирование (Enter — сохранить, Esc — отмена)
        Rectangle {
            visible: root.editing
            width: parent.width; height: editField.implicitHeight + 16
            radius: 8; color: themeManager.inputColor
            TextField {
                id: editField
                anchors { fill: parent; leftMargin: 10; rightMargin: 10 }
                verticalAlignment: TextInput.AlignVCenter
                color: themeManager.textColor; font.pixelSize: 15
                background: Item {}
                Keys.onReturnPressed: {
                    var t = text.trim()
                    if (t.length > 0 && t !== root.messageText) root.editSubmit(t)
                    root.editing = false
                }
                Keys.onEscapePressed: root.editing = false
            }
        }
        Text {
            visible: root.editing
            text: "Enter — сохранить · Esc — отмена"
            color: themeManager.textFaintColor; font.pixelSize: 10
        }

        // Картинка-вложение
        Rectangle {
            visible: root.attachment.length > 0
            width: Math.min(attImg.implicitWidth > 0 ? attImg.implicitWidth : 320, 320, parent.width)
            height: attImg.status === Image.Ready
                    ? Math.min(attImg.implicitHeight * (width / Math.max(1, attImg.implicitWidth)), 240)
                    : 120
            radius: 8; color: themeManager.railColor; clip: true
            Image {
                id: attImg
                anchors.fill: parent
                source: root.attachment
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
            }
            Text {
                anchors.centerIn: parent
                visible: attImg.status !== Image.Ready
                text: attImg.status === Image.Error ? "не удалось загрузить" : "загрузка…"
                color: themeManager.textFaintColor; font.pixelSize: 11
            }
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                onClicked: Qt.openUrlExternally(root.attachment) }
        }

        // Реакции-чипы
        Flow {
            width: parent.width; spacing: 4
            visible: root.rxList.length > 0
            Repeater {
                model: root.rxList
                Rectangle {
                    width: rxRow.implicitWidth + 14; height: 22; radius: 11
                    color: modelData.me ? themeManager.accentSoftColor : themeManager.inputColor
                    border.width: 1
                    border.color: modelData.me ? themeManager.accentColor : themeManager.borderColor
                    Row {
                        id: rxRow; anchors.centerIn: parent; spacing: 4
                        Text { text: modelData.emoji; font.pixelSize: 12 }
                        Text { text: modelData.count
                            color: modelData.me ? themeManager.accentColor : themeManager.textMutedColor
                            font.pixelSize: 11; font.bold: true }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        enabled: root.actionable
                        onClicked: root.react(modelData.emoji) }
                }
            }
        }
    }

    // Мини-панель действий справа сверху
    Rectangle {
        id: actions
        anchors { right: parent.right; rightMargin: 14; top: parent.top; topMargin: root.grouped ? 0 : 4 }
        width: actRow.implicitWidth + 12; height: 30; radius: 8
        color: themeManager.elevatedColor
        border.color: themeManager.borderColor; border.width: 1
        opacity: (hov.hovered || reactPicker.visible || moreMenu.visible) && root.actionable && !root.editing ? 1 : 0
        visible: opacity > 0.01
        Behavior on opacity { NumberAnimation { duration: themeManager.animDuration(90) } }

        Row {
            id: actRow
            anchors.centerIn: parent; spacing: 4

            component ActBtn: Rectangle {
                property alias icon: abIc.name
                signal clicked()
                width: 24; height: 24; radius: 6
                color: abMa.containsMouse ? themeManager.hoverColor : "transparent"
                AppIcon { id: abIc; anchors.centerIn: parent; size: 16
                    color: abMa.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                MouseArea { id: abMa; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: parent.clicked() }
            }

            ActBtn { icon: "smile"
                onClicked: reactPicker.visible ? reactPicker.close() : reactPicker.open() }
            ActBtn { icon: "edit"; visible: root.isOwn
                onClicked: { editField.text = root.messageText; root.editing = true
                             editField.forceActiveFocus() } }
            ActBtn { icon: "more"
                onClicked: moreMenu.popup() }
        }
    }

    // Пикер реакций
    Popup {
        id: reactPicker
        parent: actions
        x: parent ? parent.width - width : 0
        y: parent ? parent.height + 4 : 0
        width: 232; height: 100; padding: 6
        background: Rectangle { radius: 10; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1 }
        GridView {
            anchors.fill: parent; clip: true
            cellWidth: 36; cellHeight: 36
            model: ["👍","❤️","😂","😮","😢","🔥","🎉","💀","👀","🤝","💯","🙏"]
            delegate: Rectangle {
                width: 34; height: 34; radius: 6
                color: rpHov.containsMouse ? themeManager.hoverColor : "transparent"
                Text { anchors.centerIn: parent; text: modelData; font.pixelSize: 19 }
                MouseArea { id: rpHov; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: { root.react(modelData); reactPicker.close() } }
            }
        }
    }

    // Меню «…»
    Menu {
        id: moreMenu
        MenuItem { text: "Копировать текст"
            onTriggered: appState.copyToClipboard(root.messageText) }
        MenuItem { text: "Удалить"; visible: root.isOwn; height: root.isOwn ? implicitHeight : 0
            onTriggered: root.deleteRequested() }
    }
}
