import QtQuick 2.15
import QtQuick.Effects
import QtQuick.Window 2.15

Item {
    id: root
    width: 40; height: 40
    // Проигрывать GIF только если разрешено в настройках, не reduced-motion,
    // элемент виден и окно активно (не свёрнуто). Иначе — статичный первый кадр.
    readonly property bool _playAllowed: themeManager.playAnimatedAvatars
                                         && !themeManager.reducedMotion
                                         && root.visible && (Window.active !== false)

    property string source: ""
    property string displayName: "?"
    property color  accentColor: themeManager.accentColor
    // Форма берётся из глобальных настроек: 0 = квадрат, 0.5 = круг
    readonly property real cornerRadius: width * themeManager.avatarRadiusRatio

    // Фон + инициалы (когда нет аватарки)
    Rectangle {
        anchors.fill: parent
        radius: root.cornerRadius
        Behavior on radius { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
        color: Qt.rgba(accentColor.r, accentColor.g, accentColor.b, 0.28)
        visible: root.source === ""

        Text {
            anchors.centerIn: parent
            text: root.displayName.length > 0 ? root.displayName[0].toUpperCase() : "?"
            font.pixelSize: parent.width * 0.4
            font.bold: true
            color: "#ffffff"
        }
    }

    // Исходная картинка (скрыта — служит источником для маски)
    AnimatedImage {
        id: avatarImg
        anchors.fill: parent
        source: root.source
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
        // Декодируем в размер аватара (а не в нативное разрешение GIF) — против лагов
        sourceSize.width:  Math.max(1, Math.round(root.width))
        sourceSize.height: Math.max(1, Math.round(root.height))
        playing: root._playAllowed
        paused: !root._playAllowed
        visible: false
        property bool _static: !themeManager.playAnimatedAvatars || themeManager.reducedMotion
        onStatusChanged: if (status === AnimatedImage.Ready && _static) currentFrame = 0
    }

    // Маска скруглённой формы
    Rectangle {
        id: avatarMask
        anchors.fill: parent
        radius: root.cornerRadius
        Behavior on radius { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
        color: "white"
        visible: false
        layer.enabled: true
    }

    // Картинка, обрезанная по форме маски
    MultiEffect {
        anchors.fill: parent
        source: avatarImg
        maskEnabled: true
        maskSource: avatarMask
        visible: root.source !== ""
    }

    // Обводка
    Rectangle {
        anchors.fill: parent
        radius: root.cornerRadius
        Behavior on radius { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
        color: "transparent"
        border.color: Qt.rgba(root.accentColor.r, root.accentColor.g, root.accentColor.b, 0.4)
        border.width: 1
    }
}
