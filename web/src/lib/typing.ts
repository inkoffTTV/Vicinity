// «X печатает…» (docs/API.md §3): кто сейчас набирает текст в каналах и отправка своего набора.
import { create } from 'zustand';
import { useStore } from './store';
import { socket, WsEvent } from './ws';

export interface Typist {
  id: number;
  name: string;
  until: number;
}

interface State {
  byChannel: Record<number, Typist[]>;
}

// Индикатор живёт 6 с после последнего сигнала или до сообщения от этого человека
const SHOW_FOR = 6000;
// Свой набор сообщаем не чаще раза в 3 с на канал (сервер всё чаще 2 с отбрасывает)
const SEND_EVERY = 3000;

export const useTyping = create<State>(() => ({ byChannel: {} }));

let sweepTimer: number | undefined;
// Когда последний раз сообщали о своём наборе, по каналам
const lastSent = new Map<number, number>();

function update(channelId: number, fn: (list: Typist[]) => Typist[]) {
  const { byChannel } = useTyping.getState();
  const next = fn(byChannel[channelId] ?? []);
  const rest = { ...byChannel };
  if (next.length) rest[channelId] = next;
  else delete rest[channelId];
  useTyping.setState({ byChannel: rest });
  schedule();
}

// Ближайшее истечение — снять просроченных
function schedule() {
  window.clearTimeout(sweepTimer);
  const all = Object.values(useTyping.getState().byChannel).flat();
  if (!all.length) return;
  const next = Math.min(...all.map((t) => t.until));
  sweepTimer = window.setTimeout(
    () => {
      const now = Date.now();
      const byChannel: Record<number, Typist[]> = {};
      for (const [ch, list] of Object.entries(useTyping.getState().byChannel)) {
        const alive = list.filter((t) => t.until > now);
        if (alive.length) byChannel[Number(ch)] = alive;
      }
      useTyping.setState({ byChannel });
      schedule();
    },
    Math.max(0, next - Date.now()) + 20,
  );
}

socket.on((ev: WsEvent) => {
  if (ev.type === 'typing') {
    const me = useStore.getState().me?.user_id;
    if (typeof ev.channel_id !== 'number' || typeof ev.user_id !== 'number' || ev.user_id === me) return;
    const name = typeof ev.name === 'string' && ev.name ? ev.name : 'Кто-то';
    update(ev.channel_id, (list) => [
      ...list.filter((t) => t.id !== ev.user_id),
      { id: ev.user_id, name, until: Date.now() + SHOW_FOR },
    ]);
  } else if (ev.type === 'new_message') {
    const list = useTyping.getState().byChannel[ev.channel_id];
    if (list?.some((t) => t.id === ev.author_id)) update(ev.channel_id, (l) => l.filter((t) => t.id !== ev.author_id));
  }
});

// Связь пропала или сменился пользователь — прежние индикаторы недостоверны
socket.onStatus((connected) => {
  if (!connected) useTyping.setState({ byChannel: {} });
});
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) {
    useTyping.setState({ byChannel: {} });
    lastSent.clear();
  }
});

/** Пользователь набирает текст в канале — сообщить остальным (с прореживанием) */
export function sendTyping(channelId: number) {
  const now = Date.now();
  if (now - (lastSent.get(channelId) ?? 0) < SEND_EVERY) return;
  lastSent.set(channelId, now);
  socket.send({ type: 'typing', channel_id: channelId });
}

/** Сообщение отправлено — следующий набор сообщаем сразу */
export function resetTyping(channelId: number) {
  lastSent.delete(channelId);
}

/** «Алиса печатает…», «Алиса и Боб печатают…», «Несколько человек печатают…» */
export function typingText(list: Typist[]): string {
  if (list.length === 0) return '';
  if (list.length === 1) return `${list[0].name} печатает…`;
  if (list.length === 2) return `${list[0].name} и ${list[1].name} печатают…`;
  return 'Несколько человек печатают…';
}
