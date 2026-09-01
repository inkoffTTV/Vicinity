import QtQuick 2.15
import QtQuick.Shapes 1.15

// Векторная иконка. Цвет — ВСЕГДА из токена (по умолчанию textColor),
// никаких растровых ассетов. Аналог "SVG через currentColor".
// Путь задан в системе координат 24x24 и масштабируется под size.
Item {
    id: root
    property string name: ""
    property real   size: 20
    property color  color: themeManager.textColor
    property real   stroke: 2.0

    implicitWidth: size;  implicitHeight: size
    width: size;          height: size

    // Каждая иконка: { d: "<svg path>", f: filled? }
    readonly property var _set: ({
        "close":        { d: "M6 6 L18 18 M18 6 L6 18", f: false },
        "plus":         { d: "M12 5 L12 19 M5 12 L19 12", f: false },
        "minus":        { d: "M5 12 L19 12", f: false },
        "check":        { d: "M5 12 L10 17 L19 6", f: false },
        "chevron-right":{ d: "M9 5 L16 12 L9 19", f: false },
        "chevron-down": { d: "M5 9 L12 16 L19 9", f: false },
        "chevron-left": { d: "M15 5 L8 12 L15 19", f: false },
        "search":       { d: "M18 11 A7 7 0 1 1 4 11 A7 7 0 1 1 18 11 Z M16.5 16.5 L21 21", f: false },
        "settings":     { d: "M15 12 A3 3 0 1 1 9 12 A3 3 0 1 1 15 12 Z M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M18.4 5.6 L17 7 M7 17 L5.6 18.4", f: false },
        "edit":         { d: "M16 4 L20 8 L9 19 L4 20 L5 15 Z M14 6 L18 10", f: false },
        "trash":        { d: "M4 7 H20 M9 7 V5 H15 V7 M6 7 L7 20 H17 L18 7 Z M10 10 V17 M14 10 V17", f: false },
        "copy":         { d: "M8 8 H19 V19 H8 Z M4 16 V4 H15", f: false },
        "link":         { d: "M9.5 14.5 L14.5 9.5 M10 7 L12 5 A3 3 0 0 1 16 9 L14 11 M14 17 L12 19 A3 3 0 0 1 8 15 L10 13", f: false },
        "person":       { d: "M16 9 A4 4 0 1 1 8 9 A4 4 0 1 1 16 9 Z M5 20 A7 7 0 0 1 19 20", f: false },
        "person-add":   { d: "M14 9 A3.5 3.5 0 1 1 7 9 A3.5 3.5 0 1 1 14 9 Z M3.5 20 A6.5 6.5 0 0 1 17 20 M19 7 V13 M16 10 H22", f: false },
        "message":      { d: "M4 6 A2 2 0 0 1 6 4 H18 A2 2 0 0 1 20 6 V14 A2 2 0 0 1 18 16 H9 L5 20 V16 A2 2 0 0 1 4 14 Z", f: false },
        "phone":        { d: "M5 4 H9 L11 9 L8.5 11 A11 11 0 0 0 13 15.5 L15 13 L20 15 V19 A2 2 0 0 1 18 21 A16 16 0 0 1 3 6 A2 2 0 0 1 5 4 Z", f: false },
        "phone-off":    { d: "M5 4 H9 L11 9 L8.5 11 A11 11 0 0 0 13 15.5 L15 13 L20 15 V19 A2 2 0 0 1 18 21 A16 16 0 0 1 3 6 A2 2 0 0 1 5 4 Z M3 3 L21 21", f: false },
        "mic":          { d: "M12 3 A3 3 0 0 0 9 6 V11 A3 3 0 0 0 15 11 V6 A3 3 0 0 0 12 3 Z M6 11 A6 6 0 0 0 18 11 M12 17 V21 M8 21 H16", f: false },
        "mic-off":      { d: "M12 3 A3 3 0 0 0 9 6 V11 A3 3 0 0 0 15 11 V6 A3 3 0 0 0 12 3 Z M6 11 A6 6 0 0 0 18 11 M12 17 V21 M8 21 H16 M3 3 L21 21", f: false },
        "headphones":   { d: "M5 13 V12 A7 7 0 0 1 19 12 V13 M3 15 A2 2 0 0 1 5 13 H6 V19 H5 A2 2 0 0 1 3 17 Z M21 15 A2 2 0 0 0 19 13 H18 V19 H19 A2 2 0 0 0 21 17 Z", f: false },
        "deafen":       { d: "M5 13 V12 A7 7 0 0 1 19 12 V13 M3 15 A2 2 0 0 1 5 13 H6 V19 H5 A2 2 0 0 1 3 17 Z M21 15 A2 2 0 0 0 19 13 H18 V19 H19 A2 2 0 0 0 21 17 Z M3 3 L21 21", f: false },
        "video":        { d: "M4 7 A1 1 0 0 1 5 6 H14 A1 1 0 0 1 15 7 V17 A1 1 0 0 1 14 18 H5 A1 1 0 0 1 4 17 Z M15 10 L20 7 V17 L15 14", f: false },
        "video-off":    { d: "M4 7 A1 1 0 0 1 5 6 H14 A1 1 0 0 1 15 7 V17 A1 1 0 0 1 14 18 H5 A1 1 0 0 1 4 17 Z M15 10 L20 7 V17 L15 14 M3 3 L21 21", f: false },
        "screen":       { d: "M3 5 H21 V16 H3 Z M9 20 H15 M12 16 V20", f: false },
        "image":        { d: "M4 5 H20 V19 H4 Z M9 10 A1.5 1.5 0 1 1 6 10 A1.5 1.5 0 1 1 9 10 Z M4 16 L9 12 L13 15 L16 13 L20 16", f: false },
        "palette":      { d: "M12 3 A9 9 0 1 0 12 21 C13.2 21 14 20.2 14 19 C14 18.4 13.7 17.9 13.4 17.5 C13.1 17.1 12.9 16.6 12.9 16 C12.9 14.9 13.8 14 14.9 14 H17 A4 4 0 0 0 21 10 A9 9 0 0 0 12 3 Z", f: false },
        "more":         { d: "M5.4 12 A0.4 0.4 0 1 1 5.4 11.6 Z M12 12 A0.4 0.4 0 1 1 12 11.6 Z M18.6 12 A0.4 0.4 0 1 1 18.6 11.6 Z", f: true },
        "logout":       { d: "M9 5 H5 A1 1 0 0 0 4 6 V18 A1 1 0 0 0 5 19 H9 M15 8 L19 12 L15 16 M19 12 H9", f: false },
        "hash":         { d: "M9 4 L7 20 M17 4 L15 20 M5 9 H19 M4 15 H18", f: false },
        "home":         { d: "M4 11 L12 4 L20 11 M6 9.5 V19 H18 V9.5", f: false },
        "bell":         { d: "M6 16 V10 A6 6 0 0 1 18 10 V16 L20 18 H4 Z M10 21 H14", f: false },
        "star":         { d: "M12 3 L14.6 8.6 L21 9.3 L16.5 13.7 L17.8 20 L12 16.8 L6.2 20 L7.5 13.7 L3 9.3 L9.4 8.6 Z", f: false },
        "clock":        { d: "M20 12 A8 8 0 1 1 4 12 A8 8 0 1 1 20 12 Z M12 7 V12 L15 14", f: false },
        "smile":        { d: "M20 12 A8 8 0 1 1 4 12 A8 8 0 1 1 20 12 Z M9 10 H9.01 M15 10 H15.01 M8.5 14 A4 4 0 0 0 15.5 14", f: false },
        "gamepad":      { d: "M7 8 H17 A4 4 0 0 1 17 16 L15 14 H9 L7 16 A4 4 0 0 1 7 8 Z M9 11 V13 M8 12 H10 M15 11.5 H15.01 M17 13 H17.01", f: false },
        "eye-off":      { d: "M4 12 C6 8 9 6 12 6 C15 6 18 8 20 12 C19 14 17.5 15.5 15.8 16.6 M9.5 9.5 A3 3 0 0 0 14 14 M4 4 L20 20 M9.5 7 C10.3 6.7 11.1 6.5 12 6.5", f: false }
    })

    readonly property var _icon: _set[name] ? _set[name] : null

    Shape {
        id: shp
        width: 24; height: 24
        anchors.centerIn: parent
        scale: root.size / 24
        antialiasing: true
        preferredRendererType: Shape.CurveRenderer
        visible: root._icon !== null

        ShapePath {
            fillColor:   root._icon && root._icon.f ? root.color : "transparent"
            strokeColor: root._icon && root._icon.f ? "transparent" : root.color
            strokeWidth: root.stroke
            capStyle:    ShapePath.RoundCap
            joinStyle:   ShapePath.RoundJoin
            fillRule:    ShapePath.OddEvenFill
            PathSvg { path: root._icon ? root._icon.d : "" }
        }
    }

    // Подстраховка: если иконки нет в наборе — маленький кружок-плейсхолдер
    Rectangle {
        visible: root._icon === null
        anchors.centerIn: parent
        width: root.size * 0.5; height: width; radius: width / 2
        color: "transparent"; border.color: root.color; border.width: 1.5
    }
}
