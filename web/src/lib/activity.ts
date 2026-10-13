// «Активности» — игры прямо в голосовом канале или звонке (components/Activities.tsx).
// Игра — отдельная страница /activities/<id>/ в изолированном фрейме (без доступа к аккаунту);
// с мессенджером она говорит через postMessage, а сервер пересылает её сообщения остальным игрокам
// (WS: activity_join / activity / activity_leave — backend/controllers/WSController.cc).
import { create } from 'zustand';
import { knownUser } from './users';
import { socket, WsEvent } from './ws';
import { useStore } from './store';

export interface ActivityGame {
  id: string;
  name: string;
  description: string;
  players: string;
  /** Цвета обложки */
  cover: [string, string];
}

export const ACTIVITY_GAMES: ActivityGame[] = [
  {
    id: 'klyaksa',
    name: 'Клякса',
    description: 'Подвал тетрадки: забег до 4 игроков, ежедневный забег с таблицей рекордов и дуэль. Шапки за достижения',
    players: '1–4',
    cover: ['#1d2b53', '#e43b44'],
  },
  {
    id: 'hookduel',
    name: 'Хук-дуэль',
    description: 'Двое мясников через речку: ходьба на WASD, хук на Q. Кто первым наберёт 5',
    players: '2',
    cover: ['#4c3ba8', '#38d1e0'],
  },
];

export const gameById = (id: string) => ACTIVITY_GAMES.find((g) => g.id === id);

export interface ActivityPeer {
  peerId: number;
  userId: number;
  name: string;
  avatar: string;
}

interface Invite {
  channelId: number;
  game: string;
  userId: number;
  name: string;
}

interface ActivityState {
  /** Открытая игра; peerId — мой номер в ней (0 — ещё подключаемся) */
  session: { channelId: number; game: string; peerId: number; peers: ActivityPeer[] } | null;
  invites: Invite[];
  start: (channelId: number, game: string) => void;
  leave: () => void;
  dismissInvite: (channelId: number) => void;
}

type FrameListener = (msg: unknown) => void;
const frameListeners = new Set<FrameListener>();
/** Сообщения для фрейма игры (ActivityFrame подписывается) */
export function onFrameMessage(fn: FrameListener) {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}
const toFrame = (msg: unknown) => frameListeners.forEach((fn) => fn(msg));

export function peerInfo(peerId: number, userId: number): ActivityPeer {
  const u = knownUser(userId);
  return { peerId, userId, name: u?.display_name || u?.username || 'Игрок', avatar: u?.avatar_path ?? '' };
}

export const useActivity = create<ActivityState>((set, get) => ({
  session: null,
  invites: [],
  start: (channelId, game) => {
    const cur = get().session;
    if (cur) socket.send({ type: 'activity_leave', channel_id: cur.channelId, game: cur.game });
    set({ session: { channelId, game, peerId: 0, peers: [] }, invites: get().invites.filter((i) => i.channelId !== channelId) });
    socket.send({ type: 'activity_join', channel_id: channelId, game });
  },
  leave: () => {
    const cur = get().session;
    if (!cur) return;
    socket.send({ type: 'activity_leave', channel_id: cur.channelId, game: cur.game });
    set({ session: null });
  },
  dismissInvite: (channelId) => set({ invites: get().invites.filter((i) => i.channelId !== channelId) }),
}));

/** Фрейм игры просит отправить сообщение остальным (или одному игроку) */
export function sendFromFrame(data: unknown, to?: number) {
  const s = useActivity.getState().session;
  if (!s || !s.peerId || typeof data !== 'object' || data === null) return;
  socket.send({ type: 'activity', channel_id: s.channelId, game: s.game, data, ...(to ? { to } : {}) });
}

socket.on((ev: WsEvent) => {
  const st = useActivity.getState();
  const s = st.session;
  switch (ev.type) {
    case 'activity_joined': {
      if (!s || ev.channel_id !== s.channelId || ev.game !== s.game) return;
      const peers = (ev.peers as { peer_id: number; user_id: number }[]).map((p) => peerInfo(p.peer_id, p.user_id));
      useActivity.setState({ session: { ...s, peerId: ev.peer_id, peers } });
      const me = useStore.getState().me;
      toFrame({ type: 'init', self: peerInfo(ev.peer_id, me?.user_id ?? 0), peers });
      break;
    }
    case 'activity_peer': {
      if (!s || ev.channel_id !== s.channelId || ev.game !== s.game) return;
      const peer = peerInfo(ev.peer_id, ev.user_id);
      const peers = ev.event === 'join' ? [...s.peers.filter((p) => p.peerId !== peer.peerId), peer] : s.peers.filter((p) => p.peerId !== peer.peerId);
      useActivity.setState({ session: { ...s, peers } });
      toFrame({ type: ev.event === 'join' ? 'peer_join' : 'peer_leave', peer });
      break;
    }
    case 'activity':
      if (!s || ev.channel_id !== s.channelId || ev.game !== s.game) return;
      toFrame({ type: 'msg', from: ev.from, data: ev.data });
      break;
    case 'activity_invite': {
      if (!gameById(ev.game) || (s && s.channelId === ev.channel_id && s.game === ev.game)) return;
      const u = knownUser(ev.user_id);
      const inv: Invite = { channelId: ev.channel_id, game: ev.game, userId: ev.user_id, name: u?.display_name || u?.username || 'Собеседник' };
      useActivity.setState({ invites: [...st.invites.filter((i) => i.channelId !== inv.channelId), inv] });
      break;
    }
  }
});

// Связь восстановилась — сервер забыл старое подключение: войти в игру заново (номер будет новый)
socket.onStatus((connected) => {
  const s = useActivity.getState().session;
  if (!connected || !s) return;
  useActivity.setState({ session: { ...s, peerId: 0, peers: [] } });
  socket.send({ type: 'activity_join', channel_id: s.channelId, game: s.game });
});
