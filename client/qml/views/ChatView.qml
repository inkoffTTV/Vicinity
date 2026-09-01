import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Dialogs
import "qrc:/qml/components"

Item {
    id: root

    ListModel { id: channelModel }
    ListModel { id: dmModel }
    ListModel { id: messageModel }
    ListModel { id: searchModel }
    ListModel { id: serverModel }
    ListModel { id: serverChannelModel }
    ListModel { id: memberModel }
    ListModel { id: rolesModel }   // все роли (для меню «выдать роль»)

    property int    activeChannelId:   0
    property string activeChannelName: ""
    property bool   activeIsDm:        false
    property int    activeDmUserId:    0     // id собеседника в активной личке (для профиля из шапки)
    property var    unreadMap:         ({})  // {channelId: true} — непрочитанные чаты
    property int    unreadTick:        0     // меняем, чтобы пересчитать биндинги непрочитанного
    property int    activeServerId:    0     // 0 = дом (личка + каналы)
    property string activeServerName:  ""
    property string activeServerInvite: ""   // инвайт-код активного сервера
    property int    activeServerOwner: 0     // id владельца активного сервера
    property bool   iAmServerOwner: activeServerOwner > 0 && activeServerOwner === appState.userId
    property bool   showMembers:       true  // показывать панель участников на сервере
    property var    ctxMember:         ({})  // участник под правым кликом
    property int    myVoiceChannel:    0     // голосовой канал, в котором я сейчас
    property string myVoiceName:       ""
    property var    voiceMembers:      ({})  // channelId -> [{id,name,speaking}]
    property int    voiceTick:         0     // дёргаем при изменении voiceMembers (для биндингов)

    // ── Данные с сервера ───────────────────────────────────────────────────────
    Connections {
        target: appState

        function onAuthChanged() {
            if (appState.authenticated) {
                appState.loadChannels(); appState.loadDms(); appState.loadServers()
                networkManager.connectToServer(appState.wsUrl(), appState.authToken())
            } else {
                networkManager.disconnectFromServer()
            }
        }

        function onChannelsReady(channels) {
            channelModel.clear()
            for (var i = 0; i < channels.length; i++)
                channelModel.append({ chName: "# " + channels[i].name, chId: channels[i].id })
        }

        function onDmsReady(dms) {
            dmModel.clear()
            for (var i = 0; i < dms.length; i++)
                dmModel.append({ dmName: dms[i].displayName, dmId: dms[i].channelId,
                                 dmAvatar: dms[i].avatar, dmUserId: dms[i].userId,
                                 dmHandle: dms[i].username ? dms[i].username : "" })
        }

        function onDmStarted(channelId, displayName, userId) {
            root.activeServerId = 0
            root.openConversation(channelId, displayName, true, userId)
        }

        // Свой текст получил серверный id → допишем его в оптимистичную строку
        function onMessageSent(channelId, msgId) {
            if (channelId !== root.activeChannelId) return
            for (var i = messageModel.count - 1; i >= 0; i--) {
                var it = messageModel.get(i)
                if (it.own === true && it.msgId === 0) {
                    messageModel.setProperty(i, "msgId", parseInt(msgId)); break
                }
            }
        }

        // Своё вложение загружено и отправлено → показать в ленте
        function onAttachmentSent(channelId, msgId, attachUrl) {
            if (channelId !== root.activeChannelId) return
            messageModel.append({
                author: appState.displayName, authorId: appState.userId, txt: "",
                ts: Qt.formatTime(new Date(), "hh:mm"),
                own: true, av: appState.avatarPath, rc: appState.roleColor,
                msgId: parseInt(msgId), edited: false, attach: attachUrl, rx: "[]",
                grp: (messageModel.count > 0 && messageModel.get(messageModel.count - 1).authorId === appState.userId)
            })
            msgList.toBottom()
        }

        function onUsersFound(users) {
            searchModel.clear()
            for (var i = 0; i < users.length; i++)
                searchModel.append({ uId: users[i].id, uName: users[i].displayName,
                                     uTag: users[i].username, uAvatar: users[i].avatar })
        }

        function onServersReady(servers) {
            serverModel.clear()
            for (var i = 0; i < servers.length; i++)
                serverModel.append({ sId: servers[i].id, sName: servers[i].name,
                                     sInvite: servers[i].inviteCode, sOwner: servers[i].ownerId })
            // обновить инвайт-код активного сервера, если он в списке
            if (root.activeServerId > 0) root.refreshActiveInvite()
        }

        function onServerMembersReady(serverId, members) {
            if (serverId !== root.activeServerId) return
            memberModel.clear()
            for (var i = 0; i < members.length; i++)
                memberModel.append(members[i])
        }

        function onMembersChanged() {
            if (root.activeServerId > 0) appState.loadServerMembers(root.activeServerId)
        }

        function onRolesReady(roles) {
            rolesModel.clear()
            for (var i = 0; i < roles.length; i++)
                rolesModel.append({ rId: roles[i].id, rName: roles[i].name, rColor: roles[i].color })
        }

        function onServerChannelsReady(serverId, channels) {
            if (serverId !== root.activeServerId) return
            serverChannelModel.clear()
            for (var i = 0; i < channels.length; i++)
                serverChannelModel.append({ scId: channels[i].id, scName: channels[i].name,
                                            scVoice: channels[i].isVoice, membersStr: "", memberCount: 0 })
            // Запросить текущее присутствие в голосовых каналах сервера
            networkManager.sendMessage(JSON.stringify({ type: "voice_query", server_id: serverId }))
        }

        function onServerCreated(serverId, name) {
            root.selectServer(serverId, name)
        }

        function onMessagesReady(channelId, messages) {
            if (channelId !== root.activeChannelId) return
            messageModel.clear()
            // сервер отдаёт новейшие первыми → кладём в хронологическом порядке (старые сверху)
            for (var i = messages.length - 1; i >= 0; i--) {
                var mm = messages[i]
                mm.grp = (messageModel.count > 0 &&
                          messageModel.get(messageModel.count - 1).authorId === mm.authorId)
                messageModel.append(mm)
            }
            msgList.toBottom()
        }
    }

    Component.onCompleted: {
        if (appState.authenticated) {
            appState.loadChannels(); appState.loadDms(); appState.loadServers()
            networkManager.connectToServer(appState.wsUrl(), appState.authToken())
        }
    }

    // Входящие сообщения в реальном времени по WebSocket
    Connections {
        target: networkManager
        function onMessageReceived(m) {
            // Сигналинг звонков (WebRTC) → в CallEngine
            if (m.type === "call_invite" || m.type === "call_accept" || m.type === "rtc_ice" ||
                m.type === "call_reject" || m.type === "call_end" || m.type === "call_busy") {
                callEngine.handleSignal(m); return
            }
            if (m.type === "voice_state") {
                var arr = []
                if (m.users) for (var k = 0; k < m.users.length; k++)
                    arr.push({ id: m.users[k].user_id, name: m.users[k].name, speaking: false })
                root.voiceMembers[m.channel_id] = arr
                root.voiceTick++
                root.refreshVoiceRow(m.channel_id)
                return
            }
            if (m.type === "voice_speaking") {
                root.setSpeaking(m.user_id, m.speaking)
                return
            }
            if (m.type === "server_added") { appState.loadServers(); return }
            if (m.type === "channel_added") { appState.loadChannels(); appState.loadDms(); return }
            if (m.type === "server_removed") {
                if (root.activeServerId === parseInt(m.server_id)) root.selectHome()
                appState.loadServers(); return
            }
            if (m.type === "presence") {
                var uid = parseInt(m.user_id)
                for (var pi = 0; pi < memberModel.count; pi++)
                    if (memberModel.get(pi).id === uid) {
                        memberModel.setProperty(pi, "presence", String(m.presence)); break
                    }
                return
            }
            // ── Правки/удаление/реакции — применяем и к своим (сервер шлёт всем) ──
            if (m.type === "message_edited") {
                if (parseInt(m.channel_id) === root.activeChannelId) {
                    var ei = root.findMsg(m.id)
                    if (ei >= 0) { messageModel.setProperty(ei, "txt", String(m.text))
                                   messageModel.setProperty(ei, "edited", true) }
                }
                return
            }
            if (m.type === "message_deleted") {
                if (parseInt(m.channel_id) === root.activeChannelId) {
                    var di = root.findMsg(m.id)
                    if (di >= 0) {
                        messageModel.remove(di)
                        // строка, вставшая на место удалённой, могла потерять «шапку» группы
                        if (di < messageModel.count) {
                            var g = di > 0 && messageModel.get(di - 1).authorId === messageModel.get(di).authorId
                            messageModel.setProperty(di, "grp", g)
                        }
                    }
                }
                return
            }
            if (m.type === "reaction_update") {
                if (parseInt(m.channel_id) === root.activeChannelId) {
                    var ri = root.findMsg(m.message_id)
                    if (ri >= 0) {
                        var rxArr = []
                        if (m.reactions) for (var rq = 0; rq < m.reactions.length; rq++) {
                            var rr = m.reactions[rq]
                            var me = false
                            if (rr.users) for (var rw = 0; rw < rr.users.length; rw++)
                                if (parseInt(rr.users[rw]) === appState.userId) { me = true; break }
                            rxArr.push({ emoji: rr.emoji, count: rr.count, me: me })
                        }
                        messageModel.setProperty(ri, "rx", JSON.stringify(rxArr))
                    }
                }
                return
            }

            if (m.type !== "new_message") return
            if (m.author_id === appState.userId) return
            if (m.channel_id !== root.activeChannelId) {
                // Сообщение в неоткрытый чат: подтянуть список личек (вдруг это новый DM)
                // и пометить чат непрочитанным.
                appState.loadDms()
                root.markUnread(parseInt(m.channel_id))
                return
            }
            var ts = String(m.created_at)
            var wasAtBottom = msgList.atBottom
            var aid = parseInt(m.author_id)
            messageModel.append({
                author: m.author_name, authorId: aid,
                txt: m.text,
                ts: ts.length >= 16 ? ts.substring(11, 16) : ts,
                own: false, av: appState.mediaUrl(m.author_avatar ? m.author_avatar : ""), rc: "",
                msgId: parseInt(m.id), edited: false,
                attach: m.attachment && m.attachment.length ? appState.mediaUrl(m.attachment) : "",
                rx: "[]",
                grp: (messageModel.count > 0 && messageModel.get(messageModel.count - 1).authorId === aid)
            })
            if (wasAtBottom) msgList.toBottom()
        }
    }

    // Поиск строки модели по серверному id сообщения
    function findMsg(id) {
        var target = parseInt(id)
        for (var i = messageModel.count - 1; i >= 0; i--)
            if (messageModel.get(i).msgId === target) return i
        return -1
    }

    // Локальная детекция речи → серверу + своя подсветка
    Connections {
        target: voiceEngine
        function onSpeakingChanged(speaking) {
            if (root.myVoiceChannel === 0) return
            networkManager.sendMessage(JSON.stringify({ type: "voice_speaking", speaking: speaking }))
            root.setSpeaking(appState.userId, speaking)
        }
    }

    function openConversation(id, name, isDm, dmUserId) {
        root.activeChannelId   = id
        root.activeChannelName = name
        root.activeIsDm        = isDm
        // id собеседника (для 📞 и профиля из шапки): передан явно
        // или ищем по каналу в списке личек — иначе кнопка звонка мертва
        var uid = dmUserId || 0
        if (isDm && !uid)
            for (var i = 0; i < dmModel.count; i++)
                if (dmModel.get(i).dmId === id) { uid = dmModel.get(i).dmUserId; break }
        root.activeDmUserId = isDm ? uid : 0
        root.clearUnread(id)
        appState.loadMessages(id)
    }

    // ── Непрочитанные чаты (счётчик на канал) ──
    function markUnread(cid) {
        if (cid === root.activeChannelId || cid === 0) return
        root.unreadMap[cid] = (root.unreadMap[cid] || 0) + 1
        root.unreadTick++
    }
    function clearUnread(cid) {
        if (root.unreadMap[cid]) { delete root.unreadMap[cid]; root.unreadTick++ }
    }
    function isUnread(cid) {
        return root.unreadTick >= 0 && (root.unreadMap[cid] || 0) > 0
    }
    function unreadCount(cid) {
        return root.unreadTick >= 0 ? (root.unreadMap[cid] || 0) : 0
    }
    function rolesNamesOf(arr) {
        var n = []; if (arr) for (var i = 0; i < arr.length; i++) n.push(arr[i].name); return n
    }

    function selectHome() {
        root.activeServerId   = 0
        root.activeServerName = ""
    }

    function selectServer(id, name) {
        root.activeServerId   = id
        root.activeServerName = name
        serverChannelModel.clear()
        memberModel.clear()
        appState.loadServerChannels(id)
        appState.loadServerMembers(id)
        appState.loadRoles()
        root.refreshActiveInvite()
    }

    // Достать инвайт-код и владельца активного сервера из списка серверов
    function refreshActiveInvite() {
        root.activeServerInvite = ""
        root.activeServerOwner = 0
        for (var i = 0; i < serverModel.count; i++) {
            if (serverModel.get(i).sId === root.activeServerId) {
                root.activeServerInvite = serverModel.get(i).sInvite || ""
                root.activeServerOwner = serverModel.get(i).sOwner || 0
                break
            }
        }
    }

    // Перерисовать строку голосового канала из voiceMembers (id␟имя␟говорит)
    function refreshVoiceRow(channelId) {
        var arr = root.voiceMembers[channelId] || []
        var parts = []
        for (var i = 0; i < arr.length; i++)
            parts.push(arr[i].id + "␟" + arr[i].name + "␟" + (arr[i].speaking ? "1" : "0"))
        for (var j = 0; j < serverChannelModel.count; j++) {
            if (serverChannelModel.get(j).scId === channelId) {
                serverChannelModel.setProperty(j, "membersStr", parts.join("\n"))
                serverChannelModel.setProperty(j, "memberCount", arr.length)
                break
            }
        }
    }

    function setSpeaking(userId, speaking) {
        for (var ch in root.voiceMembers) {
            var arr = root.voiceMembers[ch]
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].id === userId) {
                    arr[i].speaking = speaking
                    refreshVoiceRow(parseInt(ch))
                    return
                }
            }
        }
    }

    function joinVoice(channelId, name) {
        if (root.myVoiceChannel === channelId) return
        networkManager.sendMessage(JSON.stringify({ type: "voice_join", channel_id: channelId }))
        root.myVoiceChannel = channelId
        root.myVoiceName    = name
        voiceEngine.start()     // включить микрофон + динамики
    }

    function leaveVoice() {
        if (root.myVoiceChannel === 0) return
        networkManager.sendMessage(JSON.stringify({ type: "voice_leave" }))
        root.myVoiceChannel = 0
        root.myVoiceName    = ""
        voiceEngine.stop()      // выключить аудио
    }

    // ── Layout ───────────────────────────────────────────────────────────────
    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ═══ РЕЛЬСА СЕРВЕРОВ ════════════════════════════════════════════════
        Rectangle {
            Layout.preferredWidth: 72
            Layout.fillHeight: true
            color: themeManager.railColor

            Column {
                anchors { top: parent.top; left: parent.left; right: parent.right; topMargin: 12 }
                spacing: 8

                // Дом (личные сообщения)
                Item {
                    width: parent.width; height: 48
                    Rectangle {  // пилюля активности
                        anchors.verticalCenter: parent.verticalCenter; x: 0
                        width: 4; radius: 2
                        height: root.activeServerId === 0 ? 40 : (homeHov.containsMouse ? 20 : 0)
                        color: themeManager.textColor
                        Behavior on height { NumberAnimation { duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
                    }
                    Rectangle {
                        anchors.centerIn: parent
                        width: 48; height: 48
                        property bool on: root.activeServerId === 0
                        radius: (on || homeHov.containsMouse) ? 16 : 24
                        Behavior on radius { NumberAnimation { duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
                        color: on ? themeManager.accentColor
                               : (homeHov.containsMouse ? themeManager.rgba(88,101,242,0.4) : themeManager.inputColor)
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(180) } }
                        AppIcon { anchors.centerIn: parent; name: "home"; size: 22
                            color: parent.on ? themeManager.accentTextColor : themeManager.textColor }
                        MouseArea { id: homeHov; anchors.fill: parent
                            hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                            onClicked: root.selectHome() }
                    }
                }

                Rectangle {
                    width: 32; height: 2; radius: 1; anchors.horizontalCenter: parent.horizontalCenter
                    color: themeManager.borderColor
                }

                // Иконки серверов
                Repeater {
                    model: serverModel
                    Item {
                        width: 72
                        height: 48
                        Rectangle {  // пилюля активности
                            anchors.verticalCenter: parent.verticalCenter; x: 0
                            width: 4; radius: 2
                            height: root.activeServerId === sId ? 40 : (srvHov.containsMouse ? 20 : 0)
                            color: themeManager.textColor
                            Behavior on height { NumberAnimation { duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
                        }
                        Rectangle {
                            anchors.centerIn: parent
                            width: 48; height: 48
                            property bool on: root.activeServerId === sId
                            radius: (on || srvHov.containsMouse) ? 16 : 24
                            Behavior on radius { NumberAnimation { duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
                            color: on ? themeManager.accentColor
                                   : (srvHov.containsMouse ? themeManager.rgba(88,101,242,0.4) : themeManager.inputColor)
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(180) } }
                            Text { anchors.centerIn: parent
                                text: sName.length > 0 ? sName[0].toUpperCase() : "?"
                                color: parent.on ? themeManager.accentTextColor : themeManager.textColor
                                font.pixelSize: 18; font.bold: true }
                            MouseArea { id: srvHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: root.selectServer(sId, sName) }
                        }
                    }
                }

                // Создать сервер
                Item {
                    width: parent.width; height: 48
                    Rectangle {
                        anchors.centerIn: parent
                        width: 48; height: 48; radius: addSrvHov.containsMouse ? 16 : 24
                        Behavior on radius { NumberAnimation { duration: themeManager.animDuration(200); easing.type: Easing.OutCubic } }
                        color: addSrvHov.containsMouse ? themeManager.rgba(87,242,135,0.18) : themeManager.inputColor
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(180) } }
                        AppIcon { anchors.centerIn: parent; name: "plus"; size: 22
                            color: addSrvHov.containsMouse ? themeManager.successColor : themeManager.successColor }
                        MouseArea { id: addSrvHov; anchors.fill: parent
                            hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                            onClicked: { srvNameField.text = ""; createServerPopup.open() } }
                    }
                }
            }
        }

        // ═══ САЙДБАР ════════════════════════════════════════════════════════
        Rectangle {
            Layout.preferredWidth: themeManager.sidebarWidth
            Layout.fillHeight: true
            color: themeManager.surfaceColor

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                Rectangle {
                    Layout.fillWidth: true; height: 56
                    color: themeManager.barColor
                    RowLayout {
                        anchors { fill: parent; leftMargin: 16; rightMargin: 12 }
                        Text {
                            text: root.activeServerId === 0 ? "Vicinity" : root.activeServerName
                            color: themeManager.textColor; font.pixelSize: 15; font.bold: true
                            elide: Text.ElideRight; Layout.fillWidth: true
                        }
                        // Тема/палитра переехали в Настройки → Внешний вид
                    }
                }

                // ═══ ДОМ: личка + каналы ═══════════════════════════════════
                ColumnLayout {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    spacing: 0
                    visible: root.activeServerId === 0

                    Item {
                        Layout.fillWidth: true; height: 38
                        AppIcon { name: "chevron-down"; size: 11; color: themeManager.textFaintColor
                            anchors { left: parent.left; leftMargin: 14; verticalCenter: parent.verticalCenter } }
                        Text {
                            text: "ЛИЧНЫЕ СООБЩЕНИЯ"
                            anchors { left: parent.left; leftMargin: 30; verticalCenter: parent.verticalCenter }
                            color: themeManager.textFaintColor
                            font.pixelSize: 11; font.bold: true
                        }
                        Rectangle {
                            width: 22; height: 22; radius: 5
                            anchors { right: parent.right; rightMargin: 10; verticalCenter: parent.verticalCenter }
                            color: addDmHov.containsMouse
                                   ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                             themeManager.accentColor.b, 0.2) : "transparent"
                            AppIcon { anchors.centerIn: parent; name: "search"; size: 15; color: themeManager.textMutedColor }
                            MouseArea { id: addDmHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: { searchModel.clear(); searchField.text = ""; userSearchPopup.open() } }
                        }
                    }

                    ListView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true; model: dmModel
                        spacing: 2
                        leftMargin: 8; rightMargin: 8; topMargin: 4
                        add: Transition {
                            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(200) } }
                        delegate: Rectangle {
                            width: ListView.view.width - 16; x: 8
                            height: 54; radius: 12
                            property bool active: dmId === root.activeChannelId
                            property bool unread: root.isUnread(dmId) && !active
                            color: active ? themeManager.rgba(255,255,255,0.08)
                                   : (dmHov.containsMouse ? themeManager.hoverColor : "transparent")
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(160); easing.type: Easing.OutCubic } }

                            // Левый индикатор: активный / непрочитанный
                            Rectangle {
                                anchors.verticalCenter: parent.verticalCenter; x: -4
                                width: 3; radius: 2
                                height: parent.active ? 30 : (parent.unread ? 18 : 0)
                                color: themeManager.accentColor
                                Behavior on height { NumberAnimation { duration: themeManager.animDuration(180); easing.type: Easing.OutCubic } }
                            }

                            // Клик по строке — открыть беседу (нижний слой)
                            MouseArea { id: dmHov; anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor; hoverEnabled: true
                                onClicked: root.openConversation(dmId, dmName, true, dmUserId) }

                            RowLayout {
                                anchors { fill: parent; leftMargin: 10; rightMargin: 12 }
                                spacing: 11
                                // Аватар — клик открывает профиль (верхний слой)
                                AnimatedAvatar {
                                    Layout.preferredWidth: 38; Layout.preferredHeight: 38
                                    Layout.alignment: Qt.AlignVCenter
                                    displayName: dmName; source: dmAvatar
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                        onClicked: profileCard.openFor(dmUserId) }
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true; spacing: 0
                                    Text {
                                        Layout.fillWidth: true; elide: Text.ElideRight
                                        text: dmName
                                        color: parent.parent.active ? themeManager.accentTextColor
                                               : (parent.parent.unread ? themeManager.textColor : themeManager.textMutedColor)
                                        font.pixelSize: 14; font.bold: !!(parent.parent.unread || parent.parent.active)
                                    }
                                    Text {
                                        Layout.fillWidth: true; elide: Text.ElideRight
                                        visible: dmHandle.length > 0
                                        text: "@" + dmHandle
                                        color: themeManager.textFaintColor; font.pixelSize: 11
                                    }
                                }
                                // Бейдж непрочитанных
                                Rectangle {
                                    visible: parent.parent.unread
                                    Layout.alignment: Qt.AlignVCenter
                                    Layout.preferredHeight: 20; Layout.preferredWidth: Math.max(20, badgeTxt.implicitWidth + 12); radius: 10
                                    color: themeManager.accentColor
                                    Text { id: badgeTxt; anchors.centerIn: parent
                                        text: { var n = root.unreadCount(dmId); return n > 99 ? "99+" : n }
                                        color: themeManager.accentTextColor; font.pixelSize: 11; font.bold: true }
                                }
                            }
                        }
                    }

                    // Секция «КАНАЛЫ» в личке убрана — вернём позже по-человечески
                    // (серверные каналы не тронуты).
                }

                // ═══ СЕРВЕР: текстовые + голосовые каналы ══════════════════
                ColumnLayout {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    spacing: 0
                    visible: root.activeServerId !== 0

                    Item {
                        Layout.fillWidth: true; height: 38
                        AppIcon { name: "chevron-down"; size: 11; color: themeManager.textFaintColor
                            anchors { left: parent.left; leftMargin: 14; verticalCenter: parent.verticalCenter } }
                        Text {
                            text: "КАНАЛЫ СЕРВЕРА"
                            anchors { left: parent.left; leftMargin: 30; verticalCenter: parent.verticalCenter }
                            color: themeManager.textFaintColor
                            font.pixelSize: 11; font.bold: true
                        }
                        Rectangle {
                            width: 22; height: 22; radius: 5
                            anchors { right: parent.right; rightMargin: 10; verticalCenter: parent.verticalCenter }
                            color: addScHov.containsMouse
                                   ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                             themeManager.accentColor.b, 0.2) : "transparent"
                            AppIcon { anchors.centerIn: parent; name: "plus"; size: 16; color: themeManager.textMutedColor }
                            MouseArea { id: addScHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: { scNameField.text = ""; scVoiceToggle.on = false; createSrvChPopup.open() } }
                        }
                    }

                    ListView {
                        Layout.fillWidth: true; Layout.fillHeight: true
                        clip: true; model: serverChannelModel
                        add: Transition {
                            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(200) } }
                        delegate: Column {
                            width: ListView.view.width
                            spacing: 0

                            Rectangle {
                                width: parent.width - 16; x: 8; height: 34; radius: 4
                                property bool active: scVoice ? (scId === root.myVoiceChannel)
                                                              : (scId === root.activeChannelId)
                                color: active ? themeManager.rgba(255,255,255,0.08)
                                       : (scHover.containsMouse ? themeManager.hoverColor : "transparent")
                                Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                                Row {
                                    anchors { left: parent.left; leftMargin: 8; right: parent.right; rightMargin: 26
                                              verticalCenter: parent.verticalCenter }
                                    spacing: 6
                                    AppIcon { name: scVoice ? "mic" : "hash"; size: 18
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: parent.parent.active ? themeManager.textColor : themeManager.textFaintColor }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: parent.width - 26; elide: Text.ElideRight
                                        text: scName + (scVoice && memberCount > 0 ? "  · " + memberCount : "")
                                        color: parent.parent.active ? themeManager.accentTextColor
                                               : (scHover.containsMouse ? themeManager.textColor : themeManager.textMutedColor)
                                        font.pixelSize: 15
                                    }
                                }
                                // Индикатор "я тут" для голосового
                                Rectangle {
                                    visible: scVoice && scId === root.myVoiceChannel
                                    width: 8; height: 8; radius: 4; color: themeManager.successColor
                                    anchors { right: parent.right; rightMargin: 12; verticalCenter: parent.verticalCenter }
                                }
                                MouseArea { id: scHover; anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor; hoverEnabled: true
                                    onClicked: {
                                        if (scVoice) {
                                            if (root.myVoiceChannel === scId) root.leaveVoice()
                                            else root.joinVoice(scId, scName)
                                        } else {
                                            root.openConversation(scId, scName, false)
                                        }
                                    }
                                }
                            }

                            // Участники голосового канала (presence + кто говорит)
                            Repeater {
                                model: (scVoice && memberCount > 0) ? membersStr.split("\n") : []
                                Row {
                                    anchors.left: parent.left
                                    anchors.leftMargin: 34
                                    height: 26; spacing: 7
                                    property var p: String(modelData).split("␟")  // [id, имя, говорит]
                                    property bool speaking: p.length > 2 && p[2] === "1"
                                    // Кольцо вокруг аватара, когда говорит — повторяет форму аватара
                                    Rectangle {
                                        width: 24; height: 24
                                        radius: 24 * themeManager.avatarRadiusRatio
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: "transparent"
                                        border.color: parent.speaking ? themeManager.successColor : "transparent"
                                        border.width: 2
                                        Behavior on border.color { ColorAnimation { duration: 200; easing.type: Easing.OutCubic } }
                                        AnimatedAvatar { width: 18; height: 18; anchors.centerIn: parent
                                            displayName: parent.parent.p.length > 1 ? parent.parent.p[1] : "?"
                                            source: "" }
                                    }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: parent.p.length > 1 ? parent.p[1] : ""
                                        color: parent.speaking ? themeManager.successColor
                                               : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                                                         themeManager.textColor.b, 0.7)
                                        font.pixelSize: 12; font.bold: parent.speaking
                                    }
                                }
                            }
                        }
                    }
                }

                // Панель голосового подключения
                Rectangle {
                    Layout.fillWidth: true; height: 40
                    visible: root.myVoiceChannel !== 0
                    color: themeManager.rgba(87,242,135,0.14)
                    RowLayout {
                        anchors { fill: parent; leftMargin: 14; rightMargin: 10 }
                        spacing: 8
                        AppIcon { name: "headphones"; size: 17; color: themeManager.successColor
                            Layout.alignment: Qt.AlignVCenter }
                        ColumnLayout {
                            spacing: 0; Layout.fillWidth: true
                            Text { text: "Голосовой подключён"; color: themeManager.successColor
                                font.pixelSize: 11; font.bold: true }
                            Text { text: root.myVoiceName; color: Qt.rgba(themeManager.textColor.r,
                                   themeManager.textColor.g, themeManager.textColor.b, 0.6)
                                font.pixelSize: 10; elide: Text.ElideRight; Layout.fillWidth: true }
                        }
                        // Настройки голоса (устройства/громкость)
                        Rectangle {
                            width: 30; height: 30; radius: 6
                            color: vsHov.containsMouse
                                   ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                             themeManager.accentColor.b, 0.2) : "transparent"
                            Behavior on color { ColorAnimation { duration: 200; easing.type: Easing.OutCubic } }
                            AppIcon { anchors.centerIn: parent; name: "settings"; size: 16
                                color: themeManager.textColor }
                            MouseArea { id: vsHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: settings.openAt(3) }
                        }
                        // Выключить/включить микрофон
                        Rectangle {
                            width: 30; height: 30; radius: 6
                            color: voiceEngine.muted
                                   ? themeManager.rgba(255,107,107,0.2)
                                   : (muteHov.containsMouse
                                      ? Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g,
                                                themeManager.accentColor.b, 0.2) : "transparent")
                            Behavior on color { ColorAnimation { duration: 200; easing.type: Easing.OutCubic } }
                            AppIcon { anchors.centerIn: parent
                                name: voiceEngine.muted ? "mic-off" : "mic"; size: 16
                                color: voiceEngine.muted ? themeManager.dangerColor : themeManager.textColor }
                            MouseArea { id: muteHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: voiceEngine.toggleMute() }
                        }
                        Rectangle {
                            width: 30; height: 30; radius: 6
                            color: discHov.containsMouse ? themeManager.rgba(255,107,107,0.2) : "transparent"
                            Behavior on color { ColorAnimation { duration: 200; easing.type: Easing.OutCubic } }
                            AppIcon { anchors.centerIn: parent; name: "phone-off"; size: 17; color: themeManager.dangerColor }
                            MouseArea { id: discHov; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: root.leaveVoice() }
                        }
                    }
                }

                // Профиль (общий для обоих режимов) — самый тёмный слой Discord
                Rectangle {
                    Layout.fillWidth: true; height: 56
                    color: themeManager.railColor
                    RowLayout {
                        anchors { fill: parent; leftMargin: 8; rightMargin: 6; topMargin: 8; bottomMargin: 8 }
                        spacing: 8
                        // Аватар + presence-точка
                        Rectangle {
                            Layout.preferredWidth: 40; Layout.preferredHeight: 40; radius: 8
                            color: meHov.containsMouse ? themeManager.hoverColor : "transparent"
                            Item {
                                anchors.centerIn: parent; width: 32; height: 32
                                AnimatedAvatar {
                                    anchors.fill: parent
                                    displayName: appState.displayName
                                    source: appState.avatarPath
                                    accentColor: appState.roleColor !== ""
                                                 ? Qt.color(appState.roleColor) : themeManager.accentColor
                                }
                                Rectangle {  // обводка цветом railColor
                                    width: 13; height: 13; radius: 6.5; color: themeManager.railColor
                                    anchors { right: parent.right; bottom: parent.bottom; rightMargin: -2; bottomMargin: -2 }
                                    Rectangle { anchors.centerIn: parent; width: 9; height: 9; radius: 4.5
                                        color: appState.presence === "online" ? themeManager.presenceOnline
                                             : appState.presence === "idle"   ? themeManager.presenceIdle
                                             : appState.presence === "dnd"    ? themeManager.presenceDnd
                                             : themeManager.presenceOffline }
                                }
                            }
                            MouseArea { id: meHov; anchors.fill: parent; hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: profileCard.openFor(appState.userId) }
                        }
                        ColumnLayout {
                            spacing: 0; Layout.fillWidth: true
                            Text {
                                text: appState.displayName
                                color: themeManager.textColor; font.pixelSize: 14; font.bold: true
                                elide: Text.ElideRight; Layout.fillWidth: true
                            }
                            Text {
                                text: appState.roleName !== "" ? appState.roleName : "@" + appState.username
                                color: appState.roleColor !== "" ? appState.roleColor : themeManager.textMutedColor
                                font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true
                            }
                        }
                        Rectangle {
                            Layout.preferredWidth: 32; Layout.preferredHeight: 32; radius: 6
                            color: profBtn.containsMouse ? themeManager.hoverColor : "transparent"
                            AppIcon { anchors.centerIn: parent; name: "settings"; size: 18
                                color: profBtn.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                            MouseArea { id: profBtn; anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor; hoverEnabled: true
                                onClicked: settings.openAt(0) }
                        }
                        Rectangle {
                            Layout.preferredWidth: 32; Layout.preferredHeight: 32; radius: 6
                            color: logoutBtn.containsMouse ? themeManager.rgba(255,107,107,0.18) : "transparent"
                            AppIcon { anchors.centerIn: parent; name: "logout"; size: 17
                                color: logoutBtn.containsMouse ? themeManager.dangerColor : themeManager.textMutedColor }
                            MouseArea { id: logoutBtn; anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor; hoverEnabled: true
                                onClicked: appState.clearUser() }
                        }
                    }
                }
            }
        }

        Rectangle {
            width: 1; Layout.fillHeight: true
            color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g,
                           themeManager.textColor.b, 0.08)
        }

        // ═══ ЧАТ ════════════════════════════════════════════════════════════
        Rectangle {
            Layout.fillWidth: true; Layout.fillHeight: true
            color: themeManager.bgGradientEnabled ? "transparent" : themeManager.backgroundColor

            ColumnLayout {
                anchors.fill: parent; spacing: 0

                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 48
                    color: themeManager.backgroundColor
                    RowLayout {
                        anchors { fill: parent; leftMargin: 16; rightMargin: 12 }
                        spacing: 8
                        AppIcon {
                            visible: root.activeChannelId !== 0 && !root.activeIsDm
                            name: "hash"; size: 20; color: themeManager.textFaintColor
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: root.activeChannelName !== "" ? root.activeChannelName : "Выбери чат или канал"
                            color: themeManager.textColor; font.pixelSize: 16; font.bold: true
                            Layout.fillWidth: true; elide: Text.ElideRight
                            MouseArea {
                                anchors.fill: parent
                                enabled: root.activeIsDm && root.activeDmUserId > 0
                                cursorShape: Qt.PointingHandCursor
                                onClicked: profileCard.openFor(root.activeDmUserId)
                            }
                        }
                        // Звонок в личке
                        Rectangle {
                            visible: root.activeIsDm && root.activeChannelId !== 0
                            width: 34; height: 34; radius: 8
                            property bool inCall: root.myVoiceChannel === root.activeChannelId
                            color: inCall ? themeManager.rgba(87,242,135,0.20)
                                   : (callBtn.containsMouse ? themeManager.hoverColor : "transparent")
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                            AppIcon { anchors.centerIn: parent; name: "phone"; size: 18
                                color: parent.inCall ? themeManager.successColor
                                       : (callBtn.containsMouse ? themeManager.textColor : themeManager.textMutedColor) }
                            MouseArea { id: callBtn; anchors.fill: parent
                                hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    // WebRTC-звонок собеседнику в личке
                                    if (callEngine.state === "idle" && root.activeDmUserId > 0) {
                                        callEngine.selfName = appState.displayName
                                        callEngine.startCall(root.activeDmUserId, root.activeChannelName)
                                    }
                                } }
                        }
                        // Пригласить на сервер
                        Rectangle {
                            visible: root.activeServerId > 0
                            width: 34; height: 34; radius: 8
                            color: invBtn.containsMouse ? themeManager.hoverColor : "transparent"
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                            AppIcon { anchors.centerIn: parent; name: "person-add"; size: 18
                                color: invBtn.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                            MouseArea { id: invBtn; anchors.fill: parent; hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor; onClicked: invitePopup.open() }
                        }
                        // Показать/скрыть список участников
                        Rectangle {
                            visible: root.activeServerId > 0
                            width: 34; height: 34; radius: 8
                            color: root.showMembers ? themeManager.hoverColor
                                   : (memBtn.containsMouse ? themeManager.hoverColor : "transparent")
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                            AppIcon { anchors.centerIn: parent; name: "person"; size: 18
                                color: root.showMembers ? themeManager.textColor : themeManager.textMutedColor }
                            MouseArea { id: memBtn; anchors.fill: parent; hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor; onClicked: root.showMembers = !root.showMembers }
                        }
                    }
                    Rectangle {
                        anchors.bottom: parent.bottom; width: parent.width; height: 1
                        color: themeManager.borderColor
                    }
                }

                // Полоса звонка в личке (входящий / активный) — статус + кто говорит
                Rectangle {
                    id: callBar
                    Layout.fillWidth: true
                    property var inRoom: (root.voiceTick, root.activeChannelId > 0 ? (root.voiceMembers[root.activeChannelId] || []) : [])
                    property bool meIn: root.myVoiceChannel === root.activeChannelId && root.activeChannelId !== 0
                    property bool present: root.activeIsDm && (meIn || inRoom.length > 0)
                    Layout.preferredHeight: present ? 60 : 0
                    Behavior on Layout.preferredHeight { NumberAnimation { duration: themeManager.animDuration(180); easing.type: Easing.OutCubic } }
                    visible: present
                    clip: true
                    color: callBar.meIn ? themeManager.rgba(87,242,135,0.16) : themeManager.rgba(250,166,26,0.14)
                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(200) } }
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: themeManager.borderColor }

                    RowLayout {
                        anchors { fill: parent; leftMargin: 16; rightMargin: 12 }
                        spacing: 12

                        // Статус: в звонке / входящий
                        Column {
                            spacing: 1
                            Text { text: callBar.meIn ? "🔊 Вы в звонке" : "📞 Входящий звонок"
                                color: callBar.meIn ? themeManager.successColor : themeManager.presenceIdle
                                font.pixelSize: 14; font.bold: true }
                            Text { text: callBar.meIn ? "зелёный = говорит" : root.activeChannelName + " ждёт"
                                color: themeManager.textMutedColor; font.pixelSize: 11 }
                        }

                        // Чипы участников с индикатором речи
                        Row {
                            Layout.fillWidth: true
                            spacing: 8
                            Repeater {
                                model: callBar.inRoom
                                Rectangle {
                                    id: chip
                                    property bool talking: modelData.speaking === true
                                    anchors.verticalCenter: parent.verticalCenter
                                    height: 34; width: chipRow.width + 22; radius: 17
                                    color: talking ? themeManager.rgba(87,242,135,0.22) : themeManager.inputColor
                                    border.width: 2
                                    border.color: talking ? themeManager.successColor : "transparent"
                                    Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                                    Behavior on border.color { ColorAnimation { duration: themeManager.animDuration(120) } }
                                    Row {
                                        id: chipRow
                                        anchors.centerIn: parent; spacing: 7
                                        // Индикатор речи: точка + пульсирующее кольцо
                                        Item {
                                            width: 10; height: 10; anchors.verticalCenter: parent.verticalCenter
                                            Rectangle {
                                                anchors.centerIn: parent; width: 10; height: 10; radius: 5
                                                color: chip.talking ? themeManager.successColor : themeManager.textFaintColor
                                                Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                                            }
                                            Rectangle {
                                                id: ring; anchors.centerIn: parent
                                                width: 10; height: 10; radius: 5
                                                color: "transparent"; border.color: themeManager.successColor; border.width: 2
                                                visible: chip.talking && !themeManager.reducedMotion
                                                SequentialAnimation {
                                                    running: chip.talking && !themeManager.reducedMotion
                                                    loops: Animation.Infinite
                                                    ParallelAnimation {
                                                        NumberAnimation { target: ring; property: "scale"; from: 1; to: 2.6; duration: 900; easing.type: Easing.OutCubic }
                                                        NumberAnimation { target: ring; property: "opacity"; from: 0.7; to: 0; duration: 900 }
                                                    }
                                                }
                                            }
                                        }
                                        Text {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: modelData.id === appState.userId ? "Вы" : modelData.name
                                            color: themeManager.textColor; font.pixelSize: 13
                                            font.bold: chip.talking
                                        }
                                    }
                                }
                            }
                        }

                        // Кнопка выйти / присоединиться
                        Rectangle {
                            Layout.preferredWidth: cbT.implicitWidth + 28; Layout.preferredHeight: 32; radius: 9
                            color: callBar.meIn ? themeManager.rgba(255,107,107,0.95)
                                   : (joinHovCall.containsMouse ? Qt.lighter(themeManager.successColor,1.1) : themeManager.successColor)
                            Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }
                            scale: joinHovCall.pressed ? 0.95 : 1.0
                            Behavior on scale { NumberAnimation { duration: themeManager.animDuration(130); easing.type: Easing.OutCubic } }
                            Text { id: cbT; anchors.centerIn: parent
                                text: callBar.meIn ? "Выйти" : "Присоединиться"
                                color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                            MouseArea { id: joinHovCall; anchors.fill: parent; hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (callBar.meIn) root.leaveVoice()
                                    else root.joinVoice(root.activeChannelId, root.activeChannelName)
                                } }
                        }
                    }
                }

                ListView {
                    id: msgList
                    Layout.fillWidth: true; Layout.fillHeight: true
                    clip: true; model: messageModel
                    spacing: themeManager.compact ? 1 : 4
                    topMargin: themeManager.compact ? 6 : 12; bottomMargin: 8
                    cacheBuffer: 4000
                    // обычный список (старые сверху, новые снизу) — прокрутка вверх работает штатно

                    // «внизу ли мы» (для авто-прокрутки только когда читаешь свежее)
                    property bool atBottom: true
                    function updateAtBottom() {
                        atBottom = (contentHeight <= height) ||
                                   (contentY >= contentHeight - height - 60)
                    }
                    onContentYChanged: updateAtBottom()
                    // прокрутить к низу, досчитав высоты делегатов синхронно
                    function toBottom() {
                        if (count <= 0) return
                        forceLayout()
                        positionViewAtEnd()
                        atBottom = true
                    }
                    // если содержимое доезжает по высоте позже (перенос текста) — до-прижать
                    onContentHeightChanged: if (atBottom) Qt.callLater(toBottom)
                    onHeightChanged: if (atBottom) Qt.callLater(toBottom)
                    Component.onCompleted: Qt.callLater(toBottom)

                    // Только мягкое появление по прозрачности — без сдвигов по Y и без
                    // displaced, чтобы пузыри никогда не наезжали друг на друга.
                    add: Transition {
                        NumberAnimation { property: "opacity"; from: 0; to: 1
                            duration: themeManager.animDuration(200); easing.type: Easing.OutCubic }
                    }

                    delegate: ChatBubble {
                        width: msgList.width
                        x: 0
                        authorName:   author
                        authorId:     authorId
                        messageText:  txt
                        timestamp:    ts
                        isOwn:        own
                        avatarSource: av
                        roleColor:    rc
                        msgId:        model.msgId
                        edited:       model.edited === true
                        rxJson:       model.rx ? model.rx : "[]"
                        attachment:   model.attach ? model.attach : ""
                        // подряд от того же автора → сгруппировать (без аватара/шапки)
                        grouped: grp === true
                        onOpenProfile: function(uid){ profileCard.openFor(uid) }
                        onReact: function(emoji){ appState.toggleReaction(root.activeChannelId, model.msgId, emoji) }
                        onEditSubmit: function(t){ appState.editMessage(root.activeChannelId, model.msgId, t) }
                        onDeleteRequested: appState.deleteMessage(root.activeChannelId, model.msgId)
                    }
                }

                // Discord-инпут: одна скруглённая полоса (Enter отправляет)
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 68; color: "transparent"
                    Rectangle {
                        anchors { fill: parent; leftMargin: 16; rightMargin: 16; topMargin: 0; bottomMargin: 20 }
                        radius: 8
                        color: themeManager.inputColor
                        RowLayout {
                            anchors.fill: parent; spacing: 2
                            Rectangle {
                                Layout.preferredWidth: 46; Layout.fillHeight: true; color: "transparent"
                                AppIcon { anchors.centerIn: parent; name: "plus"; size: 20
                                    color: plusMa.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                                MouseArea { id: plusMa; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: if (root.activeChannelId !== 0) attachDialog.open() }
                            }
                            TextField {
                                id: inputField
                                Layout.fillWidth: true; Layout.fillHeight: true
                                verticalAlignment: TextInput.AlignVCenter
                                rightPadding: 8
                                placeholderText: root.activeChannelName !== ""
                                                 ? "Написать в " + (root.activeIsDm ? "" : "#") + root.activeChannelName
                                                 : "Выбери чат…"
                                placeholderTextColor: themeManager.textFaintColor
                                color: themeManager.textColor; font.pixelSize: 15
                                background: Item {}
                                enabled: root.activeChannelId !== 0
                                Keys.onReturnPressed: sendMsg()
                            }
                            Rectangle {
                                Layout.preferredWidth: 46; Layout.fillHeight: true; color: "transparent"
                                AppIcon { anchors.centerIn: parent; name: "smile"; size: 20
                                    color: smileMa.containsMouse ? themeManager.textColor : themeManager.textMutedColor }
                                MouseArea { id: smileMa; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: emojiPopup.visible ? emojiPopup.close() : emojiPopup.open() }
                            }
                        }

                        // ── Эмодзи-пикер (вставляет в поле ввода) ──
                        Popup {
                            id: emojiPopup
                            x: parent.width - width
                            y: -height - 10
                            width: 344; height: 260; padding: 10
                            background: Rectangle {
                                radius: 10; color: themeManager.elevatedColor
                                border.color: themeManager.borderColor; border.width: 1
                            }
                            enter: Transition {
                                NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(120) }
                                NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: themeManager.animDuration(140); easing.type: Easing.OutCubic } }
                            exit: Transition {
                                NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(100) } }

                            GridView {
                                anchors.fill: parent
                                clip: true
                                cellWidth: 36; cellHeight: 36
                                model: ["😀","😂","🤣","😊","😍","😘","😉","😎","🤔","😴",
                                        "😭","😡","🥲","🥰","😤","🤡","🥴","😈","🤯","😅",
                                        "🙃","💀","👀","🫡","👍","👎","👌","✌️","🙏","👏",
                                        "🤝","💪","🔥","❤️","💜","💙","💚","💛","🖤","💔",
                                        "⭐","✨","🎉","🎮","🎵","☕","🍕","🚀","💯","❄️"]
                                delegate: Rectangle {
                                    width: 34; height: 34; radius: 6
                                    color: emHov.containsMouse ? themeManager.hoverColor : "transparent"
                                    Text { anchors.centerIn: parent; text: modelData; font.pixelSize: 20 }
                                    MouseArea { id: emHov; anchors.fill: parent; hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            inputField.insert(inputField.cursorPosition, modelData)
                                            inputField.forceActiveFocus()
                                        } }
                                }
                            }
                        }
                    }
                }
            }
        }

        // ═══ УЧАСТНИКИ СЕРВЕРА ══════════════════════════════════════════════
        Rectangle {
            visible: root.activeServerId > 0 && root.showMembers
            Layout.preferredWidth: 224
            Layout.fillHeight: true
            color: themeManager.surfaceColor

            Rectangle { anchors.left: parent.left; width: 1; height: parent.height
                color: themeManager.borderColor }

            ColumnLayout {
                anchors.fill: parent; spacing: 0

                // Заголовок панели
                Item {
                    Layout.fillWidth: true; Layout.preferredHeight: 56
                    Text {
                        anchors { left: parent.left; leftMargin: 18; verticalCenter: parent.verticalCenter }
                        text: "УЧАСТНИКИ — " + memberModel.count
                        color: themeManager.textMutedColor; font.pixelSize: 11; font.bold: true
                    }
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1
                        color: themeManager.borderColor }
                }

                ListView {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    clip: true; model: memberModel
                    add: Transition {
                        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(200) } }
                    spacing: 2; topMargin: 8; bottomMargin: 8
                    leftMargin: 8; rightMargin: 8

                    delegate: Rectangle {
                        width: ListView.view.width - 16; x: 8
                        height: 46; radius: 8
                        opacity: model.presence === "offline" ? 0.5 : 1.0
                        color: mHov.containsMouse ? themeManager.hoverColor : "transparent"
                        Behavior on color { ColorAnimation { duration: themeManager.animDuration(120) } }

                        Row {
                            anchors { left: parent.left; leftMargin: 8; right: parent.right; rightMargin: 8
                                      verticalCenter: parent.verticalCenter }
                            spacing: 10
                            // Аватар + индикатор присутствия
                            Item {
                                width: 34; height: 34; anchors.verticalCenter: parent.verticalCenter
                                AnimatedAvatar { anchors.fill: parent
                                    displayName: model.displayName; source: model.avatar }
                                Rectangle {
                                    width: 13; height: 13; radius: 6.5
                                    anchors { right: parent.right; bottom: parent.bottom }
                                    color: themeManager.surfaceColor
                                    Rectangle {
                                        anchors.centerIn: parent; width: 9; height: 9; radius: 4.5
                                        color: model.presence === "online" ? themeManager.presenceOnline
                                             : model.presence === "idle"   ? themeManager.presenceIdle
                                             : model.presence === "dnd"    ? themeManager.presenceDnd
                                             : themeManager.presenceOffline
                                    }
                                }
                            }
                            // Имя + бейджи + @username
                            Column {
                                anchors.verticalCenter: parent.verticalCenter; spacing: 2
                                Row {
                                    spacing: 5
                                    Text { text: model.displayName
                                        color: (model.roles && model.roles.length > 0 && model.roles[0].color)
                                               ? model.roles[0].color : themeManager.textColor
                                        font.pixelSize: 14
                                        elide: Text.ElideRight; width: Math.min(implicitWidth, 96)
                                        anchors.verticalCenter: parent.verticalCenter }
                                    Rectangle {
                                        visible: model.isOwner
                                        width: ownerT.implicitWidth + 10; height: 15; radius: 4
                                        color: themeManager.accentSoftColor
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { id: ownerT; anchors.centerIn: parent; text: "владелец"
                                            color: themeManager.accentColor; font.pixelSize: 8; font.bold: true }
                                    }
                                }
                                // @username + цветные бейджи ролей
                                Row {
                                    spacing: 5
                                    Text { text: "@" + model.username
                                        color: themeManager.textFaintColor; font.pixelSize: 11
                                        elide: Text.ElideRight
                                        width: Math.min(implicitWidth, model.roles && model.roles.length > 0 ? 60 : 140)
                                        anchors.verticalCenter: parent.verticalCenter }
                                    Repeater {
                                        model: rolesData
                                        Rectangle {
                                            height: 14; radius: 4; width: rlt.implicitWidth + 8
                                            anchors.verticalCenter: parent.verticalCenter
                                            color: Qt.rgba(Qt.color(modelData.color).r, Qt.color(modelData.color).g,
                                                           Qt.color(modelData.color).b, 0.18)
                                            Text { id: rlt; anchors.centerIn: parent; text: modelData.name
                                                color: Qt.color(modelData.color); font.pixelSize: 8; font.bold: true }
                                        }
                                    }
                                }
                            }
                        }
                        // массив ролей участника (для Repeater выше)
                        property var rolesData: model.roles ? model.roles : []

                        MouseArea {
                            id: mHov; anchors.fill: parent; hoverEnabled: true
                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                            cursorShape: Qt.PointingHandCursor
                            onClicked: function(mouse) {
                                if (mouse.button === Qt.RightButton) {
                                    root.ctxMember = { id: model.id, name: model.displayName,
                                                       isOwner: model.isOwner, roleNames: rolesNamesOf(model.roles) }
                                    memberMenu.popup()
                                } else {
                                    profileCard.openFor(model.id)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Попап: создать канал (дом) ────────────────────────────────────────────
    Popup {
        id: createChPopup
        modal: true; anchors.centerIn: Overlay.overlay; width: 300; padding: 20
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 240; easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 150; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 150; easing.type: Easing.InCubic } }
        background: Rectangle {
            radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1
        }
        Column {
            width: parent.width; spacing: 12
            Text { text: "Создать канал"; font.pixelSize: 15; font.bold: true; color: themeManager.textColor }
            Rectangle {
                width: parent.width; height: 38; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.08)
                border.color: chNameField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.2)
                border.width: 1
                TextField {
                    id: chNameField; anchors.fill: parent; leftPadding: 12
                    placeholderText: "название-канала"
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.35)
                    Keys.onReturnPressed: createChBtn.doCreate()
                }
            }
            Rectangle {
                id: createChBtn
                function doCreate() {
                    var n = chNameField.text.trim()
                    if (n.length < 1) return
                    appState.createChannel(n); chNameField.text = ""; createChPopup.close()
                }
                width: parent.width; height: 36; radius: 8
                color: createHov.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor
                Text { anchors.centerIn: parent; text: "Создать"; color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                MouseArea { id: createHov; anchors.fill: parent
                    hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: createChBtn.doCreate() }
            }
        }
    }

    // ── Попап: создать сервер ──────────────────────────────────────────────────
    Popup {
        id: createServerPopup
        modal: true; anchors.centerIn: Overlay.overlay; width: 320; padding: 20
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 240; easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 150; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 150; easing.type: Easing.InCubic } }
        background: Rectangle {
            radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1
        }
        Column {
            width: parent.width; spacing: 12
            Text { text: "Создать сервер"; font.pixelSize: 15; font.bold: true; color: themeManager.textColor }
            Text { text: "Сервер с текстовыми и голосовыми каналами. Создастся «общий» и «Голосовой»."
                width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 12
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.55) }
            Rectangle {
                width: parent.width; height: 38; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.08)
                border.color: srvNameField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.2)
                border.width: 1
                TextField {
                    id: srvNameField; anchors.fill: parent; leftPadding: 12
                    placeholderText: "Название сервера"
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.35)
                    Keys.onReturnPressed: srvCreateBtn.doCreate()
                }
            }
            Rectangle {
                id: srvCreateBtn
                function doCreate() {
                    var n = srvNameField.text.trim()
                    if (n.length < 1) return
                    appState.createServer(n); srvNameField.text = ""; createServerPopup.close()
                }
                width: parent.width; height: 36; radius: 8
                color: srvCreHov.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor
                Text { anchors.centerIn: parent; text: "Создать сервер"; color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                MouseArea { id: srvCreHov; anchors.fill: parent
                    hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: srvCreateBtn.doCreate() }
            }

            // Разделитель «или»
            Row {
                width: parent.width; spacing: 10
                Rectangle { width: (parent.width - orT.implicitWidth - 20) / 2; height: 1
                    color: themeManager.borderColor; anchors.verticalCenter: parent.verticalCenter }
                Text { id: orT; text: "или"; color: themeManager.textFaintColor; font.pixelSize: 11
                    anchors.verticalCenter: parent.verticalCenter }
                Rectangle { width: (parent.width - orT.implicitWidth - 20) / 2; height: 1
                    color: themeManager.borderColor; anchors.verticalCenter: parent.verticalCenter }
            }

            Text { text: "Войти по коду приглашения"; font.pixelSize: 12; font.bold: true
                color: themeManager.textMutedColor }
            Rectangle {
                width: parent.width; height: 38; radius: 8
                color: themeManager.inputColor
                border.color: joinCodeField.activeFocus ? themeManager.accentColor : themeManager.borderColor
                border.width: 1
                TextField {
                    id: joinCodeField; anchors.fill: parent; leftPadding: 12
                    placeholderText: "например, ABC123"
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: themeManager.textFaintColor
                    Keys.onReturnPressed: joinBtn.doJoin()
                }
            }
            Rectangle {
                id: joinBtn
                function doJoin() {
                    var c = joinCodeField.text.trim().toUpperCase()
                    if (c.length < 3) return
                    appState.joinServerByCode(c); joinCodeField.text = ""; createServerPopup.close()
                }
                width: parent.width; height: 36; radius: 8
                color: joinHov.containsMouse ? themeManager.hoverColor : themeManager.inputColor
                border.color: themeManager.borderColor; border.width: 1
                Text { anchors.centerIn: parent; text: "Войти по коду"; color: themeManager.textColor
                    font.pixelSize: 13; font.bold: true }
                MouseArea { id: joinHov; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: joinBtn.doJoin() }
            }
        }
    }

    // ── Попап: пригласить на сервер (показать/скопировать код) ──────────────────
    Popup {
        id: invitePopup
        modal: true; dim: true; anchors.centerIn: Overlay.overlay
        width: 380; padding: 0
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(180) }
            NumberAnimation { property: "scale"; from: 0.95; to: 1; duration: themeManager.animDuration(220); easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: themeManager.animDuration(130) } }
        background: Rectangle { radius: 16; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1 }
        property bool copied: false
        onAboutToShow: copied = false

        contentItem: ColumnLayout {
            spacing: 14

            Item { Layout.fillWidth: true; Layout.preferredHeight: 8 }
            // Иконка
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                width: 56; height: 56; radius: 28; color: themeManager.accentSoftColor
                AppIcon { anchors.centerIn: parent; name: "person-add"; size: 28; color: themeManager.accentColor }
            }
            Text { Layout.alignment: Qt.AlignHCenter; text: "Пригласить на сервер"
                color: themeManager.textColor; font.pixelSize: 18; font.bold: true }
            Text { Layout.alignment: Qt.AlignHCenter; Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                text: "Отправь этот код другу — он войдёт через «+» → «Войти по коду»."
                color: themeManager.textMutedColor; font.pixelSize: 12
                leftPadding: 28; rightPadding: 28 }

            // Код
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredWidth: 280; Layout.preferredHeight: 56; radius: 12
                color: themeManager.inputColor
                border.color: themeManager.borderColor; border.width: 1
                Text { anchors.centerIn: parent
                    text: root.activeServerInvite !== "" ? root.activeServerInvite : "— нет кода —"
                    color: themeManager.textColor; font.pixelSize: 26; font.bold: true
                    font.letterSpacing: 4; font.family: "Consolas" }
            }

            // Кнопка копировать
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredWidth: 280; Layout.preferredHeight: 42; radius: 10
                color: invitePopup.copied ? themeManager.successColor
                       : (cpHov.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor)
                Behavior on color { ColorAnimation { duration: themeManager.animDuration(150) } }
                Row { anchors.centerIn: parent; spacing: 8
                    AppIcon { name: invitePopup.copied ? "check" : "link"; size: 16
                        color: themeManager.accentTextColor; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: invitePopup.copied ? "Скопировано!" : "Копировать код"
                        color: themeManager.accentTextColor; font.pixelSize: 14; font.bold: true
                        anchors.verticalCenter: parent.verticalCenter } }
                MouseArea { anchors.fill: parent; id: cpHov; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    enabled: root.activeServerInvite !== ""
                    onClicked: { appState.copyToClipboard(root.activeServerInvite); invitePopup.copied = true } }
            }
            Item { Layout.fillWidth: true; Layout.preferredHeight: 6 }
        }
    }

    // ── Попап: создать канал сервера (текст/голос) ─────────────────────────────
    Popup {
        id: createSrvChPopup
        modal: true; anchors.centerIn: Overlay.overlay; width: 320; padding: 20
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 240; easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 150; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 150; easing.type: Easing.InCubic } }
        background: Rectangle {
            radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1
        }
        Column {
            width: parent.width; spacing: 12
            Text { text: "Новый канал сервера"; font.pixelSize: 15; font.bold: true; color: themeManager.textColor }
            Rectangle {
                width: parent.width; height: 38; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.08)
                border.color: scNameField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.2)
                border.width: 1
                TextField {
                    id: scNameField; anchors.fill: parent; leftPadding: 12
                    placeholderText: "название-канала"
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.35)
                }
            }
            // Тип канала
            Row {
                width: parent.width; spacing: 10
                Text { text: "Голосовой канал"; font.pixelSize: 13
                    color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.8)
                    width: parent.width - 56; anchors.verticalCenter: parent.verticalCenter }
                Rectangle {
                    id: scVoiceToggle
                    property bool on: false
                    width: 46; height: 24; radius: 12; anchors.verticalCenter: parent.verticalCenter
                    color: on ? themeManager.accentColor
                           : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.2)
                    Rectangle { width: 20; height: 20; radius: 10; color: themeManager.accentTextColor
                        anchors.verticalCenter: parent.verticalCenter
                        x: scVoiceToggle.on ? parent.width - 22 : 2
                        Behavior on x { NumberAnimation { duration: 120 } } }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: scVoiceToggle.on = !scVoiceToggle.on }
                }
            }
            Rectangle {
                width: parent.width; height: 36; radius: 8
                color: scCreHov.containsMouse ? Qt.lighter(themeManager.accentColor, 1.1) : themeManager.accentColor
                Text { anchors.centerIn: parent; text: "Создать"; color: themeManager.accentTextColor; font.pixelSize: 13; font.bold: true }
                MouseArea { id: scCreHov; anchors.fill: parent
                    hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        var n = scNameField.text.trim()
                        if (n.length < 1 || root.activeServerId === 0) return
                        appState.createServerChannel(root.activeServerId, n, scVoiceToggle.on)
                        scNameField.text = ""; createSrvChPopup.close()
                    }
                }
            }
        }
    }

    // ── Попап: поиск пользователей по тегу ────────────────────────────────────
    Popup {
        id: userSearchPopup
        modal: true; anchors.centerIn: Overlay.overlay; width: 380; height: 420; padding: 20
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 240; easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 150; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 150; easing.type: Easing.InCubic } }
        background: Rectangle {
            radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1
        }
        Column {
            anchors.fill: parent; spacing: 12
            Text { text: "Поиск людей по тегу"; font.pixelSize: 15; font.bold: true; color: themeManager.textColor }
            Rectangle {
                width: parent.width; height: 38; radius: 8
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.08)
                border.color: searchField.activeFocus ? themeManager.accentColor
                              : Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.2)
                border.width: 1
                TextField {
                    id: searchField; anchors.fill: parent; leftPadding: 12
                    placeholderText: "@тег или имя..."
                    color: themeManager.textColor; font.pixelSize: 13; background: Item {}
                    placeholderTextColor: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.35)
                    onTextChanged: if (text.trim().length >= 1) appState.searchUsers(text.trim())
                                   else searchModel.clear()
                }
            }
            ListView {
                width: parent.width; height: parent.height - 90
                clip: true; model: searchModel; spacing: 4
                add: Transition {
                    NumberAnimation { property: "opacity"; from: 0; to: 1; duration: themeManager.animDuration(200) } }
                delegate: Rectangle {
                    width: ListView.view.width; height: 50; radius: 8
                    color: resHov.containsMouse
                           ? Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.06) : "transparent"
                    Row {
                        anchors { left: parent.left; leftMargin: 8; verticalCenter: parent.verticalCenter }
                        spacing: 10
                        AnimatedAvatar { width: 34; height: 34; displayName: uName; source: uAvatar
                            anchors.verticalCenter: parent.verticalCenter }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            Text { text: uName; color: themeManager.textColor; font.pixelSize: 14; font.bold: true }
                            Text { text: "@" + uTag
                                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.45)
                                font.pixelSize: 11 }
                        }
                    }
                    Rectangle {
                        anchors { right: parent.right; rightMargin: 8; verticalCenter: parent.verticalCenter }
                        width: 80; height: 30; radius: 7
                        color: Qt.rgba(themeManager.accentColor.r, themeManager.accentColor.g, themeManager.accentColor.b, 0.2)
                        Text { anchors.centerIn: parent; text: "Написать"
                            color: themeManager.accentColor; font.pixelSize: 11; font.bold: true }
                    }
                    MouseArea { id: resHov; anchors.fill: parent
                        hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: { appState.startDm(uId); userSearchPopup.close() } }
                }
            }
        }
    }

    // ── Заглушка голосовых каналов/звонков (до WebRTC, фича №2) ────────────────
    Popup {
        id: voiceNotice
        property string chName: ""
        modal: true; anchors.centerIn: Overlay.overlay; width: 340; padding: 24
        enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.96; to: 1; duration: 240; easing.type: Easing.OutCubic } }
        exit: Transition { NumberAnimation { property: "opacity"; from: 1; to: 0; duration: 150; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; from: 1; to: 0.97; duration: 150; easing.type: Easing.InCubic } }
        background: Rectangle {
            radius: 12; color: themeManager.elevatedColor
            border.color: themeManager.borderColor; border.width: 1
        }
        Column {
            width: parent.width; spacing: 14
            Text { text: voiceNotice.chName !== "" ? "🔊 " + voiceNotice.chName : "📞 Звонки"
                font.pixelSize: 16; font.bold: true; color: themeManager.textColor }
            Text {
                width: parent.width; wrapMode: Text.WordWrap
                text: "Голосовая связь (WebRTC) — следующий этап. Канал создан и виден всем участникам, но звук подключим в фиче №2 (сигналинг + захват аудио)."
                color: Qt.rgba(themeManager.textColor.r, themeManager.textColor.g, themeManager.textColor.b, 0.7)
                font.pixelSize: 13
            }
            Rectangle {
                width: parent.width; height: 36; radius: 8; color: themeManager.accentColor
                Text { anchors.centerIn: parent; text: "Понятно"; color: themeManager.accentTextColor; font.bold: true }
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: voiceNotice.close() }
            }
        }
    }

    // Картинка-вложение через «+» в инпуте
    FileDialog {
        id: attachDialog
        title: "Отправить картинку (PNG/JPG/GIF)"
        nameFilters: ["Изображения (*.png *.jpg *.jpeg *.gif)"]
        onAccepted: if (root.activeChannelId !== 0)
                        appState.sendAttachment(root.activeChannelId, selectedFile.toString())
    }

    function sendMsg() {
        var t = inputField.text.trim()
        if (t === "" || root.activeChannelId === 0) return
        messageModel.append({
            author: appState.displayName, authorId: appState.userId, txt: t,
            ts: Qt.formatTime(new Date(), "hh:mm"),
            own: true, av: appState.avatarPath, rc: appState.roleColor,
            msgId: 0, edited: false, attach: "", rx: "[]",   // id допишет onMessageSent
            grp: (messageModel.count > 0 && messageModel.get(messageModel.count - 1).authorId === appState.userId)
        })
        msgList.toBottom()
        appState.sendChatMessage(root.activeChannelId, t)
        inputField.text = ""
    }

    // ── Контекстное меню участника сервера ──
    Menu {
        id: memberMenu
        MenuItem { text: "Профиль"; onTriggered: profileCard.openFor(root.ctxMember.id) }
        MenuSeparator {}
        Menu {
            id: rolesSubmenu
            title: "Роли"
            enabled: rolesModel.count > 0
            Instantiator {
                model: rolesModel
                delegate: MenuItem {
                    required property string rName
                    required property int rId
                    text: (root.ctxMember.roleNames && root.ctxMember.roleNames.indexOf(rName) >= 0 ? "✓  " : "      ") + rName
                    onTriggered: {
                        if (root.ctxMember.roleNames && root.ctxMember.roleNames.indexOf(rName) >= 0)
                            appState.unassignRoleFrom(rId, root.ctxMember.id)
                        else
                            appState.assignRoleTo(rId, root.ctxMember.id)
                    }
                }
                onObjectAdded: function(index, object) { rolesSubmenu.insertItem(index, object) }
                onObjectRemoved: function(index, object) { rolesSubmenu.removeItem(object) }
            }
        }
        MenuItem {
            text: "Кикнуть с сервера"
            height: enabled ? implicitHeight : 0
            enabled: root.iAmServerOwner && !root.ctxMember.isOwner && root.ctxMember.id !== appState.userId
            onTriggered: appState.kickMember(root.activeServerId, root.ctxMember.id)
        }
    }

    // Единое окно настроек (Профиль / Внешний вид / Голос / Роли)
    SettingsView { id: settings }

    ProfileCard { id: profileCard
        contextServerId: root.activeServerId
        contextChannelId: (root.activeChannelId !== 0 && root.activeIsDm) ? root.activeChannelId : 0
        onOpenFull: function(uid){ profileModal.openFor(uid) } }
    ProfileModal { id: profileModal }
    CallOverlay  { id: callOverlay }

    // ── Мини-плашка свёрнутого звонка (звонок живёт, приложение свободно) ──
    Rectangle {
        visible: callOverlay.minimized && callEngine.state !== "idle"
        z: 100
        anchors { top: parent.top; right: parent.right; topMargin: 64; rightMargin: 16 }
        width: miniRow.implicitWidth + 26; height: 44; radius: 22
        color: themeManager.elevatedColor
        border.color: themeManager.borderColor; border.width: 1

        component MiniBtn: Rectangle {
            property alias icon: mbIc.name
            property alias iconRotation: mbIc.rotation
            property color bg: "transparent"
            property color fg: themeManager.textMutedColor
            signal clicked()
            width: 28; height: 28; radius: 14
            color: mbMa.containsMouse ? (bg.a > 0 ? Qt.darker(bg, 1.2) : themeManager.hoverColor) : bg
            AppIcon { id: mbIc; anchors.centerIn: parent; size: 14; color: parent.fg }
            MouseArea { id: mbMa; anchors.fill: parent; hoverEnabled: true
                cursorShape: Qt.PointingHandCursor; onClicked: parent.clicked() }
        }

        Row {
            id: miniRow
            anchors.centerIn: parent; spacing: 8
            Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter
                color: callEngine.state === "incall" ? themeManager.successColor : themeManager.warningColor }
            Text { text: callEngine.peerName.length ? callEngine.peerName : "Звонок"
                anchors.verticalCenter: parent.verticalCenter
                color: themeManager.textColor; font.pixelSize: 13; font.bold: true }
            MiniBtn { anchors.verticalCenter: parent.verticalCenter
                icon: voiceEngine.muted ? "mic-off" : "mic"
                bg: voiceEngine.muted ? themeManager.dangerColor : "transparent"
                fg: voiceEngine.muted ? themeManager.accentTextColor : themeManager.textMutedColor
                onClicked: voiceEngine.toggleMute() }
            MiniBtn { anchors.verticalCenter: parent.verticalCenter
                icon: "chevron-down"; iconRotation: 180
                onClicked: callOverlay.minimized = false }
            MiniBtn { anchors.verticalCenter: parent.verticalCenter
                icon: "phone-off"; bg: themeManager.dangerColor; fg: themeManager.accentTextColor
                onClicked: callEngine.hangup() }
        }
    }
}
