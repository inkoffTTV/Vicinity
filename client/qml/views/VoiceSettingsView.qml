import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"

// Раздел настроек «Голос и видео» (встраивается в SettingsView).
// Контролы — тёмные, в стиле Discord (свои ComboBox/Slider по токенам).
Item {
    id: root
    anchors.fill: parent
    property var inDevs:  []
    property var outDevs: []
    property var camDevs: []
    function reload() {
        inDevs  = voiceEngine.inputDevices()
        outDevs = voiceEngine.outputDevices()
        camDevs = videoEngine.cameras()
    }
    Component.onCompleted: reload()

    // ── Тёмный ComboBox (Discord) ──
    component DarkCombo: ComboBox {
        id: combo
        implicitHeight: 40
        font.pixelSize: 14

        background: Rectangle {
            radius: 4; color: themeManager.railColor
            border.width: 1
            border.color: combo.popup.visible ? themeManager.accentColor : themeManager.borderColor
        }
        contentItem: Text {
            leftPadding: 12; rightPadding: 32
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
            text: combo.displayText
            color: themeManager.textColor; font.pixelSize: 14
        }
        indicator: AppIcon {
            x: combo.width - 26; y: combo.height / 2 - 8
            name: "chevron-down"; size: 16
            color: themeManager.textMutedColor
            rotation: combo.popup.visible ? 180 : 0
            Behavior on rotation { NumberAnimation { duration: themeManager.animDuration(140) } }
        }
        delegate: ItemDelegate {
            id: dItem
            required property var model
            required property int index
            width: combo.width; height: 36
            contentItem: Text {
                text: dItem.model[combo.textRole] !== undefined ? dItem.model[combo.textRole] : modelData
                color: themeManager.textColor; font.pixelSize: 14
                verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight
                leftPadding: 6
            }
            background: Rectangle {
                radius: 4
                color: dItem.highlighted ? themeManager.hoverColor : "transparent"
            }
            highlighted: combo.highlightedIndex === index
        }
        popup: Popup {
            y: combo.height + 4
            width: combo.width
            padding: 6
            implicitHeight: Math.min(contentItem.implicitHeight + 12, 280)
            background: Rectangle {
                radius: 6; color: themeManager.railColor
                border.color: themeManager.borderColor; border.width: 1
            }
            contentItem: ListView {
                clip: true
                implicitHeight: contentHeight
                model: combo.popup.visible ? combo.delegateModel : null
                currentIndex: combo.highlightedIndex
                ScrollBar.vertical: ScrollBar {}
            }
        }
    }

    // ── Тёмный Slider (Discord: синяя дорожка + белая ручка-пилюля) ──
    component DarkSlider: Slider {
        id: sl
        implicitHeight: 28

        background: Rectangle {
            x: sl.leftPadding; y: sl.topPadding + sl.availableHeight / 2 - height / 2
            width: sl.availableWidth; height: 8; radius: 4
            color: themeManager.inputColor
            Rectangle {
                width: sl.visualPosition * parent.width; height: parent.height; radius: 4
                color: themeManager.accentColor
            }
        }
        handle: Rectangle {
            x: sl.leftPadding + sl.visualPosition * (sl.availableWidth - width)
            y: sl.topPadding + sl.availableHeight / 2 - height / 2
            width: 12; height: 24; radius: 4
            color: "#ffffff"
            border.color: themeManager.borderColor; border.width: 1
        }
    }

    component SectionLabel: Text {
        font.pixelSize: 12; font.bold: true
        color: themeManager.textFaintColor
    }
    component GroupDivider: Rectangle {
        height: 1; color: themeManager.borderColor
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(660, parent.width)
            spacing: 12

            // ═══ ГОЛОС ═══
            RowLayout {
                Layout.fillWidth: true; spacing: 16
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 8
                    SectionLabel { text: "УСТРОЙСТВО ВВОДА" }
                    DarkCombo {
                        Layout.fillWidth: true
                        model: root.inDevs
                        currentIndex: voiceEngine.inputDeviceIndex
                        onActivated: voiceEngine.setInputDevice(currentIndex)
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 8
                    SectionLabel { text: "УСТРОЙСТВО ВЫВОДА" }
                    DarkCombo {
                        Layout.fillWidth: true
                        model: root.outDevs
                        currentIndex: voiceEngine.outputDeviceIndex
                        onActivated: voiceEngine.setOutputDevice(currentIndex)
                    }
                }
            }

            Item { Layout.preferredHeight: 4 }

            SectionLabel { text: "ГРОМКОСТЬ МИКРОФОНА: " + voiceEngine.micVolume + "%" }
            DarkSlider {
                Layout.fillWidth: true
                from: 0; to: 200; stepSize: 5
                value: voiceEngine.micVolume
                onMoved: voiceEngine.micVolume = value
            }

            SectionLabel { text: "ГРОМКОСТЬ ЗВУКА: " + voiceEngine.outVolume + "%" }
            DarkSlider {
                Layout.fillWidth: true
                from: 0; to: 100; stepSize: 5
                value: voiceEngine.outVolume
                onMoved: voiceEngine.outVolume = value
            }

            GroupDivider { Layout.fillWidth: true; Layout.topMargin: 8; Layout.bottomMargin: 8 }

            // ═══ ВИДЕО ═══
            SectionLabel { text: "КАМЕРА" }
            DarkCombo {
                Layout.fillWidth: true
                model: root.camDevs.length > 0 ? root.camDevs : ["Камера не найдена"]
                enabled: root.camDevs.length > 0
                currentIndex: Math.max(0, videoEngine.cameraIndex())
                onActivated: videoEngine.setCameraIndex(currentIndex)
            }
            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                text: "Камера используется в видеозвонках. Смену камеры можно делать прямо в звонке."
                color: themeManager.textFaintColor
            }

            GroupDivider { Layout.fillWidth: true; Layout.topMargin: 8; Layout.bottomMargin: 8 }

            // ═══ МИКРОФОН ВЫКЛ ═══
            RowLayout {
                Layout.fillWidth: true; spacing: 10
                Text { text: "Выключить микрофон"; font.pixelSize: 14
                    color: themeManager.textColor; Layout.fillWidth: true }
                Rectangle {
                    width: 46; height: 24; radius: 12
                    color: voiceEngine.muted ? themeManager.dangerColor : themeManager.inputColor
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    Rectangle { width: 20; height: 20; radius: 10; color: "#ffffff"
                        anchors.verticalCenter: parent.verticalCenter
                        x: voiceEngine.muted ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: themeManager.animDuration(120) } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: voiceEngine.toggleMute() }
                }
            }

            Text {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                text: "Совет: используй наушники, иначе микрофон ловит звук из динамиков (эхо)."
                color: themeManager.textFaintColor
            }

            Item { Layout.preferredHeight: 30 }
        }
    }
}
