import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

// Переиспользуемый пикер цвета: HEX + RGBA + пресеты + превью.
// Двусторонний: родитель задаёт value, компонент обновляет value при правках.
Column {
    id: root
    property color value: "#5865f2"
    property bool  showAlpha: true
    spacing: 10
    width: parent ? parent.width : 240

    // защита от циклов при программном обновлении полей
    property bool _editing: false

    function _set(c) { if (c && c.toString() !== root.value.toString()) root.value = c }
    function _r() { return Math.round(root.value.r * 255) }
    function _g() { return Math.round(root.value.g * 255) }
    function _b() { return Math.round(root.value.b * 255) }
    function _a() { return root.value.a }

    // ── Превью + HEX ──
    Row {
        width: parent.width; spacing: 10
        // превью со «шахматкой» под альфу
        Rectangle {
            width: 44; height: 38; radius: 8
            anchors.verticalCenter: parent.verticalCenter
            color: themeManager.inputColor
            border.color: themeManager.borderColor; border.width: 1
            clip: true
            // шахматка
            Grid {
                anchors.fill: parent; columns: 6; rows: 5
                Repeater { model: 30
                    Rectangle { width: 44/6; height: 38/5
                        color: (index % 2 === (Math.floor(index/6) % 2)) ? "#ffffff" : "#bbbbbb" } }
            }
            Rectangle { anchors.fill: parent; radius: 8; color: root.value }
        }
        // HEX
        Rectangle {
            width: parent.width - 54; height: 38; radius: 8
            anchors.verticalCenter: parent.verticalCenter
            color: themeManager.inputColor
            border.color: hexField.activeFocus ? themeManager.accentColor : themeManager.borderColor
            border.width: 1
            TextField {
                id: hexField
                anchors.fill: parent; leftPadding: 12
                text: themeManager.colorToHex(root.value)
                color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                selectByMouse: true
                inputMethodHints: Qt.ImhNoAutoUppercase
                onEditingFinished: {
                    if (themeManager.isHexColor(text))
                        root._set(themeManager.colorFromHex(text))
                    text = themeManager.colorToHex(root.value)
                }
            }
        }
    }

    // ── RGBA слайдеры ──
    Repeater {
        model: root.showAlpha
               ? [{n:"R",k:0,mx:255},{n:"G",k:1,mx:255},{n:"B",k:2,mx:255},{n:"A",k:3,mx:100}]
               : [{n:"R",k:0,mx:255},{n:"G",k:1,mx:255},{n:"B",k:2,mx:255}]
        Row {
            width: root.width; spacing: 8
            Text { text: modelData.n; width: 14; color: themeManager.textMutedColor
                font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
            Slider {
                id: sld
                width: parent.width - 64
                anchors.verticalCenter: parent.verticalCenter
                from: 0; to: modelData.mx; stepSize: 1
                value: modelData.k === 0 ? root._r()
                     : modelData.k === 1 ? root._g()
                     : modelData.k === 2 ? root._b()
                     : Math.round(root._a() * 100)
                onMoved: {
                    var r = root._r(), g = root._g(), b = root._b(), a = root._a()
                    if (modelData.k === 0) r = value
                    else if (modelData.k === 1) g = value
                    else if (modelData.k === 2) b = value
                    else a = value / 100
                    root._set(themeManager.rgba(r, g, b, a))
                }
            }
            Text {
                width: 34; horizontalAlignment: Text.AlignRight
                anchors.verticalCenter: parent.verticalCenter
                color: themeManager.textColor; font.pixelSize: 12
                text: modelData.k === 0 ? root._r()
                    : modelData.k === 1 ? root._g()
                    : modelData.k === 2 ? root._b()
                    : Math.round(root._a() * 100) + "%"
            }
        }
    }

    // ── Пресеты ──
    Flow {
        width: root.width; spacing: 7
        Repeater {
            model: ["#5865f2","#f23f43","#e67e22","#f1c40f","#57f287",
                    "#1abc9c","#00b0f4","#9b59b6","#eb459e","#ffffff","#2b2d31"]
            Rectangle {
                width: 24; height: 24; radius: 12; color: modelData
                border.color: Qt.colorEqual(root.value, modelData) ? themeManager.textColor
                              : themeManager.borderColor
                border.width: Qt.colorEqual(root.value, modelData) ? 2 : 1
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    onClicked: root._set(Qt.color(modelData)) }
            }
        }
    }
}
