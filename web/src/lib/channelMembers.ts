// Участники бесед (GET /channels/{id}/members, docs/API.md §7) — для @упоминаний и подсказок.
// У каналов серверов участники уже есть в store (membersByServer), здесь — только беседы.
import { create } from 'zustand';
import { api, ChannelMember } from './api';
import { useStore } from './store';
import { socket, WsEvent } from './ws';

interface State {
  byChannel: Record<number, ChannelMember[]>;
  load: (channelId: number) => Promise<void>;
}

const loading = new Set<number>();

export const useChannelMembers = create<State>((set, get) => ({
  byChannel: {},
  load: async (channelId) => {
    if (loading.has(channelId)) return;
    loading.add(channelId);
    const owner = useStore.getState().me?.user_id;
    try {
      const members = await api.channelMembers(channelId);
      // Пока ждали ответа, сменился пользователь вкладки — чужой состав не нужен
      if (useStore.getState().me?.user_id === owner) set({ byChannel: { ...get().byChannel, [channelId]: members } });
    } catch {
      /* старый сервер без эндпоинта или беседа уже недоступна — подсказок по ней не будет */
    } finally {
      loading.delete(channelId);
    }
  },
}));

function forget(channelId: number) {
  const { [channelId]: _, ...rest } = useChannelMembers.getState().byChannel;
  useChannelMembers.setState({ byChannel: rest });
}

socket.on((ev: WsEvent) => {
  const s = useChannelMembers.getState();
  switch (ev.type) {
    case 'channel_member_joined':
    case 'channel_member_left':
      if (s.byChannel[ev.channel_id]) void s.load(ev.channel_id);
      break;
    case 'channel_removed':
      if (s.byChannel[ev.channel_id]) forget(ev.channel_id);
      break;
    case 'user_updated': {
      const patch = (m: ChannelMember): ChannelMember =>
        m.id === ev.user_id
          ? {
              ...m,
              display_name: typeof ev.display_name === 'string' ? ev.display_name : m.display_name,
              avatar_path: typeof ev.avatar_path === 'string' ? ev.avatar_path : m.avatar_path,
            }
          : m;
      const byChannel: Record<number, ChannelMember[]> = {};
      for (const [ch, list] of Object.entries(s.byChannel)) byChannel[Number(ch)] = list.map(patch);
      useChannelMembers.setState({ byChannel });
      break;
    }
  }
});

// Выход из аккаунта — составы бесед прежнего пользователя не храним
useStore.subscribe((s, prev) => {
  if (prev.me && !s.me) useChannelMembers.setState({ byChannel: {} });
});
