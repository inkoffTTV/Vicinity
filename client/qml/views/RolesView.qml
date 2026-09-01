import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"

// Раздел настроек «Роли» (встраивается в SettingsView)
Item {
    id: root
    anchors.fill: parent

    property string newName:  ""
    property string newColor: "#5865f2"
    property string newIcon:  ""
    property int    newTier:  0
    property string roleErr:  ""

    ListModel { id: rolesModel }

    function reload() { roleErr = ""; appState.loadRoles() }
    Component.onCompleted: reload()

    Connections {
        target: appState
        function onRolesReady(roles) {
            rolesModel.clear()
            for (var i = 0; i < roles.length; i++) {
                var r = roles[i]
                rolesModel.append({
                    rId: r.id, rName: r.name, rColor: r.color,
                    rIcon: r.icon, isPremium: r.isPremium, assigned: r.assigned
                })
            }
        }
        function onRoleError(message) { root.roleErr = message }
    }

    ColumnLayout {
        anchors.fill: parent; spacing: 0

        // ── Создать роль ─────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                           themeManager.accentColor.b, 0.05)
            border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                   themeManager.accentColor.b, 0.15)
            border.width: 1
            height: createCol.implicitHeight + 28
            opacity: appState.isDeveloper ? 1.0 : 0.45

            Rectangle {
                anchors.fill: parent; z: 10
                visible: !appState.isDeveloper
                color: "transparent"
                Text {
                    anchors.centerIn: parent
                    text: "🔒 Создание ролей доступно только разработчикам\n(developer = 1 в базе данных)"
                    color: themeManager.textColor; font.pixelSize: 12
                    horizontalAlignment: Text.AlignHCenter
                }
            }

            Column {
                id: createCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                spacing: 10
                enabled: appState.isDeveloper

                Text { text: "СОЗДАТЬ РОЛЬ"; font.pixelSize: 10; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.5) }

                Row { spacing: 8; width: parent.width
                    Rectangle {
                        width: parent.width - 76; height: 38; radius: 8
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.07)
                        border.color: nf.activeFocus ? themeManager.accentColor
                                      : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                themeManager.textColor.b, 0.14); border.width: 1
                        TextField { id: nf; anchors.fill: parent; leftPadding: 12
                            placeholderText: "Название роли..."
                            color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                            onTextChanged: root.newName = text }
                    }
                    Rectangle {
                        width: 60; height: 38; radius: 8
                        opacity: appState.subscriptionTier >= 1 ? 1.0 : 0.4
                        color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.07)
                        border.color: iconF.activeFocus ? themeManager.accentColor
                                      : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                themeManager.textColor.b, 0.14); border.width: 1
                        TextField { id: iconF; anchors.fill: parent
                            horizontalAlignment: Text.AlignHCenter
                            placeholderText: appState.subscriptionTier >= 1 ? "🏷" : "🔒"
                            color: themeManager.textColor; font.pixelSize: 16; background: Item {}
                            enabled: appState.subscriptionTier >= 1
                            onTextChanged: root.newIcon = text }
                    }
                }

                Text { text: "ЦВЕТ"; font.pixelSize: 9; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.4) }
                Flow { width: parent.width; spacing: 6
                    Repeater {
                        model: ["#f23f43","#e67e22","#f1c40f","#57f287","#1abc9c",
                                "#00b0f4","#5865f2","#9b59b6","#eb459e","#95a5a6","#f0f0f0","#ffd700"]
                        Rectangle {
                            width: 26; height: 26; radius: 13; color: modelData
                            border.color: root.newColor === modelData ? themeManager.accentTextColor : "transparent"
                            border.width: 2
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: root.newColor = modelData }
                        }
                    }
                }

                Text { text: "ТИП ДОСТУПА"; font.pixelSize: 9; font.bold: true
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.4) }
                Row { spacing: 6
                    Repeater {
                        model: [
                            { label: "Бесплатная", req: 0 },
                            { label: "Basic+",     req: 1 },
                            { label: "Standard+",  req: 2 },
                            { label: "Ultra",      req: 3 }
                        ]
                        Rectangle {
                            property bool sel:   root.newTier === index
                            property bool avail: appState.subscriptionTier >= modelData.req
                            height: 28; radius: 14; width: tierTxt.implicitWidth + 16
                            color: sel ? Qt.rgba(themeManager.accentColor.r,
                                                 themeManager.accentColor.g,
                                                 themeManager.accentColor.b, 0.3)
                                       : Qt.rgba(themeManager.textColor.r,
                                                 themeManager.textColor.g,
                                                 themeManager.textColor.b, 0.07)
                            border.color: sel ? themeManager.accentColor : "transparent"; border.width: 1
                            opacity: avail ? 1.0 : 0.38
                            Text { id: tierTxt; anchors.centerIn: parent
                                text: modelData.req > 0 ? "🔒 " + modelData.label : modelData.label
                                color: themeManager.textColor; font.pixelSize: 11 }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: { if (appState.subscriptionTier >= modelData.req)
                                                root.newTier = index } }
                        }
                    }
                }

                Rectangle {
                    width: 150; height: 34; radius: 8
                    color: crtMa.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1)
                                               : themeManager.accentColor
                    Behavior on color { ColorAnimation { duration: 100 } }
                    Text { anchors.centerIn: parent; text: "Создать роль"
                        color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                    MouseArea { id: crtMa; anchors.fill: parent
                        hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            root.roleErr = ""
                            if (!appState.isDeveloper) {
                                root.roleErr = "Создавать роли может только разработчик (developer = 1)"; return
                            }
                            if (root.newName.trim().length < 1) {
                                root.roleErr = "Введите название роли"; return
                            }
                            if (root.newTier > appState.subscriptionTier) {
                                root.roleErr = "Недостаточный уровень подписки для этого типа роли"; return
                            }
                            appState.createRole(root.newName.trim(), root.newColor,
                                                root.newIcon, root.newTier)
                            nf.text = ""; iconF.text = ""
                            root.newName = ""; root.newIcon = ""
                        }
                    }
                }

                Text {
                    visible: root.roleErr !== ""
                    text: "⚠ " + root.roleErr
                    color: themeManager.dangerColor; font.pixelSize: 11; wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
        }

        // ── Список ролей ─────────────────────────────────────────
        Text {
            leftPadding: 16; topPadding: 12; bottomPadding: 6
            text: "ВСЕ РОЛИ (" + rolesModel.count + ")"
            color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                           themeManager.textColor.b, 0.5)
            font.pixelSize: 10; font.bold: true
        }

        ListView {
            Layout.fillWidth: true; Layout.fillHeight: true
            clip: true; model: rolesModel; spacing: 2; bottomMargin: 8

            delegate: Rectangle {
                width: ListView.view.width - 32; height: 48; radius: 8
                anchors.horizontalCenter: parent ? parent.horizontalCenter : undefined
                property bool canAssign: appState.subscriptionTier >= isPremium
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, assigned ? 0.08 : 0.04)
                border.color: assigned
                              ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                        themeManager.accentColor.b, 0.3) : "transparent"
                border.width: 1

                Row {
                    anchors { fill: parent; leftMargin: 14; rightMargin: 12 }
                    spacing: 10

                    Rectangle {
                        width: 12; height: 12; radius: 6; color: rColor
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Text { text: rIcon; font.pixelSize: 15; color: rColor; visible: rIcon !== ""
                        anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        text: rName; color: rColor; font.pixelSize: 14; font.bold: true
                        anchors.verticalCenter: parent.verticalCenter
                        width: parent.width - 160; elide: Text.ElideRight
                    }
                    Rectangle {
                        visible: isPremium > 0; anchors.verticalCenter: parent.verticalCenter
                        height: 18; radius: 9; width: pBadge.implicitWidth + 12
                        color: isPremium === 1 ? "#424242" : isPremium === 2 ? "#0d47a1" : "#4a148c"
                        Text { id: pBadge; anchors.centerIn: parent
                            text: ["","Basic","Standard","Ultra"][isPremium]
                            color: themeManager.accentTextColor; font.pixelSize: 9 }
                    }
                    Rectangle {
                        anchors.verticalCenter: parent.verticalCenter
                        width: 82; height: 28; radius: 7
                        color: assigned ? Qt.rgba(1,0.42,0.42,0.14)
                             : canAssign ? Qt.rgba(themeManager.accentColor.r,
                                           themeManager.accentColor.g,
                                           themeManager.accentColor.b, 0.18)
                             : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                       themeManager.textColor.b, 0.06)
                        border.color: assigned ? themeManager.dangerColor
                                    : canAssign ? themeManager.accentColor : "transparent"
                        border.width: 1
                        opacity: canAssign ? 1.0 : 0.4
                        Text { anchors.centerIn: parent
                            text: assigned ? "Снять" : canAssign ? "Взять роль" : "🔒"
                            color: assigned ? themeManager.dangerColor
                                 : canAssign ? themeManager.accentColor
                                 : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                           themeManager.textColor.b, 0.4)
                            font.pixelSize: 11; font.bold: true }
                        MouseArea { anchors.fill: parent
                            cursorShape: canAssign ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: {
                                if (!canAssign) return
                                var wasAssigned = assigned
                                // Оптимистичное обновление UI
                                for (var i = 0; i < rolesModel.count; i++)
                                    rolesModel.setProperty(i, "assigned", false)
                                if (!wasAssigned) {
                                    rolesModel.setProperty(index, "assigned", true)
                                    appState.setRole(rName, rColor)
                                    appState.assignRole(rId)
                                } else {
                                    appState.setRole("", "")
                                    appState.unassignRole(rId)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
