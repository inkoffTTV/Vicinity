// Уведомления о сообщениях: когда показывать (лички, упоминания, настройки серверов и каналов),
// системное уведомление браузера и короткий звук без звуковых файлов (WebAudio).
// Настройки — в localStorage этого браузера.
import { create } from 'zustand';
import { Message } from './api';
import { plainText } from './markdown';

/** Сервер: уведомлять обо всех сообщениях, только об упоминаниях или ни о чём */
export type NotifyLevel = 'all' | 'mentions' | 'none';

export const NOTIFY_LEVELS: [NotifyLevel, string][] = [
  ['all', 'Все сообщения'],
  ['mentions', 'Только @упоминания'],
  ['none', 'Ничего'],
];

interface Settings {
  servers: Record<number, NotifyLevel>;
  /** Каналы (в том числе лички и беседы) без уведомлений */
  muted: number[];
}

interface State extends Settings {
  setServerLevel: (serverId: number, level: NotifyLevel) => void;
  toggleMute: (channelId: number) => void;
}

const KEY = 'vicinity.notify';

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      servers: raw && typeof raw.servers === 'object' && raw.servers ? raw.servers : {},
      muted: Array.isArray(raw?.muted) ? raw.muted.filter((x: unknown) => typeof x === 'number') : [],
    };
  } catch {
    return { servers: {}, muted: [] };
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ servers: s.servers, muted: s.muted }));
  } catch {
    /* приватный режим — настройки живут до перезагрузки */
  }
}

export const useNotifySettings = create<State>((set, get) => ({
  ...load(),
  setServerLevel: (serverId, level) => {
    set({ servers: { ...get().servers, [serverId]: level } });
    save(get());
  },
  toggleMute: (channelId) => {
    const muted = get().muted;
    set({ muted: muted.includes(channelId) ? muted.filter((x) => x !== channelId) : [...muted, channelId] });
    save(get());
  },
}));

/** Уровень уведомлений сервера; по умолчанию — только упоминания */
export const serverLevel = (s: Settings, serverId: number): NotifyLevel => s.servers[serverId] ?? 'mentions';

export interface NotifyContext {
  /** Сервер канала; null — личка или беседа */
  serverId: number | null;
  mentioned: boolean;
  /** Канал открыт на экране */
  active: boolean;
  /** Статус «Не беспокоить» */
  dnd: boolean;
  /** Открыть канал по щелчку на уведомлении */
  open: () => void;
}

/** Чужое новое сообщение: уведомить, если это личка/беседа или упоминание (или так настроен сервер) */
export function notifyMessage(msg: Message, ctx: NotifyContext) {
  const s = useNotifySettings.getState();
  if (ctx.dnd || s.muted.includes(msg.channel_id)) return;
  if (ctx.serverId !== null) {
    const level = serverLevel(s, ctx.serverId);
    if (level === 'none' || (level === 'mentions' && !ctx.mentioned)) return;
  }
  const focused = !document.hidden && document.hasFocus();
  if (ctx.active && focused) return;
  playChime();
  if (focused || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(ctx.mentioned ? `${msg.author_name} упоминает вас` : msg.author_name, {
      body: plainText(msg.text) || (msg.attachment_type === 'file' ? `📎 ${msg.attachment_name || 'Файл'}` : '📎 Изображение'),
      icon: msg.author_avatar || '/favicon.svg',
      tag: `ch-${msg.channel_id}`,
    });
    n.onclick = () => {
      window.focus();
      ctx.open();
      n.close();
    };
  } catch {
    /* браузер запретил уведомление — звука достаточно */
  }
}

let audio: AudioContext | null = null;
let lastChime = 0;

// Короткий двухнотный сигнал; пачка сообщений подряд звучит один раз
function playChime() {
  const now = Date.now();
  if (now - lastChime < 1500) return;
  lastChime = now;
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    (
      [
        [0, 0.11, 880],
        [0.12, 0.16, 1318.5],
      ] as const
    ).forEach(([start, duration, freq]) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const t = t0 + start;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(env).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    });
  } catch {
    /* WebAudio недоступен — без звука */
  }
}
