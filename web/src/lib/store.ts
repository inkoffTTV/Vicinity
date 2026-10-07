import { create } from 'zustand';
import {
  api,
  ApiError,
  Dm,
  getToken,
  Group,
  Me,
  Member,
  Message,
  Presence,
  Server,
  ServerChannel,
  setToken,
  setUnauthorizedHandler,
  UserSummary,
} from './api';
import { socket, WsEvent } from './ws';

// Что открыто в основной области
export type View =
  | { kind: 'friends' }
  | { kind: 'dm'; channelId: number }
  | { kind: 'group'; channelId: number }
  | { kind: 'server'; serverId: number; channelId: number | null };

export interface VoiceUser {
  user_id: number;
  name: string;
}

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface IncomingCall {
  from: number;
  name: string;
}

interface State {
  me: Me | null;
  booting: boolean;
  connected: boolean;

  servers: Server[];
  channelsByServer: Record<number, ServerChannel[]>;
  membersByServer: Record<number, Member[]>;
  dms: Dm[];
  groups: Group[];
  friends: UserSummary[];
  incoming: UserSummary[];
  outgoing: UserSummary[];
  presence: Record<number, Presence>;
  voice: Record<number, VoiceUser[]>;
  speaking: Record<number, boolean>;

  messages: Record<number, Message[]>;
  loadingChannel: Record<number, boolean>;
  unread: Record<number, number>;

  view: View;
  profileUserId: number | null;
  settingsOpen: boolean;
  toasts: Toast[];
  incomingCall: IncomingCall | null;
  editing: number | null;

  boot: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string, d: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServer: (id: number) => Promise<void>;
  refreshDms: () => Promise<void>;
  refreshFriends: () => Promise<void>;
  open: (v: View) => void;
  openDmWith: (userId: number) => Promise<void>;
  loadMessages: (channelId: number) => Promise<void>;
  setPresence: (p: Presence) => void;
  showProfile: (id: number | null) => void;
  setSettingsOpen: (v: boolean) => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
  rejectCall: () => void;
  setEditing: (id: number | null) => void;
}

let toastSeq = 0;
const VIEW_KEY = 'vicinity.view';

function rememberView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
function recallView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { kind: 'friends' };
}

export function activeChannelId(v: View): number | null {
  if (v.kind === 'dm' || v.kind === 'group') return v.channelId;
  if (v.kind === 'server') return v.channelId;
  return null;
}

export const useStore = create<State>((set, get) => {
  const errorToast = (e: unknown) =>
    get().toast(e instanceof ApiError ? e.message : 'Что-то пошло не так', 'error');

  // ── Обработка событий WebSocket ──
  const handleEvent = (ev: WsEvent) => {
    const s = get();
    switch (ev.type) {
      case 'new_message': {
        const msg: Message = {
          id: ev.id,
          channel_id: ev.channel_id,
          author_id: ev.author_id,
          author_name: ev.author_name,
          author_avatar: ev.author_avatar ?? '',
          text: ev.text ?? '',
          created_at: ev.created_at,
          edited: false,
          attachment: ev.attachment ?? '',
          reactions: [],
        };
        const list = s.messages[msg.channel_id];
        if (list && !list.some((m) => m.id === msg.id))
          set({ messages: { ...s.messages, [msg.channel_id]: [...list, msg] } });
        const visible = activeChannelId(s.view) === msg.channel_id && !document.hidden;
        if (!visible && msg.author_id !== s.me?.user_id) {
          set({ unread: { ...get().unread, [msg.channel_id]: (get().unread[msg.channel_id] ?? 0) + 1 } });
          notify(msg);
        }
        // Новая личка, которой ещё нет в списке
        if (!s.dms.some((d) => d.channel_id === msg.channel_id) && !isServerChannel(s, msg.channel_id))
          void get().refreshDms();
        refreshMembersIfUnknown(msg.author_id);
        break;
      }
      case 'message_edited':
        patchMessage(ev.channel_id, ev.id, (m) => ({ ...m, text: ev.text, edited: true }));
        break;
      case 'message_deleted': {
        const list = s.messages[ev.channel_id];
        if (list)
          set({ messages: { ...s.messages, [ev.channel_id]: list.filter((m) => m.id !== ev.id) } });
        break;
      }
      case 'reaction_update':
        patchMessage(ev.channel_id, ev.message_id, (m) => ({ ...m, reactions: ev.reactions ?? [] }));
        break;
      case 'presence': {
        set({ presence: { ...s.presence, [ev.user_id]: ev.presence } });
        refreshMembersIfUnknown(ev.user_id);
        break;
      }
      case 'voice_state':
        set({ voice: { ...s.voice, [ev.channel_id]: ev.users ?? [] } });
        break;
      case 'voice_speaking':
        set({ speaking: { ...s.speaking, [ev.user_id]: !!ev.speaking } });
        break;
      case 'server_added':
        s.toast(`Вас добавили на сервер «${ev.name}»`);
        void s.refreshServers();
        break;
      case 'server_removed':
        s.toast(`Вас удалили с сервера «${ev.name}»`, 'error');
        if (s.view.kind === 'server' && s.view.serverId === ev.server_id) s.open({ kind: 'friends' });
        void s.refreshServers();
        break;
      case 'channel_added':
        s.toast(`Вас добавили в беседу «${ev.name}»`);
        void s.refreshDms();
        break;
      case 'friend_event':
        void s.refreshFriends();
        if (ev.action === 'request') s.toast('Новая заявка в друзья');
        if (ev.action === 'accept') s.toast('Заявка в друзья принята');
        break;
      case 'profile_updated':
        void s.refreshMe();
        break;
      case 'call_invite': {
        const dm = s.dms.find((d) => d.user_id === ev.from);
        set({ incomingCall: { from: ev.from, name: dm?.display_name ?? 'Пользователь' } });
        break;
      }
      case 'call_end':
      case 'call_reject':
        if (s.incomingCall?.from === ev.from) set({ incomingCall: null });
        break;
    }
  };

  const patchMessage = (channelId: number, id: number, fn: (m: Message) => Message) => {
    const s = get();
    const list = s.messages[channelId];
    if (!list) return;
    set({ messages: { ...s.messages, [channelId]: list.map((m) => (m.id === id ? fn(m) : m)) } });
  };

  // Вступление по коду не рассылает событий — новый участник обнаруживается
  // по его сообщению или смене статуса, тогда перезапрашиваем список участников.
  const refreshMembersIfUnknown = (userId: number) => {
    const s = get();
    if (s.view.kind !== 'server' || userId === s.me?.user_id) return;
    const members = s.membersByServer[s.view.serverId];
    if (members && !members.some((m) => m.id === userId)) void s.refreshServer(s.view.serverId);
  };

  const isServerChannel = (s: State, channelId: number) =>
    Object.values(s.channelsByServer).some((chs) => chs.some((c) => c.id === channelId));

  const notify = (msg: Message) => {
    if (!document.hidden) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(msg.author_name, {
        body: msg.text || '📎 Изображение',
        icon: msg.author_avatar || '/favicon.svg',
        tag: `ch-${msg.channel_id}`,
      });
    } catch {
      /* ignore */
    }
  };

  const startSession = async () => {
    const me = await api.me();
    set({ me, presence: { [me.user_id]: me.presence } });
    socket.connect(getToken()!);
    await Promise.all([get().refreshServers(), get().refreshDms(), get().refreshFriends()]);
    // Восстановить последний открытый экран, если он ещё доступен
    const v = recallView();
    const s = get();
    const ok =
      (v.kind === 'dm' && s.dms.some((d) => d.channel_id === v.channelId)) ||
      (v.kind === 'group' && s.groups.some((g) => g.id === v.channelId)) ||
      (v.kind === 'server' && s.servers.some((x) => x.id === v.serverId));
    get().open(ok ? v : { kind: 'friends' });
  };

  socket.on(handleEvent);
  socket.onStatus((connected) => {
    set({ connected });
    if (connected) {
      // После переподключения — догнать пропущенное
      const s = get();
      const ch = activeChannelId(s.view);
      if (ch) void s.loadMessages(ch);
      if (s.view.kind === 'server') {
        socket.send({ type: 'voice_query', server_id: s.view.serverId });
        void s.refreshServer(s.view.serverId);
      }
    }
  });

  setUnauthorizedHandler(() => {
    socket.disconnect();
    setToken(null);
    set({ me: null });
  });

  return {
    me: null,
    booting: true,
    connected: false,
    servers: [],
    channelsByServer: {},
    membersByServer: {},
    dms: [],
    groups: [],
    friends: [],
    incoming: [],
    outgoing: [],
    presence: {},
    voice: {},
    speaking: {},
    messages: {},
    loadingChannel: {},
    unread: {},
    view: { kind: 'friends' },
    profileUserId: null,
    settingsOpen: false,
    toasts: [],
    incomingCall: null,
    editing: null,

    boot: async () => {
      if (getToken()) {
        try {
          await startSession();
        } catch {
          setToken(null);
          set({ me: null });
        }
      }
      set({ booting: false });
    },

    login: async (u, p) => {
      const r = await api.login(u, p);
      setToken(r.token);
      await startSession();
    },

    register: async (u, p, d) => {
      const r = await api.register(u, p, d);
      setToken(r.token);
      await startSession();
    },

    logout: async () => {
      try {
        await api.logout();
      } catch {
        /* токен мог уже истечь */
      }
      socket.disconnect();
      setToken(null);
      set({
        me: null,
        servers: [],
        dms: [],
        groups: [],
        messages: {},
        unread: {},
        channelsByServer: {},
        membersByServer: {},
        view: { kind: 'friends' },
        settingsOpen: false,
        profileUserId: null,
        incomingCall: null,
      });
    },

    refreshMe: async () => {
      try {
        const me = await api.me();
        set({ me, presence: { ...get().presence, [me.user_id]: me.presence } });
      } catch (e) {
        errorToast(e);
      }
    },

    refreshServers: async () => {
      try {
        const servers = await api.listServers();
        set({ servers });
        await Promise.all(
          servers.map(async (srv) => {
            const chs = await api.serverChannels(srv.id);
            set({ channelsByServer: { ...get().channelsByServer, [srv.id]: chs } });
          }),
        );
      } catch (e) {
        errorToast(e);
      }
    },

    refreshServer: async (id) => {
      try {
        const [chs, members] = await Promise.all([api.serverChannels(id), api.members(id)]);
        const presence = { ...get().presence };
        members.forEach((m) => m.presence && (presence[m.id] = m.presence));
        set({
          channelsByServer: { ...get().channelsByServer, [id]: chs },
          membersByServer: { ...get().membersByServer, [id]: members },
          presence,
        });
      } catch (e) {
        errorToast(e);
      }
    },

    refreshDms: async () => {
      try {
        const [dms, groups] = await Promise.all([api.listDms(), api.listGroups()]);
        set({ dms, groups });
      } catch (e) {
        errorToast(e);
      }
    },

    refreshFriends: async () => {
      try {
        const [friends, pend] = await Promise.all([api.friends(), api.pending()]);
        const presence = { ...get().presence };
        friends.forEach((f) => f.presence && (presence[f.id] = f.presence));
        set({ friends, incoming: pend.incoming, outgoing: pend.outgoing, presence });
      } catch (e) {
        errorToast(e);
      }
    },

    open: (v) => {
      // Для сервера без выбранного канала — первый текстовый
      if (v.kind === 'server' && v.channelId === null) {
        const first = (get().channelsByServer[v.serverId] ?? []).find((c) => !c.is_voice);
        v = { ...v, channelId: first?.id ?? null };
      }
      set({ view: v, editing: null });
      rememberView(v);
      const ch = activeChannelId(v);
      if (ch) {
        const { [ch]: _, ...rest } = get().unread;
        set({ unread: rest });
        void get().loadMessages(ch);
      }
      if (v.kind === 'server') {
        void get().refreshServer(v.serverId);
        socket.send({ type: 'voice_query', server_id: v.serverId });
      }
    },

    openDmWith: async (userId) => {
      try {
        const r = await api.startDm(userId);
        await get().refreshDms();
        get().open({ kind: 'dm', channelId: r.channel_id });
        set({ profileUserId: null });
      } catch (e) {
        errorToast(e);
      }
    },

    loadMessages: async (channelId) => {
      set({ loadingChannel: { ...get().loadingChannel, [channelId]: true } });
      try {
        const list = await api.messages(channelId);
        set({ messages: { ...get().messages, [channelId]: list } });
      } catch (e) {
        errorToast(e);
      } finally {
        set({ loadingChannel: { ...get().loadingChannel, [channelId]: false } });
      }
    },

    setPresence: (p) => {
      const me = get().me;
      if (!me) return;
      socket.send({ type: 'set_presence', presence: p });
      set({ me: { ...me, presence: p }, presence: { ...get().presence, [me.user_id]: p } });
    },

    showProfile: (id) => set({ profileUserId: id }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),

    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      set({ toasts: [...get().toasts, { id, text, kind }] });
      window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4000);
    },

    rejectCall: () => {
      const c = get().incomingCall;
      if (c) socket.send({ type: 'call_reject', to: c.from });
      set({ incomingCall: null });
    },

    setEditing: (id) => set({ editing: id }),
  };
});

// Голосовые каналы и звонки в браузере пока не поддерживаются —
// на входящий звонок отвечаем «отклонено» по кнопке пользователя.
export const VOICE_UNSUPPORTED =
  'Голос и звонки пока доступны только в десктопном клиенте Vicinity';
