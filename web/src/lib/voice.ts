import { create } from 'zustand';
import { applyOutput, HTTPS_REQUIRED, mediaAvailable, mediaError, openMic, stopStream, useMediaPrefs } from './media';
import { useStore } from './store';
import { socket } from './ws';

// Голосовые каналы: голосовые каналы серверов и «голосовые комнаты» личек и бесед
// (docs/CALLS.md §2, docs/API.md §11). Звук идёт сырым PCM по тому же WebSocket:
// отправляем кадры 640 байт без заголовка, получаем (протокол v2) с 8 байтами id отправителя.

const WORKLET_URL = `${import.meta.env.BASE_URL}worklets/voice-processor.js`;
// «Говорит» — RMS кадра после усиления выше 380 (шкала int16) и ещё 300 мс после: как у десктопа
const SPEAK_RMS = 380;
const HOLD_FRAMES = 15;
// Кадры идут, пока говорит, и ещё 300 мс — чтобы не обрезать окончания; в тишине не отправляем ничего
const HANGOVER_FRAMES = 15;
// 40 мс до начала речи уходят вместе с первым громким кадром — чтобы не съесть первый звук
const PREROLL_FRAMES = 2;
// Сервер молча игнорирует voice_join без доступа — не ждём подтверждения вечно
const JOIN_TIMEOUT = 8000;

/** Счётчики кадров — для отладки (и e2e): window.__vicinityVoiceStats */
const stats = { framesSent: 0, framesDropped: 0, framesReceived: 0 };
(window as unknown as { __vicinityVoiceStats: typeof stats }).__vicinityVoiceStats = stats;

interface VoiceState {
  /** Канал, в котором мы (или к которому подключаемся) */
  channelId: number | null;
  /** Сервер подтвердил вход: мы есть в его списке канала */
  joined: boolean;
  muted: boolean;
  /** Не слышать никого (и не говорить) */
  deafened: boolean;
  join: (channelId: number) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

// Захват, воспроизведение и вывод звука для одного подключения к голосу
class Engine {
  private ctx: AudioContext;
  private out: GainNode;
  private dest: MediaStreamAudioDestinationNode;
  private audio = new Audio();
  private capture: AudioWorkletNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mic: MediaStream | null = null;
  // Смена устройства во время открытия микрофона: побеждает последний выбор, а не последний ответ
  private micSeq = 0;
  private closed = false;

  // Создаётся прямо в обработчике клика: контекст и <audio> сразу получают право играть звук.
  // Частота контекста — родная для устройства: передискретизация в 16 кГц сделана в ворклете.
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    void this.ctx.resume().catch(() => {});
    this.out = this.ctx.createGain();
    this.dest = this.ctx.createMediaStreamDestination();
    this.out.connect(this.dest);
    // Через <audio>, а не ctx.destination: так работает выбор устройства вывода (setSinkId)
    this.audio.srcObject = this.dest.stream;
    void this.audio.play().catch(() => {});
    const p = useMediaPrefs.getState();
    this.setVolume(p.volume);
    this.setOutput(p.outputId);
  }

  async load(onCaptured: (f: { pcm: ArrayBuffer; rms: number }) => void) {
    await this.ctx.audioWorklet.addModule(WORKLET_URL);
    if (this.closed) return;
    this.playback = new AudioWorkletNode(this.ctx, 'vicinity-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.playback.connect(this.out);
    this.capture = new AudioWorkletNode(this.ctx, 'vicinity-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    // Выход захвата — тишина; подключён, чтобы браузер обрабатывал узел
    this.capture.connect(this.dest);
    this.capture.port.onmessage = (e) => onCaptured(e.data);
    this.setGain(useMediaPrefs.getState().micGain);
  }

  async openMic(deviceId: string) {
    const seq = ++this.micSeq;
    const mic = await openMic(deviceId);
    if (this.closed || !this.capture || seq !== this.micSeq) return stopStream(mic);
    this.source?.disconnect();
    stopStream(this.mic);
    this.mic = mic;
    this.source = this.ctx.createMediaStreamSource(mic);
    this.source.connect(this.capture);
    mic.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.mic === mic)
        useStore.getState().toast('Микрофон отключился — выберите другой в настройках голоса', 'error');
    });
  }

  frame(id: number, data: ArrayBuffer) {
    this.playback?.port.postMessage({ id, buf: data }, [data]);
  }

  /** Забыть всё недоигранное (смена канала, «не слышать») */
  reset() {
    this.playback?.port.postMessage({ reset: true });
  }

  setGain(g: number) {
    this.capture?.port.postMessage({ gain: g });
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setOutput(deviceId: string) {
    applyOutput(this.audio, deviceId);
  }

  close() {
    this.closed = true;
    this.source?.disconnect();
    stopStream(this.mic);
    this.mic = null;
    this.audio.pause();
    this.audio.srcObject = null;
    void this.ctx.close().catch(() => {});
  }
}

let engine: Engine | null = null;
let joinTimer: number | undefined;
let speaking = false;
let quiet = Infinity; // кадров подряд без речи
let preroll: ArrayBuffer[] = [];
// Пока идёт звонок 1:1, голосовой канал недоступен — правило задаёт модуль звонков
let guard: () => string | null = () => null;

/** Причина, по которой в голос сейчас нельзя (null — можно) */
export function setVoiceGuard(fn: () => string | null) {
  guard = fn;
}

const meId = () => useStore.getState().me?.user_id;

function showSelfSpeaking(v: boolean) {
  const id = meId();
  const s = useStore.getState();
  if (id && !!s.speaking[id] !== v) useStore.setState({ speaking: { ...s.speaking, [id]: v } });
}

function setSpeaking(v: boolean) {
  if (speaking === v) return;
  speaking = v;
  socket.send({ type: 'voice_speaking', speaking: v });
  showSelfSpeaking(v);
}

// Замолчать без сообщения серверу (вышли из канала, нет связи)
function resetSpeaking() {
  speaking = false;
  quiet = Infinity;
  preroll = [];
  showSelfSpeaking(false);
}

function sendFrame(pcm: ArrayBuffer) {
  if (socket.sendBinary(pcm)) stats.framesSent++;
  else stats.framesDropped++;
}

// Кадр с микрофона (20 мс, уже 16 кГц s16le)
function onCaptured({ pcm, rms }: { pcm: ArrayBuffer; rms: number }) {
  const v = useVoice.getState();
  if (!v.joined || v.muted || v.deafened) return;
  quiet = rms > SPEAK_RMS ? 0 : quiet + 1;
  setSpeaking(quiet < HOLD_FRAMES);
  if (quiet < HOLD_FRAMES + HANGOVER_FRAMES) {
    preroll.forEach(sendFrame);
    preroll = [];
    sendFrame(pcm);
  } else {
    preroll.push(pcm);
    if (preroll.length > PREROLL_FRAMES) preroll.shift();
  }
}

function sendJoin() {
  const ch = useVoice.getState().channelId;
  if (!ch) return;
  socket.send({ type: 'voice_join', channel_id: ch, proto: 2 });
  window.clearTimeout(joinTimer);
  joinTimer = window.setTimeout(() => {
    const v = useVoice.getState();
    if (v.channelId !== ch || v.joined || !useStore.getState().connected) return;
    useStore.getState().toast('Не удалось подключиться к голосовому каналу', 'error');
    v.leave();
  }, JOIN_TIMEOUT);
}

// Выключить звук у себя; серверу ничего не сообщаем
function stopLocal() {
  window.clearTimeout(joinTimer);
  resetSpeaking();
  engine?.close();
  engine = null;
  useVoice.setState({ channelId: null, joined: false });
}

// Голос пользователя может быть только в одной вкладке: сервер слушает последнюю вошедшую
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('vicinity.voice') : null;

export const useVoice = create<VoiceState>((set, get) => ({
  channelId: null,
  joined: false,
  muted: false,
  deafened: false,

  join: async (channelId) => {
    if (get().channelId === channelId) return;
    const store = useStore.getState();
    if (!mediaAvailable()) return store.toast(HTTPS_REQUIRED, 'error');
    if (typeof AudioWorkletNode === 'undefined')
      return store.toast('Этот браузер не поддерживает голосовые каналы', 'error');
    const blocked = guard();
    if (blocked) return store.toast(blocked, 'error');
    if (!store.connected) return store.toast('Нет связи с сервером', 'error');

    window.clearTimeout(joinTimer);
    setSpeaking(false);
    resetSpeaking();
    set({ channelId, joined: false });
    if (engine) {
      // Переход в другой канал: звук уже запущен, недоигранное из прошлого канала — выбросить
      engine.reset();
    } else {
      const eng = (engine = new Engine());
      try {
        await eng.load(onCaptured);
      } catch {
        if (engine === eng) {
          get().leave();
          store.toast('Не удалось запустить звук в браузере', 'error');
        }
        return;
      }
      try {
        await eng.openMic(useMediaPrefs.getState().inputId);
      } catch (e) {
        if (engine === eng) {
          get().leave();
          store.toast(mediaError(e), 'error');
        }
        return;
      }
      if (engine !== eng) return; // вышли, пока запускался звук
    }
    // Пока запускался звук, перешли в другой канал — тот вызов уже отправил свой voice_join
    if (get().channelId !== channelId) return;
    sendJoin();
    tabs?.postMessage({ userId: meId() });
  },

  leave: () => {
    if (get().channelId === null) return;
    socket.send({ type: 'voice_leave' });
    stopLocal();
  },

  toggleMute: () => {
    const { muted, deafened } = get();
    // Как в Discord: включить микрофон при «не слышать» — снова слышать
    set(deafened ? { muted: false, deafened: false } : { muted: !muted });
    if (!get().muted) return;
    setSpeaking(false);
    resetSpeaking();
  },

  toggleDeafen: () => {
    const deafened = !get().deafened;
    set({ deafened });
    if (!deafened) return;
    engine?.reset();
    setSpeaking(false);
    resetSpeaking();
  },
}));

socket.onBinary((data) => {
  const v = useVoice.getState();
  if (!engine || v.channelId === null || v.deafened || data.byteLength <= 8) return;
  const view = new DataView(data);
  const sender = view.getUint32(0, true) + view.getInt32(4, true) * 2 ** 32;
  stats.framesReceived++;
  engine.frame(sender, data);
});

// После переподключения сервер уже выкинул нас из канала — входим снова
socket.onStatus((connected) => {
  if (useVoice.getState().channelId === null) return;
  if (connected) return sendJoin();
  window.clearTimeout(joinTimer);
  resetSpeaking();
  useVoice.setState({ joined: false });
});

useStore.subscribe((s, prev) => {
  // Выход из аккаунта: сокет уже закрыт, остаётся выключить звук
  if (prev.me && !s.me) return stopLocal();
  const { channelId, joined } = useVoice.getState();
  if (channelId === null || s.voice[channelId] === prev.voice[channelId]) return;
  const present = !!s.voice[channelId]?.some((u) => u.user_id === s.me?.user_id);
  if (present && !joined) {
    window.clearTimeout(joinTimer);
    useVoice.setState({ joined: true });
  } else if (!present && joined) {
    // Сервер убрал нас из канала: кик с сервера, доступ пропал, голос включили на другом устройстве
    stopLocal();
    s.toast('Вы отключены от голосового канала');
  }
});

useMediaPrefs.subscribe((p, prev) => {
  if (!engine) return;
  if (p.micGain !== prev.micGain) engine.setGain(p.micGain);
  if (p.volume !== prev.volume) engine.setVolume(p.volume);
  if (p.outputId !== prev.outputId) engine.setOutput(p.outputId);
  if (p.inputId !== prev.inputId)
    engine.openMic(p.inputId).catch((e) => useStore.getState().toast(mediaError(e), 'error'));
});

if (tabs)
  tabs.onmessage = (e) => {
    if (useVoice.getState().channelId === null || e.data?.userId !== meId()) return;
    stopLocal();
    useStore.getState().toast('Голосовой канал открыт в другой вкладке');
  };

// Закрытие вкладки — выход из канала, не дожидаясь, пока сервер заметит обрыв
window.addEventListener('pagehide', () => useVoice.getState().leave());
