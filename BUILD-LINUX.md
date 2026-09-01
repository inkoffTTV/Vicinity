# Building Vicinity on Linux (CachyOS / Arch)

The Drogon backend and Qt 6 client are cross-platform. On Linux, audio uses ALSA
(typically routed through PipeWire); on Windows it uses WinMM.

## 1. Dependencies

CachyOS / Arch:

```bash
sudo pacman -S --needed base-devel cmake git \
    qt6-base qt6-declarative qt6-websockets qt6-shadertools qt6-wayland \
    alsa-lib jsoncpp openssl sqlite c-ares brotli zlib

paru -S drogon
```

The client also needs libdatachannel, Opus and OpenH264. Install them using your
preferred package manager or build method if they are not already available.

## 2. Clone and build

```bash
git clone https://github.com/inkoffTTV/Vicinity.git
cd Vicinity

# Backend
cmake -S backend -B build-linux/backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/backend -j$(nproc)

# Client
cmake -S client -B build-linux/client -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/client -j$(nproc)
```

Or use:

```bash
chmod +x build-linux.sh
./build-linux.sh
```

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

- Linux audio uses the ALSA `default` device.
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
