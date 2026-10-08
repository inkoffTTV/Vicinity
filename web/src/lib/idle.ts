// Автостатус «Не активен»: 10 минут без действий во всех вкладках (свёрнутая вкладка действий не даёт) —
// статус «В сети» меняется на «Не активен», при возвращении — обратно. Выбранные вручную
// «Не беспокоить», «Невидимый» и «Не активен» не трогаются никогда.
// Вкладки одного браузера делятся через localStorage временем последнего действия и своим статусом
// (сервер не присылает пользователю его же изменения статуса).
import { Presence } from './api';
import { useStore } from './store';

const IDLE_AFTER = 10 * 60_000;
const CHECK_EVERY = 30_000;
// Отметка о действиях пишется не чаще этого — её читают другие вкладки
const SHARE_EVERY = 15_000;
const ACTIVE_KEY = 'vicinity.activeAt';
const PRESENCE_KEY = 'vicinity.presence';

let lastActive = Date.now();
let lastShared = 0;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — каждая вкладка сама по себе */
  }
};

function activity() {
  if (document.hidden) return;
  const now = Date.now();
  lastActive = now;
  if (now - lastShared > SHARE_EVERY) {
    lastShared = now;
    write(ACTIVE_KEY, String(now));
  }
  const s = useStore.getState();
  // Вернулись — снять только автоматический «Не активен»
  if (s.me?.presence === 'idle' && s.presenceAuto && s.connected) s.setPresence('online');
}

function check() {
  const s = useStore.getState();
  if (!s.me || !s.connected || s.me.presence !== 'online') return;
  const shared = Number(read(ACTIVE_KEY)) || 0;
  if (Date.now() - Math.max(lastActive, shared) >= IDLE_AFTER) s.setPresence('idle', true);
}

for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'])
  window.addEventListener(type, activity, { passive: true, capture: true });
document.addEventListener('visibilitychange', activity);
window.setInterval(check, CHECK_EVERY);

function stored(): { user?: number; presence?: Presence; auto?: boolean } | null {
  try {
    return JSON.parse(read(PRESENCE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

useStore.subscribe((s, prev) => {
  if (!s.me) return;
  // Вход (в том числе перезагрузка): сервер помнит «Не активен», поставленный автоматически
  // в прошлый раз, — его тоже снимет первое действие пользователя
  if (!prev.me || prev.me.user_id !== s.me.user_id) {
    const last = stored();
    if (s.me.presence === 'idle' && last?.user === s.me.user_id && last.presence === 'idle' && last.auto)
      useStore.setState({ presenceAuto: true });
    return;
  }
  // Свой статус — другим вкладкам
  if (s.me.presence !== prev.me.presence || s.presenceAuto !== prev.presenceAuto)
    write(PRESENCE_KEY, JSON.stringify({ user: s.me.user_id, presence: s.me.presence, auto: s.presenceAuto }));
});

// Статус, сменённый в другой вкладке, — показать и здесь (на сервер его уже отправили там)
window.addEventListener('storage', (e) => {
  if (e.key !== PRESENCE_KEY || !e.newValue) return;
  const s = useStore.getState();
  const v = stored();
  if (!s.me || !v || v.user !== s.me.user_id || !v.presence) return;
  useStore.setState({
    me: { ...s.me, presence: v.presence },
    presence: { ...s.presence, [s.me.user_id]: v.presence },
    presenceAuto: v.auto === true,
  });
});
