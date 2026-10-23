// Синхронизация оформления между устройствами: GET/PATCH /settings/appearance (docs/API.md §0.6).
// Сервер сам проверяет подписку для цветовых тем (Standard) и своей темы (Ultra): 403 — тема не сохраняется.
import { create } from 'zustand';
import { ApiError, AppearanceSettings, api } from './api';
import { appIconById, DEFAULT_APP_ICON } from './appIcon';
import { Appearance, pick, sanitize, useAppearance } from './prefs';

const iconAllowed = (id: string, tier: number) => appIconById(id).tier <= tier;

/** Что из премиум-оформления доступно этому аккаунту */
export const useThemeAccess = create<{ colorThemes: boolean; customTheme: boolean; tier: number; loaded: boolean }>(
  () => ({ colorThemes: false, customTheme: false, tier: 0, loaded: false }),
);

export function toServer(a: Appearance): AppearanceSettings {
  return {
    follow_system: a.followSystem,
    base_theme: a.baseTheme,
    color_theme: a.colorTheme,
    custom_theme: a.customTheme,
    sync_devices: a.syncDevices,
    apply_to_profiles: a.applyToProfiles,
    server_theme: a.serverTheme,
    accent: a.accent,
    font_size: a.fontSize,
    button_style: a.buttonStyle,
    compact: a.compact,
    reduce_motion: a.reducedMotion,
    saturation: a.saturation,
    high_contrast: a.highContrast,
    app_icon: a.appIcon,
  };
}

function fromServer(s: AppearanceSettings): Appearance {
  return sanitize({
    followSystem: s.follow_system,
    baseTheme: s.base_theme,
    colorTheme: s.color_theme,
    customTheme: s.custom_theme,
    syncDevices: s.sync_devices,
    applyToProfiles: s.apply_to_profiles,
    serverTheme: s.server_theme,
    accent: s.accent,
    fontSize: s.font_size,
    buttonStyle: s.button_style,
    compact: s.compact,
    reducedMotion: s.reduce_motion,
    saturation: s.saturation,
    highContrast: s.high_contrast,
    appIcon: s.app_icon,
  });
}

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent = '';
let onError: ((msg: string) => void) | null = null;

/** Отправить настройки сейчас (или с задержкой — несколько щелчков подряд уходят одним запросом) */
async function push(a: Appearance) {
  const body = toServer(a);
  const json = JSON.stringify(body);
  if (json === lastSent) return;
  try {
    const r = await api.saveAppearance(body);
    lastSent = json;
    useThemeAccess.setState({ ...accessOf(r.access), loaded: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      // Подписки на тему нет (её сняли или запрос подменён) — убираем тему у себя
      const icon = useAppearance.getState().appIcon;
      useAppearance.getState().set({ colorTheme: null, customTheme: null, appIcon: iconAllowed(icon, useThemeAccess.getState().tier) ? icon : DEFAULT_APP_ICON });
      onError?.(e.message);
    }
  }
}

const accessOf = (a: { color_themes: boolean; custom_theme: boolean; tier: number }) => ({
  colorThemes: a.color_themes,
  customTheme: a.custom_theme,
  tier: a.tier,
});

/** После входа: взять тему с сервера (если синхронизация включена) и отправлять изменения */
export async function startAppearanceSync(toastError: (msg: string) => void) {
  stopAppearanceSync();
  onError = toastError;
  try {
    const r = await api.appearance();
    useThemeAccess.setState({ ...accessOf(r.access), loaded: true });
    const local = useAppearance.getState();
    if (!r.stored) {
      // Первый вход с этой версией: на сервере ещё ничего — сохраняем то, что настроено здесь
      // (кроме тем, на которые нет подписки)
      if (!r.access.color_themes && local.colorTheme) local.set({ colorTheme: null });
      if (!r.access.custom_theme && local.customTheme) local.set({ customTheme: null });
      if (!iconAllowed(local.appIcon, r.access.tier)) local.set({ appIcon: DEFAULT_APP_ICON });
      if (local.syncDevices) void push(pick(useAppearance.getState()));
    } else if (r.settings.sync_devices) {
      const server = fromServer(r.settings);
      lastSent = JSON.stringify(toServer(server));
      useAppearance.getState().replace(server);
    } else if ((!r.access.color_themes && local.colorTheme) || (!r.access.custom_theme && local.customTheme) || !iconAllowed(local.appIcon, r.access.tier)) {
      local.set({
        colorTheme: r.access.color_themes ? local.colorTheme : null,
        customTheme: r.access.custom_theme ? local.customTheme : null,
        appIcon: iconAllowed(local.appIcon, r.access.tier) ? local.appIcon : DEFAULT_APP_ICON,
      });
    }
  } catch {
    /* старый сервер без /settings/appearance — оформление только в этом браузере */
    return;
  }
  let prev = JSON.stringify(pick(useAppearance.getState()));
  unsubscribe = useAppearance.subscribe((s) => {
    const now = JSON.stringify(pick(s));
    if (now === prev) return;   // предпросмотр и переходы между экранами не сохраняются
    const wasSync = JSON.parse(prev).syncDevices;
    prev = now;
    // Выключили синхронизацию — сообщаем серверу один раз (дальше устройство живёт своей темой)
    if (!s.syncDevices && !wasSync) return;
    clearTimeout(timer);
    timer = setTimeout(() => void push(pick(s)), 500);
  });
}

export function stopAppearanceSync() {
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(timer);
  lastSent = '';
  useThemeAccess.setState({ colorThemes: false, customTheme: false, tier: 0, loaded: false });
}
