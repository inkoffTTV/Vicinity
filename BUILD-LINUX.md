# Building Vicinity on Linux

The Drogon backend and the Qt 6 desktop client are cross-platform. On Linux the
client uses ALSA for audio (usually routed through PipeWire or PulseAudio); on
Windows it uses WinMM.

## 1. Requirements

| Component | Version | Why |
|---|---|---|
| CMake, C++17 compiler | CMake ≥ 3.16 | |
| Qt | **≥ 6.6** | `Shape.preferredRendererType` (icons, gradients) needs 6.6; screen sharing (`QScreenCapture`) needs 6.5. Modules: Core, Gui, Qml, Quick, QuickControls2, WebSockets, Network, Sql, Multimedia (with the FFmpeg backend), plus the QML modules QtQuick.Shapes, QtQuick.Effects and QtQuick.Dialogs |
| libdatachannel | **≥ 0.23** | 1:1 calls (WebRTC); the client needs its CMake package `LibDataChannel` |
| Opus | ≥ 1.3 | call audio; found through its CMake package or, failing that, pkg-config |
| OpenH264 | ≥ 2.0 | call video (camera and screen) |
| ALSA (`libasound`) | any | microphone and speakers |

The backend needs Drogon 1.9, JsonCpp, OpenSSL, SQLite3, c-ares, Brotli and zlib.

Verified configuration: Qt 6.8.3, libdatachannel 0.23.2, Opus 1.4, OpenH264 2.6.0,
GCC 13.3, CMake 3.28.

### Arch / CachyOS

```bash
sudo pacman -S --needed base-devel cmake git pkgconf \
    qt6-base qt6-declarative qt6-websockets qt6-multimedia qt6-multimedia-ffmpeg \
    qt6-shadertools qt6-wayland \
    libdatachannel opus openh264 alsa-lib \
    jsoncpp openssl sqlite c-ares brotli zlib

paru -S drogon
```

Check that `pacman -Q libdatachannel` reports 0.23 or newer; otherwise build it
from source (below).

### Debian / Ubuntu

```bash
sudo apt install build-essential cmake git pkg-config \
    libasound2-dev libopus-dev libopenh264-dev libssl-dev
```

Ubuntu 24.04 and Debian 12 ship Qt 6.4, which is too old for the client. Use a
distribution with Qt ≥ 6.6 (for example Ubuntu 25.04 with Qt 6.8: `qt6-base-dev qt6-declarative-dev
qt6-websockets-dev qt6-multimedia-dev` plus the `qml6-module-*` packages for the
QML imports: QtQuick Controls, Layouts, Window, Shapes, Effects, Dialogs and
QtMultimedia),
or install Qt with the Qt online installer, `aqtinstall` or conda-forge (`qt6-main`)
and pass its prefix in `CMAKE_PREFIX_PATH`.

### libdatachannel from source

```bash
git clone --recursive --branch v0.23.2 https://github.com/paullouisageneau/libdatachannel.git
cmake -S libdatachannel -B libdatachannel/build -DCMAKE_BUILD_TYPE=Release \
    -DNO_EXAMPLES=ON -DNO_TESTS=ON
cmake --build libdatachannel/build -j"$(nproc)"
sudo cmake --install libdatachannel/build      # into /usr/local
```

## 2. Build

```bash
git clone https://github.com/inkoffTTV/Vicinity.git
cd Vicinity

# Backend
cmake -S backend -B build-linux/backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/backend -j"$(nproc)"

# Client
cmake -S client -B build-linux/client -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/client -j"$(nproc)"
```

If Qt or libdatachannel live outside the system prefixes, list them
(semicolon-separated) when configuring, for example
`-DCMAKE_PREFIX_PATH="$HOME/Qt/6.8.3/gcc_64;/usr/local"`. CMake also reads a
colon-separated `CMAKE_PREFIX_PATH` environment variable, which works with
`build-linux.sh` as well.

Or use the script, which builds both:

```bash
chmod +x build-linux.sh
./build-linux.sh
```

### Call interop harness (optional)

`-DVICINITY_BUILD_INTEROP=ON` additionally builds `call_interop`: the desktop call
engine without QML or audio devices, driven over the real WebSocket. It is used by
the browser↔desktop call tests in `web/e2e/d-interop.spec.ts`:

```bash
cmake -S client -B build-linux/client -DCMAKE_BUILD_TYPE=Release -DVICINITY_BUILD_INTEROP=ON
cmake --build build-linux/client -j"$(nproc)"
cd web && npm ci && VICINITY_SERVER_BIN="$PWD/../build-linux/backend/VicinityServer" \
    VICINITY_INTEROP_BIN="$PWD/../build-linux/client/call_interop" npx playwright test e2e/d-interop.spec.ts
```

Without `VICINITY_INTEROP_BIN` those tests are skipped.

## 3. Run

```bash
# Terminal 1: backend
cd build-linux/backend
./VicinityServer

# Terminal 2: client (from repository root)
./build-linux/client/Vicinity
```

The backend listens on port `8080`. For a local setup, enter this server address
in the client:

```text
127.0.0.1:8080
```

## Audio notes

- Linux audio uses the ALSA `default` device; voice and call audio are played on a
  separate thread and mixed per speaker.
- PipeWire/PulseAudio can route the application to the desired input/output.
- If audio is not working, inspect devices with `wpctl status` or `pavucontrol`.
- Windows supports device selection in the current UI; Linux currently relies
  on the system default device.

## Client data

Qt settings are stored under the user's configuration directory, typically:

```text
~/.config/Vicinity/Vicinity.conf
```

For server deployment, see [DEPLOY-VPS.md](DEPLOY-VPS.md).
