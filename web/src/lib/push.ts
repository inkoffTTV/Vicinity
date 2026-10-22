// Web Push: уведомления на телефон, когда приложение закрыто (docs/API.md §14).
// Подписка живёт в браузере (pushManager) и на сервере вместе с настройками уведомлений этого
// клиента — сервер сам не будит телефон заглушёнными каналами. Включено по умолчанию, когда
// разрешены уведомления браузера; выключается в Настройки → Уведомления.
import { create } from 'zustand';
import { api } from './api';
import { useNotifySettings } from './notify';

export type PushStatus = 'unsupported' | 'off' | 'on' | 'error';

interface State {
  status: PushStatus;
  /** Пользователь выключил push на этом устройстве */
  disabled: boolean;
}

const KEY = 'vicinity.push';

function loadDisabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export const usePush = create<State>(() => ({ status: supported() ? 'off' : 'unsupported', disabled: loadDisabled() }));

export function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined' &&
    window.isSecureContext &&
    import.meta.env.PROD
  );
}

function toKey(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function prefs() {
  const s = useNotifySettings.getState();
  return { muted: s.muted, servers: s.servers };
}

let busy: Promise<void> | null = null;

/** Подписаться (или обновить настройки) — после входа, при смене настроек уведомлений и разрешения */
export function syncPush(): Promise<void> {
  if (busy) return busy;
  busy = doSync().finally(() => (busy = null));
  return busy;
}

async function doSync() {
  if (!supported()) return;
  if (usePush.getState().disabled || Notification.permission !== 'granted') return usePush.setState({ status: 'off' });
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await api.pushVapid();
      if (!key) return usePush.setState({ status: 'unsupported' });
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) as BufferSource });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys) throw new Error('bad subscription');
    await api.pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, prefs: prefs() });
    usePush.setState({ status: 'on' });
  } catch {
    usePush.setState({ status: 'error' });
  }
}

/** Снять подписку на сервере (выход из аккаунта или выключение на устройстве) */
export async function dropPush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  } catch {
    /* без service worker подписки и не было */
  }
  usePush.setState({ status: supported() ? 'off' : 'unsupported' });
}

/** Переключатель в настройках: выключить — снять подписку, включить — подписаться (спросив разрешение) */
export async function setPushEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* приватный режим */
  }
  usePush.setState({ disabled: !on });
  if (!on) return dropPush();
  if (Notification.permission === 'default') await Notification.requestPermission();
  await syncPush();
}

// Настройки уведомлений изменились — сервер должен знать, что не присылать
useNotifySettings.subscribe((s, prev) => {
  if (s.muted !== prev.muted || s.servers !== prev.servers) void syncPush();
});
