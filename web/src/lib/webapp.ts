// Мини-приложения ботов (docs/API.md §21.8): панель с iframe, совместимая с telegram-web-app.js.
// Здесь — что открыто и тема для мини-приложения; панель и протокол postMessage — components/WebAppPanel.tsx.
import { create } from 'zustand';
import { useStore } from './store';

export interface WebAppTarget {
  botId: number;
  botName: string;
  url: string;
  channelId?: number;
  /** Кнопка сообщения (message_id) или эфемерного сообщения (ephemeral_id); без них — кнопка меню бота */
  messageId?: number;
  ephemeralId?: string;
}

interface State {
  app: WebAppTarget | null;
  /** Номер открытия: то же приложение, открытое заново, — новая панель с новым initData */
  seq: number;
  open: (t: WebAppTarget) => void;
  close: () => void;
}

export const useWebApp = create<State>((set, get) => ({
  app: null,
  seq: 0,
  open: (t) => set({ app: t, seq: get().seq + 1 }),
  close: () => set({ app: null }),
}));

// Другой пользователь вошёл в этой вкладке — чужое мини-приложение закрывается
let owner = useStore.getState().me?.user_id;
useStore.subscribe((st) => {
  const id = st.me?.user_id;
  if (id === owner) return;
  owner = id;
  useWebApp.setState({ app: null });
});

/** Адрес мини-приложения: https (http — только локальные адреса для разработки; сервер проверяет строже).
 *  Тот же origin, что у Vicinity, внутрь не открываем: с allow-same-origin такая страница вышла бы из песочницы */
export function webAppUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
}

export const sameOriginApp = (u: URL) => u.origin === window.location.origin;

// theme_params telegram-web-app.js ← токены Vicinity. Фон и текст — те же, что видит человек вокруг панели
const THEME_VARS: [string, string][] = [
  ['bg_color', '--bg-panel'],
  ['secondary_bg_color', '--bg-ground'],
  ['section_bg_color', '--bg-raised'],
  ['header_bg_color', '--bg-raised'],
  ['bottom_bar_bg_color', '--bg-raised'],
  ['text_color', '--text'],
  ['subtitle_text_color', '--text-2'],
  ['hint_color', '--text-3'],
  ['link_color', '--link'],
  ['accent_text_color', '--link'],
  ['section_header_text_color', '--link'],
  ['button_color', '--accent'],
  ['button_text_color', '--on-accent'],
  ['destructive_text_color', '--danger-text'],
  ['section_separator_color', '--border'],
];

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Цвета темы в #rrggbb. Токен может быть color-mix() или полупрозрачным — браузер вычисляет его на элементе,
 *  а холст сводит к пикселю поверх фона приложения */
export function themeParams(): Record<string, string> {
  const out: Record<string, string> = {};
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return out;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolve = (v: string) => {
    probe.style.color = '';
    probe.style.color = `var(${v})`;
    return getComputedStyle(probe).color;
  };
  const ground = resolve('--bg-ground');
  const paint = (color: string) => {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  };
  try {
    for (const [key, v] of THEME_VARS) {
      const c = resolve(v);
      if (c) out[key] = paint(c);
    }
  } finally {
    probe.remove();
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

/** Относительная яркость sRGB (WCAG) */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
