import { create } from 'zustand';
import {
  applyCodecOrder,
  cameraConstraints,
  cameraTarget,
  canShareScreen,
  chooseVideoCodecs,
  HTTPS_REQUIRED,
  mediaAvailable,
  mediaError,
  openMic,
  processingKey,
  mixScreenAudio,
  openScreen,
  type ScreenMix,
  rtcIceServers,
  screenQuality,
  stopStream,
  tuneCameraSender,
  tuneScreenSender,
  useMediaPrefs,
  withStartBitrate,
} from './media';
import { pttHeld, usePtt } from './ptt';
import { startTone } from './ringtone';
import { playSound } from './sounds';
import { userName, useStore } from './store';
import { setVoiceGuard, useVoice } from './voice';
import { socket, WsEvent } from './ws';

// Звонки 1:1 через WebRTC, совместимые с десктоп-клиентом (docs/CALLS.md §3–§5).
// Предложение всегда делает звонящий: SDP едет внутри call_invite / call_accept, ICE — в rtc_ice.
// Три m-строки в порядке аудио, камера, экран (у десктопа mid audio/video/screen) и канал данных
// «ctrl» с {"video","screen"}. Пересогласования нет: камера и экран включаются только replaceTrack.

export type CallPhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'active';
type Role = 'audio' | 'video' | 'screen';

const RING_TIMEOUT = 45_000;
// Стартовая оценка канала между браузерами, кбит/с: камера и экран сразу чёткие, дальше подстроится
const BROWSER_START_KBPS = 2500;
const CONNECT_TIMEOUT = 30_000;
// «disconnected» часто проходит само (смена сети) — ждём, прежде чем завершать
const DISCONNECT_GRACE = 5_000;
// Ответ сервера call_unavailable на наш же call_end уже завершённого звонка — не показываем
const ENDED_QUIET = 10_000;
const STATS_PERIOD = 2_000;

/** Качество связи по RTT и потерям входящего звука: для индикатора в шапке звонка */
export type NetQuality = 'good' | 'fair' | 'poor' | 'unknown';

interface CallState {
  phase: CallPhase;
  peerId: number;
  peerName: string;
  /** RTCPeerConnection.connectionState — для отладки и e2e */
  connection: RTCPeerConnectionState;
  /** Когда соединились (мс), 0 — ещё нет */
  startedAt: number;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  /** Видео согласовано с собеседником (десктоп умеет только H264) */
  canCamera: boolean;
  canScreen: boolean;
  remoteCamera: boolean;
  remoteScreen: boolean;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  /** Качество своего показа экрана, «1440p60» ('' — не показываем) */
  screenLabel: string;
  /** Собеседник — десктоп-клиент (mid audio/video/screen, без a=extmap): экран не выше 1080p30 */
  desktopPeer: boolean;
  net: NetQuality;
  /** Время приёма-передачи, мс (0 — неизвестно) */
  rtt: number;
  remoteAudio: MediaStream | null;
  remoteCameraStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  minimized: boolean;

  start: (peerId: number, name: string) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  setMinimized: (v: boolean) => void;
}

const IDLE = {
  phase: 'idle' as CallPhase,
  peerId: 0,
  peerName: '',
  connection: 'new' as RTCPeerConnectionState,
  startedAt: 0,
  muted: false,
  camera: false,
  screen: false,
  canCamera: false,
  canScreen: false,
  remoteCamera: false,
  remoteScreen: false,
  localCamera: null,
  localScreen: null,
  screenLabel: '',
  desktopPeer: false,
  net: 'unknown' as NetQuality,
  rtt: 0,
  remoteAudio: null,
  remoteCameraStream: null,
  remoteScreenStream: null,
  minimized: false,
};

// Всё, что живёт один звонок. Новый звонок — новый объект: асинхронные шаги старого,
// закончившиеся позже, видят, что sess сменился, и ничего не трогают.
interface Session {
  pc: RTCPeerConnection | null;
  ctrl: RTCDataChannel | null;
  mic: MediaStream | null;
  cam: MediaStream | null;
  scr: MediaStream | null;
  /** Звук экрана, смешанный с микрофоном (пока идёт показ экрана со звуком) */
  mix?: ScreenMix | null;
  /** Входящий звонок: SDP предложения до ответа */
  offer: string;
  transceivers: Partial<Record<Role, RTCRtpTransceiver>>;
  mids: Partial<Record<Role, string>>;
  /** Кандидаты собеседника, пришедшие раньше удалённого описания */
  remoteIce: RemoteCandidate[];
  /** Свои кандидаты до отправки call_invite/call_accept: десктоп отбрасывает их раньше SDP */
  localIce: WsEvent[];
  signalled: boolean;
  /** Собеседник уже сообщил по ctrl, включены ли камера/экран: дальше решает только ctrl */
  ctrlSaid: { video: boolean; screen: boolean };
  ringTimer: number;
  connectTimer: number;
  graceTimer: number;
  statsTimer: number;
  /** Прошлый замер входящего звука — потери считаются по разнице */
  lastAudio: { received: number; lost: number };
  stopTone: (() => void) | null;
}

interface RemoteCandidate {
  candidate: string;
  mid: string;
}

const fresh = (): Session => ({
  pc: null,
  ctrl: null,
  mic: null,
  cam: null,
  scr: null,
  offer: '',
  transceivers: {},
  mids: {},
  remoteIce: [],
  localIce: [],
  signalled: false,
  ctrlSaid: { video: false, screen: false },
  ringTimer: 0,
  connectTimer: 0,
  graceTimer: 0,
  statsTimer: 0,
  lastAudio: { received: 0, lost: 0 },
  stopTone: null,
});

let sess = fresh();
let lastEnded = { peerId: 0, at: 0 };

const toast = (text: string, kind: 'info' | 'error' = 'info') => useStore.getState().toast(text, kind);
const meId = () => useStore.getState().me?.user_id;

// Звонок, принятый или отклонённый в одной вкладке, перестаёт звонить в остальных
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('vicinity.call') : null;

function silenceRing(s: Session) {
  window.clearTimeout(s.ringTimer);
  s.stopTone?.();
  s.stopTone = null;
}

/** Завершить звонок у себя. sound — короткий сигнал отбоя (не нужен, если звонок ушёл в другую вкладку) */
function teardown(sound = true) {
  const s = sess;
  sess = fresh();
  silenceRing(s);
  window.clearTimeout(s.connectTimer);
  window.clearTimeout(s.graceTimer);
  window.clearInterval(s.statsTimer);
  if (s.ctrl) s.ctrl.onopen = s.ctrl.onmessage = null;
  if (s.pc) {
    s.pc.onicecandidate = s.pc.ontrack = s.pc.ondatachannel = s.pc.onconnectionstatechange = null;
    s.pc.close();
  }
  [s.mic, s.cam, s.scr].forEach(stopStream);
  s.mix?.close();
  s.mix = null;
  const { phase, peerId } = useCall.getState();
  if (phase !== 'idle') {
    lastEnded = { peerId, at: Date.now() };
    if (sound) playSound('callEnd');
  }
  useCall.setState(IDLE);
}

/** Сообщить собеседнику и закончить у себя */
function endWith(type: 'call_end' | 'call_reject', reason?: 'timeout') {
  socket.send({ type, to: useCall.getState().peerId, ...(reason ? { reason } : {}) });
  teardown();
}

function fail(s: Session) {
  if (sess !== s) return;
  toast(
    useCall.getState().phase === 'active' ? 'Связь с собеседником потеряна' : 'Не удалось соединиться с собеседником',
    'error',
  );
  endWith('call_end');
}

// Собеседник — десктоп-клиент: его m-строки называются audio/video/screen, и в SDP нет a=extmap
// (у браузеров они есть всегда). Его H264 — уровень 3.1: экран больше 1080p30 рискованно слать.
function isDesktopSdp(sdp: string): boolean {
  return (/^a=mid:audio\r?$/m.test(sdp) && /^a=mid:screen\r?$/m.test(sdp)) || !/^a=extmap:/m.test(sdp);
}

// Качество связи раз в пару секунд: RTT выбранной пары кандидатов и доля потерь входящего звука
async function sampleStats(s: Session) {
  const pc = s.pc;
  if (!pc || sess !== s) return;
  let rtt = 0;
  let received = 0;
  let lost = 0;
  try {
    const report = await pc.getStats();
    report.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number')
        rtt = r.currentRoundTripTime * 1000;
      if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        received += r.packetsReceived ?? 0;
        lost += Math.max(0, r.packetsLost ?? 0);
      }
    });
  } catch {
    return;
  }
  if (sess !== s) return;
  const dr = received - s.lastAudio.received;
  const dl = lost - s.lastAudio.lost;
  s.lastAudio = { received, lost };
  const loss = dr + dl > 0 ? dl / (dr + dl) : 0;
  const net: NetQuality =
    !rtt && dr <= 0 ? 'unknown' : rtt < 150 && loss < 0.02 ? 'good' : rtt < 400 && loss < 0.08 ? 'fair' : 'poor';
  const st = useCall.getState();
  if (st.net !== net || Math.abs(st.rtt - rtt) >= 5) useCall.setState({ net, rtt: Math.round(rtt) });
}

// Роли m-строк по порядку в SDP: первая аудио — микрофон, первая видео — камера, вторая — экран.
// У десктопа это mid audio/video/screen, у браузера — 0/1/2.
function sdpMids(sdp: string): Partial<Record<Role, string>> {
  const mids: Partial<Record<Role, string>> = {};
  let kind = '';
  let videos = 0;
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) kind = line.slice(2).split(' ')[0];
    else if (line.startsWith('a=mid:')) {
      const mid = line.slice(6).trim();
      if (kind === 'audio' && mids.audio === undefined) mids.audio = mid;
      else if (kind === 'video') {
        if (videos === 0) mids.video = mid;
        else if (videos === 1) mids.screen = mid;
        videos++;
      }
    }
  }
  return mids;
}

// Десктоп не присылает отчётов о пропускной способности (ни RR, ни REMB, ни TWCC), и Chrome держал бы
// своё видео у стартовых ~300 кбит/с. Предложение десктопа узнаём по отсутствию a=extmap (у браузеров
// они есть всегда) и задаём для H264 стартовый и минимальный битрейт; другие браузеры это игнорируют.
function tuneOffer(sdp: string): string {
  if (/^a=extmap:/m.test(sdp)) return sdp;
  const h264 = new Set([...sdp.matchAll(/^a=rtpmap:(\d+) H264\/90000/gim)].map((m) => m[1]));
  return sdp.replace(/^a=fmtp:(\d+) [^\r\n]*/gm, (line, pt: string) =>
    h264.has(pt) && !line.includes('x-google-') ? `${line};x-google-start-bitrate=1000;x-google-min-bitrate=500` : line,
  );
}

function sendCtrl(s: Session) {
  if (s.ctrl?.readyState !== 'open') return;
  const { camera, screen } = useCall.getState();
  s.ctrl.send(JSON.stringify({ video: camera, screen }));
}

function setupCtrl(s: Session, ch: RTCDataChannel) {
  s.ctrl = ch;
  ch.onmessage = (e) => {
    if (sess !== s || typeof e.data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { video?: unknown; screen?: unknown };
    const patch: Partial<CallState> = {};
    if ('video' in m) {
      patch.remoteCamera = !!m.video;
      s.ctrlSaid.video = true;
    }
    if ('screen' in m) {
      patch.remoteScreen = !!m.screen;
      s.ctrlSaid.screen = true;
    }
    useCall.setState(patch);
  };
  ch.onopen = () => sendCtrl(s);
  if (ch.readyState === 'open') sendCtrl(s);
}

function onTrack(s: Session, e: RTCTrackEvent) {
  if (sess !== s) return;
  const mid = e.transceiver.mid;
  // Потоков в SDP десктопа нет (нет a=msid) — e.streams может быть пустым
  const stream = new MediaStream([e.track]);
  if (mid === s.mids.audio) useCall.setState({ remoteAudio: stream });
  // Как у десктопа: первый кадр показывает видео, пока не открылся ctrl; дальше включает и выключает
  // только ctrl (иначе запоздалые кадры после «выключил» снова показали бы застывшую картинку)
  else if (mid === s.mids.video) {
    useCall.setState({ remoteCameraStream: stream });
    e.track.onunmute = () => sess === s && !s.ctrlSaid.video && useCall.setState({ remoteCamera: true });
  } else if (mid === s.mids.screen) {
    useCall.setState({ remoteScreenStream: stream });
    e.track.onunmute = () => sess === s && !s.ctrlSaid.screen && useCall.setState({ remoteScreen: true });
  }
}

function onConnectionState(s: Session, pc: RTCPeerConnection) {
  if (sess !== s) return;
  const state = pc.connectionState;
  useCall.setState({ connection: state });
  window.clearTimeout(s.graceTimer);
  if (state === 'connected') {
    window.clearTimeout(s.connectTimer);
    if (useCall.getState().phase !== 'active') {
      useCall.setState({ phase: 'active', startedAt: Date.now() });
      playSound('join');
      window.clearInterval(s.statsTimer);
      s.statsTimer = window.setInterval(() => void sampleStats(s), STATS_PERIOD);
      void sampleStats(s);
    }
  } else if (state === 'disconnected') {
    s.graceTimer = window.setTimeout(() => fail(s), DISCONNECT_GRACE);
  } else if (state === 'failed' || state === 'closed') {
    fail(s);
  }
}

function createPc(s: Session, iceServers: RTCIceServer[]): RTCPeerConnection {
  // У десктопа один ICE-транспорт на всё: BUNDLE и RTCP-mux обязательны
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  s.pc = pc;
  pc.onicecandidate = (e) => {
    if (!e.candidate?.candidate) return; // «конец кандидатов» десктопу не нужен
    const msg = {
      type: 'rtc_ice',
      to: useCall.getState().peerId,
      candidate: e.candidate.candidate,
      mid: e.candidate.sdpMid ?? '',
    };
    if (s.signalled) socket.send(msg);
    else s.localIce.push(msg);
  };
  pc.ontrack = (e) => onTrack(s, e);
  pc.ondatachannel = (e) => e.channel.label === 'ctrl' && setupCtrl(s, e.channel);
  pc.onconnectionstatechange = () => onConnectionState(s, pc);
  return pc;
}

// SDP ушёл собеседнику — теперь можно и кандидаты
function markSignalled(s: Session) {
  s.signalled = true;
  s.localIce.splice(0).forEach((m) => socket.send(m));
}

// Кандидат собеседника — в наш RTCPeerConnection. Десктоп всегда пишет mid «audio» (его линия BUNDLE);
// если такой m-строки у нас нет (звонок начал браузер, mid 0/1/2), кандидат относится к первой — она и есть BUNDLE.
function addCandidate(pc: RTCPeerConnection, { candidate, mid }: RemoteCandidate) {
  const known = !!mid && (pc.remoteDescription?.sdp ?? '').split(/\r?\n/).includes(`a=mid:${mid}`);
  return pc.addIceCandidate(known ? { candidate, sdpMid: mid } : { candidate, sdpMLineIndex: 0 }).catch(() => {});
}

async function addRemoteIce(s: Session) {
  for (const c of s.remoteIce.splice(0)) if (s.pc) await addCandidate(s.pc, c);
}

// Камера/экран доступны, если их m-строка согласована на отправку
function updateCaps(s: Session) {
  const sends = (t?: RTCRtpTransceiver) => t?.currentDirection === 'sendrecv' || t?.currentDirection === 'sendonly';
  useCall.setState({
    canCamera: sends(s.transceivers.video),
    canScreen: sends(s.transceivers.screen) && canShareScreen(),
  });
}

// Кнопка «выключить микрофон» могла быть нажата, пока он открывался
// В режиме рации микрофон открыт, только пока зажата клавиша
function applyMute(mic: MediaStream) {
  const open = !useMediaPrefs.getState().ptt || pttHeld();
  mic.getAudioTracks().forEach((t) => (t.enabled = !useCall.getState().muted && open));
}

function attachMic(s: Session, mic: MediaStream) {
  applyMute(mic);
  stopStream(s.mic);
  s.mic = mic;
  mic.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (sess === s && s.mic === mic) toast('Микрофон отключился — выберите другой в настройках звонка', 'error');
  });
}

function startConnectTimer(s: Session) {
  s.connectTimer = window.setTimeout(() => fail(s), CONNECT_TIMEOUT);
}

function stopVideo(s: Session, role: 'video' | 'screen') {
  void s.transceivers[role]?.sender.replaceTrack(null).catch(() => {});
  if (role === 'video') {
    stopStream(s.cam);
    s.cam = null;
    useCall.setState({ camera: false, localCamera: null });
  } else {
    stopStream(s.scr);
    s.scr = null;
    if (s.mix) {
      // Вернуть чистый микрофон
      void s.transceivers.audio?.sender.replaceTrack(s.mic?.getAudioTracks()[0] ?? null).catch(() => {});
      s.mix.close();
      s.mix = null;
    }
    useCall.setState({ screen: false, localScreen: null, screenLabel: '' });
  }
  sendCtrl(s);
}

// Включить камеру или показ экрана в уже идущем звонке — без пересогласования
async function startVideo(s: Session, role: 'video' | 'screen') {
  const t = s.transceivers[role];
  if (!t) return;
  // Качество экрана — по подписке; собеседнику-десктопу — не выше 1080p30
  const quality = screenQuality(
    useStore.getState().me?.subscription_tier ?? 0,
    useMediaPrefs.getState().screenMode,
    { desktopPeer: useCall.getState().desktopPeer },
  );
  let stream: MediaStream;
  try {
    stream =
      role === 'video'
        ? await navigator.mediaDevices.getUserMedia({ video: cameraConstraints() })
        : await openScreen(quality);
  } catch (e) {
    if (sess === s) toast(mediaError(e, role === 'video' ? 'camera' : 'screen'), 'error');
    return;
  }
  const track = stream.getVideoTracks()[0];
  if (sess !== s || !track || (role === 'video' ? s.cam : s.scr)) return stopStream(stream);
  try {
    await t.sender.replaceTrack(track);
  } catch {
    stopStream(stream);
    if (sess === s) toast(role === 'video' ? 'Не удалось включить камеру' : 'Не удалось показать экран', 'error');
    return;
  }
  if (sess !== s) return stopStream(stream);
  if (role === 'video') {
    s.cam = stream;
    useCall.setState({ camera: true, localCamera: stream });
    void tuneCameraSender(t.sender);
  } else {
    s.scr = stream;
    useCall.setState({ screen: true, localScreen: stream, screenLabel: quality.label });
    void tuneScreenSender(t.sender, quality);
    // Звук экрана: в звонке 1:1 новую линию не добавить — смешиваем с микрофоном
    const audio = stream.getAudioTracks()[0];
    if (audio && s.transceivers.audio) {
      const mix = mixScreenAudio(s.mic?.getAudioTracks()[0], audio);
      try {
        await s.transceivers.audio.sender.replaceTrack(mix.track);
        s.mix = mix;
      } catch {
        mix.close();
      }
    }
  }
  // Камеру отключили или нажали «Прекратить показ» в браузере
  track.addEventListener('ended', () => {
    if (sess === s && (role === 'video' ? s.cam : s.scr) === stream) stopVideo(s, role);
  });
  sendCtrl(s);
}

export const useCall = create<CallState>((set, get) => ({
  ...IDLE,

  start: async (peerId, name) => {
    const store = useStore.getState();
    if (get().phase !== 'idle') return toast('Сначала завершите текущий звонок', 'error');
    if (!mediaAvailable()) return toast(HTTPS_REQUIRED, 'error');
    if (!store.connected) return toast('Нет связи с сервером', 'error');
    const s = sess;
    set({ ...IDLE, phase: 'outgoing', peerId, peerName: name });
    s.stopTone = startTone('outgoing');
    let mic: MediaStream;
    try {
      mic = await openMic(useMediaPrefs.getState().inputId);
    } catch (e) {
      if (sess !== s) return;
      toast(mediaError(e), 'error');
      return teardown();
    }
    if (sess !== s) return stopStream(mic);
    attachMic(s, mic);
    try {
      const ice = await rtcIceServers();
      if (sess !== s) return;
      const pc = createPc(s, ice);
      const audio = pc.addTransceiver(s.mic!.getAudioTracks()[0], { direction: 'sendrecv' });
      const video = pc.addTransceiver('video', { direction: 'sendrecv' });
      const screen = pc.addTransceiver('video', { direction: 'sendrecv' });
      // Кодеки: что кодирует видеокарта — первым (десктоп всё равно найдёт в списке свой H264)
      const mode = useMediaPrefs.getState().screenMode;
      const [camCodecs, screenCodecs] = await Promise.all([
        chooseVideoCodecs(cameraTarget(), false),
        chooseVideoCodecs(screenQuality(store.me?.subscription_tier ?? 0, mode), mode === 'detail'),
      ]);
      if (sess !== s) return;
      applyCodecOrder(video, camCodecs.order);
      applyCodecOrder(screen, screenCodecs.order);
      s.transceivers = { audio, video, screen };
      // Канал ctrl — до createOffer, чтобы попасть в предложение (пересогласования не будет)
      setupCtrl(s, pc.createDataChannel('ctrl'));
      await pc.setLocalDescription(await pc.createOffer());
      if (sess !== s) return;
      s.mids = { audio: audio.mid ?? undefined, video: video.mid ?? undefined, screen: screen.mid ?? undefined };
      socket.send({
        type: 'call_invite',
        to: peerId,
        sdp: pc.localDescription!.sdp,
        sdpType: 'offer',
        name: store.me?.display_name ?? '',
      });
      markSignalled(s);
      // Сервер не знает, слышит ли адресат звонок: без ответа — отбой
      s.ringTimer = window.setTimeout(() => {
        if (sess !== s) return;
        toast(`${name} не отвечает`);
        endWith('call_end');
      }, RING_TIMEOUT);
    } catch {
      if (sess !== s) return;
      toast('Не удалось начать звонок', 'error');
      endWith('call_end');
    }
  },

  accept: async () => {
    const { phase, peerId } = get();
    if (phase !== 'incoming') return;
    if (!mediaAvailable()) return toast(HTTPS_REQUIRED, 'error');
    const s = sess;
    silenceRing(s);
    tabs?.postMessage({ userId: meId(), handled: peerId });
    useVoice.getState().leave();
    set({ phase: 'connecting' });
    // Микрофон — до RTCPeerConnection: тогда браузер отдаёт настоящие адреса, а не mDNS (*.local),
    // которые десктоп может не разрешить
    let mic: MediaStream;
    try {
      mic = await openMic(useMediaPrefs.getState().inputId);
    } catch (e) {
      if (sess !== s) return;
      toast(mediaError(e), 'error');
      return endWith('call_reject');
    }
    if (sess !== s) return stopStream(mic);
    attachMic(s, mic);
    try {
      const ice = await rtcIceServers();
      if (sess !== s) return;
      const pc = createPc(s, ice);
      s.mids = sdpMids(s.offer);
      set({ desktopPeer: isDesktopSdp(s.offer) });
      // Десктопу — его стартовый битрейт H264; браузеру — стартовая скорость видео сразу около рабочей
      const desktop = isDesktopSdp(s.offer);
      await pc.setRemoteDescription({ type: 'offer', sdp: desktop ? tuneOffer(s.offer) : withStartBitrate(s.offer, BROWSER_START_KBPS) });
      if (sess !== s) return;
      await addRemoteIce(s);
      // Все три линии — sendrecv: отправлять видео позже можно будет только через replaceTrack
      for (const role of ['audio', 'video', 'screen'] as Role[]) {
        const t = pc.getTransceivers().find((x) => x.mid !== null && x.mid === s.mids[role]);
        if (!t) continue;
        t.direction = 'sendrecv';
        s.transceivers[role] = t;
      }
      await s.transceivers.audio?.sender.replaceTrack(s.mic!.getAudioTracks()[0]);
      await pc.setLocalDescription(await pc.createAnswer());
      if (sess !== s) return;
      // Ответ отправляется как есть: испорченный call_accept может уронить десктоп
      socket.send({ type: 'call_accept', to: peerId, sdp: pc.localDescription!.sdp, sdpType: 'answer' });
      markSignalled(s);
      updateCaps(s);
      startConnectTimer(s);
    } catch {
      if (sess !== s) return;
      toast('Не удалось принять звонок', 'error');
      endWith('call_reject');
    }
  },

  decline: () => {
    const { phase, peerId } = get();
    if (phase !== 'incoming') return;
    tabs?.postMessage({ userId: meId(), handled: peerId });
    endWith('call_reject');
  },

  hangup: () => {
    const { phase } = get();
    if (phase === 'incoming') return get().decline();
    if (phase !== 'idle') endWith('call_end');
  },

  toggleMute: () => {
    const muted = !get().muted;
    set({ muted });
    if (sess.mic) applyMute(sess.mic);
    playSound(muted ? 'mute' : 'unmute');
  },

  toggleCamera: async () => {
    if (!get().canCamera) return;
    if (get().camera) stopVideo(sess, 'video');
    else await startVideo(sess, 'video');
  },

  toggleScreen: async () => {
    if (!get().canScreen) return;
    if (get().screen) stopVideo(sess, 'screen');
    else await startVideo(sess, 'screen');
  },

  setMinimized: (minimized) => set({ minimized }),
}));

// ── Сигналинг ──

// Не ответили за RING_TIMEOUT — отклоняем: десктоп-звонящий сам не перестаёт звонить
function ringIncoming(s: Session, name: string) {
  window.clearTimeout(s.ringTimer);
  s.ringTimer = window.setTimeout(() => {
    if (sess !== s) return;
    toast(`Пропущенный звонок от ${name}`);
    endWith('call_reject', 'timeout');
  }, RING_TIMEOUT);
}

function onInvite(ev: WsEvent) {
  const from = Number(ev.from);
  const st = useCall.getState();
  if (!meId() || !from || typeof ev.sdp !== 'string' || !ev.sdp) return;
  if (st.phase === 'incoming' && st.peerId === from) {
    // Повторное приглашение того же звонящего — новое предложение, звонит заново
    sess.offer = ev.sdp;
    sess.remoteIce = [];
    return ringIncoming(sess, st.peerName);
  }
  // Уже звоним или разговариваем (в том числе встречный звонок) — «занято», как у десктопа
  if (st.phase !== 'idle') return socket.send({ type: 'call_busy', to: from });
  const s = sess;
  const name = typeof ev.name === 'string' && ev.name ? ev.name : userName(from);
  s.offer = ev.sdp;
  useCall.setState({ ...IDLE, phase: 'incoming', peerId: from, peerName: name });
  s.stopTone = startTone('incoming');
  ringIncoming(s, name);
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('Входящий звонок', { body: name, icon: '/favicon.svg', tag: 'vicinity-call' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* уведомления недоступны — звонок виден в окне */
    }
  }
}

function onRemoteIce(ev: WsEvent) {
  const st = useCall.getState();
  if (st.phase === 'idle' || Number(ev.from) !== st.peerId || !ev.candidate) return;
  // Десктоп присылает кандидата с префиксом «a=»
  const c = { candidate: String(ev.candidate).replace(/^a=/, ''), mid: typeof ev.mid === 'string' ? ev.mid : '' };
  const pc = sess.pc;
  if (!pc || !pc.remoteDescription) sess.remoteIce.push(c);
  else void addCandidate(pc, c);
}

async function onAccept(ev: WsEvent) {
  const st = useCall.getState();
  const s = sess;
  if (st.phase !== 'outgoing' || Number(ev.from) !== st.peerId || !s.pc || typeof ev.sdp !== 'string') return;
  silenceRing(s);
  // Разговор начинается — голосовой канал оставляем (пока звонок только звонил, он не мешал)
  useVoice.getState().leave();
  useCall.setState({ phase: 'connecting' });
  // Старый десктоп не понимает браузерное предложение: отклоняет все медиалинии (такой ответ
  // браузер обычно и не принимает) — без этой проверки звонок «шёл» бы в тишине
  const incompatible = () => {
    toast(`Не удалось соединиться: похоже, у ${st.peerName} старая версия Vicinity без звонков из браузера`, 'error');
    endWith('call_end');
  };
  try {
    await s.pc.setRemoteDescription({ type: 'answer', sdp: isDesktopSdp(ev.sdp) ? ev.sdp : withStartBitrate(ev.sdp, BROWSER_START_KBPS) });
  } catch {
    if (sess === s) incompatible();
    return;
  }
  if (sess !== s) return;
  useCall.setState({ desktopPeer: isDesktopSdp(ev.sdp) });
  const audio = s.transceivers.audio?.currentDirection;
  if (audio !== 'sendrecv' && audio !== 'sendonly' && audio !== 'recvonly') return incompatible();
  await addRemoteIce(s);
  if (sess !== s) return;
  updateCaps(s);
  startConnectTimer(s);
}

function onPeerEnded(ev: WsEvent) {
  const { phase, peerId, peerName } = useCall.getState();
  if (phase === 'idle' || Number(ev.from) !== peerId) return;
  if (ev.type === 'call_busy') toast(`${peerName} сейчас занят(а)`, 'error');
  else if (phase === 'incoming') toast(`Пропущенный звонок от ${peerName}`);
  else if (ev.type === 'call_reject') toast(`${peerName} отклонил(а) звонок`);
  else toast(phase === 'active' ? 'Звонок завершён' : `${peerName} завершил(а) звонок`);
  teardown();
}

function onUnavailable(ev: WsEvent) {
  const uid = Number(ev.user_id);
  const { phase, peerId, peerName } = useCall.getState();
  if (phase === 'outgoing' && uid === peerId) {
    toast(`${peerName} сейчас не в сети`, 'error');
    return teardown();
  }
  // Собеседник переподключается, пока идёт звонок, — судьбу звонка решает состояние соединения
  if (phase !== 'idle' && uid === peerId) return;
  if (uid === lastEnded.peerId && Date.now() - lastEnded.at < ENDED_QUIET) return;
  toast(`${userName(uid)} сейчас не в сети`, 'error');
}

socket.on((ev) => {
  switch (ev.type) {
    case 'call_invite':
      return onInvite(ev);
    case 'rtc_ice':
      return onRemoteIce(ev);
    case 'call_accept':
      return void onAccept(ev);
    case 'call_reject':
    case 'call_busy':
    case 'call_end':
      return onPeerEnded(ev);
    case 'call_unavailable':
      return onUnavailable(ev);
  }
});

// Пока идёт звонок, в голосовой канал не входим (микрофон один, говорить в оба места — путаница)
setVoiceGuard(() => {
  const { phase } = useCall.getState();
  return phase === 'idle' || phase === 'incoming' ? null : 'Сначала завершите звонок';
});

// Выбрали другой микрофон в настройках — подменяем дорожку прямо в звонке
useMediaPrefs.subscribe((p, prev) => {
  const s = sess;
  if (s.mic && p.ptt !== prev.ptt) applyMute(s.mic);
  if ((p.inputId === prev.inputId && processingKey(p) === processingKey(prev)) || !s.mic) return;
  openMic(p.inputId).then(
    async (mic) => {
      if (sess !== s) return stopStream(mic);
      applyMute(mic);
      try {
        // Идёт показ экрана со звуком — меняем микрофон внутри смеси, линия та же
        if (s.mix) s.mix.setMic(mic.getAudioTracks()[0]);
        else await s.transceivers.audio?.sender.replaceTrack(mic.getAudioTracks()[0]);
      } catch {
        stopStream(mic);
        if (sess === s) toast('Не удалось переключить микрофон', 'error');
        return;
      }
      if (sess !== s) return stopStream(mic);
      attachMic(s, mic);
    },
    (e) => sess === s && toast(mediaError(e), 'error'),
  );
});

// Рация: клавишу зажали или отпустили — открываем или закрываем микрофон в звонке
usePtt.subscribe(() => {
  if (sess.mic) applyMute(sess.mic);
});

// Выход из аккаунта: сокет уже закрыт — только освобождаем микрофон и камеру
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me && useCall.getState().phase !== 'idle') teardown(false);
});

if (tabs)
  tabs.onmessage = (e) => {
    const { phase, peerId } = useCall.getState();
    if (phase === 'incoming' && e.data?.handled === peerId && e.data?.userId === meId()) teardown(false);
  };

// Закрытие вкладки: собеседник узнаёт сразу, а не по обрыву соединения. Входящий не отклоняем —
// пусть звонит на других устройствах.
window.addEventListener('pagehide', () => {
  const { phase } = useCall.getState();
  if (phase === 'idle') return;
  if (phase === 'incoming') teardown(false);
  else endWith('call_end');
});

// Собеседник включил/выключил камеру или показ экрана — короткий сигнал. Флаги «мигают» (первые пакеты
// дорожки и сообщение ctrl приходят в разном порядке), поэтому сигналим по устоявшемуся состоянию,
// и не в первые секунды разговора, когда собеседник только присылает своё начальное состояние.
const STREAM_SETTLE = 500;
const STREAM_QUIET_AFTER_CONNECT = 1_200;
let announced = { camera: false, screen: false };
let streamTimer = 0;
useCall.subscribe((s, prev) => {
  if (s.phase !== 'active') {
    window.clearTimeout(streamTimer);
    announced = { camera: false, screen: false };
    return;
  }
  if (s.remoteCamera === prev.remoteCamera && s.remoteScreen === prev.remoteScreen && prev.phase === 'active') return;
  window.clearTimeout(streamTimer);
  streamTimer = window.setTimeout(() => {
    const st = useCall.getState();
    if (st.phase !== 'active') return;
    const now = { camera: st.remoteCamera, screen: st.remoteScreen };
    const quiet = Date.now() - st.startedAt < STREAM_QUIET_AFTER_CONNECT;
    if (!quiet) {
      if ((now.camera && !announced.camera) || (now.screen && !announced.screen)) playSound('streamStart');
      else if ((!now.camera && announced.camera) || (!now.screen && announced.screen)) playSound('streamStop');
    }
    announced = now;
  }, STREAM_SETTLE);
});
