import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

RowLayout {
    spacing: 6

    Repeater {
        model: [
            { label: "⚫", theme: 0, tip: "Чёрная" },
            { label: "⚪", theme: 1, tip: "Белая" }
        ]

        Rectangle {
            width: 36; height: 28; radius: 6
            property bool active: themeManager.currentThemeName === ["Black","White"][modelData.theme]
            color: active
                   ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                             themeManager.accentColor.b, 0.28)
                   : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                             themeManager.textColor.b, 0.07)
            border.color: active ? themeManager.accentColor : "transparent"
            border.width: 1
            Behavior on color { ColorAnimation { duration: 120 } }

            Text { anchors.centerIn: parent; text: modelData.label; font.pixelSize: 14 }

            ToolTip.visible: ma.containsMouse
            ToolTip.text: modelData.tip

            MouseArea {
                id: ma; anchors.fill: parent
                cursorShape: Qt.PointingHandCursor; hoverEnabled: true
                onClicked: themeManager.setTheme(modelData.theme)
            }
        }
    }
}
