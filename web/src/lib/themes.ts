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
  { id: 'dusk', name: 'Сумерки', base: 'dark', colors: ['#1d1a2c', '#352833'], angle: 135 },
  { id: 'aurora', name: 'Аврора', base: 'dark', colors: ['#0f2027', '#1d3540', '#284a5a'], angle: 135 },
  { id: 'forest', name: 'Лес', base: 'dark', colors: ['#0f1d16', '#1d2a1f'], angle: 160 },
  { id: 'crimson', name: 'Багрянец', base: 'dark', colors: ['#1e0c10', '#2c1218'], angle: 135 },
  { id: 'midnight', name: 'Полночь', base: 'dark', colors: ['#0b1020', '#161c35'], angle: 135 },
  { id: 'brick', name: 'Кирпич', base: 'dark', colors: ['#21150f', '#33221b'], angle: 135 },
  { id: 'mist', name: 'Туман', base: 'dark', colors: ['#1b1d25', '#2b2d39'], angle: 180 },
  { id: 'sage', name: 'Шалфей', base: 'dark', colors: ['#161f1a', '#222d26'], angle: 135 },
  { id: 'ocean', name: 'Океан', base: 'dark', colors: ['#0b1a29', '#0f2b35'], angle: 135 },
  { id: 'lagoon', name: 'Лагуна', base: 'dark', colors: ['#0c2125', '#1e1a31'], angle: 135 },
  { id: 'berry', name: 'Ягоды', base: 'dark', colors: ['#1f0f1d', '#2d1b16'], angle: 135 },
  { id: 'sunset', name: 'Закат', base: 'dark', colors: ['#24150d', '#2f2211'], angle: 135 },
  { id: 'neon', name: 'Неон', base: 'dark', colors: ['#0c1530', '#0d2929', '#1c1232'], angle: 135 },
  { id: 'bronze', name: 'Бронза', base: 'dark', colors: ['#1c1710', '#2a2215'], angle: 135 },
  { id: 'indigo', name: 'Индиго', base: 'dark', colors: ['#10142e', '#0b0e1f'], angle: 135 },
];

export const themeById = (id: string | null | undefined) => COLOR_THEMES.find((t) => t.id === id) ?? null;

export const gradientCss = (t: { colors: string[]; angle: number }) =>
  `linear-gradient(${t.angle}deg, ${t.colors.join(', ')})`;
