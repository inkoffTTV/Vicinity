// Тема профиля (макет «11 · Тема профиля»): два цвета карточки — верх и низ. Подложка под текстом
// и цвет текста подбираются по яркости пары, чтобы контраст был не ниже 4,5:1 (WCAG AA).
import type { CSSProperties } from 'react';

export interface ProfileTheme {
  top: string;
  bottom: string;
}

export const PROFILE_THEME_PRESETS: { name: string; top: string; bottom: string }[] = [
  { name: 'Мята и ночь', top: '#2bc6a4', bottom: '#0e1015' },
  { name: 'Закат', top: '#ffb443', bottom: '#c8306e' },
  { name: 'Океан', top: '#38d1e0', bottom: '#1b2f7a' },
  { name: 'Аврора', top: '#5cf2cf', bottom: '#4c3ba8' },
  { name: 'Лаванда', top: '#e3d4ff', bottom: '#b78cf7' },
  { name: 'Графит', top: '#3a3b42', bottom: '#1a1b1f' },
  { name: 'Песок', top: '#f6e7c8', bottom: '#d9b98a' },
  { name: 'Вишня', top: '#ff6b9a', bottom: '#5a0f2e' },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function parseProfileTheme(v: unknown): ProfileTheme | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (typeof t.top !== 'string' || typeof t.bottom !== 'string' || !HEX.test(t.top) || !HEX.test(t.bottom)) return null;
  return { top: t.top.toLowerCase(), bottom: t.bottom.toLowerCase() };
}

type Rgb = [number, number, number];

export const hexToRgb = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (v: number) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
export const luminance = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ratio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

export interface ThemeSurface {
  /** Светлая пара → светлая подложка и тёмный текст */
  light: boolean;
  /** Непрозрачность подложки 0..1 */
  alpha: number;
  /** Худший контраст текста по верху и низу */
  ratio: number;
  ok: boolean;
  vars: CSSProperties;
}

/** Подложка и цвета текста для пары: подложку усиливаем, пока контраст не станет ≥ 4,5 (не больше 88 %) */
export function themeSurface(t: ProfileTheme): ThemeSurface {
  const cTop = hexToRgb(t.top);
  const cBot = hexToRgb(t.bottom);
  const light = luminance(mix(cTop, cBot, 0.5)) >= 0.4;
  const over: Rgb = light ? [255, 255, 255] : [10, 12, 16];
  const fg: Rgb = light ? [21, 24, 30] : [242, 244, 248];
  const worst = (a: number) => Math.min(ratio(luminance(fg), luminance(mix(cTop, over, a))), ratio(luminance(fg), luminance(mix(cBot, over, a))));
  let alpha = light ? 0.72 : 0.55;
  while (worst(alpha) < 4.5 && alpha < 0.88) alpha = Math.round((alpha + 0.08) * 100) / 100;
  const r = worst(alpha);
  return {
    light,
    alpha,
    ratio: r,
    ok: r >= 4.5,
    vars: {
      '--pt-top': t.top,
      '--pt-bottom': t.bottom,
      '--pt-panel': `rgba(${over.join(',')},${alpha})`,
      '--pt-fg': light ? '#15181e' : '#f2f4f8',
      '--pt-fg2': light ? '#3a404d' : '#c9cdd6',
      '--pt-divider': light ? 'rgba(16,20,28,.12)' : 'rgba(255,255,255,.12)',
      '--pt-tag-bg': light ? 'rgba(16,20,28,.06)' : 'rgba(255,255,255,.08)',
      '--pt-tag-border': light ? 'rgba(16,20,28,.14)' : 'rgba(255,255,255,.14)',
      '--pt-btn-bg': light ? '#15181e' : 'var(--accent)',
      '--pt-btn-fg': light ? '#ffffff' : 'var(--on-accent)',
    } as CSSProperties,
  };
}

/** Цвет подписи поверх одного цвета (кружки «Верх»/«Низ») */
export const labelOn = (hex: string) => (luminance(hexToRgb(hex)) >= 0.4 ? '#15181e' : '#ffffff');

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const [R, G, B] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
