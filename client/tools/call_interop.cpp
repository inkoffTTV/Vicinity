// Безголовый участник звонка 1:1 для e2e-проверки совместимости с браузером
// (web/e2e/d-interop.spec.ts). Тот же CallEngine, что у десктопа, но без устройств:
// вместо микрофона — тон 440 Гц, вместо динамиков — счётчик принятых кадров и их громкость.
//
//   call_interop --server http://127.0.0.1:8080 --token <token> --peer <user_id>
//                --mode call|answer [--timeout <sec>]
//
// call   — звонит peer'у, как только подключится WebSocket;
// answer — ждёт входящий звонок от peer'а и принимает его.
// Строка "hangup" в stdin — положить трубку. В stdout — JSON-строки:
//   {"event":"ws","connected":true}
//   {"event":"state","state":"incall"}
//   {"event":"stats","state":"incall","rx_frames":N,"rx_rms":R,"tx_frames":M}   (каждые 500 мс)
//   {"event":"notice","text":"..."}
//   {"event":"done","reached_incall":true,"rx_frames":N,"tx_frames":M}
// Выход: 0 — звонок состоялся и завершён, 1 — звонок не дошёл до incall, 2 — таймаут.
#include "src/core/CallEngine.h"
#include "src/network/ApiClient.h"
#include <QCoreApplication>
#include <QCommandLineParser>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkRequest>
#include <QTimer>
#include <QUrl>
#include <QWebSocket>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#ifdef _WIN32
  #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
  #endif
  #include <windows.h>
#else
  #include <unistd.h>
#endif

namespace {

// Чтение stdin мимо stdio: поток, ждущий в std::getline, держит блокировку FILE,
// и exit() процесса на ней зависает
long readStdin(char* buf, unsigned long size) {
#ifdef _WIN32
    DWORD got = 0;
    return ReadFile(GetStdHandle(STD_INPUT_HANDLE), buf, size, &got, nullptr) ? static_cast<long>(got) : -1;
#else
    return static_cast<long>(::read(0, buf, size));
#endif
}

constexpr double kPi = 3.14159265358979323846;

void emitLine(const QJsonObject& o) {
    const QByteArray line = QJsonDocument(o).toJson(QJsonDocument::Compact);
    std::fwrite(line.constData(), 1, static_cast<size_t>(line.size()), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}

QString wsUrlFor(QString origin) {
    while (origin.endsWith('/')) origin.chop(1);
    if (origin.startsWith("https://"))     origin.replace(0, 8, "wss://");
    else if (origin.startsWith("http://")) origin.replace(0, 7, "ws://");
    return origin + "/ws";
}

} // namespace

int main(int argc, char* argv[]) {
    QCoreApplication app(argc, argv);
    QCommandLineParser args;
    args.setApplicationDescription("Vicinity desktop call engine, headless (interop tests)");
    args.addHelpOption();
    const QCommandLineOption serverOpt("server", "Backend origin, e.g. http://127.0.0.1:8080", "url");
    const QCommandLineOption tokenOpt("token", "Session token of the desktop user", "token");
    const QCommandLineOption peerOpt("peer", "User id of the other side", "id");
    const QCommandLineOption modeOpt("mode", "call | answer", "mode");
    const QCommandLineOption timeoutOpt("timeout", "Give up after this many seconds", "sec", "90");
    args.addOptions({ serverOpt, tokenOpt, peerOpt, modeOpt, timeoutOpt });
    args.process(app);

    const QString server = args.value(serverOpt);
    const QString token  = args.value(tokenOpt);
    const qlonglong peer = args.value(peerOpt).toLongLong();
    const QString mode   = args.value(modeOpt);
    if (server.isEmpty() || token.isEmpty() || peer <= 0 || (mode != "call" && mode != "answer")) {
        std::cerr << "usage: call_interop --server URL --token TOKEN --peer ID --mode call|answer\n";
        return 64;
    }

    ApiClient::instance().setBaseUrl(server + "/api/v1");   // для GET /rtc/ice
    ApiClient::instance().setToken(token);

    CallEngine call;   // без VideoEngine: видео-линии согласуются, кадров нет
    call.setProperty("selfName", QStringLiteral("Desktop interop"));

    QWebSocket ws;
    QObject::connect(&call, &CallEngine::sendSignal, &ws, [&ws](const QString& json) {
        if (ws.state() == QAbstractSocket::ConnectedState) ws.sendTextMessage(json);
    });
    QObject::connect(&ws, &QWebSocket::textMessageReceived, &call, [&call](const QString& text) {
        const QJsonObject m = QJsonDocument::fromJson(text.toUtf8()).object();
        const QString t = m.value("type").toString();
        if (t.startsWith("call_") || t == "rtc_ice") call.handleSignal(m);
    });

    bool started = false, reachedIncall = false, finished = false;
    qint64 rxFrames = 0, txFrames = 0;
    double rxSumSq = 0.0;
    qint64 rxSamples = 0;
    int exitCode = 1;

    auto finish = [&](int code) {
        if (finished) return;
        finished = true;
        QJsonObject o;
        o["event"] = "done";
        o["reached_incall"] = reachedIncall;
        o["rx_frames"] = rxFrames;
        o["tx_frames"] = txFrames;
        emitLine(o);
        exitCode = code;
        // Выходим, когда сервер подтвердит закрытие: иначе последние сигналы (call_end) могли
        // остаться в буфере сокета и не дойти до собеседника. Сервер не ответил — через 5 с всё равно.
        if (ws.state() == QAbstractSocket::UnconnectedState) {
            QCoreApplication::exit(code);
            return;
        }
        QObject::connect(&ws, &QWebSocket::disconnected, &ws, [code] { QCoreApplication::exit(code); });
        QTimer::singleShot(5000, &ws, [code] { QCoreApplication::exit(code); });
        ws.close();
    };

    QObject::connect(&ws, &QWebSocket::connected, &call, [&] {
        emitLine({ { "event", "ws" }, { "connected", true } });
        if (mode == "call") call.startCall(peer, QStringLiteral("Browser"));
    });
    QObject::connect(&ws, &QWebSocket::disconnected, &call, [&] {
        emitLine({ { "event", "ws" }, { "connected", false } });
    });
    QObject::connect(&call, &CallEngine::incomingCall, &call, [&](qlonglong from) {
        if (mode == "answer" && from == peer)
            QTimer::singleShot(300, &call, [&call] { call.acceptCall(); });   // «человек» тянется к кнопке
    });
    QObject::connect(&call, &CallEngine::callNotice, &call, [](const QString& text) {
        emitLine({ { "event", "notice" }, { "text", text } });
    });
    QObject::connect(&call, &CallEngine::stateChanged, &call, [&] {
        emitLine({ { "event", "state" }, { "state", call.state() } });
        if (call.state() == "incall") reachedIncall = true;
        if (call.state() != "idle") started = true;
        else if (started) finish(reachedIncall ? 0 : 1);
    });

    // «Динамики»: считаем кадры и громкость (поток сети → в главный поток)
    QObject::connect(&call, &CallEngine::remoteAudio, &call, [&](const QByteArray& pcm) {
        const auto* s = reinterpret_cast<const int16_t*>(pcm.constData());
        const int n = pcm.size() / 2;
        for (int i = 0; i < n; ++i) rxSumSq += double(s[i]) * double(s[i]);
        rxSamples += n;
        rxFrames += n / 320;
    }, Qt::QueuedConnection);

    // «Микрофон»: 440 Гц, −12 dBFS, кадры по 20 мс
    double phase = 0.0;
    QTimer mic;
    mic.setTimerType(Qt::PreciseTimer);
    QObject::connect(&mic, &QTimer::timeout, &call, [&] {
        std::vector<int16_t> frame(320);
        for (auto& v : frame) {
            v = static_cast<int16_t>(8192.0 * std::sin(phase));
            phase += 2.0 * kPi * 440.0 / 16000.0;
        }
        if (phase > 2.0 * kPi) phase = std::fmod(phase, 2.0 * kPi);
        call.pushMicFrame(QByteArray(reinterpret_cast<const char*>(frame.data()),
                                     static_cast<int>(frame.size() * 2)));
        if (call.state() == "incall") ++txFrames;
    });
    mic.start(20);

    QTimer stats;
    QObject::connect(&stats, &QTimer::timeout, &call, [&] {
        QJsonObject o;
        o["event"] = "stats";
        o["state"] = call.state();
        o["rx_frames"] = rxFrames;
        o["rx_rms"] = rxSamples > 0 ? std::sqrt(rxSumSq / double(rxSamples)) : 0.0;
        o["tx_frames"] = txFrames;
        emitLine(o);
    });
    stats.start(500);

    QTimer::singleShot(args.value(timeoutOpt).toInt() * 1000, &call, [&] {
        emitLine({ { "event", "notice" }, { "text", "timeout" } });
        finish(2);
        call.hangup();
    });

    // stdin: "hangup" — положить трубку (поток чтения живёт до конца процесса)
    std::thread([&app, &call] {
        std::string pending;
        char buf[256];
        for (long n; (n = readStdin(buf, sizeof(buf))) > 0;) {
            pending.append(buf, static_cast<size_t>(n));
            for (size_t eol; (eol = pending.find('\n')) != std::string::npos; pending.erase(0, eol + 1)) {
                if (pending.compare(0, eol, "hangup") == 0)
                    QMetaObject::invokeMethod(&app, [&call] { call.hangup(); }, Qt::QueuedConnection);
            }
        }
    }).detach();

    QNetworkRequest req{ QUrl(wsUrlFor(server)) };
    req.setRawHeader("Authorization", ("Bearer " + token).toUtf8());
    ws.open(req);

    app.exec();
    return exitCode;
}
