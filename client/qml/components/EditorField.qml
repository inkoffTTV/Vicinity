import QtQuick 2.15
import QtQuick.Controls 2.15

// Поле ввода с лейблом-плейсхолдером. Эмитит edited(value).
Rectangle {
    id: root
    property string label: ""
    property string text: ""
    property int    maxLen: 0
    signal edited(string value)

    implicitHeight: 38; height: 38; radius: 8
    color: themeManager.inputColor
    border.color: tf.activeFocus ? themeManager.accentColor : themeManager.borderColor
    border.width: 1

    TextField {
        id: tf
        anchors.fill: parent; leftPadding: 12; rightPadding: 12
        text: root.text
        placeholderText: root.label
        color: themeManager.textColor; font.pixelSize: 13; background: Item {}
        placeholderTextColor: themeManager.textFaintColor
        selectByMouse: true
        onTextChanged: {
            if (root.maxLen > 0 && length > root.maxLen) {
                text = text.substring(0, root.maxLen); cursorPosition = root.maxLen
            }
            root.edited(text)
        }
    }
}
