// Цветовые темы оформления (экран «Тема»). id совпадают со списком на сервере
// (backend/controllers/SettingsController.cc): сохранить тему без подписки Standard сервер не даст.

export type BaseTheme = 'light' | 'dark' | 'graphite' | 'black';

export interface ColorTheme {
  id: string;
  name: string;
  /** Светлая или тёмная основа интерфейса поверх градиента */
  base: 'light' | 'dark';
  colors: string[];
  angle: number;
}

/** Своя тема (подписка Ultra): 2–3 цвета, угол градиента и основа */
export interface CustomTheme {
  colors: string[];
  angle: number;
  base: 'light' | 'dark';
}

export const BASE_THEMES: { id: BaseTheme; name: string; swatch: string }[] = [
  { id: 'light', name: 'Светлая', swatch: '#ffffff' },
  { id: 'dark', name: 'Тёмная', swatch: '#161920' },
  { id: 'graphite', name: 'Графит', swatch: '#232429' },
  { id: 'black', name: 'Чёрная', swatch: '#000000' },
];

export const COLOR_THEMES: ColorTheme[] = [
  // Светлые: пастель с низкой насыщенностью
  { id: 'mint', name: 'Мята', base: 'light', colors: ['#dff3ec', '#cfe6ef'], angle: 135 },
  { id: 'peach', name: 'Персик', base: 'light', colors: ['#f7e6da', '#f0d6d2'], angle: 135 },
  { id: 'lavender', name: 'Лаванда', base: 'light', colors: ['#e6e4f6', '#d9e5f4'], angle: 135 },
  { id: 'lime', name: 'Лайм', base: 'light', colors: ['#edf1dd', '#f5eedb'], angle: 135 },
  { id: 'rose', name: 'Роза', base: 'light', colors: ['#f2e0e5', '#eee2d7'], angle: 135 },
  { id: 'cotton', name: 'Сахарная вата', base: 'light', colors: ['#f1e2ee', '#e0e6f6'], angle: 135 },
  { id: 'sky', name: 'Небо', base: 'light', colors: ['#ddecf6', '#e5f2ec'], angle: 135 },
  { id: 'cream', name: 'Крем', base: 'light', colors: ['#f4efe5', '#ebe4d8'], angle: 135 },
  // Тёмные: глубокие приглушённые тона — градиент заметен, но не спорит с интерфейсом
  { id: 'dusk', name: 'Сумерки', base: 'dark', colors: ['#231d3d', '#4a2c3c'], angle: 135 },
  { id: 'aurora', name: 'Аврора', base: 'dark', colors: ['#0f2a33', '#1c4150', '#2b5d70'], angle: 135 },
  { id: 'forest', name: 'Лес', base: 'dark', colors: ['#10261a', '#25361f'], angle: 160 },
  { id: 'crimson', name: 'Багрянец', base: 'dark', colors: ['#2a0d14', '#3d1420'], angle: 135 },
  { id: 'midnight', name: 'Полночь', base: 'dark', colors: ['#0d1430', '#1d2550'], angle: 135 },
  { id: 'brick', name: 'Кирпич', base: 'dark', colors: ['#2c1810', '#452a1e'], angle: 135 },
  { id: 'mist', name: 'Туман', base: 'dark', colors: ['#20222e', '#363849'], angle: 180 },
  { id: 'sage', name: 'Шалфей', base: 'dark', colors: ['#1a2a22', '#2c3d32'], angle: 135 },
  { id: 'ocean', name: 'Океан', base: 'dark', colors: ['#0c2238', '#103a48'], angle: 135 },
  { id: 'lagoon', name: 'Лагуна', base: 'dark', colors: ['#0e2e33', '#2a2050'], angle: 135 },
  { id: 'berry', name: 'Ягоды', base: 'dark', colors: ['#2c1028', '#3d2418'], angle: 135 },
  { id: 'sunset', name: 'Закат', base: 'dark', colors: ['#331a0c', '#453012'], angle: 135 },
  { id: 'neon', name: 'Неон', base: 'dark', colors: ['#0f1d45', '#0e3a38', '#2a1548'], angle: 135 },
  { id: 'bronze', name: 'Бронза', base: 'dark', colors: ['#2a2213', '#3b301a'], angle: 135 },
  { id: 'indigo', name: 'Индиго', base: 'dark', colors: ['#141a45', '#0c1030'], angle: 135 },
];

export const themeById = (id: string | null | undefined) => COLOR_THEMES.find((t) => t.id === id) ?? null;

export const gradientCss = (t: { colors: string[]; angle: number }) =>
  `linear-gradient(${t.angle}deg, ${t.colors.join(', ')})`;

// ── Акцент под тему ──
// Пользователь акцент не выбирает: у базовых тем он свой (theme.css), у цветовых — из цветов темы.

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Акцент, который «встаёт» в цветовую тему: оттенок главного цвета градиента,
 *  яркий на тёмной основе и приглушённо-тёмный на светлой (чтобы кнопки и ссылки читались) */
export function accentForTheme(t: { colors: string[]; base: 'light' | 'dark' }): string {
  // Главный цвет темы — первый (по нему тема и названа); другой — только если он заметно насыщеннее
  const hsl = t.colors.map(hexToHsl);
  const top = hsl.reduce((best, c) => (c[1] > best[1] * 1.5 ? c : best), hsl[0]);
  const [h, s] = top;
  // Почти серые темы (туман, крем) — сдержанный, но заметный акцент того же оттенка
  const sat = Math.min(0.7, Math.max(0.42, s * 1.6));
  return t.base === 'dark' ? hslToHex(h, sat, 0.64) : hslToHex(h, Math.min(sat, 0.6), 0.36);
}
