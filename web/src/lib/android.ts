// Приложение для Android (android/): окно WebView с этим же веб-клиентом. Мост — window.VicinityAndroid
// из android/app/src/main/java/app/vicinity/android/MainActivity.java.
//
// Во WebView нет браузерного Notification — подставляем свой на системных уведомлениях, чтобы
// lib/notify.ts и настройки работали как в браузере. Пока идёт звонок или вы в голосовом канале,
// приложение держит уведомление «Идёт звонок» — так Android не отключает микрофон в свёрнутом виде.
import { useCall } from './call';
import { useVoice } from './voice';

interface AndroidBridge {
  version(): string;
  notificationPermission(): NotificationPermission;
  requestNotificationPermission(): void;
  notify(title: string, body: string, tag: string): void;
  closeNotification(tag: string): void;
  setInCall(active: boolean): void;
  retry(): void;
}

export const android: AndroidBridge | undefined = (window as unknown as { VicinityAndroid?: AndroidBridge }).VicinityAndroid;

/** APK на этом же сервере (deploy/downloads → /download/), туда его кладёт deploy/update.sh */
export const ANDROID_APK = '/download/Vicinity.apk';

const ua = navigator.userAgent;
/** iPhone/iPad (iPadOS представляется как Mac, но с сенсорным экраном) */
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
/** Открыто с экрана «Домой» как приложение */
export const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Предлагать скачать APK: Android в браузере, а не внутри самого приложения */
export const offerAndroidApp = !android && /Android/i.test(ua);
/** Предлагать добавить на экран «Домой»: iPhone/iPad в браузере */
export const offerIosInstall = isIOS && !isStandalone;

if (android) installBridge(android);

function installBridge(bridge: AndroidBridge) {
  const open = new Map<string, AndroidNotification>();
  let pending: ((p: NotificationPermission) => void)[] = [];
  let seq = 0;

  class AndroidNotification extends EventTarget {
    static get permission(): NotificationPermission {
      return bridge.notificationPermission();
    }

    static requestPermission(cb?: (p: NotificationPermission) => void): Promise<NotificationPermission> {
      return new Promise((resolve) => {
        pending.push((p) => {
          cb?.(p);
          resolve(p);
        });
        bridge.requestNotificationPermission();
      });
    }

    readonly title: string;
    readonly body: string;
    readonly tag: string;
    onclick: ((this: AndroidNotification, ev: Event) => unknown) | null = null;
    onclose: ((this: AndroidNotification, ev: Event) => unknown) | null = null;
    onshow = null;
    onerror = null;

    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = title;
      this.body = options.body ?? '';
      this.tag = options.tag || `n${++seq}`;
      open.set(this.tag, this);
      bridge.notify(this.title, this.body, this.tag);
    }

    close() {
      if (open.get(this.tag) === this) open.delete(this.tag);
      bridge.closeNotification(this.tag);
    }
  }

  (window as unknown as { __vicinityNotifyPermission: (p: NotificationPermission) => void }).__vicinityNotifyPermission = (p) => {
    const waiting = pending;
    pending = [];
    waiting.forEach((f) => f(p));
  };

  // Нажали на уведомление — приложение уже на экране; открываем нужный канал
  window.addEventListener('vicinity-notification-click', (e) => {
    const n = open.get((e as CustomEvent<string>).detail);
    if (!n) return;
    open.delete(n.tag);
    const ev = new Event('click');
    n.onclick?.call(n, ev);
    n.dispatchEvent(ev);
  });

  Object.defineProperty(window, 'Notification', { value: AndroidNotification, configurable: true, writable: true });

  // Звонок 1:1 или голосовой канал — держать приложение «живым» в свёрнутом виде
  let inCall = false;
  const sync = () => {
    const active = useCall.getState().phase !== 'idle' || useVoice.getState().channelId !== null;
    if (active === inCall) return;
    inCall = active;
    bridge.setInCall(active);
  };
  useCall.subscribe(sync);
  useVoice.subscribe(sync);
}
