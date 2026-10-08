# Vicinity browser interop spec: voice channels and 1:1 calls (browser ↔ desktop)

Справочник по протоколу голосовых каналов и звонков 1:1 между десктоп-клиентом (libdatachannel) и браузером. Ссылки на строки соответствуют состоянию кода на момент анализа (до доработок из docs/API.md); поведение SDP проверено на libdatachannel 0.22.5 с копией `CallEngine::setupPeer`.

---

## 0. Summary

| Topic | Fact |
|---|---|
| Voice channels | Raw PCM over the existing `/ws` WebSocket as binary messages. Format: s16le, 16 kHz, mono, 320 samples (640 bytes, 20 ms) per message. There is **no header at all**: no sender id, no sequence number, no timestamp, no codec. The server relays the bytes unchanged. Opus is **not** used here. |
| Telling speakers apart | Not possible. The server does not add a sender id (`WSController.cc:109-116`). The desktop writes every frame, in arrival order, into one output device without mixing. |
| Speaking indicator | Separate JSON message `voice_speaking`. Detection is RMS > 380 (int16 scale, about −38.7 dBFS) on each 20 ms frame, after mic gain, with a 300 ms hold. |
| 1:1 calls | WebRTC through libdatachannel. **The caller always creates the offer.** The SDP is inside `call_invite` (`sdp`, `sdpType`) and `call_accept`. ICE is trickled as `rtc_ice {candidate, mid}`. `rtc_offer` and `rtc_answer` are relayed by the server but **never used by the desktop**, so there is no renegotiation. |
| Media | Three fixed m-lines with mids **`audio`, `video`, `screen`**. Opus is fixed at PT 111. H264 is fixed at PT 96 (`42e01f`, `packetization-mode=1`) on both video lines. Fixed SSRCs 42/43/44. One SCTP data channel `"ctrl"` (created by the caller, mid `"0"`) carries `{"video":bool,"screen":bool}`. |
| ICE | Hardcoded `stun:stun.l.google.com:19302` only (`client/main.cpp:37`). No TURN is configured in the client and no backend endpoint provides ICE servers. |
| Browser role | **The browser can safely be the answerer only.** A stock browser offer to the current desktop produces an answer with every media line rejected (shown in §4.1). Browser-initiated calls need a desktop change (§6) or fragile workarounds (§5.3). |
| Hard prerequisites | (1) The page must be served over HTTPS. The web container listens on plain `http:80` (`deploy/nginx.conf:3`, `docker-compose.yml:17-27`), and `getUserMedia`, `getDisplayMedia` and `AudioWorklet` only work in a secure context. (2) Test with **two different accounts**: the server keeps one WebSocket per user (§1.2). |

---

## 1. Transport basics that affect both features

### 1.1 WebSocket
- URL is `/ws`. The desktop sends `Authorization: Bearer <token>` (`NetworkManager.cc:66-69`). The browser uses `/ws?token=` (`AuthFilter.cc:12-14`, `web/src/lib/ws.ts:52`).
- Server JSON is produced with `Json::FastWriter`, so **every server text message ends with `"\n"`**. `JSON.parse` accepts this.
- The server reads `channel_id`, `server_id` and `to` with `asInt64()`, and `speaking` with `asBool()`. **Send them as JSON numbers and booleans.** JsonCpp throws on a string value.
- Binary messages are handled only as voice (`WSController.cc:109`). The browser must set `ws.binaryType = 'arraybuffer'`. Today `web/src/lib/ws.ts:62` throws binary frames away.
- nginx `location = /ws` (`deploy/nginx.conf:25-35`) already passes binary frames. Timeouts are 1 h and the client pings every 25 s.

### 1.2 One connection per user (critical when testing)
- `WSManager::addConnection` does `connections_[user_id] = conn` (`WSManager.cc:12`), so a newer connection replaces the older one.
- When any of that user's connections closes, `removeConnection(user_id)` (`WSManager.cc:18`) **removes whatever connection is currently registered**. It also calls `VoiceManager::leave` and re-broadcasts presence (`WSController.cc:196-205`).
- Consequences:
  - With the same account logged in on desktop and web, only the newest connection receives signalling and voice.
  - When the old connection closes or reconnects, it unregisters the new one.
  - Any WebSocket reconnect silently removes the user from their voice channel.

---

## 2. Voice channels

### 2.1 JSON control messages

| Direction | Message | Server behaviour |
|---|---|---|
| C→S | `{"type":"voice_join","channel_id":<int>}` | `VoiceManager::join` automatically leaves the previous channel. Then `voice_state` is broadcast for the new channel and, if different, the old one (`WSController.cc:132-139`). **No authorisation**: it does not check that the channel is a voice channel or that the user is a member. Anyone who knows a channel id can listen in. |
| C→S | `{"type":"voice_leave"}` | Leave, then broadcast `voice_state` (`:140-144`). |
| C→S | `{"type":"voice_speaking","speaking":<bool>}` | Only accepted if the sender is in a voice channel. Re-sent as `{"type":"voice_speaking","user_id":<int>,"speaking":<bool>}` to the **other members of that voice channel only**, not to the sender and not to everyone on the server (`:145-158`). |
| C→S | `{"type":"voice_query","server_id":<int>}` | For every `is_voice=1` channel of that server, sends one `voice_state` to the requester only, including empty channels (`:159-172`). No membership check. |
| S→C | `{"type":"voice_state","channel_id":<int>,"users":[{"user_id":<int>,"name":"<display_name>"}]}` | Built at `:43-63`. For a server channel it goes to all server members (`:70-75`). For a DM or group it goes to `channel_members` (`:79-83`). Otherwise it goes to the users in the channel. It has **no speaking or mute fields**. The desktop resets every member's speaking flag to false whenever it receives one (`ChatView.qml:170-178`). |
| — | Implicit leave | The WebSocket closed (`:199-200`). |

How the desktop uses these:
- On join it sends `voice_join`, starts `VoiceEngine`, and stores `myVoiceChannel` (`ChatView.qml:373-379`). On leave it sends `voice_leave` and stops the engine (`:381-387`).
- After loading a server's channel list it sends `voice_query` (`ChatView.qml:133`).
- It sends `voice_speaking` only when `myVoiceChannel != 0`, and updates its own indicator locally because the server does not echo it back (`ChatView.qml:274-279`).
- **DM voice rooms:** the desktop also lets users `voice_join` a **DM channel id** (`ChatView.qml:949-1047`, buttons at `:1045-1046`). This is the older call path, so it can show up in DMs as well.
- The desktop does **not** re-send `voice_join` after a WebSocket reconnect (it is a bug). Its UI still shows it as in the channel, but the server has dropped it.

### 2.2 Binary frame format (exact)

```
WebSocket binary message = raw PCM payload, nothing else
+-----------------------------------------------+
| int16 LE sample[0] | int16 LE sample[1] | ... |   N samples, N*2 bytes
+-----------------------------------------------+
```

| Property | Value | Source |
|---|---|---|
| Header | **None**: no sender id, sequence, timestamp, codec or version | `VoiceEngine.cc:183/251`, `main.cpp:29-30`, `NetworkManager.cc:83-86` |
| Codec | Uncompressed PCM. Opus is not used for voice channels. | `VoiceEngine.h:23-25` |
| Sample format | Signed 16-bit, **little-endian** (`SND_PCM_FORMAT_S16_LE`; winmm `WAVE_FORMAT_PCM` 16-bit) | `VoiceEngine.cc:218-224`, `:89` |
| Sample rate / channels | 16000 Hz, mono | `VoiceEngine.cc:89`, `:218-224` |
| Frame size | 320 samples = **640 bytes = 20 ms** (`kFrameSamples`/`kFrameBytes`) | `VoiceEngine.h:84-85` |
| Exact length | Windows: `dwBytesRecorded` of a 640-byte buffer, normally 640 (`VoiceEngine.cc:177-183`). Linux: `snd_pcm_readi` result × 2, normally 640 but can be shorter (`:243-251`). **Receivers must accept any even length.** | |
| Rate | 50 messages/s per **unmuted** user. Silence is sent too: there is no VAD gating. That is 32 kB/s (256 kbit/s) of payload per sender. | |
| Muted | Nothing is sent, and the speaking flag is forced to false (`VoiceEngine.cc:178,185`, `:247`) | |
| Gain | Mic gain 0–200 % is applied **before** sending (`VoiceEngine.cc:31`, `:180-182`, `:248-250`). Output volume 0–100 % is applied at playback. | |

**Server relay** (`WSController.cc:109-116`): if the sender is in voice channel `ch`, the identical bytes go to every other user in `ch` through `sendBinaryToUser`. The bytes are not changed, nothing is prepended, and there is no rate limit or validation.

**How the desktop receives:**
- `binaryReceived → VoiceEngine::playFrame`, connected directly on the GUI thread (`main.cpp:31-32`).
- There is no jitter buffer and no mixing:
  - **Windows** (`VoiceEngine.cc:192-204`): a ring of 24 `WAVEHDR`s, at most about 480 ms queued. If the next slot is still queued, the frame is **dropped** (`:195`).
  - **Linux** (`:256-271`): blocking `snd_pcm_writei` with roughly 100 ms ALSA latency (`:218-224`). On underrun it calls `prepare` and writes again. On overflow it **blocks the GUI thread**.
- With two or more simultaneous speakers, their frames are played **one after another**, not mixed. Each receiver gets (N−1)×50 frames per second, which exceeds real time. The result is choppy audio or drops on Windows and growing latency or a stalled GUI on Linux.

**Desktop-side quirks to be aware of:**
- `VoiceEngine::frameCaptured` is always connected to `NetworkManager::sendBinary` (`main.cpp:29-30`). During a 1:1 call the desktop therefore also streams PCM to the WebSocket, and the server drops it unless the user is in a voice channel.
- `CallEngine::teardown` stops `VoiceEngine` unconditionally (`CallEngine.cc:565-566`; the comment says otherwise). Ending a call cuts voice-channel audio while the server still lists the user as joined.

### 2.3 Speaking detection (match this so indicators behave the same)
- `VoiceEngine::detectSpeaking` (`VoiceEngine.cc:71-82`) computes the RMS of one captured frame (320 int16 samples, after gain).
  - `rms > 380.0` marks the moment as "loud".
  - Speaking = less than 300 ms since the last loud frame.
  - An event fires only when the state changes.
- Float equivalent: threshold `380/32768 ≈ 0.011597` RMS (about −38.7 dBFS), hold 300 ms.
- Muting forces `speaking=false` (`:185`, `:247`).

### 2.4 Browser implementation for voice channels (compatible with today's desktop)

**Capture path**
1. `getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true}})`. Do this from a user gesture ("Join") and resume the `AudioContext` there.
2. `AudioWorklet` capture processor: downmix to mono, resample to 16 000 Hz, then build 320-sample `Int16Array`s.
   - Clamp with `Math.max(-1, Math.min(1, x)) * 32767`.
   - Apply the mic-gain slider before converting.
   - Send each frame to the main thread with `port.postMessage(buf.buffer, [buf.buffer])`.
3. Resampling:
   - First try `new AudioContext({sampleRate:16000})`. Chrome resamples the mic itself.
   - **Pitfall:** Firefox has historically thrown `NotSupportedError` for a `MediaStreamAudioSourceNode` whose context rate differs from the device rate. Catch that, fall back to a default-rate context, and resample inside the worklet. For 48 k→16 k: low-pass at about 7 kHz (FIR or biquad), then decimate by 3. For 44.1 k: low-pass, then fractional or linear interpolation.
4. Sending, on the main thread:
   - `if (ws.bufferedAmount < 64*1024) ws.send(frame.buffer)`. Drop frames under backpressure; do not queue seconds of audio.
   - `ArrayBuffer`/`Int16Array` use the platform's byte order, which is little-endian on every browser platform in practice. For strict correctness, write with `DataView.setInt16(off, v, true)`.
   - Send exactly 640-byte frames.
5. Speaking: apply the RMS and hold logic from §2.3 to each outgoing int16 frame. On a change, send `{"type":"voice_speaking","speaking":b}` and update your own indicator locally.
6. Mute: stop sending entirely (like the desktop) and send `speaking:false` if needed.
7. Optional, still compatible: send only while "speaking" plus about 300 ms of hangover. Receivers simply play whatever arrives. Both desktop paths tolerate gaps: ALSA recovers from `EPIPE` (`VoiceEngine.cc:269`) and winmm just idles. This greatly reduces the desktop's multi-speaker problem. The desktop could adopt the same gating.

**Playback path**
1. Set `ws.binaryType='arraybuffer'`. Every binary message is PCM from **some** member of your current voice channel.
2. An `AudioWorklet` playback processor holds a FIFO ring of 16 kHz float samples.
   - Use a 16 kHz `AudioContext` for playback, or upsample in the worklet.
   - Convert with `int16/32768`.
3. Jitter policy, to bound latency the way the desktop does:
   - Pre-buffer about 60 ms before starting.
   - If the FIFO exceeds about 200–300 ms, discard the oldest samples down to about 80 ms.
   - On underrun, output zeros and pre-buffer again.
4. Multiple speakers: without a sender id they cannot be separated. Two options:
   - (a) Behave like the desktop: one FIFO, accept drops.
   - (b) Heuristic: give each frame a 20 ms slot based on its arrival time and **sum** frames that land in the same slot. TCP/WebSocket burstiness causes false collisions, so (a) is the safer default.
   - The real fix is a v2 framing with a sender header (§6, S3).
5. Echo: the desktop has no AEC. In Chrome, audio played through Web Audio has historically **not** been used as the echo-cancellation reference; only WebRTC-rendered audio was. **(verify on your target Chrome)** Workarounds: headphones, or route the playback worklet through `MediaStreamAudioDestinationNode`, a local loopback `RTCPeerConnection`, and an `<audio>` element.
6. Lifecycle:
   - After a WebSocket reconnect, re-send `voice_join` if you were in a channel, because the server dropped you (`WSController.cc:199`).
   - Also re-send `voice_query` (the web client already does this, `store.ts:258-267`).
   - Leave the voice channel before closing the tab when possible.

**Bundling note:** `AudioWorklet` modules must be plain JS URLs. With Vite, put them in `public/` or import with `?worker&url`. A `.ts` file imported with `?url` is not transpiled.

---

## 3. 1:1 calls

### 3.1 Server relay
`WSController.cc:183-193` handles `call_invite`, `call_accept`, `call_reject`, `call_end`, `call_busy`, `rtc_offer`, `rtc_answer` and `rtc_ice`:
- It requires a numeric `to != 0`.
- It sets `root["from"] = <sender id>`, overwriting any client-supplied value, so `from` cannot be spoofed.
- It re-serialises **all fields** and sends the result to `to`.
- There is no friendship or DM check and no call id. If the target is offline the message is silently dropped and no error comes back.

### 3.2 Messages (exact fields sent and expected by the desktop)

| Type | Desktop sends | Desktop reads |
|---|---|---|
| `call_invite` | `{"type":"call_invite","to":<int>,"sdp":"<offer SDP>","sdpType":"offer","name":"<caller display name>"}` (`CallEngine.cc:86-98`; `name` = `selfName` = `appState.displayName`, `ChatView.qml:914`) | `from`, `name`, `sdp`. Stored until accepted (`:285-293`). If not idle, it replies `call_busy` and stops (`:286-287`). |
| `call_accept` | `{"type":"call_accept","to":<int>,"sdp":"<answer SDP>","sdpType":"answer"}` (same code path, `type != "offer"`) | Ignored unless `from == peerId`. `setRemoteDescription(sdp,"answer")` is **not inside try/catch** (`:294-298`). A malformed answer throws inside a Qt/QML call, which is likely to abort the desktop. |
| `rtc_ice` | `{"type":"rtc_ice","to":<int>,"candidate":"a=candidate:1 1 UDP 2122317823 192.168.1.5 36972 typ host","mid":"audio"}` (`:99-109`). **The candidate keeps the `a=` prefix.** `mid` is always the bundle mid `"audio"` (confirmed in testing). | `candidate`, `mid`. Before accept (no PC yet, state `incoming`) candidates are queued (`:301-304`, `m_pendingIce`). Afterwards they go through `addRemoteCandidate`, with errors swallowed (`:306-309`). |
| `call_reject` | `{"type":"call_reject","to":<int>}` (`:271-274`) | Hangs up if `from == peerId` (`:311-314`). |
| `call_end` | `{"type":"call_end","to":<int>}` (`:276-279`) | Same as above. |
| `call_busy` | `{"type":"call_busy","to":<int>}` (`:287`) | Same as above. |
| `rtc_offer` / `rtc_answer` | Never sent | **Ignored.** QML only forwards the 6 types above (`ChatView.qml:166-168`). |

`sdpType` is sent but never read; the desktop infers the type from the message type. Send it anyway for symmetry.

### 3.3 Sequences

**Desktop calls browser (supported path):**
```
Desktop (caller)                          Server            Browser (callee)
startCall: setupPeer(true) [tracks audio/video/screen + DC "ctrl"]
setLocalDescription() → offer
 call_invite{to,sdp,sdpType:"offer",name} ──relay+from──▶ show ringing; keep invite
 rtc_ice{candidate:"a=candidate:…",mid:"audio"} × n ────▶ BUFFER (no PC yet)
                                                         user accepts:
                                                         new RTCPeerConnection; ondatachannel/ontrack/onicecandidate
                                                         setRemoteDescription(offer); add buffered ICE
                                                         set the 3 transceivers to sendrecv; attach mic
                                                         createAnswer; setLocalDescription
 ◀──────────────────────── call_accept{to,sdp,sdpType:"answer"}   (MUST be sent before any rtc_ice)
setRemoteDescription(answer)
 ◀──────────────────────── rtc_ice{candidate:"candidate:…",mid:"audio"} × n
ICE/DTLS → PC Connected → state "incall"; DC "ctrl" opens → both send {"video":..,"screen":..}
hangup: call_end{to} ──────────────────────────────────▶ close PC
```

**Ordering rules enforced by the desktop:**
- The desktop caller drops candidates that arrive before `call_accept`. libdatachannel throws `"Got a remote candidate without remote description"` (`impl/peerconnection.cpp:1157-1158`) and `CallEngine.cc:306-309` swallows it. The browser must therefore queue its `onicecandidate` output until it has sent `call_accept`.
- The desktop callee only queues candidates while it is in state `incoming`. A candidate that arrives before `call_invite` is dropped.
- Alternative (non-trickle): wait for gathering to complete, or about 1.5 s, then send the answer with candidates embedded. libdatachannel imports `a=candidate` lines from a remote SDP (`peerconnection.cpp:251-264`). Trickle is faster.

**States and timeouts:**
- Desktop states: `idle | outgoing | incoming | connecting | incall` (`CallEngine.h:25`). The caller stays `outgoing` until connected and only starts sending mic audio in `connecting`/`incall` (`:319`).
- The desktop has **no ring timeout**.
- If the PeerConnection goes `Disconnected`, `Failed` or `Closed`, the desktop tears down immediately (`:110-117`) **without sending `call_end`**. The browser must end the call itself on `connectionState` `failed`/`closed`, and on `disconnected` after a few seconds.
- **Glare:** with no call id, two simultaneous calls make each side answer `call_busy`, and both calls fail. Mirror that behaviour.

### 3.4 The desktop's offer SDP (libdatachannel 0.22.5 replica of `setupPeer(true)`)
```
v=0
o=rtc 3000004399 0 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE audio video screen 0
a=group:LS audio video screen
a=msid-semantic:WMS *
a=ice-options:ice2,trickle
a=fingerprint:sha-256 …
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=mid:audio
a=sendrecv
a=ssrc:42 cname:vicinity-audio
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;maxaveragebitrate=96000;stereo=1;sprop-stereo=1;useinbandfec=1
a=setup:actpass
a=ice-ufrag:… / a=ice-pwd:…
m=video 9 UDP/TLS/RTP/SAVPF 96
a=mid:video
a=sendrecv
a=ssrc:43 cname:vicinity-video
a=rtcp-mux
a=rtpmap:96 H264/90000
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtcp-fb:96 goog-remb
a=fmtp:96 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1
…
m=video 9 UDP/TLS/RTP/SAVPF 96
a=mid:screen
a=ssrc:44 cname:vicinity-screen
(same H264 lines as above)
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=setup:actpass
```
- No candidates are included in the SDP; they are trickled.
- There are **no `a=msid` lines, no `a=extmap` lines (so no transport-cc, abs-send-time, mid or audio-level extensions), no RTX and no FEC.**
- This comes from `disableAutoNegotiation=true` with explicit `setLocalDescription()` (`CallEngine.cc:80`, `:245`, `:262`).

### 3.5 Media details

**Audio** (`CallEngine.cc:11-15`, `:119-137`, `:317-340`)
- Sent: libopus `opus_encoder_create(16000, 1, OPUS_APPLICATION_VOIP)`, default bitrate, one 20 ms frame (320 samples) per RTP packet.
- RTP clock 48 kHz with the timestamp advanced by 960 per packet. It only advances when a packet is sent, so after a mute the timestamps jump in wall-clock time (a small glitch at NetEq on the browser side).
- Chain: `OpusRtpPacketizer` + `RtpDepacketizer` + `RtcpSrReporter` + `RtcpNackResponder`.
- Received: `opus_decoder_create(16000,1)` and `opus_decode(…, frame_size=320, fec=0)`.
  - **Incoming Opus packets must be ≤ 20 ms.** A 40 or 60 ms packet fails with `BUFFER_TOO_SMALL` and the audio is dropped.
  - No jitter buffer and no PLC. Audio is played straight through `VoiceEngine::playFrame`.
- Stereo or FEC from the browser is fine: the mono decoder downmixes and ignores FEC.

**Video and screen** (`:139-178`, `:343-542`)
- H264 via openh264 at PT 96, RTP clock 90 kHz, timestamps from elapsed ms × 90.
- `H264RtpPacketizer` takes Annex-B input and sends single-NAL and FU-A packets.
- Encoder settings: Baseline profile (`PRO_BASELINE`, `:376`), `CAMERA_VIDEO_REAL_TIME`, max 30 fps, IDR every 60 frames (`:365`), `CONSTANT_ID` SPS/PPS sent with every IDR, frame skipping enabled.
- Bitrate: more than 1280×720 pixels → 2.5 Mbps; more than 640×480 → 1.8 Mbps; otherwise 0.9 Mbps; max is 1.25× target (`:360-363`).
- Camera: up to 1280×720 (`VideoEngine.cc:93`).
- Screen: primary screen only (`VideoEngine.cc:133`), throttled to about 15 fps (`:181`), scaled down to ≤ 1600 px wide (`:185`). This can exceed the level 3.1 limits in `42e01f`; Chrome usually decodes it anyway.
- Receive: openh264 `DecodeFrameNoDelay` with error concealment off. On a decode error the desktop sends a PLI (`requestKeyframe`) at most once per second (`:463-469`, `:516-521`).
- Incoming PLI forces an IDR (`PliHandler`, `:152`, `:172`). Incoming NACK is answered by `RtcpNackResponder`.
- **The desktop never sends RR, REMB, NACK or TWCC** because there is no `RtcpReceivingSession` in the chain.
- The `video` and `screen` tracks are **always present in SDP**. Frames are only sent while the source is on, and turning a source on or off never renegotiates.

**Data channel "ctrl"** (`:180-225`)
- Created only by the caller with `createDataChannel("ctrl")`: reliable, ordered, empty protocol, in-band DCEP.
- The callee receives it through `onDataChannel`.
- Messages are UTF-8 JSON **text**, `{"video":<bool>,"screen":<bool>}`, sent when the channel opens and on every `VideoEngine::activeChanged`. Binary messages are ignored (`:203`).
- The receiver applies whichever keys are present.
- The desktop also flips `remoteVideo`/`remoteScreen` on when the first frame decodes (`:486-489`, `:538-540`), but **only a ctrl message turns them off**. A browser that stops its camera without sending `{"video":false}` leaves a frozen frame on the desktop.

**Screen sharing** is a separate m-line and SSRC and can run alongside the camera. The desktop UI shows the remote screen large and the camera as a picture-in-picture (`CallOverlay.qml:105-132`). Mute is not signalled: a muted desktop simply stops sending audio packets.

### 3.6 ICE servers and TURN
- Desktop: `{"stun:stun.l.google.com:19302"}` only (`main.cpp:37`).
  - libdatachannel also accepts `turn:user:pass@host:3478?transport=udp`, but nothing configures it.
  - libjuice supports UDP only, so no ICE-TCP.
- `deploy/turnserver.conf`:
  - `listening-port=3478`, `tls-listening-port=5349` (TLS is unusable as is: no `cert=`/`pkey=`).
  - `lt-cred-mech`, `realm=vicinity`, **static** `user=vicinity:REPLACE_WITH_STRONG_SECRET`.
  - Relay ports 49160–49200; `external-ip` is commented out.
  - The comments are mojibake (UTF-8 BOM plus cp1251 double encoding). Harmless.
- No backend endpoint provides ICE servers.
- Browser: use the same STUN server plus your TURN server. **TURN on the browser side alone is usually enough.** The relay address is public, and coturn grants permissions per peer IP, so a desktop with STUN only can reach it. Do not ship the static TURN password in the JS bundle; see S5 in §6.

---

## 4. Incompatibilities between a browser RTCPeerConnection and the desktop

### 4.1 A browser offer to the current desktop fails (tested)
When the desktop is the callee, `processLocalDescription` (libdatachannel `impl/peerconnection.cpp:928-1022`) behaves as follows:
- For each remote m-line whose **mid matches a local track** (`audio`/`video`/`screen`), it puts **that local track's description verbatim** into the answer. This includes PT 111 and 96 and SSRCs 42–44, regardless of the PTs in the offer.
- Remote m-lines with other mids become unhandled "incoming" tracks. With a Chrome-style offer (mids `0,1,2,3`) the answer **rejects every media line (port 0)** and bundles only the data channel. The call "connects" with no audio or video.
- The desktop's own tracks are never added to an answer.

Requirements for a browser offer to work with the current desktop:
- mids exactly `audio`, `video`, `screen`, in that order.
- `111 = opus`.
- `96 = H264 CB pm=1`.
- `a=ssrc` lines on all three.
- The "ctrl" data channel created **before** `createOffer`.

Chrome's default puts VP8 at PT 96. Firefox uses Opus at PT 109. Stock browser offers fail.

### 4.2 Requirements and pitfalls when the browser answers
1. **Answer with all three m-lines `sendrecv`.** Transceivers created by `setRemoteDescription(offer)` default to `recvonly`. Set `t.direction='sendrecv'` on all three before `createAnswer`, and turn camera or screen on later with `replaceTrack`. Since the desktop cannot renegotiate, a `recvonly` answer means the browser can never send video in that call.
2. **SSRC demux.** libdatachannel routes incoming RTP **only through the SSRC→track map from the remote SDP**; unknown SSRCs are silently dropped (`impl/peerconnection.cpp:628-640`; also the comment at `CallEngine.cc:122-124`).
   - The browser answer must contain `a=ssrc` for each sending m-line. Chrome adds them for `sendrecv` transceivers even with a null track; Firefox adds them as well. Check this once in the generated answer.
   - Do not use simulcast or `rid`. No RTX is negotiated (the desktop offers none), so retransmissions reuse the media SSRC.
3. **mids:** in the answerer role they come from the offer (`audio`/`video`/`screen`). Tell the tracks apart with `ev.transceiver.mid`, **not** with `ev.streams`. There is no `a=msid`, so `ev.streams` may be empty; build `new MediaStream([ev.track])` yourself.
4. **Candidates:**
   - Incoming desktop candidates start with `a=candidate:`. Strip the `a=` prefix (Chrome tolerates it; stripping is safer) and pass `{candidate, sdpMid: msg.mid}`.
   - Outgoing: send `e.candidate.candidate` (format `candidate:…`; libdatachannel accepts both forms, `candidate.cpp:85-88`) with `mid: e.candidate.sdpMid`.
   - Skip `null` and empty end-of-candidates events.
5. **mDNS host candidates** (`*.local`): libdatachannel resolves them with a blocking `getaddrinfo`, which can fail on the desktop. Call `getUserMedia` **before** creating the PeerConnection so the browser exposes real host IPs. STUN srflx candidates work either way.
6. **BUNDLE and RTCP mux** are mandatory: `bundlePolicy:'max-bundle'`, `rtcpMuxPolicy:'require'`. libdatachannel uses one ICE transport for everything.
7. **Codec support:**
   - H264 is the **only** video codec. Check `RTCRtpReceiver.getCapabilities('video').codecs` for `video/H264` with `packetization-mode=1` and `42e01f`.
   - Chromium builds without proprietary codecs, and Firefox without the OpenH264 plugin, cannot do video. They answer with video rejected, the desktop's video tracks never open, audio still works, and the camera button should be hidden.
   - Opus is supported everywhere. Never configure a ptime above 20 ms.
8. **No congestion feedback from the desktop.** No TWCC, no REMB and no RR mean Chrome's send-side bandwidth estimate stays near its 300 kbps start, so the browser's camera reaches the desktop at low quality.
   - Mitigation (Chrome): before `setRemoteDescription`, append `;x-google-start-bitrate=1000;x-google-min-bitrate=500;x-google-max-bitrate=2500` to `a=fmtp:96` in the desktop's offer. **(verify)**
   - Also set `sender.setParameters` with `encodings[0].maxBitrate`.
   - Desktop-to-browser video is fine: openh264 runs at a fixed rate, and the browser's NACK/PLI are honoured.
9. **No renegotiation ever.** Do not `addTrack` after connecting, do not create additional data channels, do not change direction, and ignore `negotiationneeded` after the answer. Use `replaceTrack` only.
10. **A malformed `call_accept` is likely to crash the desktop** (`CallEngine.cc:297` has no try). Always send `pc.localDescription.sdp` unmodified.
11. **Video on and off:**
    - On: `replaceTrack(track)`, then send `{"video":true,"screen":<cur>}` on "ctrl".
    - Off: `replaceTrack(null)`, `track.stop()`, then send `{"video":false,…}`.
    - Always send both keys. Send the current state when "ctrl" opens, using `ondatachannel` plus a check of `readyState==='open'`.
12. **Camera constraints:** ≤ 1280×720 at 30 fps (level 3.1). For screen sharing, `getDisplayMedia({video:{frameRate:15}})`, `track.contentHint='detail'`, `maxFramerate:15`. Handle `track.onended` (the user pressed "Stop sharing") by sending `replaceTrack(null)` plus ctrl.
13. **Fixed SSRC 42/43/44** on every desktop. This is harmless for a browser peer.
14. **Single WebSocket per user** (§1.2) and **HTTPS** (§0) apply here too.

---

## 5. Recommended browser implementation

### 5.1 Voice channels
See §2.4. Summary:
- Capture: `getUserMedia`, then a capture `AudioWorklet` that resamples to 16 kHz, packs 320-sample s16le frames and computes RMS/speaking. Send with `ws.send(ArrayBuffer)`, with backpressure.
- Playback: binary WebSocket message → playback `AudioWorklet` with a 60–300 ms FIFO.
- Control messages: `voice_join`, `voice_leave`, `voice_speaking`, `voice_query`.
- Code to change in `web/`:
  - `ws.ts:62` → set `binaryType='arraybuffer'` and add an `onBinary` listener.
  - `Sidebar.tsx:167` → join instead of the `VOICE_UNSUPPORTED` toast.
  - `store.ts` → add `myVoiceChannel`, and re-join after reconnect at `:258-267`.
- WebCodecs is **not needed**: the payload is raw PCM.

### 5.2 1:1 calls, browser as callee (works with today's desktop)
```ts
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, /* + TURN from backend */];
let pc: RTCPeerConnection | null = null, pendingRemoteIce: RTCIceCandidateInit[] = [],
    localIceQueue: any[] = [], answerSent = false, ctrl: RTCDataChannel | null = null;

// on WS: call_invite while idle -> store invite, show UI (use ev.name); busy -> send call_busy
// on WS: rtc_ice -> if (!pc || !pc.remoteDescription) pendingRemoteIce.push(toInit(ev)) else pc.addIceCandidate(toInit(ev))
const toInit = (ev: any): RTCIceCandidateInit =>
  ({ candidate: String(ev.candidate).replace(/^a=/, ''), sdpMid: ev.mid || 'audio' });

async function accept(invite: { from: number; sdp: string }) {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  pc.onicecandidate = (e) => {
    if (!e.candidate || !e.candidate.candidate) return;
    const msg = { type: 'rtc_ice', to: invite.from, candidate: e.candidate.candidate, mid: e.candidate.sdpMid };
    answerSent ? socket.send(msg) : localIceQueue.push(msg);           // never before call_accept
  };
  pc.ondatachannel = (e) => { if (e.channel.label === 'ctrl') setupCtrl(e.channel); };
  pc.ontrack = (e) => routeTrack(e.transceiver.mid!, e.track);          // 'audio' | 'video' | 'screen'
  pc.onconnectionstatechange = () => { /* failed/closed -> end; disconnected -> end after ~5s */ };

  await pc.setRemoteDescription({ type: 'offer', sdp: tuneRemoteSdp(invite.sdp) }); // optional x-google-* bitrate
  for (const c of pendingRemoteIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  const byMid = (m: string) => pc!.getTransceivers().find((t) => t.mid === m)!;
  for (const m of ['audio', 'video', 'screen']) byMid(m).direction = 'sendrecv';
  await byMid('audio').sender.replaceTrack(mic.getAudioTracks()[0]);
  await pc.setLocalDescription(await pc.createAnswer());
  socket.send({ type: 'call_accept', to: invite.from, sdp: pc.localDescription!.sdp, sdpType: 'answer' });
  answerSent = true; localIceQueue.splice(0).forEach((m) => socket.send(m));
}
function setupCtrl(ch: RTCDataChannel) {
  ctrl = ch;
  ch.onmessage = (e) => { if (typeof e.data !== 'string') return; const o = JSON.parse(e.data);
    if ('video' in o) setRemoteVideo(!!o.video); if ('screen' in o) setRemoteScreen(!!o.screen); };
  const hello = () => ch.send(JSON.stringify({ video: camOn, screen: scrOn }));
  ch.readyState === 'open' ? hello() : (ch.onopen = hello);
}
// remote audio: <audio autoplay> with srcObject = new MediaStream([track]) (accept click satisfies autoplay)
// hangup: socket.send({type:'call_end',to}); reject: {type:'call_reject',to}; on call_end/reject/busy from peer -> close
```
The current web code only supports rejecting a call: `store.ts:196-203`, `:467-471`, and `IncomingCall.tsx`. Replace it with the flow above, and also buffer `rtc_ice` and handle `call_busy`.

### 5.3 1:1 calls, browser as caller
- **Option A (recommended): make the desktop change D2 (§6).** The browser then makes a normal offer:
  - `addTransceiver('audio')`, `addTransceiver('video')` for the camera, `addTransceiver('video')` for the screen, all `sendrecv`, in that order.
  - `setCodecPreferences` on the video transceivers so H264 CB `pm=1` comes first.
  - `createDataChannel('ctrl')` before `createOffer`.
  - Send `call_invite{to, sdp, sdpType:'offer', name}`, queue ICE until the invite is sent, then apply `call_accept.sdp` as the answer.
  - Add a ring timeout (about 45 s, then `call_end`), because the server never reports an offline callee.
- **Option B (no desktop change; Chrome/Safari only; audio only):**
  - Offer with one audio transceiver plus "ctrl".
  - Rewrite the SDP **only on the wire**: before sending `call_invite`, change `a=mid:0` to `a=mid:audio` and the same in `a=group:BUNDLE`. In the received `call_accept` SDP and in `rtc_ice.mid`, change `audio` back to `0`.
  - This works because no mid header extension is negotiated, since the desktop's answer has no `extmap`, and because Chrome and Safari use Opus PT 111.
  - Abort if the local Opus PT is not 111 (Firefox uses 109).
  - There is no camera for the whole call.
- **Option C (fragile; avoid):** edit the local SDP before `setLocalDescription` to set mids `audio/video/screen` and remap H264 to PT 96. Firefox mostly rejects this and Chrome is phasing out SDP munging.

### 5.4 WebCodecs and other APIs
- Calls: `RTCPeerConnection` handles Opus and H264 natively. Do **not** use WebCodecs, insertable streams, or data-channel media.
- Voice channels today: PCM only, so `AudioWorklet` is enough.
- If voice moves to Opus (S3 in §6):
  - Use `AudioEncoder({codec:'opus', sampleRate:48000, numberOfChannels:1, bitrate:32000, opus:{frameDuration:20000}})` and `AudioDecoder({codec:'opus', sampleRate:48000, numberOfChannels:1})`.
  - Feature-detect with `isConfigSupported`, because Safari and older Firefox have gaps. Fall back to a libopus WASM build.
  - WebCodecs needs a secure context.

---

## 6. Recommended desktop, server and deploy changes (by priority)

| # | Where | Change |
|---|---|---|
| P0 | deploy | Serve the web app over **HTTPS/WSS**; without it the microphone does not work. In `turnserver.conf`: set `external-ip`, replace the static user with `use-auth-secret` + `static-auth-secret`, and add a cert/key if 5349 or `turns:` is used. |
| S1 | `WSManager.cc:12,18`, `WSController.cc:196-205` | Allow several connections per user (a set of connections). On close, remove **only that connection**, and leave voice only if it was the voice connection. |
| S2 | `WSController.cc:132-172` | `voice_join`: require `is_voice=1` (or a DM member) and membership. `voice_query`: require server membership. `call_*`: require friendship or a shared DM. Reply `{"type":"call_unavailable","to_user":…}` when the target is offline. |
| S3 | `WSController.cc:109-116` | Opt-in v2 voice framing: the client sends `{"type":"voice_join","channel_id":N,"proto":2}`. The server prepends `[u8 ver=2][u8 codec(0=PCM16k,1=Opus)][u16 seq][u32 ts][i64 sender_id LE]` for v2 receivers and strips it for v1 receivers. Clients can then mix per sender and use Opus. Do not add a header for legacy desktops: it would be played as clicks. |
| S4 | `WSController.cc` | Server-side VAD gating is not possible without parsing audio. Instead, ask clients (desktop and web) to gate sending on speaking plus hangover. |
| S5 | backend | `GET /api/rtc/ice` returning `[{urls:['stun:…','turn:host:3478?transport=udp','turn:host:3478?transport=tcp'], username:'<exp>:<uid>', credential: base64(HMAC-SHA1(secret, username))}]`. The desktop's `setIceServers` should use the same endpoint with libdatachannel URL form `turn:user:pass@host:port`. |
| D1 | `CallEngine.cc:294-298`, `:263-266` | Wrap the `call_accept` `setRemoteDescription` in try/catch. Send `call_end` to the peer on any failure in accept or remote description. |
| D2 | `CallEngine.cc:248-269`, `setupPeer` | Callee adapts to the offer. Parse `rtc::Description(offer)` first. Take the audio m-line's mid and Opus PT, the 1st and 2nd video m-line mids, and the H264 `pm=1` PT. Create local tracks with **those mids and PTs** and pass the PTs to `RtpPacketizationConfig`. This makes stock browser offers work (Option A). |
| D3 | `CallEngine.h:121` | Pick random SSRCs per call. |
| D4 | `CallEngine.cc` media chains | Add `rtc::RtcpReceivingSession` (sends RR + REMB via `requestBitrate`) so the browser's bandwidth estimate can ramp up. |
| D5 | `CallEngine.cc:565-566`, `main.cpp:29-32` | Do not stop `VoiceEngine` on call teardown while in a voice channel. Gate `frameCaptured → sendBinary` on actually being in a voice channel. |
| D6 | `ChatView.qml` | Re-send `voice_join` after a WebSocket reconnect. Add a ring timeout. |
| D7 | `VoiceEngine.cc:192-204`, `:256-271` | Real playback: a jitter buffer plus mixing per sender (with S3). Move ALSA writes off the GUI thread. |

---

## 7. Interop test checklist
1. Two **different** accounts, web over HTTPS, desktop on the same backend.
2. Voice channel test: web joins → desktop sees `voice_state` → both hear each other (web sends 640 B every 20 ms; check in Wireshark or devtools that frames are binary). Speaking rings toggle at matching loudness. Mute stops traffic. Reconnecting the web WebSocket re-joins.
3. Desktop calls web, 5 checks:
   - Ringing shows `name`.
   - `rtc_ice` received before accepting is buffered.
   - Answer contains `a=mid:audio/video/screen` and `a=ssrc` in all three m-sections.
   - Two-way audio.
   - Desktop camera and screen appear on web and are toggled by ctrl.
4. Web camera and screen in that call: desktop shows them and hides them on ctrl `false`. Check `getStats` outbound bitrate; expect about 300 kbps without the x-google workaround.
5. Hang up from each side, and reject, busy and glare cases: both sides return to idle.
6. Web calls desktop: works only with D2 (Option A), or audio only via Option B on Chrome/Safari.