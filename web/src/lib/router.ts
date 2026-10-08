// Адресная строка ↔ открытый экран (lib/routes.ts): переходы попадают в историю браузера,
// «назад/вперёд» открывают прежний экран, /invite/<код> предлагает вступить на сервер.
import { create } from 'zustand';
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
  replaceNext = true;
  s.open((route && viewForRoute(s, route)) ?? { kind: 'friends' });
});
