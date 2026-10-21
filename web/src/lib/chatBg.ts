import { create } from 'zustand';
import type { ChatBg } from './api';

export type { ChatBg } from './api';

/** Готовые фоны чата — свои (CSS-градиенты, без картинок); id совпадают со списком на сервере
 *  (backend/controllers/ChannelController.cc, bgPresets). Цвета — данные фонов, не токены темы. */
export const BG_PRESETS: { id: string; name: string; css: string }[] = [
  { id: 'lagoon', name: 'Лагуна', css: 'linear-gradient(135deg, #0f3d3a, #1b6b5e 55%, #2bc6a4)' },
  { id: 'dusk', name: 'Сумерки', css: 'linear-gradient(160deg, #2b1a4f, #6a2a6e 50%, #c2543f)' },
  { id: 'forest', name: 'Лес', css: 'linear-gradient(180deg, #0f2a1c, #1f5a36 60%, #4f8a3a)' },
  { id: 'ember', name: 'Угли', css: 'linear-gradient(135deg, #2a0f0f, #7a2a1a 55%, #e0742f)' },
  { id: 'night', name: 'Ночь', css: 'radial-gradient(circle at 30% 20%, #26315c, #0b0e1e 70%)' },
  {
    id: 'dots',
    name: 'Точки',
    css: 'radial-gradient(circle, rgba(255, 255, 255, 0.14) 1.5px, transparent 2px) 0 0 / 22px 22px, linear-gradient(180deg, #1c2230, #11151d)',
  },
  {
    id: 'grid',
    name: 'Сетка',
    css: 'linear-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px) 0 0 / 28px 28px, #141821',
  },
  { id: 'waves', name: 'Волны', css: 'repeating-linear-gradient(135deg, #15323a 0 18px, #1b4049 18px 36px)' },
];

export const presetById = (id: string | undefined) => BG_PRESETS.find((p) => p.id === id);

/** Фон из JSON-строки сервера или объекта; неизвестное — null */
export function parseBg(raw: unknown): ChatBg | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const bg: ChatBg = {};
  if (typeof o.preset === 'string' && presetById(o.preset)) bg.preset = o.preset;
  else if (typeof o.image === 'string' && /^\/uploads\/backgrounds\/[A-Za-z0-9._-]+$/.test(o.image)) bg.image = o.image;
  else return null;
  if (typeof o.dim === 'number') bg.dim = Math.max(0, Math.min(80, Math.round(o.dim)));
  if (o.blur === true) bg.blur = true;
  return bg;
}

/** Значение background-image для слоя фона */
export function bgCss(bg: ChatBg): string {
  if (bg.image) return `url("${bg.image}")`;
  return presetById(bg.preset)?.css ?? 'none';
}

/* Предложение фона собеседнику — обычным сообщением фиксированного вида; клиент показывает его карточкой
   с кнопкой «Поставить себе», другие клиенты — текстом */
const PROPOSAL_RE = /^Фон чата: (preset|image)=(\S+)(?: dim=(\d{1,2}))?( blur)?$/;

export function proposalText(bg: ChatBg): string {
  const kind = bg.image ? `image=${bg.image}` : `preset=${bg.preset}`;
  return `Фон чата: ${kind}${bg.dim !== undefined ? ` dim=${bg.dim}` : ''}${bg.blur ? ' blur' : ''}`;
}

export function parseProposal(text: string): ChatBg | null {
  const m = PROPOSAL_RE.exec(text.trim());
  if (!m) return null;
  return parseBg({ [m[1]]: m[2], dim: m[3] !== undefined ? Number(m[3]) : undefined, blur: !!m[4] });
}

/* Личные фоны — у себя в браузере, по id чата; собеседник их не видит */
const KEY = 'vicinity.chatbg';

function loadPersonal(): Record<number, ChatBg> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<number, ChatBg> = {};
    for (const [k, v] of Object.entries(raw)) {
      const bg = parseBg(v);
      if (bg && Number.isFinite(Number(k))) out[Number(k)] = bg;
    }
    return out;
  } catch {
    return {};
  }
}

interface PersonalBgState {
  bgs: Record<number, ChatBg>;
  set: (channelId: number, bg: ChatBg | null) => void;
}

export const usePersonalBg = create<PersonalBgState>((set, get) => ({
  bgs: loadPersonal(),
  set: (channelId, bg) => {
    const bgs = { ...get().bgs };
    if (bg) bgs[channelId] = bg;
    else delete bgs[channelId];
    set({ bgs });
    try {
      localStorage.setItem(KEY, JSON.stringify(bgs));
    } catch {
      /* приватный режим — фон живёт до перезагрузки */
    }
  },
}));
