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
  { id: 'mint', name: 'Мята', base: 'light', colors: ['#a8e6cf', '#d9f5c5'], angle: 135 },
  { id: 'peach', name: 'Персик', base: 'light', colors: ['#ffd8a8', '#ffb38a'], angle: 135 },
  { id: 'lavender', name: 'Лаванда', base: 'light', colors: ['#c3c8f2', '#b9d7f0'], angle: 135 },
  { id: 'lime', name: 'Лайм', base: 'light', colors: ['#e3f5b8', '#fff3c4'], angle: 135 },
  { id: 'rose', name: 'Роза', base: 'light', colors: ['#e7b7c8', '#f3d9b1'], angle: 135 },
  { id: 'cotton', name: 'Сахарная вата', base: 'light', colors: ['#f9d1e6', '#d6e4ff'], angle: 135 },
  { id: 'sky', name: 'Небо', base: 'light', colors: ['#c9f1ff', '#e8fbd8'], angle: 135 },
  { id: 'cream', name: 'Крем', base: 'light', colors: ['#f7f0d8', '#efe6cf'], angle: 135 },
  { id: 'dusk', name: 'Сумерки', base: 'dark', colors: ['#3a2a6b', '#a5562f'], angle: 135 },
  { id: 'aurora', name: 'Аврора', base: 'dark', colors: ['#2b1a8f', '#a3168a', '#1c7ad6'], angle: 135 },
  { id: 'forest', name: 'Лес', base: 'dark', colors: ['#0e2a1b', '#3b4a1c'], angle: 160 },
  { id: 'crimson', name: 'Багрянец', base: 'dark', colors: ['#3b0508', '#0b0001'], angle: 135 },
  { id: 'midnight', name: 'Полночь', base: 'dark', colors: ['#1a1446', '#05040f'], angle: 135 },
  { id: 'brick', name: 'Кирпич', base: 'dark', colors: ['#5c2b24', '#3a1c18'], angle: 135 },
  { id: 'mist', name: 'Туман', base: 'dark', colors: ['#4a4560', '#7b7a96'], angle: 180 },
  { id: 'sage', name: 'Шалфей', base: 'dark', colors: ['#3d5a4a', '#2b3d33'], angle: 135 },
  { id: 'ocean', name: 'Океан', base: 'dark', colors: ['#1f3f78', '#1f6b7a'], angle: 135 },
  { id: 'lagoon', name: 'Лагуна', base: 'dark', colors: ['#106b6b', '#5b2f8c'], angle: 135 },
  { id: 'berry', name: 'Ягоды', base: 'dark', colors: ['#7a0f5c', '#c46a14'], angle: 135 },
  { id: 'sunset', name: 'Закат', base: 'dark', colors: ['#8a2c0a', '#d29a12'], angle: 135 },
  { id: 'neon', name: 'Неон', base: 'dark', colors: ['#0f2e8a', '#09766b', '#5d1f9e'], angle: 135 },
  { id: 'bronze', name: 'Бронза', base: 'dark', colors: ['#5a4426', '#2a2014'], angle: 135 },
  { id: 'indigo', name: 'Индиго', base: 'dark', colors: ['#1a2b8f', '#0c1650'], angle: 135 },
];

export const themeById = (id: string | null | undefined) => COLOR_THEMES.find((t) => t.id === id) ?? null;

export const gradientCss = (t: { colors: string[]; angle: number }) =>
  `linear-gradient(${t.angle}deg, ${t.colors.join(', ')})`;
