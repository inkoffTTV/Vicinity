// Стиль ника (макет «4 · Стиль отображаемого имени»): шрифт, эффект и 1–2 цвета.
// id и уровни подписки совпадают с сервером (backend/utils/ProfileExt.cc), он же проверяет подписку.
import type { CSSProperties } from 'react';

export interface NameStyle {
  font: string;
  effect: string;
  colors: string[];
}

export interface NameFont {
  id: string;
  name: string;
  family: string;
  weight: number;
  /** Поправка кегля: у шрифтов разная «высота» при одном размере */
  k: number;
  /** 1 — Basic, 2 — Standard, 3 — Ultra */
  tier: number;
}

export const NAME_FONTS: NameFont[] = [
  { id: 'onest', name: 'Onest', family: "'Onest', sans-serif", weight: 700, k: 1, tier: 1 },
  { id: 'comfortaa', name: 'Comfortaa', family: "'Comfortaa', sans-serif", weight: 700, k: 0.95, tier: 1 },
  { id: 'oswald', name: 'Oswald', family: "'Oswald', sans-serif", weight: 600, k: 1.05, tier: 1 },
  { id: 'exo', name: 'Exo 2', family: "'Exo 2', sans-serif", weight: 700, k: 1, tier: 1 },
  { id: 'unbounded', name: 'Unbounded', family: "'Unbounded', sans-serif", weight: 700, k: 0.88, tier: 2 },
  { id: 'russo', name: 'Russo One', family: "'Russo One', sans-serif", weight: 400, k: 0.95, tier: 2 },
  { id: 'caveat', name: 'Caveat', family: "'Caveat', cursive", weight: 700, k: 1.2, tier: 2 },
  { id: 'playfair', name: 'Playfair Display', family: "'Playfair Display', serif", weight: 700, k: 1, tier: 2 },
  { id: 'pressstart', name: 'Press Start 2P', family: "'Press Start 2P', monospace", weight: 400, k: 0.62, tier: 3 },
  { id: 'lobster', name: 'Lobster', family: "'Lobster', cursive", weight: 400, k: 1.05, tier: 3 },
  { id: 'amatic', name: 'Amatic SC', family: "'Amatic SC', cursive", weight: 700, k: 1.3, tier: 3 },
  { id: 'rubikmono', name: 'Rubik Mono One', family: "'Rubik Mono One', sans-serif", weight: 400, k: 0.74, tier: 3 },
];

export const NAME_EFFECTS: { id: string; name: string; tier: number }[] = [
  { id: 'minimal', name: 'Минимализм', tier: 1 },
  { id: 'gradient', name: 'Градиент', tier: 2 },
  { id: 'outline', name: 'Обводка', tier: 2 },
  { id: 'highlight', name: 'Выделение', tier: 2 },
  { id: 'neon', name: 'Неон', tier: 3 },
  { id: 'jelly', name: 'Мармелад', tier: 3 },
  { id: 'prism', name: 'Призма', tier: 3 },
];

export const NAME_COLORS: { hex: string; name: string }[] = [
  { hex: '#2bc6a4', name: 'Мята' },
  { hex: '#4c9bff', name: 'Синий' },
  { hex: '#b78cf7', name: 'Сирень' },
  { hex: '#ff6b9a', name: 'Розовый' },
  { hex: '#ff8a3d', name: 'Оранжевый' },
  { hex: '#f2c14e', name: 'Жёлтый' },
  { hex: '#3dd68c', name: 'Зелёный' },
  { hex: '#f0616d', name: 'Красный' },
];

export const TIER_INFO = [
  { name: '', bg: '', fg: '' },
  { name: 'Basic', bg: '#b7bdc9', fg: '#15181e' },
  { name: 'Standard', bg: '#7db8f5', fg: '#071b30' },
  { name: 'Ultra', bg: '#b78cf7', fg: '#1d1236' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Какая подписка нужна стилю: максимум из шрифта, эффекта и «своего цвета» (Standard) */
export function styleTier(s: NameStyle): number {
  const f = NAME_FONTS.find((x) => x.id === s.font)?.tier ?? 1;
  const e = NAME_EFFECTS.find((x) => x.id === s.effect)?.tier ?? 1;
  const custom = s.colors.some((c) => !NAME_COLORS.some((p) => p.hex === c.toLowerCase())) ? 2 : 1;
  return Math.max(f, e, custom);
}

/** Стиль с сервера (может быть старым форматом или мусором) → NameStyle | null */
export function parseNameStyle(v: unknown): NameStyle | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.font !== 'string' || typeof o.effect !== 'string' || !Array.isArray(o.colors)) return null;
  if (!NAME_FONTS.some((f) => f.id === o.font) || !NAME_EFFECTS.some((e) => e.id === o.effect)) return null;
  const colors = o.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 2);
  return colors.length ? { font: o.font, effect: o.effect, colors } : null;
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Светлее (amt > 0) или темнее (amt < 0) */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/** CSS ника: px — базовый кегль места (профиль 24…; 0 — относительно текущего шрифта, для чата и списков), onLight — на светлом фоне */
export function nameCss(s: NameStyle, px: number, onLight = false): CSSProperties {
  const font = NAME_FONTS.find((f) => f.id === s.font) ?? NAME_FONTS[0];
  const a = s.colors[0] ?? '#2bc6a4';
  const b = s.colors[1] ?? a;
  const base: CSSProperties = {
    fontFamily: font.family,
    fontWeight: font.weight,
    fontSize: px ? Math.round(px * font.k) : `${font.k}em`,
    color: a,
    lineHeight: 1.25,
  };
  const clip: CSSProperties = { color: 'transparent', WebkitBackgroundClip: 'text', backgroundClip: 'text' };
  switch (s.effect) {
    case 'gradient':
      return { ...base, ...clip, backgroundImage: `linear-gradient(90deg, ${a}, ${b})` };
    case 'outline':
      return { ...base, color: 'transparent', WebkitTextStroke: `${px > 18 ? 1.4 : 1}px ${a}` };
    case 'highlight':
      return { ...base, color: lum(a) > 0.4 ? '#15181e' : '#ffffff', background: a, padding: '0 6px', borderRadius: 6 };
    case 'neon':
      return { ...base, color: onLight ? shade(a, -0.25) : shade(a, 0.55), textShadow: `0 0 3px ${a}, 0 0 10px ${a}, 0 0 18px ${a}` };
    case 'jelly':
      return {
        ...base,
        ...clip,
        backgroundImage: `linear-gradient(180deg, ${shade(a, 0.55)} 0%, ${a} 55%, ${shade(a, -0.15)} 100%)`,
        filter: `drop-shadow(0 2px 0 ${shade(a, -0.45)})`,
      };
    case 'prism':
      return {
        ...base,
        ...clip,
        backgroundImage: 'linear-gradient(90deg, #ff5f6d, #ffc371, #47e891, #2bc6a4, #7db8f5, #b78cf7)',
        filter: 'drop-shadow(1px 0 0 rgba(255,79,216,.55)) drop-shadow(-1px 0 0 rgba(88,214,255,.55))',
      };
    default:
      return base;
  }
}
