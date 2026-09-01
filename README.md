# Vicinity

[![C++17](https://img.shields.io/badge/C%2B%2B-17-blue.svg)](https://isocpp.org/)
[![Qt 6](https://img.shields.io/badge/Qt-6-41CD52.svg)](https://www.qt.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Backend CI](https://github.com/inkoffTTV/Vicinity/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/inkoffTTV/Vicinity/actions/workflows/backend-ci.yml)

# Vicinity

**Vicinity** is a desktop real-time messenger built with C++17, Qt 6/QML and a Drogon backend.

It combines Discord-style servers and channels with direct messaging, voice channels, WebRTC calls, camera video, screen sharing, profiles, roles and UI customization.

> **Status:** alpha / active development. Windows is the primary platform; Linux support is available.

## Highlights

- Real-time direct messages over WebSocket
- Servers, text channels, members and roles
- Voice channels with speaking indicators and device controls
- 1:1 WebRTC calls
- Opus audio and H264 video
- Camera video and screen sharing
- Message reactions, editing, deletion and image attachments
- Profiles, presence and customizable themes
- Bearer-token authentication and rate limiting
- PBKDF2 password processing and hashed session tokens
- Windows installer and Linux build support

## Architecture

```text
+------------------------+         HTTP / WebSocket         +------------------------+
|   Vicinity Desktop     | <------------------------------> |   Drogon C++ Backend   |
|   Qt 6 / QML / C++17   |                                  |                        |
|                        |                                  | REST API               |
| AppState               |                                  | Authentication         |
| ApiClient              |                                  | Rate limiting          |
| NetworkManager         |                                  | Presence               |
| VoiceEngine            |                                  | Message routing        |
| VideoEngine            |                                  | Voice relay            |
| CallEngine             |                                  +-----------+------------+
+-----------+------------+                                              |
            |                                                           v
            | WebRTC 1:1                                         +-----------+
            +---------------------------------------------------> |  SQLite   |
                                                                  +-----------+
```

WebSocket is used for live messaging, presence and server voice transport. Direct 1:1 calls use WebRTC through libdatachannel, with Opus for audio and H264 for video.

## Tech stack

| Area | Technology |
| --- | --- |
| Language | C++17 |
| Desktop UI | Qt 6, Qt Quick, QML |
| Backend | Drogon |
| Database | SQLite |
| Realtime | WebSocket |
| Calls | WebRTC / libdatachannel |
| Media | Opus, OpenH264 |
| Build system | CMake |
| Deployment | Docker / Docker Compose / coturn |
| Installer | Inno Setup |

## Repository structure

```text
Vicinity/
├── client/       # Qt/QML desktop application
├── backend/      # Drogon REST/WebSocket server
├── shared/       # Shared protocol and crypto definitions
├── deploy/       # Docker/coturn deployment files
├── installer/    # Windows Inno Setup installer
├── BUILD-LINUX.md
└── DEPLOY-VPS.md
```

## Screenshots

Project screenshots will be added as the UI is prepared for the public portfolio.

<!--
Suggested structure once screenshots are ready:

<p align="center">
  <img src="docs/screenshots/chat.png" width="49%" alt="Vicinity chat">
  <img src="docs/screenshots/call.png" width="49%" alt="Vicinity call">
</p>
-->

## Building

### Windows

The client uses Qt 6 and CMake. WebRTC/media dependencies are expected through vcpkg:

- libdatachannel
- opus
- openh264

The backend requires Drogon and OpenSSL.

Typical build flow:

```powershell
cmake -S backend -B build/backend -DCMAKE_BUILD_TYPE=Release
cmake --build build/backend --config Release

cmake -S client -B build/client -DCMAKE_BUILD_TYPE=Release
cmake --build build/client --config Release
```

### Linux

See [BUILD-LINUX.md](BUILD-LINUX.md) for Linux dependencies and build instructions.

## Running locally

Start the backend first, then launch the desktop client and use:

```text
127.0.0.1:8080
```

as the server address.

For VPS/Docker deployment, see [DEPLOY-VPS.md](DEPLOY-VPS.md).

## Security notes

Vicinity currently includes:

- PBKDF2-based password processing
- Hashed session tokens
- Bearer-token authentication
- Authentication filters
- Request rate limiting

Vicinity is still under active development and has not undergone a formal security audit.

## Roadmap

- Public VPS deployment / test environment
- Improved presence indicators
- Friends screen
- Richer live profile presence
- Role badge colors
- DM previews and ordering improvements
- Automatic updates
- Polished release builds
- Public screenshots and demo media

## Development

Vicinity is an independent engineering project.

AI-assisted development tools were used as part of the workflow for implementation support, debugging and documentation. Architecture, integration, testing and product decisions remain part of the engineering work behind the project.

## License

Released under the [MIT License](LICENSE).
