// Параметр запуска бота из ссылки /bots/<username>?start=<payload> (docs/API.md §21.9): кнопка «Начать» в личке
// отправит «/start <payload>», как в Telegram. Живёт до отправки или перезагрузки.
import { create } from 'zustand';

/** payload — [A-Za-z0-9_-]{1,64}, иначе без него */
export function startPayload(search: string): string | null {
  const p = new URLSearchParams(search).get('start');
  return p && /^[A-Za-z0-9_-]{1,64}$/.test(p) ? p : null;
}

interface State {
  /** @имя бота (нижний регистр) → payload */
  payloads: Record<string, string>;
  remember: (username: string, payload: string | null) => void;
  /** Текст первого сообщения боту: «/start» или «/start <payload>»; payload забывается */
  take: (username: string) => string;
}

export const useBotStart = create<State>((set, get) => ({
  payloads: {},
  remember: (username, payload) => {
    if (!payload) return;
    set({ payloads: { ...get().payloads, [username.toLowerCase()]: payload } });
  },
  take: (username) => {
    const key = username.toLowerCase();
    const p = get().payloads[key];
    if (p) {
      const { [key]: _, ...rest } = get().payloads;
      set({ payloads: rest });
    }
    return p ? `/start ${p}` : '/start';
  },
}));
