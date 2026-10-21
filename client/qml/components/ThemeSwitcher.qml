import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

RowLayout {
    spacing: 6

    Repeater {
        model: [
            { theme: 0, name: "dark",     tip: "Тёмная" },
            { theme: 1, name: "light",    tip: "Светлая" },
            { theme: 2, name: "graphite", tip: "Графит" },
            { theme: 3, name: "black",    tip: "Чёрная" }
        ]

        Rectangle {
            width: 36; height: 28; radius: 6
            property bool active: themeManager.currentThemeName === modelData.name
            color: active
                   ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                             themeManager.accentColor.b, 0.28)
                   : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                             themeManager.textColor.b, 0.07)
            border.color: active ? themeManager.accentColor : "transparent"
            border.width: 1
            Behavior on color { ColorAnimation { duration: 120 } }

            // Образец: панель темы
            Rectangle { anchors.centerIn: parent; width: 18; height: 14; radius: themeManager.radiusXs
                color: themeManager.themePanelColor(modelData.theme)
                border.color: themeManager.borderColor; border.width: 1 }

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
