import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtMultimedia
import "qrc:/qml/components"

// Оверлей звонка (входящий / исходящий / соединение / в звонке + видео, Фаза C).
// Показывается сам по callEngine.state; цвета — токены, иконки — AppIcon.
// Видео-режим: большое видео собеседника + PiP своей камеры; включается когда
// хоть одна камера активна (моя — videoEngine.active, его — callEngine.remoteVideo).
Popup {
    id: root
    parent: Overlay.overlay
    anchors.centerIn: parent
    // НЕмодальный: во время звонка можно писать и ходить по чатам (звонок живёт)
    modal: false; dim: false
    closePolicy: Popup.NoAutoClose
    visible: callEngine.state !== "idle" && !minimized
    padding: 0

    // Свёрнут в мини-плашку (ChatView рисует её сам)
    property bool minimized: false
    Connections {
        target: callEngine
        function onStateChanged() {
            // входящий/новый звонок всегда разворачиваем; конец звонка — сброс
            if (callEngine.state === "incoming" || callEngine.state === "idle")
                root.minimized = false
        }
    }

    readonly property bool incoming: callEngine.state === "incoming"
    readonly property bool videoMode: !!(callEngine.remoteVideo || callEngine.remoteScreen
                                         || videoEngine.active)
    readonly property string statusText:
        callEngine.state === "outgoing"   ? "Звоним…" :
        callEngine.state === "incoming"   ? "Входящий звонок" :
        callEngine.state === "connecting" ? "Соединение…" :
        callEngine.state === "incall"     ? "В звонке" : ""

    width:  videoMode ? Math.min(920, (parent ? parent.width  : 960) - 48) : 340
    height: videoMode ? Math.min(640, (parent ? parent.height : 680) - 48) : 430

    background: Rectangle {
        radius: 18; color: themeManager.elevatedColor
        border.color: themeManager.borderColor; border.width: 1

        // Кнопка «свернуть» (звонок продолжается, UI освобождается).
        // Живёт в background — вне ColumnLayout, чтобы layout её не трогал.
        Rectangle {
            z: 10
            anchors { top: parent.top; right: parent.right; topMargin: 10; rightMargin: 10 }
            width: 32; height: 32; radius: 8
            color: minHov.containsMouse ? themeManager.hoverColor : "transparent"
            AppIcon { anchors.centerIn: parent; name: "chevron-down"; size: 18
                color: minHov.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
            MouseArea { id: minHov; anchors.fill: parent; hoverEnabled: true
                cursorShape: Qt.PointingHandCursor; onClicked: root.minimized = true }
        }
    }
    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(180) }
        NumberAnimation { property: "scale"; from: 0.95; to: 1; duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
    exit: Transition {
        NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(140) } }

    // Отдаём синки видео-движку один раз при создании
    Component.onCompleted: {
        videoEngine.setRemoteSink(remoteOut.videoSink)
        videoEngine.setRemoteScreenSink(remoteScreenOut.videoSink)
        videoEngine.setPreviewSink(localOut.videoSink)
    }


    // Круглая кнопка управления
    component CallBtn: Rectangle {
        property alias icon: ic.name
        property color bg: themeManager.inputColor
        property color fg: themeManager.textColor
        signal clicked()
        width: 58; height: 58; radius: 29
        color: ma.pressed ? Qt.darker(bg, 1.2) : (ma.containsMouse ? Qt.lighter(bg, 1.15) : bg)
        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
        scale: ma.pressed ? 0.92 : 1.0
        Behavior on scale { NumberAnimation { duration: themeManager.animDuration(120); easing.type: Easing.OutCubic } }
        AppIcon { id: ic; anchors.centerIn: parent; size: 24; color: parent.fg }
        MouseArea { id: ma; anchors.fill: parent; hoverEnabled: true
            cursorShape: Qt.PointingHandCursor; onClicked: parent.clicked() }
    }

    contentItem: ColumnLayout {
        spacing: 0

        // ── ВИДЕО-ЗОНА (только в videoMode) ─────────────────────────────
        Item {
            Layout.fillWidth: true; Layout.fillHeight: true
            Layout.margins: 12
            visible: root.videoMode

            Rectangle {
                anchors.fill: parent
                radius: 12; color: themeManager.railColor
                clip: true

                // Экран собеседника (если демонстрирует) — всегда крупно
                VideoOutput {
                    id: remoteScreenOut
                    anchors.fill: parent
                    fillMode: VideoOutput.PreserveAspectFit
                    visible: !!callEngine.remoteScreen
                }

                // Камера собеседника: крупно, а при его демке — мини-окном слева снизу
                Rectangle {
                    readonly property bool pip: !!callEngine.remoteScreen
                    visible: !!callEngine.remoteVideo
                    x: pip ? 12 : 0
                    y: pip ? parent.height - height - 12 : 0
                    width:  pip ? 176 : parent.width
                    height: pip ? 118 : parent.height
                    z: pip ? 2 : 0
                    radius: pip ? 10 : 0
                    color: pip ? themeManager.railColor : "transparent"
                    border.width: pip ? 1 : 0; border.color: themeManager.borderColor
                    clip: true
                    VideoOutput {
                        id: remoteOut
                        anchors.fill: parent; anchors.margins: parent.pip ? 1 : 0
                        fillMode: parent.pip ? VideoOutput.PreserveAspectCrop
                                             : VideoOutput.PreserveAspectFit
                    }
                }

                // Его камера и экран выключены — аватар по центру
                Column {
                    anchors.centerIn: parent
                    spacing: 12
                    visible: !callEngine.remoteVideo && !callEngine.remoteScreen
                    AnimatedAvatar {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 96; height: 96
                        displayName: callEngine.peerName.length > 0 ? callEngine.peerName : "?"
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "Камера выключена"
                        color: themeManager.textFaintColor; font.pixelSize: 13
                    }
                }

                // PiP — моя камера (зеркально, как в Discord)
                Rectangle {
                    visible: !!videoEngine.active
                    anchors.right: parent.right; anchors.bottom: parent.bottom
                    anchors.margins: 12
                    width: 176; height: 118; radius: 10
                    color: themeManager.railColor
                    border.color: themeManager.borderColor; border.width: 1
                    clip: true
                    VideoOutput {
                        id: localOut
                        anchors.fill: parent; anchors.margins: 1
                        fillMode: VideoOutput.PreserveAspectCrop
                        transform: Scale { origin.x: localOut.width / 2; xScale: -1 }
                    }
                }

                // Имя + статус поверх видео (слева сверху, плашкой)
                Rectangle {
                    anchors.left: parent.left; anchors.top: parent.top; anchors.margins: 12
                    radius: 8; color: themeManager.rgba(0, 0, 0, 0.45)
                    width: capRow.implicitWidth + 20; height: 30
                    Row {
                        id: capRow
                        anchors.centerIn: parent; spacing: 8
                        Text { text: callEngine.peerName.length > 0 ? callEngine.peerName : "Собеседник"
                            anchors.verticalCenter: parent.verticalCenter
                            color: "#ffffff"; font.pixelSize: 13; font.bold: true }
                        Text { text: root.statusText
                            anchors.verticalCenter: parent.verticalCenter
                            color: themeManager.rgba(255, 255, 255, 0.72); font.pixelSize: 12 }
                    }
                }
            }
        }

        // Локальный VideoOutput обязан существовать и вне videoMode (синк отдан навсегда),
        // но когда PiP скрыт — он нулевого размера внутри невидимой зоны, ничего не рисует.

        // ── АУДИО-РАСКЛАДКА (без видео) ─────────────────────────────────
        ColumnLayout {
            Layout.fillWidth: true; Layout.fillHeight: true
            visible: !root.videoMode
            spacing: 0

            Item { Layout.fillWidth: true; Layout.preferredHeight: 44 }

            // Аватар + пульс входящего
            Item {
                Layout.alignment: Qt.AlignHCenter
                width: 120; height: 120
                Rectangle {
                    anchors.centerIn: parent; width: 104; height: 104; radius: 52
                    color: "transparent"; border.color: themeManager.accentColor; border.width: 2
                    opacity: 0
                    SequentialAnimation on opacity {
                        running: root.incoming && root.visible && !themeManager.reducedMotion; loops: Animation.Infinite
                        NumberAnimation { from: 0.55; to: 0.0; duration: 1300; easing.type: Easing.OutCubic } }
                    SequentialAnimation on scale {
                        running: root.incoming && root.visible && !themeManager.reducedMotion; loops: Animation.Infinite
                        NumberAnimation { from: 1.0; to: 1.4; duration: 1300; easing.type: Easing.OutCubic } }
                }
                AnimatedAvatar {
                    anchors.centerIn: parent; width: 96; height: 96
                    displayName: callEngine.peerName.length > 0 ? callEngine.peerName : "?"
                }
            }

            Item { Layout.preferredHeight: 20 }
            Text { Layout.alignment: Qt.AlignHCenter
                text: callEngine.peerName.length > 0 ? callEngine.peerName : "Собеседник"
                color: themeManager.textColor; font.pixelSize: 20; font.bold: true }
            Text { Layout.alignment: Qt.AlignHCenter; text: root.statusText
                color: themeManager.textMutedColor; font.pixelSize: 14 }

            Item { Layout.fillHeight: true }
        }

        // ── УПРАВЛЕНИЕ (общее для обоих режимов) ────────────────────────
        RowLayout {
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: root.videoMode ? 16 : 32
            spacing: 20

            // Входящий: принять / отклонить
            CallBtn {
                visible: root.incoming
                icon: "phone"; bg: themeManager.successColor; fg: themeManager.accentTextColor
                onClicked: callEngine.acceptCall()
            }
            CallBtn {
                visible: root.incoming
                icon: "phone-off"; bg: themeManager.dangerColor; fg: themeManager.accentTextColor
                onClicked: callEngine.rejectCall()
            }

            // Активный/исходящий: mute / камера / выход
            CallBtn {
                visible: !root.incoming
                icon: voiceEngine.muted ? "mic-off" : "mic"
                bg: voiceEngine.muted ? themeManager.dangerColor : themeManager.inputColor
                fg: voiceEngine.muted ? themeManager.accentTextColor : themeManager.textColor
                onClicked: voiceEngine.toggleMute()
            }
            CallBtn {
                visible: !root.incoming
                icon: videoEngine.cameraActive ? "video" : "video-off"
                bg: videoEngine.cameraActive ? themeManager.accentColor : themeManager.inputColor
                fg: videoEngine.cameraActive ? themeManager.accentTextColor : themeManager.textColor
                onClicked: callEngine.toggleCamera()
            }
            // Демонстрация экрана (Фаза D) — работает вместе с камерой
            CallBtn {
                visible: !root.incoming
                icon: "screen"
                bg: videoEngine.screenActive ? themeManager.accentColor : themeManager.inputColor
                fg: videoEngine.screenActive ? themeManager.accentTextColor : themeManager.textColor
                onClicked: callEngine.toggleScreen()
            }
            CallBtn {
                visible: !root.incoming
                icon: "phone-off"; bg: themeManager.dangerColor; fg: themeManager.accentTextColor
                onClicked: callEngine.hangup()
            }
        }
    }
}
