// Установка как приложения: service worker (только в собранной версии и в защищённом контексте —
// https или localhost), предложение обновиться до новой версии и счётчик на значке приложения.
import { create } from 'zustand';

interface PwaState {
  /** Новая версия скачана и ждёт — показать «Доступна новая версия — обновить» */
  updateReady: boolean;
}

export const usePwa = create<PwaState>(() => ({ updateReady: false }));

let waiting: ServiceWorker | null = null;
// Перезагружаемся при смене service worker, только если обновление попросил пользователь
let reloadOnChange = false;

const UPDATE_CHECK_EVERY = 60 * 60_000;

function offer(sw: ServiceWorker) {
  waiting = sw;
  usePwa.setState({ updateReady: true });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => {
    if (reloadOnChange) location.reload();
  });
  const register = () =>
    sw.register('/sw.js').then(
      (reg) => {
        // Есть активная версия и уже скачанная новая — предложить сразу; первая установка тихая
        if (reg.waiting && sw.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && sw.controller) offer(next);
          });
        });
        // Вкладка открыта днями — проверять новую версию раз в час и при возвращении на неё
        window.setInterval(() => void reg.update().catch(() => {}), UPDATE_CHECK_EVERY);
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void reg.update().catch(() => {});
        });
      },
      () => {
        /* без service worker приложение работает как обычный сайт */
      },
    );
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

/** Перейти на новую версию: она активируется, вкладка перезагрузится */
export function applyUpdate() {
  if (!waiting) return;
  reloadOnChange = true;
  waiting.postMessage({ type: 'skip-waiting' });
}

/** Число на значке установленного приложения (где браузер это умеет) */
export function setAppBadge(count: number) {
  if (!('setAppBadge' in navigator)) return;
  const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  void done.catch(() => {
    /* значок недоступен (не установлено как приложение, нет разрешения) */
  });
}
