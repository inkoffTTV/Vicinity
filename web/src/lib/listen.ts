// «Слушать вместе» в голосовом канале (docs/CALLS.md §2.7): общая очередь 30-секундных превью из каталога.
// Сервер хранит очередь и позицию и шлёт listen_state всем в канале; здесь — зеркало состояния,
// один <audio> на вкладку, подгонка позиции под сервер и команды listen_*.
import { create } from 'zustand';
import { MusicTrack } from './api';
import { applyOutput, useMediaPrefs } from './media';
import { useVoice } from './voice';
import { socket, WsEvent } from './ws';

export interface ListenTrack extends MusicTrack {
  added_by: number;
}

interface ListenState {
  channelId: number | null;
  queue: ListenTrack[];
  playing: boolean;
  /** Позиция сервера в момент получения и локальное время получения */
  positionMs: number;
  receivedAt: number;
  durationMs: number;
  by: number;
  /** Панель открыта на сцене голосового канала */
  open: boolean;
  /** Громкость общей музыки 0…1 (локально, поверх общей громкости) */
  volume: number;
  setOpen: (v: boolean) => void;
  setVolume: (v: number) => void;
  add: (t: MusicTrack) => void;
  remove: (index: number) => void;
  toggle: () => void;
  next: () => void;
  seek: (ms: number) => void;
  clear: () => void;
}

const VOLUME_KEY = 'vicinity.listenVolume';
const loadVolume = () => {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.6;
  } catch {
    return 0.6;
  }
};

const EMPTY = { channelId: null, queue: [] as ListenTrack[], playing: false, positionMs: 0, receivedAt: 0, durationMs: 30000, by: 0 };

export const useListen = create<ListenState>((set, get) => ({
  ...EMPTY,
  open: false,
  volume: loadVolume(),
  setOpen: (open) => set({ open }),
  setVolume: (v) => {
    const volume = Math.min(1, Math.max(0, v));
    set({ volume });
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* приватный режим */
    }
  },
  add: (t) => socket.send({ type: 'listen_add', track: t }),
  remove: (index) => socket.send({ type: 'listen_remove', index }),
  toggle: () => socket.send({ type: get().playing ? 'listen_pause' : 'listen_play' }),
  next: () => socket.send({ type: 'listen_next', index: 0 }),
  seek: (ms) => socket.send({ type: 'listen_seek', position_ms: Math.round(ms) }),
  clear: () => socket.send({ type: 'listen_clear' }),
}));

/** Текущая позиция трека по данным сервера, мс */
export function positionNow(s: Pick<ListenState, 'playing' | 'positionMs' | 'receivedAt' | 'durationMs'>) {
  const p = s.playing ? s.positionMs + (Date.now() - s.receivedAt) : s.positionMs;
  return Math.max(0, Math.min(s.durationMs, p));
}

socket.on((ev: WsEvent) => {
  if (ev.type !== 'listen_state') return;
  // Состояние чужого канала (устаревшее после перехода) — не берём
  const mine = useVoice.getState().channelId;
  if (mine !== null && ev.channel_id !== mine) return;
  useListen.setState({
    channelId: ev.channel_id,
    queue: Array.isArray(ev.queue) ? ev.queue : [],
    playing: !!ev.playing,
    positionMs: Number(ev.position_ms) || 0,
    receivedAt: Date.now(),
    durationMs: Number(ev.duration_ms) || 30000,
    by: Number(ev.by) || 0,
  });
});

// Вышли из голоса — очередь не наша
useVoice.subscribe((v, prev) => {
  if (v.channelId !== prev.channelId) useListen.setState({ ...EMPTY, open: false });
});

// ── Воспроизведение ──
let audio: HTMLAudioElement | null = null;
let src = '';
let endedSent = '';

function player() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', () => {
    // Трек кончился — просим следующий; сервер учитывает только первый запрос
    const s = useListen.getState();
    const key = s.queue[0]?.preview ?? '';
    if (key && endedSent !== key) {
      endedSent = key;
      s.next();
    }
  });
  return audio;
}

function syncPlayback() {
  const s = useListen.getState();
  const v = useVoice.getState();
  const el = player();
  const track = s.queue[0];
  const shouldPlay = !!track && s.playing && v.joined && v.channelId === s.channelId && !v.deafened;
  if (!track) {
    if (src) {
      el.pause();
      el.removeAttribute('src');
      src = '';
    }
    return;
  }
  if (src !== track.preview) {
    src = track.preview;
    el.src = track.preview;
    endedSent = '';
  }
  const prefs = useMediaPrefs.getState();
  el.volume = Math.min(1, prefs.volume * s.volume);
  applyOutput(el, prefs.outputId);
  const want = positionNow(s) / 1000;
  // Подгоняем позицию, если разошлись больше чем на секунду
  if (Math.abs(el.currentTime - want) > 1 && Number.isFinite(want)) el.currentTime = want;
  if (shouldPlay) {
    if (el.paused) void el.play().catch(() => {});
  } else if (!el.paused) el.pause();
}

useListen.subscribe(syncPlayback);
useVoice.subscribe(syncPlayback);
useMediaPrefs.subscribe(syncPlayback);

/** Для тестов и отладки: что сейчас играет */
if (typeof window !== 'undefined')
  Object.defineProperty(window, '__vicinityListen', { get: () => ({ src, paused: audio?.paused ?? true, time: audio?.currentTime ?? 0 }) });
