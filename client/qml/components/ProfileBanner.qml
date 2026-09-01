import QtQuick 2.15
import QtQuick.Window 2.15

// Универсальный рендер баннера профиля: сплошной цвет / градиент / картинка(GIF).
Item {
    id: root
    property string type: "solid"          // solid | gradient | image
    property color  solid: themeManager.accentColor
    property var    gradient: null          // {type,angle,stops}
    property string image: ""               // готовый URL
    property bool   playing: true           // проигрывать GIF (с учётом настройки/видимости)
    clip: true

    Rectangle {
        anchors.fill: parent
        visible: root.type === "solid"
        color: root.solid
    }

    GradientRect {
        anchors.fill: parent
        visible: root.type === "gradient"
        spec: root.gradient ? root.gradient
              : ({ type:"linear", angle:90,
                   stops:[{pos:0,color:"#5865f2"},{pos:1,color:"#eb459e"}] })
    }

    AnimatedImage {
        id: bannerImg
        anchors.fill: parent
        visible: root.type === "image" && root.image !== ""
        source: root.image
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
        // Декодируем GIF в разрешение области (а не в нативное) — иначе жуткие лаги
        sourceSize.width:  Math.max(1, Math.round(root.width))
        sourceSize.height: Math.max(1, Math.round(root.height))
        // GIF играем только если: разрешено, не reduced-motion, видно и окно активно
        property bool _allow: root.playing && themeManager.playAnimatedAvatars
                              && !themeManager.reducedMotion && root.visible && (Window.active !== false)
        playing: _allow
        paused: !_allow
        // reduced-motion / выключенная анимация → статичный первый кадр
        property bool _static: !themeManager.playAnimatedAvatars || themeManager.reducedMotion
        onStatusChanged: if (status === AnimatedImage.Ready && _static) currentFrame = 0
    }
}
