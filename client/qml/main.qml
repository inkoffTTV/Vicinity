import QtQuick 2.15
import QtQuick.Controls 2.15
import "qrc:/qml/components"
import "qrc:/qml/format.js" as Fmt

ApplicationWindow {
    id: root
    visible: true
    width: 1100
    height: 720
    minimumWidth: 820
    minimumHeight: 560
    title: "Vicinity"
    color: themeManager.backgroundColor

    // Градиентный фон интерфейса (опция в «Внешний вид»)
    GradientRect {
        anchors.fill: parent
        visible: themeManager.bgGradientEnabled
        spec: Fmt.parse(themeManager.bgGradientJson,
                        ({type:"linear",angle:135,stops:[{pos:0,color:"#1a1a2e"},{pos:1,color:"#16213e"}]}))
    }

    Loader {
        id: viewLoader
        anchors.fill: parent
        source: appState.authenticated
                ? "qrc:/qml/views/ChatView.qml"
                : "qrc:/qml/views/LoginView.qml"

        // Плавное появление экрана при смене (вход/выход) — декларативно от статуса
        opacity: status === Loader.Ready ? 1 : 0
        scale:   status === Loader.Ready ? 1 : 0.985
        Behavior on opacity { NumberAnimation { duration: themeManager.animDuration(280); easing.type: Easing.OutCubic } }
        Behavior on scale   { NumberAnimation { duration: themeManager.animDuration(280); easing.type: Easing.OutCubic } }
        onStatusChanged: if (status === Loader.Error) console.error("Loader error:", sourceComponent)
    }
}
