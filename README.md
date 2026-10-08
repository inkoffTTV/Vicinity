# Vicinity

[![C++17](https://img.shields.io/badge/C%2B%2B-17-blue.svg)](https://isocpp.org/)
[![Qt 6](https://img.shields.io/badge/Qt-6-41CD52.svg)](https://www.qt.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Backend CI](https://github.com/inkoffTTV/Vicinity/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/inkoffTTV/Vicinity/actions/workflows/backend-ci.yml)
[![Web CI](https://github.com/inkoffTTV/Vicinity/actions/workflows/web-ci.yml/badge.svg)](https://github.com/inkoffTTV/Vicinity/actions/workflows/web-ci.yml)
[![E2E](https://github.com/inkoffTTV/Vicinity/actions/workflows/e2e.yml/badge.svg)](https://github.com/inkoffTTV/Vicinity/actions/workflows/e2e.yml)
[![Docker](https://github.com/inkoffTTV/Vicinity/actions/workflows/docker.yml/badge.svg)](https://github.com/inkoffTTV/Vicinity/actions/workflows/docker.yml)

**Vicinity** is a real-time messenger with a Qt 6/QML desktop client, a React web client and a C++17
Drogon backend.

It combines Discord-style servers and channels with direct messages and group chats, voice channels,
WebRTC calls with camera video and screen sharing, profiles, roles and UI customization. The desktop
and web clients share one backend and one account base, and talk to each other in voice channels and calls.

> **Status:** alpha / active development. Windows is the primary desktop platform; Linux builds are
> supported. The web client runs in any modern browser.

## Highlights

**Messaging**
- Direct messages, group chats, servers with text and voice channels, roles and invites
- Real-time delivery over WebSocket; one account can be online on the desktop and in several browser tabs at once
- Editing, deletion, reactions, image and file attachments (up to 15 MB)
- Replies, pinned messages, search, typing indicators and read state with unread/@mention counters
  synchronized across devices (see the [API contract](docs/API.md))
- Friends, presence, profiles with avatar, banner, bio, pronouns and accent color

**Voice and calls**
- Voice channels on servers and voice rooms in DMs/groups, with speaking indicators, mute/deafen and device selection
- Per-speaker mixing (voice protocol v2) while older desktop builds keep using protocol v1
- 1:1 WebRTC calls with Opus audio, H264 camera video and screen sharing — desktop↔desktop,
  browser↔browser and desktop↔browser
- TURN relay (coturn) with short-lived credentials issued by the server, so calls work behind NAT

**Web client** ([web/](web/README.md))
- Optimistic sending with retry, per-channel drafts, history paging
- Survives network drops: keepalive, reconnect with catch-up, no logout on server outages
- Image upload by button, paste and drag & drop; browser notifications; mobile layout; light/dark theme
- Server and profile management, friends, keyboard-accessible message actions

**Security**
- PBKDF2 password hashing, hashed session tokens, session list and remote logout, password change
  that closes other sessions
- Access checks on every channel, message, upload and voice operation; call signaling only between friends or DM partners
- Per-IP limits for login/registration and per-user limits for messages, uploads, friend requests and search;
  client IPs taken from `X-Real-IP` only behind configured proxies
- Upload signature checks, executable/HTML deny-list, `nosniff` and download-only attachments,
  path traversal protection, malformed WebSocket frames rejected safely
- nginx with a strict Content-Security-Policy and security headers; HTTPS via Caddy or the host's proxy

**Deployment**
- Docker Compose: backend, nginx web front, coturn and an optional Caddy with automatic Let's Encrypt
- Coexists with an existing nginx/Caddy (e.g. a Telegram bot) on the same VPS
- Health checks, log rotation, `backup.sh` (online SQLite backup + uploads) and `update.sh`
- Windows installer (Inno Setup) and Linux build instructions for the desktop client

## Architecture

```text
  Clients                                    VPS: docker compose (deploy/)
 ┌───────────────────────┐    HTTPS     ┌──────────────────────┐    ┌───────────────────────┐
 │ Web client            │ ───────────► │ Caddy (profile       │ ─► │ web: nginx            │
 │ React · TS · Vite     │              │ "https") or the      │    │ static app, proxies   │
 └───────────────────────┘              │ host's nginx/Caddy   │    │ /api /ws /uploads     │
                                        └──────────────────────┘    └───────────┬───────────┘
                                                                                ▼
 ┌───────────────────────┐   REST + WebSocket, :8080 or HTTPS     ┌───────────────────────────┐
 │ Desktop client        │ ─────────────────────────────────────► │ vicinity: Drogon (C++17)  │
 │ Qt 6 · QML · C++17    │                                        │ REST API, WebSocket,      │
 │ libdatachannel, Opus, │                                        │ presence, voice relay,    │
 │ OpenH264              │                                        │ auth, rate limits         │
 └───────────────────────┘                                        └──────┬──────────┬─────────┘
                                                                         ▼          │ TURN credentials
                                                                 ┌──────────────┐   │ (shared secret)
                                                                 │ SQLite +     │   ▼
                                                                 │ uploads      │ ┌──────────────────┐
                                                                 │ (volume)     │ │ coturn: TURN/STUN│
                                                                 └──────────────┘ └──────────────────┘
```

- **Messages, presence and voice channels** go through the server's WebSocket: voice is 16 kHz PCM frames
  relayed to the other members of the channel.
- **1:1 calls** are WebRTC between the two clients (libdatachannel on the desktop, `RTCPeerConnection` in
  the browser), relayed through coturn when no direct path exists. The signaling and SDP details are in
  [docs/CALLS.md](docs/CALLS.md).
- Desktop clients connect either directly to `http://server:8080` or through the HTTPS domain; browsers
  always use HTTPS, which they require for the microphone, camera and screen sharing.

## Tech stack

| Area | Technology |
| --- | --- |
| Language | C++17, TypeScript |
| Desktop UI | Qt 6, Qt Quick, QML |
| Web UI | React 18, Vite, zustand |
| Backend | Drogon |
| Database | SQLite |
| Realtime | WebSocket |
| Calls | WebRTC (libdatachannel / browser), coturn |
| Media | Opus, OpenH264 |
| Build system | CMake, npm |
| Deployment | Docker Compose, nginx, Caddy, coturn |
| Tests and CI | Playwright end-to-end tests, GitHub Actions |
| Installer | Inno Setup |

## Repository structure

```text
Vicinity/
├── backend/      # Drogon REST/WebSocket server
├── client/       # Qt/QML desktop application
├── web/          # React web client and Playwright e2e tests (web/e2e)
├── shared/       # Shared protocol and crypto definitions
├── deploy/       # Docker Compose, nginx, Caddy, coturn, backup/update scripts
├── docs/         # API contract, call protocol, deployment helper
├── installer/    # Windows Inno Setup installer
├── BUILD-LINUX.md
└── DEPLOY-VPS.md
```

## Documentation

| Document | Contents |
| --- | --- |
| [DEPLOY-VPS.md](DEPLOY-VPS.md) | Step-by-step VPS deployment with HTTPS and TURN, updates, backups, troubleshooting (Russian) |
| [docs/LOCAL-CLAUDE-DEPLOY.md](docs/LOCAL-CLAUDE-DEPLOY.md) | Ready prompt for deploying or updating a VPS with a local Claude Code session (Russian) |
| [docs/API.md](docs/API.md) | REST and WebSocket API contract, compatibility rules |
| [docs/CALLS.md](docs/CALLS.md) | Voice and call protocol, desktop ↔ browser interoperability |
| [web/README.md](web/README.md) | Web client features, development and e2e tests |
| [BUILD-LINUX.md](BUILD-LINUX.md) | Building the backend and desktop client on Linux |

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

### Web client

```bash
cd web
npm ci
npm run build        # type check + production build into web/dist
```

## Running locally

Start the backend first (it reads `config.json` from its working directory), then launch the desktop
client and use

```text
127.0.0.1:8080
```

as the server address. For the web client, run `npm run dev` in `web/` and open `http://localhost:5173`
(API and WebSocket requests are proxied to `http://localhost:8080`).

For a VPS/Docker deployment, see [DEPLOY-VPS.md](DEPLOY-VPS.md).

## Testing

The Playwright suite starts a real backend with a fresh database and the production web build:

```bash
cd web
npm ci
npx playwright install chromium
VICINITY_SERVER_BIN=../build/backend/VicinityServer npx playwright test
```

CI runs the backend and web builds, the e2e suite and a Docker build with a compose smoke test
(`.github/workflows`).

## Security notes

Vicinity currently includes:

- PBKDF2-based password processing and hashed session tokens
- Bearer-token authentication, session management and access checks on every channel operation
- Per-IP and per-user rate limiting
- Upload validation and safe serving of user files
- HTTPS deployment with a strict Content-Security-Policy for the web client

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
