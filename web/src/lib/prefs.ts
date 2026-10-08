// Оформление этого браузера: тема, акцентный цвет, плотность ленты, размер шрифта, анимации.
// Хранится в localStorage и применяется атрибутами на <html> (CSS — в styles.css) до первой отрисовки.
import { create } from 'zustand';

export type Theme = 'system' | 'light' | 'dark';
export type FontSize = 's' | 'm' | 'l';

interface Appearance {
  theme: Theme;
  /** Акцентный цвет интерфейса (#rrggbb); пустая строка — стандартный */
  accent: string;
  /** Компактная лента: меньше отступы и аватары */
  compact: boolean;
  fontSize: FontSize;
  /** Убрать анимации независимо от настройки системы */
  reducedMotion: boolean;
}

interface State extends Appearance {
  set: (patch: Partial<Appearance>) => void;
  reset: () => void;
}

export const DEFAULT_ACCENT = '#5865f2';
export const ACCENTS = ['#5865f2', '#3ba55c', '#eb459e', '#ed4245', '#9b59b6', '#1abc9c', '#e67e22', '#0f7bbf'];

const KEY = 'vicinity.appearance';
const DEFAULTS: Appearance = { theme: 'system', accent: '', compact: false, fontSize: 'm', reducedMotion: false };
const HEX = /^#[0-9a-f]{6}$/i;

function load(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      accent: typeof raw.accent === 'string' && HEX.test(raw.accent) ? raw.accent.toLowerCase() : '',
      compact: raw.compact === true,
      fontSize: raw.fontSize === 's' || raw.fontSize === 'l' ? raw.fontSize : 'm',
      reducedMotion: raw.reducedMotion === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(a: Appearance) {
  try {
    const { theme, accent, compact, fontSize, reducedMotion } = a;
    localStorage.setItem(KEY, JSON.stringify({ theme, accent, compact, fontSize, reducedMotion }));
  } catch {
    /* приватный режим — оформление живёт до перезагрузки */
  }
}

// Цвет при наведении — тот же оттенок, темнее на 20%
function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * 0.8);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Тёмная ли тема сейчас на экране (с учётом «как в системе») */
const isDark = (a: Appearance) => (a.theme === 'system' ? systemDark() : a.theme === 'dark');

/** Атрибуты и переменные на <html> — по ним CSS выбирает тему, акцент, плотность и шрифт */
function apply(a: Appearance) {
  const root = document.documentElement;
  if (a.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a.theme);
  // Через CSSOM, а не атрибут style: так разрешает CSP (style-src 'self')
  if (a.accent) {
    root.style.setProperty('--accent', a.accent);
    root.style.setProperty('--accent-hover', darken(a.accent));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
  }
  root.toggleAttribute('data-compact', a.compact);
  root.setAttribute('data-font', a.fontSize);
  root.toggleAttribute('data-reduced-motion', a.reducedMotion);
  // Цвет строки состояния мобильного браузера и окна установленного приложения
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark(a) ? '#1e1f22' : '#e3e5e8');
}

export const useAppearance = create<State>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    save(get());
    apply(get());
  },
  reset: () => {
    set(DEFAULTS);
    save(get());
    apply(get());
  },
}));

apply(useAppearance.getState());
// «Как в системе»: система сменила тему — обновить цвет строки состояния
if (typeof matchMedia === 'function')
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(useAppearance.getState()));

/** Анимации выключены — в настройках Vicinity или в системе */
export function prefersReducedMotion(): boolean {
  return (
    useAppearance.getState().reducedMotion ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}
