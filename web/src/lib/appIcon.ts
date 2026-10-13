// Значок приложения (макет 01): 20 вариантов — 2 базовых, 11 со Standard, 7 с Ultra.
// Каждый — SVG 56×56 (фон + буква «V»), им же становится значок вкладки браузера.
// Список id и уровней совпадает с сервером (backend/controllers/SettingsController.cc, appIcons).

export interface AppIcon {
  id: string;
  name: string;
  /** 0 — базовый, 2 — Standard, 3 — Ultra */
  tier: number;
  fg: string;
  /** Свечение буквы */
  glow?: string;
  pixel?: boolean;
  /** Содержимое фона (внутри скруглённой маски) и нужные ему defs */
  bg: string;
  defs?: string;
}

const lin = (id: string, angle: number, stops: [string, number][]) => {
  // Угол как в CSS: 0° — вверх, 90° — вправо
  const r = (angle * Math.PI) / 180;
  const dx = Math.sin(r) / 2;
  const dy = -Math.cos(r) / 2;
  const s = stops.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return `<linearGradient id="${id}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${s}</linearGradient>`;
};
const rad = (id: string, cx: number, cy: number, r: number, color: string) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
const fill = (c: string) => `<rect width="56" height="56" fill="${c}"/>`;
const dot = (x: number, y: number, r: number, c: string) => `<circle cx="${(x * 56) / 100}" cy="${(y * 56) / 100}" r="${r}" fill="${c}"/>`;

export const APP_ICONS: AppIcon[] = [
  { id: 'classic', name: 'Классика', tier: 0, fg: '#06231C', bg: fill('#2BC6A4') },
  { id: 'night', name: 'Ночь', tier: 0, fg: '#2BC6A4', bg: fill('#0E1015') },
  { id: 'mono-light', name: 'Монохром светлый', tier: 2, fg: '#15181E', bg: fill('#F3F4F7') },
  { id: 'mono-dark', name: 'Монохром тёмный', tier: 2, fg: '#FFFFFF', bg: fill('#000000') },
  { id: 'neon', name: 'Неон', tier: 2, fg: '#6FF5D6', glow: '#2BC6A4', bg: fill('#0A0E12') },
  {
    id: 'sunset',
    name: 'Закат',
    tier: 2,
    fg: '#FFFFFF',
    defs: lin('g', 150, [['#FFB443', 0], ['#FF6B57', 0.5], ['#C8306E', 1]]),
    bg: fill('url(#g)'),
  },
  {
    id: 'ocean',
    name: 'Океан',
    tier: 2,
    fg: '#FFFFFF',
    defs: lin('g', 150, [['#38D1E0', 0], ['#1C7FD6', 0.5], ['#1B2F7A', 1]]),
    bg: fill('url(#g)'),
  },
  { id: 'lavender', name: 'Лаванда', tier: 2, fg: '#1D1236', bg: fill('#B78CF7') },
  { id: 'graphite', name: 'Графит', tier: 2, fg: '#A3A9B7', bg: fill('#232429') },
  {
    id: 'terminal',
    name: 'Терминал',
    tier: 2,
    fg: '#3DD68C',
    glow: '#3DD68C',
    defs: '<pattern id="p" width="56" height="4" patternUnits="userSpaceOnUse"><rect width="56" height="1" fill="#3DD68C" fill-opacity=".09"/></pattern>',
    bg: fill('#050A07') + fill('url(#p)'),
  },
  {
    id: 'camo',
    name: 'Камуфляж',
    tier: 2,
    fg: '#EFE9CC',
    bg: fill('#5E6E45') + dot(18, 28, 9, '#3E4A2F') + dot(74, 18, 11, '#2C3523') + dot(62, 78, 12, '#6E5F40') + dot(12, 82, 8, '#2C3523') + dot(92, 62, 7, '#3E4A2F'),
  },
  {
    id: 'newyear',
    name: 'Новый год',
    tier: 2,
    fg: '#F4FBF6',
    defs: lin('g', 160, [['#D23246', 0], ['#7E1426', 1]]),
    bg: fill('url(#g)') + dot(18, 22, 1.6, '#fff') + dot(78, 14, 1.6, '#fff') + dot(86, 72, 1.4, '#fff') + dot(26, 84, 1.2, '#fff') + dot(60, 90, 1, '#fff'),
  },
  {
    id: 'halloween',
    name: 'Хэллоуин',
    tier: 2,
    fg: '#FF8A1F',
    glow: '#FF8A1F',
    defs: lin('g', 160, [['#1E1029', 0], ['#0C0910', 1]]) + rad('r', 28, 64, 40, '#6A2E08'),
    bg: fill('url(#g)') + fill('url(#r)'),
  },
  {
    id: 'aurora',
    name: 'Аврора',
    tier: 3,
    fg: '#FFFFFF',
    defs: lin('g', 180, [['#14304A', 0], ['#0B0F1E', 1]]) + rad('a', 11, 7, 38, '#5CF2CF') + rad('b', 49, 21, 38, '#8F6BFF'),
    bg: fill('url(#g)') + fill('url(#a)') + fill('url(#b)'),
  },
  { id: 'pixel', name: 'Пиксель', tier: 3, fg: '#7DF9C9', pixel: true, bg: fill('#20163A') },
  {
    id: 'glass',
    name: 'Стекло',
    tier: 3,
    fg: '#FFFFFF',
    defs: lin('g', 135, [['#2BC6A4', 0], ['#4C6DFF', 1]]),
    bg:
      fill('url(#g)') +
      '<path d="M0 0H56L0 56Z" fill="#fff" fill-opacity=".2"/>' +
      '<rect x=".5" y=".5" width="55" height="55" rx="13.5" fill="none" stroke="#fff" stroke-opacity=".5"/>',
  },
  {
    id: 'retro',
    name: 'Ретро-волна',
    tier: 3,
    fg: '#FF7BE5',
    glow: '#FF4FD8',
    defs: lin('g', 180, [['#2B0F4A', 0], ['#8A2270', 0.66], ['#170A2B', 0.67], ['#170A2B', 1]]),
    bg:
      fill('url(#g)') +
      '<circle cx="28" cy="37" r="13" fill="#FFC24A"/>' +
      '<rect y="37.5" width="56" height="18.5" fill="#170A2B"/>' +
      [38, 44, 50].map((y) => `<rect y="${y}" width="56" height="1" fill="#FF4FD8" fill-opacity=".6"/>`).join(''),
  },
  { id: 'fuchsia', name: 'Неон фуксия', tier: 3, fg: '#FF6FE0', glow: '#FF4FD8', bg: fill('#120A16') },
  {
    id: 'gold',
    name: 'Золото',
    tier: 3,
    fg: '#2A1A05',
    defs: lin('g', 150, [['#FFE7A6', 0], ['#E7B04A', 0.45], ['#9C6A1E', 1]]),
    bg: fill('url(#g)'),
  },
  {
    id: 'confetti',
    name: 'Конфетти',
    tier: 3,
    fg: '#15181E',
    bg: fill('#FBF6EC') + dot(16, 20, 2.5, '#FF6B57') + dot(82, 16, 2.5, '#2BC6A4') + dot(88, 78, 2.5, '#7DB8F5') + dot(14, 80, 2.5, '#B78CF7') + dot(50, 92, 2, '#FFB443'),
  },
];

export const DEFAULT_APP_ICON = 'classic';

export const appIconById = (id: string | undefined) => APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0];

/** Пиксельная «V»: клетки 6×6 */
const PIXELS: [number, number][] = [
  [13, 14], [37, 14], [13, 20], [37, 20], [19, 26], [31, 26], [19, 32], [31, 32], [25, 38],
];

/** SVG значка целиком */
export function appIconSvg(icon: AppIcon): string {
  const glow = icon.glow
    ? `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${icon.glow}"/><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${icon.glow}" flood-opacity=".7"/></filter>`
    : '';
  const glyph = icon.pixel
    ? `<g fill="${icon.fg}">${PIXELS.map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="6"/>`).join('')}</g>`
    : `<path d="M16 21 28 41 40 21" fill="none" stroke="${icon.fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"${icon.glow ? ' filter="url(#f)"' : ''}/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><defs>${icon.defs ?? ''}${glow}` +
    `<clipPath id="c"><rect width="56" height="56" rx="14"/></clipPath></defs>` +
    `<g clip-path="url(#c)">${icon.bg}</g>${glyph}</svg>`
  );
}

const cache = new Map<string, string>();
/** data:-адрес SVG значка (CSP разрешает data: для картинок) */
export function appIconUrl(icon: AppIcon): string {
  let u = cache.get(icon.id);
  if (!u) {
    u = 'data:image/svg+xml,' + encodeURIComponent(appIconSvg(icon));
    cache.set(icon.id, u);
  }
  return u;
}

/** Адрес картинки значка для интерфейса (логотип в боковой панели) */
export const appIconSrc = (id: string) => (id === DEFAULT_APP_ICON ? '/favicon.svg' : appIconUrl(appIconById(id)));

let applied = '';

/** Поставить значок во вкладку браузера и — в ПК-приложении — на окно, панель задач, трей и ярлыки */
export function applyFavicon(id: string) {
  if (applied === id) return;
  applied = id;
  // Новый <link>, а не смена href: так браузеры надёжнее перерисовывают значок вкладки
  const old = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = appIconSrc(id);
  document.head.append(link);
  old.forEach((l) => l.remove());
  void sendToDesktop(id);
}

/** ПК-приложение: растр 256×256 для значка окна и ярлыков (классический — свой из установщика) */
async function sendToDesktop(id: string) {
  const bridge = (window as unknown as { vicinityDesktop?: { setIcon?: (id: string, png: string | null) => void } }).vicinityDesktop;
  if (!bridge?.setIcon) return;
  if (id === DEFAULT_APP_ICON) return bridge.setIcon(id, null);
  try {
    const img = new Image();
    img.src = appIconUrl(appIconById(id));
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    canvas.getContext('2d')!.drawImage(img, 0, 0, 256, 256);
    if (applied === id) bridge.setIcon(id, canvas.toDataURL('image/png'));
  } catch {
    /* значок окна останется прежним */
  }
}
