// Закреплённые сообщения каналов (docs/API.md §6): список, закрепить/открепить, живое обновление.
import { create } from 'zustand';
import { api, ApiError, PinnedMessage } from './api';
import { useStore } from './store';
import { socket, WsEvent } from './ws';

interface State {
  /** undefined — ещё не загружены (или сервер их не поддерживает) */
  byChannel: Record<number, PinnedMessage[] | undefined>;
  load: (channelId: number) => Promise<void>;
  pin: (channelId: number, messageId: number) => Promise<void>;
  unpin: (channelId: number, messageId: number) => Promise<void>;
}

const toastError = (e: unknown) =>
  useStore.getState().toast(e instanceof ApiError ? e.message : 'Что-то пошло не так', 'error');

export const usePins = create<State>((set, get) => ({
  byChannel: {},
  load: async (channelId) => {
    const owner = useStore.getState().me?.user_id;
    try {
      const pins = await api.pins(channelId);
      if (useStore.getState().me?.user_id === owner) set({ byChannel: { ...get().byChannel, [channelId]: pins } });
    } catch {
      /* старый сервер без закрепов или канал уже недоступен — кнопки закрепа просто не будет */
    }
  },
  // Список обновит pins_updated; ответ запроса подтверждает действие сразу, не дожидаясь события
  pin: async (channelId, messageId) => {
    try {
      await api.pin(channelId, messageId);
      await get().load(channelId);
    } catch (e) {
      toastError(e);
    }
  },
  unpin: async (channelId, messageId) => {
    try {
      await api.unpin(channelId, messageId);
      const list = get().byChannel[channelId];
      if (list) set({ byChannel: { ...get().byChannel, [channelId]: list.filter((p) => p.id !== messageId) } });
    } catch (e) {
      toastError(e);
    }
  },
}));

socket.on((ev: WsEvent) => {
  const { byChannel, load } = usePins.getState();
  if (ev.type === 'pins_updated' && byChannel[ev.channel_id]) void load(ev.channel_id);
  // Удалённое сообщение сервер открепляет сам; правка меняет текст закрепа
  if (ev.type === 'message_edited' && byChannel[ev.channel_id]?.some((p) => p.id === ev.id))
    usePins.setState({
      byChannel: {
        ...byChannel,
        [ev.channel_id]: byChannel[ev.channel_id]!.map((p) => (p.id === ev.id ? { ...p, text: ev.text, edited: true } : p)),
      },
    });
});

// Связь вернулась — закрепы могли поменяться, пока её не было
socket.onStatus((connected) => {
  if (!connected) return;
  const { byChannel, load } = usePins.getState();
  Object.keys(byChannel).forEach((ch) => void load(Number(ch)));
});

useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) usePins.setState({ byChannel: {} });
});

/** Может ли пользователь закреплять в канале: в личках и беседах — любой, на сервере — владелец */
export function canManagePins(channelId: number): boolean {
  const s = useStore.getState();
  const v = s.view;
  if (v.kind === 'dm' || v.kind === 'group') return v.channelId === channelId;
  if (v.kind === 'server' && v.channelId === channelId)
    return s.servers.find((x) => x.id === v.serverId)?.owner_id === s.me?.user_id;
  return false;
}
