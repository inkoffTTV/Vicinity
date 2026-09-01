import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

// Редактор градиента. Производит spec: {type, angle, stops:[{pos,color(hex)}]}.
// Цвета стопов — hex-строки (JSON-сериализуемо для бэкенда).
Column {
    id: root
    property var spec: ({ type: "linear", angle: 90,
                          stops: [{pos:0, color:"#5865f2"}, {pos:1, color:"#eb459e"}] })
    spacing: 10
    width: parent ? parent.width : 280
    property int _editIdx: -1

    function _clone() { return JSON.parse(JSON.stringify(root.spec)) }
    function setType(t)        { var c=_clone(); c.type=t; root.spec=c }
    function setAngle(a)       { var c=_clone(); c.angle=a; root.spec=c }
    function setStopPos(i,p)   { var c=_clone(); c.stops[i].pos=Math.max(0,Math.min(1,p)); root.spec=c }
    function setStopColor(i,h) { var c=_clone(); c.stops[i].color=h; root.spec=c }
    function addStop()         { if(root.spec.stops.length>=4) return; var c=_clone();
                                 c.stops.push({pos:0.5, color:"#ffffff"}); root.spec=c }
    function removeStop(i)     { if(root.spec.stops.length<=2) return; var c=_clone();
                                 c.stops.splice(i,1); root.spec=c }

    // Превью
    GradientRect {
        width: parent.width; height: 56; radius: 8
        spec: root.spec
        Rectangle { anchors.fill: parent; radius: 8; color: "transparent"
            border.color: themeManager.borderColor; border.width: 1 }
    }

    // Тип
    Row {
        spacing: 8
        Repeater {
            model: [{l:"Линейный", t:"linear"}, {l:"Радиальный", t:"radial"}]
            Rectangle {
                width: 120; height: 34; radius: 8
                property bool sel: root.spec.type === modelData.t
                color: sel ? themeManager.accentSoftColor : themeManager.inputColor
                border.color: sel ? themeManager.accentColor : themeManager.borderColor; border.width: 1
                Text { anchors.centerIn: parent; text: modelData.l; font.pixelSize: 12
                    color: sel ? themeManager.accentColor : themeManager.textColor }
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    onClicked: root.setType(modelData.t) }
            }
        }
    }

    // Угол (для линейного)
    Row {
        width: parent.width; spacing: 8; visible: root.spec.type === "linear"
        Text { text: "Угол"; width: 40; color: themeManager.textMutedColor; font.pixelSize: 12
            anchors.verticalCenter: parent.verticalCenter }
        Slider {
            width: parent.width - 90; anchors.verticalCenter: parent.verticalCenter
            from: 0; to: 360; stepSize: 5; value: root.spec.angle
            onMoved: root.setAngle(value)
        }
        Text { width: 36; horizontalAlignment: Text.AlignRight; text: Math.round(root.spec.angle)+"°"
            color: themeManager.textColor; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
    }

    // Стопы
    Text { text: "СТОПЫ"; font.pixelSize: 10; font.bold: true; color: themeManager.textFaintColor }
    Repeater {
        model: root.spec.stops.length
        Row {
            width: root.width; spacing: 8
            property int idx: index
            Rectangle {  // цвет стопа
                width: 30; height: 30; radius: 6
                anchors.verticalCenter: parent.verticalCenter
                color: root.spec.stops[index].color
                border.color: themeManager.borderColor; border.width: 1
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    onClicked: { root._editIdx = index
                                 stopCp.value = root.spec.stops[index].color
                                 stopColorPopup.open() } }
            }
            Slider {
                width: parent.width - 84; anchors.verticalCenter: parent.verticalCenter
                from: 0; to: 1; stepSize: 0.01; value: root.spec.stops[index].pos
                onMoved: root.setStopPos(index, value)
            }
            Rectangle {  // удалить стоп
                width: 30; height: 30; radius: 6
                anchors.verticalCenter: parent.verticalCenter
                visible: root.spec.stops.length > 2
                color: rmHov.containsMouse ? themeManager.rgba(255,107,107,0.18) : "transparent"
                AppIcon { anchors.centerIn: parent; name: "close"; size: 14; color: themeManager.dangerColor }
                MouseArea { id: rmHov; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: root.removeStop(index) }
            }
        }
    }

    // Добавить стоп
    Rectangle {
        width: parent.width; height: 32; radius: 8
        visible: root.spec.stops.length < 4
        color: addHov.containsMouse ? themeManager.accentSoftColor : themeManager.inputColor
        border.color: themeManager.borderColor; border.width: 1
        Row { anchors.centerIn: parent; spacing: 6
            AppIcon { name: "plus"; size: 14; color: themeManager.accentColor
                anchors.verticalCenter: parent.verticalCenter }
            Text { text: "Добавить стоп"; color: themeManager.accentColor; font.pixelSize: 12
                anchors.verticalCenter: parent.verticalCenter }
        }
        MouseArea { id: addHov; anchors.fill: parent; hoverEnabled: true
            cursorShape: Qt.PointingHandCursor; onClicked: root.addStop() }
    }

    // Попап выбора цвета стопа
    Popup {
        id: stopColorPopup
        modal: true; width: 280; padding: 16
        anchors.centerIn: Overlay.overlay
        background: Rectangle { radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1 }
        ColorPicker {
            id: stopCp
            width: 248; showAlpha: true
            onValueChanged: if (root._editIdx >= 0)
                                root.setStopColor(root._editIdx, themeManager.colorToHex(value))
        }
    }
}
