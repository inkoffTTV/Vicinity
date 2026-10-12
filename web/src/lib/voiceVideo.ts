import { create } from 'zustand';
import {
  cameraConstraints,
  canShareScreen,
  mediaError,
  openScreen,
  rtcIceServers,
  screenQuality,
  stopStream,
  tuneCameraSender,
  tuneScreenSender,
  useMediaPrefs,
} from './media';
import { playSound } from './sounds';
import { useStore, VoiceUser } from './store';
import { useVoice } from './voice';
import { socket, WsEvent } from './ws';

// Видео в голосовых каналах (docs/API.md §11): голос — как раньше PCM через WebSocket, а камера и показ
// экрана — прямые WebRTC-соединения между браузерами участников (mesh). Сервер хранит, кто что транслирует
// (voice_media → поля screen/camera в voice_state), и пересылает сигналинг voice_rtc только внутри канала.
//
// Зритель шлёт watch → транслирующий создаёт RTCPeerConnection «только отправка» на каждого зрителя и вид
// трансляции и шлёт offer → зритель отвечает answer → ice в обе стороны. У ice поле sdpType говорит, чей это
// кандидат: "offer" — транслирующего, "answer" — зрителя (двое могут смотреть экраны друг друга одновременно).
// unwatch (зритель) и stop (транслирующий) закрывают соединение; stop с reason "full" — зрителей уже максимум.
// Десктоп-клиенты видео в каналах не умеют: у них просто плитки со звуком.

export type StreamKind = 'screen' | 'camera';
/** Сколько зрителей одновременно получают одну трансляцию (каждому — свой поток с нашего канала) */
export const MAX_VIEWERS = 8;
const WATCH_TIMEOUT = 15_000;
// Кандидаты ICE собираем в SDP (одно сообщение вместо десятка): ждём конца сбора, но не дольше этого.
// Сигналинг делит лимит частоты со звонками — у транслирующего на 8 зрителей это важно.
const GATHER_WAIT = 1_500;

export interface Watch {
  userId: number;
  kind: StreamKind;
  stream: MediaStream | null;
  state: 'connecting' | 'live';
}

interface VoiceVideoState {
  /** Открыт экран голосового канала в основной области */
  stageOpen: boolean;
  camera: MediaStream | null;
  screen: MediaStream | null;
  /** Качество своего показа экрана («1440p60») */
  screenLabel: string;
  /** Трансляции, которые мы смотрим: ключ `${userId}:${kind}` */
  watching: Record<string, Watch>;
  /** Сколько зрителей у своих трансляций */
  viewers: Record<StreamKind, number>;
  openStage: () => void;
  closeStage: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  watch: (userId: number, kind: StreamKind) => void;
  unwatch: (userId: number, kind: StreamKind) => void;
}

const keyOf = (userId: number, kind: StreamKind) => `${userId}:${kind}`;
const toast = (text: string, kind: 'info' | 'error' = 'info') => useStore.getState().toast(text, kind);
const meId = () => useStore.getState().me?.user_id ?? 0;

interface Peer {
  pc: RTCPeerConnection | null;
  /** SDP ушёл: кандидаты, найденные позже, — отдельными сообщениями */
  described: boolean;
  /** Кандидаты собеседника до удалённого описания */
  pendingIce: RTCIceCandidateInit[];
  closed: boolean;
  timer: number;
}

/** Свои трансляции: ключ `${зритель}:${kind}` */
const outgoing = new Map<string, Peer>();
/** Чужие трансляции, которые смотрим: ключ `${транслирующий}:${kind}` */
const incoming = new Map<string, Peer>();
/** Камеры, которые не удалось открыть автоматически, — не повторяем, пока камеру не перевключат */
const autoFailed = new Set<string>();

function rtc(to: number, kind: StreamKind, action: string, extra: Record<string, unknown> = {}) {
  socket.send({ type: 'voice_rtc', to, kind, action, ...extra });
}

function closePeer(p: Peer | undefined) {
  if (!p || p.closed) return;
  p.closed = true;
  window.clearTimeout(p.timer);
  if (p.pc) {
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
  }
}

function countViewers() {
  const viewers: Record<StreamKind, number> = { screen: 0, camera: 0 };
  for (const k of outgoing.keys()) viewers[k.endsWith(':screen') ? 'screen' : 'camera']++;
  useVoiceVideo.setState({ viewers });
}

function sendMedia() {
  const { screen, camera } = useVoiceVideo.getState();
  if (useVoice.getState().channelId === null) return;
  socket.send({ type: 'voice_media', screen: !!screen, camera: !!camera });
}

function addIce(p: Peer, c: RTCIceCandidateInit) {
  if (!p.pc || !p.pc.remoteDescription) p.pendingIce.push(c);
  else void p.pc.addIceCandidate(c).catch(() => {});
}

async function flushIce(p: Peer) {
  const pc = p.pc;
  if (!pc) return;
  for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
}

/** Дождаться конца сбора кандидатов (или GATHER_WAIT) */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = window.setTimeout(done, GATHER_WAIT);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function iceFrom(ev: WsEvent): RTCIceCandidateInit | null {
  if (typeof ev.candidate !== 'string' || !ev.candidate) return null;
  const mid = typeof ev.mid === 'string' && ev.mid ? ev.mid : null;
  return mid ? { candidate: ev.candidate, sdpMid: mid } : { candidate: ev.candidate, sdpMLineIndex: 0 };
}

// ── Транслирующий ──

function dropOutgoing(key: string, notify: boolean) {
  const p = outgoing.get(key);
  if (!p) return;
  outgoing.delete(key);
  closePeer(p);
  if (notify) {
    const [viewer, kind] = key.split(':');
    rtc(Number(viewer), kind as StreamKind, 'stop');
  }
  countViewers();
}

async function onWatch(viewer: number, kind: StreamKind) {
  const st = useVoiceVideo.getState();
  const stream = kind === 'screen' ? st.screen : st.camera;
  const track = stream?.getVideoTracks()[0];
  if (!stream || !track) return rtc(viewer, kind, 'stop');
  const key = keyOf(viewer, kind);
  dropOutgoing(key, false); // повторный watch — новое соединение
  const same = [...outgoing.keys()].filter((k) => k.endsWith(`:${kind}`)).length;
  if (same >= MAX_VIEWERS) {
    rtc(viewer, kind, 'stop', { reason: 'full' });
    toast(`К вашей трансляции подключено максимум зрителей (${MAX_VIEWERS})`);
    return;
  }
  const peer: Peer = { pc: null, described: false, pendingIce: [], closed: false, timer: 0 };
  outgoing.set(key, peer);
  countViewers();
  const ice = await rtcIceServers();
  if (peer.closed) return;
  const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' });
  peer.pc = pc;
  const quality = screenQuality(useStore.getState().me?.subscription_tier ?? 0, useMediaPrefs.getState().screenMode);
  const sender = pc.addTransceiver(track, {
    direction: 'sendonly',
    streams: [stream],
    sendEncodings:
      kind === 'screen'
        ? [{ maxBitrate: quality.maxBitrate, maxFramerate: quality.fps }]
        : [{ maxBitrate: 1_500_000, maxFramerate: 30 }],
  }).sender;
  pc.onicecandidate = (e) => {
    if (peer.described && e.candidate?.candidate)
      rtc(viewer, kind, 'ice', { candidate: e.candidate.candidate, mid: e.candidate.sdpMid ?? '', sdpType: 'offer' });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropOutgoing(key, false);
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (peer.closed) return;
    rtc(viewer, kind, 'offer', { sdp: pc.localDescription!.sdp, sdpType: 'offer' });
    peer.described = true;
    if (kind === 'screen') void tuneScreenSender(sender, quality);
    else void tuneCameraSender(sender);
  } catch {
    dropOutgoing(key, true);
  }
}

async function onAnswer(viewer: number, kind: StreamKind, ev: WsEvent) {
  const p = outgoing.get(keyOf(viewer, kind));
  if (!p?.pc || typeof ev.sdp !== 'string' || p.pc.signalingState !== 'have-local-offer') return;
  try {
    await p.pc.setRemoteDescription({ type: 'answer', sdp: ev.sdp });
    await flushIce(p);
  } catch {
    dropOutgoing(keyOf(viewer, kind), true);
  }
}

function stopOwn(kind: StreamKind) {
  for (const key of [...outgoing.keys()]) if (key.endsWith(`:${kind}`)) dropOutgoing(key, true);
  const st = useVoiceVideo.getState();
  const stream = kind === 'screen' ? st.screen : st.camera;
  if (!stream) return;
  stopStream(stream);
  useVoiceVideo.setState(kind === 'screen' ? { screen: null, screenLabel: '' } : { camera: null });
  playSound('streamStop');
  sendMedia();
}

// ── Зритель ──

function setWatch(key: string, w: Watch | null) {
  const { [key]: _, ...rest } = useVoiceVideo.getState().watching;
  useVoiceVideo.setState({ watching: w ? { ...rest, [key]: w } : rest });
}

function dropIncoming(key: string) {
  const p = incoming.get(key);
  incoming.delete(key);
  closePeer(p);
  if (useVoiceVideo.getState().watching[key]) setWatch(key, null);
}

async function onOffer(streamer: number, kind: StreamKind, ev: WsEvent) {
  const key = keyOf(streamer, kind);
  const p = incoming.get(key);
  if (!p || typeof ev.sdp !== 'string') return rtc(streamer, kind, 'unwatch'); // не смотрим — отказываемся
  if (p.pc) {
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.pc = null;
  }
  const ice = await rtcIceServers();
  if (p.closed || incoming.get(key) !== p) return;
  const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' });
  p.pc = pc;
  p.described = false;
  pc.onicecandidate = (e) => {
    if (p.described && e.candidate?.candidate)
      rtc(streamer, kind, 'ice', { candidate: e.candidate.candidate, mid: e.candidate.sdpMid ?? '', sdpType: 'answer' });
  };
  pc.ontrack = (e) => {
    if (p.closed) return;
    window.clearTimeout(p.timer);
    setWatch(key, { userId: streamer, kind, stream: e.streams[0] ?? new MediaStream([e.track]), state: 'live' });
  };
  pc.onconnectionstatechange = () => {
    if (p.closed || incoming.get(key) !== p) return;
    if (pc.connectionState === 'failed') {
      toast('Трансляция прервалась', 'error');
      dropIncoming(key);
      autoFailed.add(key);
    }
  };
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: ev.sdp });
    await flushIce(p);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    if (p.closed || p.pc !== pc) return;
    rtc(streamer, kind, 'answer', { sdp: pc.localDescription!.sdp, sdpType: 'answer' });
    p.described = true;
  } catch {
    rtc(streamer, kind, 'unwatch');
    dropIncoming(key);
  }
}

function onStop(streamer: number, kind: StreamKind, ev: WsEvent) {
  const key = keyOf(streamer, kind);
  if (!incoming.has(key)) return;
  dropIncoming(key);
  if (ev.reason === 'full') {
    autoFailed.add(key);
    toast(`Трансляция заполнена: смотрят уже ${MAX_VIEWERS} человек`, 'error');
  }
}

// ── Общее ──

/** Всё закрыть: вышли из канала, перешли в другой, вышли из аккаунта */
function closeAll() {
  for (const key of [...outgoing.keys()]) dropOutgoing(key, useStore.getState().connected);
  for (const key of [...incoming.keys()]) dropIncoming(key);
  const { screen, camera } = useVoiceVideo.getState();
  stopStream(screen);
  stopStream(camera);
  autoFailed.clear();
  useVoiceVideo.setState({ screen: null, camera: null, screenLabel: '', watching: {}, viewers: { screen: 0, camera: 0 } });
}

const channelUsers = (): VoiceUser[] => {
  const ch = useVoice.getState().channelId;
  return ch === null ? [] : (useStore.getState().voice[ch] ?? []);
};

// Камеры на открытом экране канала смотрим сами (как в Discord); экраны — по кнопке «Смотреть»
function autoWatchCameras() {
  const st = useVoiceVideo.getState();
  if (!st.stageOpen || !useVoice.getState().joined) return;
  for (const u of channelUsers()) {
    const key = keyOf(u.user_id, 'camera');
    if (u.user_id === meId() || !u.camera || incoming.has(key) || autoFailed.has(key)) continue;
    st.watch(u.user_id, 'camera');
  }
}

export const useVoiceVideo = create<VoiceVideoState>((set, get) => ({
  stageOpen: false,
  camera: null,
  screen: null,
  screenLabel: '',
  watching: {},
  viewers: { screen: 0, camera: 0 },

  openStage: () => {
    set({ stageOpen: true });
    autoWatchCameras();
  },

  closeStage: () => {
    if (!get().stageOpen) return;
    set({ stageOpen: false });
    // Смотреть больше негде — отключаемся от чужих трансляций
    for (const key of [...incoming.keys()]) {
      const [uid, kind] = key.split(':');
      rtc(Number(uid), kind as StreamKind, 'unwatch');
      dropIncoming(key);
    }
  },

  toggleCamera: async () => {
    if (get().camera) return stopOwn('camera');
    if (!useVoice.getState().joined) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints() });
    } catch (e) {
      return toast(mediaError(e, 'camera'), 'error');
    }
    if (get().camera || !useVoice.getState().joined) return stopStream(stream);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (get().camera === stream) stopOwn('camera');
    });
    set({ camera: stream });
    playSound('streamStart');
    sendMedia();
  },

  toggleScreen: async () => {
    if (get().screen) return stopOwn('screen');
    if (!useVoice.getState().joined) return;
    if (!canShareScreen()) return toast('Этот браузер не умеет показывать экран', 'error');
    const quality = screenQuality(useStore.getState().me?.subscription_tier ?? 0, useMediaPrefs.getState().screenMode);
    let stream: MediaStream;
    try {
      stream = await openScreen(quality);
    } catch (e) {
      return toast(mediaError(e, 'screen'), 'error');
    }
    if (get().screen || !useVoice.getState().joined) return stopStream(stream);
    // «Прекратить показ» в панели браузера
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (get().screen === stream) stopOwn('screen');
    });
    set({ screen: stream, screenLabel: quality.label });
    playSound('streamStart');
    sendMedia();
  },

  watch: (userId, kind) => {
    const key = keyOf(userId, kind);
    if (incoming.has(key) || userId === meId()) return;
    const peer: Peer = { pc: null, described: false, pendingIce: [], closed: false, timer: 0 };
    incoming.set(key, peer);
    setWatch(key, { userId, kind, stream: null, state: 'connecting' });
    peer.timer = window.setTimeout(() => {
      if (incoming.get(key) !== peer || get().watching[key]?.state === 'live') return;
      rtc(userId, kind, 'unwatch');
      dropIncoming(key);
      autoFailed.add(key);
      toast('Не удалось подключиться к трансляции', 'error');
    }, WATCH_TIMEOUT);
    rtc(userId, kind, 'watch');
  },

  unwatch: (userId, kind) => {
    const key = keyOf(userId, kind);
    if (!incoming.has(key)) return;
    rtc(userId, kind, 'unwatch');
    dropIncoming(key);
    if (kind === 'camera') autoFailed.add(key); // сам закрыл камеру — не открываем её снова
  },
}));

socket.on((ev) => {
  if (ev.type !== 'voice_rtc') return;
  const from = Number(ev.from);
  const kind = ev.kind === 'screen' || ev.kind === 'camera' ? (ev.kind as StreamKind) : null;
  if (!from || !kind || useVoice.getState().channelId === null) return;
  switch (ev.action) {
    case 'watch':
      return void onWatch(from, kind);
    case 'unwatch':
      return dropOutgoing(keyOf(from, kind), false);
    case 'answer':
      return void onAnswer(from, kind, ev);
    case 'offer':
      return void onOffer(from, kind, ev);
    case 'stop':
      return onStop(from, kind, ev);
    case 'ice': {
      const c = iceFrom(ev);
      if (!c) return;
      // Кандидат транслирующего — нашему входящему соединению, кандидат зрителя — исходящему
      const p = ev.sdpType === 'answer' ? outgoing.get(keyOf(from, kind)) : incoming.get(keyOf(from, kind));
      if (p) addIce(p, c);
      return;
    }
  }
});

// Состав канала и флаги трансляций: закрыть то, что закончилось; звуки; камеры на экране канала
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) {
    closeAll();
    useVoiceVideo.setState({ stageOpen: false });
    return;
  }
  // Перешли в другой раздел (текстовый канал, личку) — экран голосового канала закрывается
  if (s.view !== prev.view) useVoiceVideo.getState().closeStage();
  const ch = useVoice.getState().channelId;
  if (ch === null || s.voice[ch] === prev.voice[ch]) return;
  const users = s.voice[ch] ?? [];
  const before = prev.voice[ch] ?? [];
  const me = meId();
  const joined = useVoice.getState().joined;
  for (const key of [...incoming.keys()]) {
    const [uid, kind] = key.split(':');
    const u = users.find((x) => x.user_id === Number(uid));
    if (!u || !u[kind as StreamKind]) dropIncoming(key);
  }
  for (const key of [...outgoing.keys()]) {
    const viewer = Number(key.split(':')[0]);
    if (!users.some((x) => x.user_id === viewer)) dropOutgoing(key, false);
  }
  // Флаги перевключили — автоматически камеру можно открыть снова
  for (const u of users) {
    const was = before.find((x) => x.user_id === u.user_id);
    if (!u.camera || !was?.camera) autoFailed.delete(keyOf(u.user_id, 'camera'));
  }
  if (joined && before.some((x) => x.user_id === me)) {
    let start = false;
    let stop = false;
    for (const u of users) {
      if (u.user_id === me) continue;
      const was = before.find((x) => x.user_id === u.user_id);
      if (!was) continue;
      if ((u.screen && !was.screen) || (u.camera && !was.camera)) start = true;
      if ((!u.screen && was.screen) || (!u.camera && was.camera)) stop = true;
    }
    if (start) playSound('streamStart');
    else if (stop) playSound('streamStop');
  }
  autoWatchCameras();
});

let lastChannel: number | null = null;
useVoice.subscribe((v, prev) => {
  // Вышли или перешли в другой канал: трансляции и соединения прежнего канала закрываются
  if (v.channelId !== lastChannel) {
    if (lastChannel !== null) closeAll();
    lastChannel = v.channelId;
    if (v.channelId === null) useVoiceVideo.setState({ stageOpen: false });
  }
  // Сервер снова принял нас (после переподключения) — напомнить, что мы транслируем
  if (v.joined && !prev.joined) {
    const { screen, camera } = useVoiceVideo.getState();
    if (screen || camera) sendMedia();
    autoWatchCameras();
  }
});
