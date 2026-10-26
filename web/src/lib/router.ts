// Адресная строка ↔ открытый экран (lib/routes.ts): переходы попадают в историю браузера,
// «назад/вперёд» открывают прежний экран, /invite/<код> предлагает вступить на сервер.
import { create } from 'zustand';
import { api, ApiError } from './api';
import { parsePath, pathFor, viewForRoute } from './routes';
import { useStore } from './store';

interface InviteState {
  /** Код из ссылки-приглашения, по которому ещё не решили — вступать или нет */
  code: string | null;
  dismiss: () => void;
}

const initial = parsePath(location.pathname);

export const useInvite = create<InviteState>((set) => ({
  code: initial?.kind === 'invite' ? initial.code : null,
  dismiss: () => set({ code: null }),
}));

/** Подарочный код из ссылки /gift/<код> (components/GiftCard.tsx) */
export const useGift = create<InviteState>((set) => ({
  code: initial?.kind === 'gift' ? initial.code : null,
  dismiss: () => set({ code: null }),
}));

// Первый экран после входа и переход по «назад/вперёд» заменяют запись истории, остальные — добавляют
let replaceNext = true;

useStore.subscribe((s, prev) => {
  if (!s.me) {
    // Выход из аккаунта: адрес прежнего пользователя ни к чему
    if (prev.me) {
      replaceNext = true;
      if (location.pathname !== '/') history.replaceState(null, '', '/');
    }
    return;
  }
  if (s.view === prev.view) return;
  const path = pathFor(s.view);
  const replace = replaceNext;
  replaceNext = false;
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
});

window.addEventListener('popstate', () => {
  const s = useStore.getState();
  if (!s.me) return;
  const route = parsePath(location.pathname);
  if (route?.kind === 'invite') {
    useInvite.setState({ code: route.code });
    return;
  }
  if (route?.kind === 'gift') {
    useGift.setState({ code: route.code });
    return;
  }
  replaceNext = true;
  s.open((route && viewForRoute(s, route)) ?? { kind: 'friends' });
});

/**
 * Открыть адрес приложения (/invite/…, /gift/…, /u/…, /users/…, /channels/…) внутри уже открытого
 * клиента, без перезагрузки и без нового окна. false — это не адрес экрана приложения.
 * Так работают ссылки из сообщений, а ещё приложения для Windows и Android, когда их открывают
 * по ссылке снаружи (событие vicinity-open, ниже).
 */
export function openAppUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, location.origin);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  const route = parsePath(url.pathname);
  if (!route) return false;
  const s = useStore.getState();
  if (!s.me) {
    // Ещё не вошли: экран откроется после входа (store читает адрес при загрузке)
    history.pushState(null, '', url.pathname);
    return true;
  }
  if (route.kind === 'invite') {
    history.pushState(null, '', url.pathname);
    useInvite.setState({ code: route.code });
    return true;
  }
  if (route.kind === 'gift') {
    history.pushState(null, '', url.pathname);
    useGift.setState({ code: route.code });
    return true;
  }
  if (route.kind === 'user') {
    s.showProfile(route.userId);
    return true;
  }
  if (route.kind === 'profileLink') {
    api.userByLink(route.code).then(
      (id) => useStore.getState().showProfile(id, route.code),
      (err) => useStore.getState().toast(err instanceof ApiError ? err.message : 'Не удалось открыть профиль', 'error'),
    );
    return true;
  }
  const v = viewForRoute(s, route);
  if (v) s.open(v);
  else s.toast(route.kind === 'server' ? 'Вы не участник этого сервера' : 'Этот чат вам недоступен', 'error');
  return true;
}

// Ссылки на свой же сайт в сообщениях открываются здесь же, а не в новой вкладке или внешнем браузере
// (в приложениях для Windows и Android новая вкладка — это внешний браузер)
document.addEventListener(
  'click',
  (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    if (openAppUrl(a.href)) e.preventDefault();
  },
  true,
);

// Приложение открыли по ссылке снаружи (vicinity://… или https-ссылка на сайт) — desktop/src/main.js,
// android MainActivity: detail — адрес или путь
window.addEventListener('vicinity-open', (e) => {
  const href = (e as CustomEvent<unknown>).detail;
  if (typeof href === 'string') openAppUrl(href);
});
