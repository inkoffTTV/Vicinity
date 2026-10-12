// Оформление: тема (базовая, цветовая, своя), акцент, плотность, шрифт, анимации и специальные возможности.
// Хранится в localStorage и применяется атрибутами/переменными на <html> (CSS — styles.css, theme.css)
// до первой отрисовки. С «Синхронизировать тему на моих устройствах» ещё и на сервере (lib/appearanceSync.ts).
import { create } from 'zustand';
import { BaseTheme, ColorTheme, CustomTheme, gradientCss, themeById } from './themes';

export type FontSize = 's' | 'm' | 'l';
export type ServerTheme = 'mine' | 'default';

export interface Appearance {
  /** «Как тема устройства»: светлая или тёмная по системе */
  followSystem: boolean;
  baseTheme: BaseTheme;
  /** Готовая цветовая тема (подписка Standard+) */
  colorTheme: string | null;
  /** Своя тема (подписка Ultra) */
  customTheme: CustomTheme | null;
  syncDevices: boolean;
  /** Профили других людей — в моей теме, а не в их цветах */
  applyToProfiles: boolean;
  /** На серверах: моя тема или стандартная тёмная без цветовой темы */
  serverTheme: ServerTheme;
  /** Акцентный цвет интерфейса (#rrggbb); пустая строка — стандартный */
  accent: string;
  /** Компактная лента: меньше отступы и аватары */
  compact: boolean;
  fontSize: FontSize;
  /** Убрать анимации независимо от настройки системы */
  reducedMotion: boolean;
  /** Насыщенность цветов, % */
  saturation: number;
  highContrast: boolean;
}

/** Временный предпросмотр темы (клик по цветовой теме без подписки) — не сохраняется */
export interface Preview {
  colorTheme: string | null;
  customTheme: CustomTheme | null;
}

interface State extends Appearance {
  preview: Preview | null;
  /** Открыт канал сервера — для «Тема по умолчанию на серверах» */
  inServer: boolean;
  set: (patch: Partial<Appearance>) => void;
  /** Применить настройки с сервера, не отправляя их обратно */
  replace: (a: Appearance) => void;
  setPreview: (p: Preview | null) => void;
  setInServer: (v: boolean) => void;
  reset: () => void;
}

export const DEFAULT_ACCENT = '#2bc6a4';
export const ACCENTS = ['#2bc6a4', '#5865f2', '#3ba55c', '#eb459e', '#ed4245', '#9b59b6', '#e67e22', '#0f7bbf'];

const KEY = 'vicinity.appearance';
export const DEFAULTS: Appearance = {
  followSystem: false,
  baseTheme: 'dark',
  colorTheme: null,
  customTheme: null,
  syncDevices: true,
  applyToProfiles: false,
  serverTheme: 'mine',
  accent: '',
  compact: false,
  fontSize: 'm',
  reducedMotion: false,
  saturation: 100,
  highContrast: false,
};
const HEX = /^#[0-9a-f]{6}$/i;
const BASES: BaseTheme[] = ['light', 'dark', 'graphite', 'black'];

/** Проверка значений (из localStorage или с сервера); неизвестное — по умолчанию */
export function sanitize(raw: any): Appearance {
  const r = raw && typeof raw === 'object' ? raw : {};
  // Старый формат: theme = system | light | dark
  const legacy = r.theme === 'system' ? { followSystem: true } : r.theme === 'light' || r.theme === 'dark' ? { baseTheme: r.theme } : {};
  const src = { ...legacy, ...r };
  const custom = src.customTheme;
  const customOk =
    custom &&
    Array.isArray(custom.colors) &&
    custom.colors.length >= 2 &&
    custom.colors.length <= 3 &&
    custom.colors.every((c: unknown) => typeof c === 'string' && HEX.test(c));
  return {
    followSystem: src.followSystem === true,
    baseTheme: BASES.includes(src.baseTheme) ? src.baseTheme : DEFAULTS.baseTheme,
    colorTheme: themeById(src.colorTheme) ? src.colorTheme : null,
    customTheme: customOk
      ? {
          colors: custom.colors.map((c: string) => c.toLowerCase()),
          angle: Number.isFinite(custom.angle) ? Math.max(0, Math.min(360, custom.angle)) : 135,
          base: custom.base === 'light' ? 'light' : 'dark',
        }
      : null,
    syncDevices: src.syncDevices !== false,
    applyToProfiles: src.applyToProfiles === true,
    serverTheme: src.serverTheme === 'default' ? 'default' : 'mine',
    accent: typeof src.accent === 'string' && HEX.test(src.accent) ? src.accent.toLowerCase() : '',
    compact: src.compact === true,
    fontSize: src.fontSize === 's' || src.fontSize === 'l' ? src.fontSize : 'm',
    reducedMotion: src.reducedMotion === true,
    saturation: Number.isFinite(src.saturation) ? Math.max(0, Math.min(100, Math.round(src.saturation))) : 100,
    highContrast: src.highContrast === true,
  };
}

function load(): Appearance {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function pick(s: Appearance): Appearance {
  const out = {} as Record<keyof Appearance, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Appearance)[]) out[k] = s[k];
  return out as unknown as Appearance;
}

function save(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pick(a)));
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

/** Текст на акцентном фоне: тёмный на светлом акценте, белый на тёмном (контраст WCAG) */
function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // контраст с белым (1.05/(l+0.05)) против контраста с почти чёрным
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? '#ffffff' : '#06231c';
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Активная градиентная тема с учётом предпросмотра и «Тема по умолчанию на серверах» */
function activeGradient(s: State): { gradient: ColorTheme | CustomTheme; base: 'light' | 'dark' } | null {
  if (s.inServer && s.serverTheme === 'default' && !s.preview) return null;
  const src = s.preview ?? s;
  const t = themeById(src.colorTheme) ?? src.customTheme;
  return t ? { gradient: t, base: t.base } : null;
}

/** Какая основа сейчас на экране */
export function resolvedBase(s: State): BaseTheme {
  const g = activeGradient(s);
  if (g) return g.base;
  if (s.inServer && s.serverTheme === 'default' && !s.preview) return 'dark';
  return s.followSystem ? (systemDark() ? 'dark' : 'light') : s.baseTheme;
}

/** Атрибуты и переменные на <html> — по ним CSS выбирает тему, акцент, плотность и шрифт */
function apply(s: State) {
  const root = document.documentElement;
  const base = resolvedBase(s);
  root.setAttribute('data-theme', base);
  // Через CSSOM, а не атрибут style: так разрешает CSP (style-src 'self')
  const g = activeGradient(s);
  if (g) {
    root.setAttribute('data-gradient', '');
    root.style.setProperty('--theme-gradient', gradientCss(g.gradient));
    root.style.setProperty('--theme-tint', g.gradient.colors[0]);
  } else {
    root.removeAttribute('data-gradient');
    root.style.removeProperty('--theme-gradient');
    root.style.removeProperty('--theme-tint');
  }
  if (s.accent) {
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--accent-hover', darken(s.accent));
    root.style.setProperty('--on-accent', onAccent(s.accent));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--on-accent');
  }
  root.toggleAttribute('data-compact', s.compact);
  root.setAttribute('data-font', s.fontSize);
  root.toggleAttribute('data-reduced-motion', s.reducedMotion);
  root.toggleAttribute('data-contrast', s.highContrast);
  if (s.saturation < 100) {
    root.setAttribute('data-saturation', '');
    root.style.setProperty('--saturation', String(s.saturation / 100));
  } else {
    root.removeAttribute('data-saturation');
    root.style.removeProperty('--saturation');
  }
  // Цвет строки состояния мобильного браузера и окна установленного приложения
  const bar = { light: '#e9ecf1', dark: '#0e1015', graphite: '#1a1b1f', black: '#000000' }[base];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
}

export const useAppearance = create<State>((set, get) => ({
  ...load(),
  preview: null,
  inServer: false,
  set: (patch) => {
    set(patch);
    save(get());
    apply(get());
  },
  replace: (a) => {
    set(sanitize(a));
    save(get());
    apply(get());
  },
  setPreview: (p) => {
    set({ preview: p });
    apply(get());
  },
  setInServer: (v) => {
    if (get().inServer === v) return;
    set({ inServer: v });
    apply(get());
  },
  reset: () => {
    set({ ...DEFAULTS, preview: null });
    save(get());
    apply(get());
  },
}));

apply(useAppearance.getState());
// «Как тема устройства»: система сменила тему
if (typeof matchMedia === 'function')
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(useAppearance.getState()));

/** Анимации выключены — в настройках Vicinity или в системе */
export function prefersReducedMotion(): boolean {
  return (
    useAppearance.getState().reducedMotion ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}
