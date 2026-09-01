import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "qrc:/qml/components"

Item {
    id: root

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            orientation: Gradient.Vertical
            GradientStop { position: 0.0; color: Qt.darker(themeManager.backgroundColor, 1.3) }
            GradientStop { position: 1.0; color: themeManager.backgroundColor }
        }
    }

    Rectangle {
        width: 340; height: 340; radius: 170; x: -80; y: -60
        color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                       themeManager.accentColor.b, 0.07)
    }
    Rectangle {
        width: 260; height: 260; radius: 130
        x: parent.width - 140; y: parent.height - 140
        color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                       themeManager.accentColor.b, 0.05)
    }

    // Карточка
    Rectangle {
        width: 400
        height: cardCol.implicitHeight + 56
        anchors.centerIn: parent
        radius: 16
        color: Qt.rgba(themeManager.backgroundColor.r, themeManager.backgroundColor.g,
                       themeManager.backgroundColor.b, 0.94)
        border.color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                               themeManager.accentColor.b, 0.28)
        border.width: 1

        ColumnLayout {
            id: cardCol
            anchors { left: parent.left; right: parent.right; top: parent.top
                      margins: 36; topMargin: 36 }
            spacing: 14

            // Логотип
            Text {
                text: "V"; font.pixelSize: 38; font.bold: true
                color: themeManager.accentColor; Layout.alignment: Qt.AlignHCenter
            }
            Text {
                text: isRegister ? "Создать аккаунт" : "Добро пожаловать"
                font.pixelSize: 20; font.bold: true
                color: themeManager.textColor; Layout.alignment: Qt.AlignHCenter
            }

            Text {
                text: isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"
                font.pixelSize: 13; color: themeManager.accentColor
                Layout.alignment: Qt.AlignHCenter
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        isRegister = !isRegister
                        errorLabel.text = ""
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; height: 1
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.1) }

            // Переключатель: показать поле адреса сервера
            Text {
                text: serverRow.visible ? "▾ Адрес сервера" : "▸ Адрес сервера"
                font.pixelSize: 12
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.55)
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                    onClicked: serverRow.visible = !serverRow.visible }
            }

            // Поле: адрес сервера
            Rectangle {
                id: serverRow
                Layout.fillWidth: true; height: 44; radius: 8
                visible: false
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.07)
                border.color: serverField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                        themeManager.textColor.b, 0.18)
                border.width: 1
                TextField {
                    id: serverField; anchors.fill: parent
                    leftPadding: 14
                    text: appState.serverAddress
                    placeholderText: "192.168.0.5:8080 или https://xxx.trycloudflare.com"
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                  themeManager.textColor.b, 0.4)
                    enabled: !appState.loginPending
                }
            }

            // Поле: имя пользователя
            Rectangle {
                Layout.fillWidth: true; height: 44; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.07)
                border.color: usernameField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                        themeManager.textColor.b, 0.18)
                border.width: 1
                Behavior on border.color { ColorAnimation { duration: 120 } }
                TextField {
                    id: usernameField; anchors.fill: parent
                    leftPadding: 14; placeholderText: "Имя пользователя"
                    color: themeManager.textColor; font.pixelSize: 14; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                  themeManager.textColor.b, 0.4)
                    enabled: !appState.loginPending
                }
            }

            // Поле: отображаемое имя (только при регистрации)
            Rectangle {
                Layout.fillWidth: true; height: 44; radius: 8
                visible: isRegister
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.07)
                border.color: displayField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                        themeManager.textColor.b, 0.18)
                border.width: 1
                TextField {
                    id: displayField; anchors.fill: parent
                    leftPadding: 14; placeholderText: "Отображаемое имя"
                    color: themeManager.textColor; font.pixelSize: 14; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                  themeManager.textColor.b, 0.4)
                    enabled: !appState.loginPending
                }
            }

            // Поле: пароль
            Rectangle {
                Layout.fillWidth: true; height: 44; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                               themeManager.textColor.b, 0.07)
                border.color: passwordField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                        themeManager.textColor.b, 0.18)
                border.width: 1
                Behavior on border.color { ColorAnimation { duration: 120 } }
                TextField {
                    id: passwordField; anchors.fill: parent
                    leftPadding: 14; placeholderText: "Пароль"
                    echoMode: TextInput.Password
                    color: themeManager.textColor; font.pixelSize: 14; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                  themeManager.textColor.b, 0.4)
                    Keys.onReturnPressed: root.doLogin()
                    enabled: !appState.loginPending
                }
            }

            // Ошибка / статус
            Text {
                id: errorLabel; text: ""
                color: text.startsWith("⏳") ? themeManager.accentColor : themeManager.dangerColor
                font.pixelSize: 12; Layout.fillWidth: true
                wrapMode: Text.WordWrap; visible: text !== ""
            }

            // Пользовательское соглашение (только при регистрации)
            RowLayout {
                Layout.fillWidth: true; spacing: 8
                visible: isRegister
                Rectangle {
                    width: 20; height: 20; radius: 5
                    Layout.alignment: Qt.AlignTop
                    color: tosAccepted ? themeManager.accentColor : "transparent"
                    border.width: 1
                    border.color: tosAccepted ? themeManager.accentColor
                                  : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                            themeManager.textColor.b, 0.4)
                    Text { anchors.centerIn: parent; text: "✓"; visible: tosAccepted
                        color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: tosAccepted = !tosAccepted }
                }
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                    text: "Я принимаю <a href='#'>пользовательское соглашение</a>"
                    textFormat: Text.StyledText
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                   themeManager.textColor.b, 0.7)
                    linkColor: themeManager.accentColor
                    onLinkActivated: tosPopup.open()
                }
            }

            // Кнопка
            Rectangle {
                Layout.fillWidth: true; height: 44; radius: 8
                opacity: appState.loginPending ? 0.6 : 1.0
                color: loginMa.pressed ? Qt.darker(themeManager.accentColor, 1.2)
                       : (loginMa.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1)
                                                : themeManager.accentColor)
                Behavior on color { ColorAnimation { duration: 110 } }
                Text { anchors.centerIn: parent
                    text: appState.loginPending
                          ? "⏳ Загрузка..."
                          : (isRegister ? "Зарегистрироваться" : "Войти")
                    color: themeManager.accentTextColor; font.pixelSize: 15; font.bold: true }
                MouseArea { id: loginMa; anchors.fill: parent
                    hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                    enabled: !appState.loginPending
                    onClicked: root.doLogin() }
            }

            ThemeSwitcher { Layout.alignment: Qt.AlignHCenter }
            Item { height: 4 }
        }
    }

    // Подписка на результат авторизации
    Connections {
        target: appState
        function onAuthChanged() {
            if (!appState.loginPending) {
                if (appState.loginError !== "")
                    errorLabel.text = appState.loginError
                else
                    errorLabel.text = ""
            }
        }
    }

    property bool isRegister: false
    property bool tosAccepted: false

    function doLogin() {
        errorLabel.text = ""
        // Применяем адрес сервера перед авторизацией
        appState.setServerAddress(serverField.text)
        if (usernameField.text.length < 3) {
            errorLabel.text = "Имя пользователя: минимум 3 символа"
            return
        }
        if (passwordField.text.length < 8) {
            errorLabel.text = "Пароль: минимум 8 символов"
            return
        }
        if (isRegister && !tosAccepted) {
            errorLabel.text = "Примите пользовательское соглашение"
            return
        }
        if (isRegister) {
            var name = displayField.text.trim()
            appState.registerUser(usernameField.text, passwordField.text,
                                  name !== "" ? name : usernameField.text)
        } else {
            appState.login(usernameField.text, passwordField.text)
        }
    }

    // ── Пользовательское соглашение ──
    Popup {
        id: tosPopup
        parent: Overlay.overlay
        anchors.centerIn: parent
        modal: true; dim: true
        width: 460; height: 520; padding: 0
        enter: Transition {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(180) }
            NumberAnimation { property: "scale"; from: 0.95; to: 1; duration: themeManager.animDuration(220); easing.type: Easing.OutCubic } }
        exit: Transition {
            NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(140) }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: themeManager.animDuration(140) } }
        background: Rectangle { radius: 16; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1 }

        contentItem: ColumnLayout {
            spacing: 0
            Text {
                Layout.fillWidth: true; Layout.margins: 20; Layout.bottomMargin: 8
                text: "Пользовательское соглашение"
                color: themeManager.textColor; font.pixelSize: 18; font.bold: true
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: themeManager.borderColor }
            ScrollView {
                Layout.fillWidth: true; Layout.fillHeight: true
                Layout.margins: 20; clip: true
                Text {
                    width: tosPopup.width - 56
                    wrapMode: Text.WordWrap; textFormat: Text.StyledText
                    color: themeManager.textMutedColor; font.pixelSize: 13; lineHeight: 1.25
                    text: "Используя Vicinity, вы соглашаетесь с условиями ниже.<br><br>" +
                          "<b>1. Аккаунт.</b> Вы отвечаете за сохранность логина и пароля и за действия под своим аккаунтом.<br><br>" +
                          "<b>2. Поведение.</b> Запрещены спам, оскорбления, угрозы, незаконный контент и любые действия, нарушающие законы РФ.<br><br>" +
                          "<b>3. Контент.</b> Ответственность за отправленные сообщения, файлы и аватары несёте вы. Администрация может удалять нарушающий контент и блокировать аккаунты.<br><br>" +
                          "<b>4. Данные.</b> Сообщения, профиль и загруженные файлы хранятся на сервере, который держит владелец сервера. Не передавайте здесь чувствительные данные.<br><br>" +
                          "<b>5. Без гарантий.</b> Сервис предоставляется «как есть», без гарантий доступности и сохранности данных. Авторы не несут ответственности за возможные убытки.<br><br>" +
                          "<b>6. Возраст.</b> Используя сервис, вы подтверждаете, что вам исполнилось 13 лет.<br><br>" +
                          "Продолжая регистрацию, вы принимаете эти условия."
                }
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: themeManager.borderColor }
            Rectangle {
                Layout.fillWidth: true; Layout.preferredHeight: 56; color: "transparent"
                Rectangle {
                    anchors.centerIn: parent
                    width: 200; height: 38; radius: 9
                    color: okMa.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                    scale: okMa.pressed ? 0.96 : 1.0
                    Behavior on scale { NumberAnimation { duration: themeManager.animDuration(140); easing.type: Easing.OutCubic } }
                    Text { anchors.centerIn: parent; text: "Принимаю"
                        color: themeManager.accentTextColor; font.pixelSize: 14; font.bold: true }
                    MouseArea { id: okMa; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: { root.tosAccepted = true; tosPopup.close() } }
                }
            }
        }
    }
}
