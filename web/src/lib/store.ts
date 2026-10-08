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

interface State {
  me: Me | null;
  booting: boolean;
  /** Сессия сохранена, но сервер не отвечает — повторяем вход без выхода из аккаунта */
  unreachable: boolean;
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
  /** Есть ли более старые сообщения; null — сервер не умеет отдавать историю постранично */
  hasMore: Record<number, boolean | null>;
  loadingOlder: Record<number, boolean>;
  unread: Record<number, number>;

  view: View;
  profileUserId: number | null;
  settingsOpen: boolean;
  toasts: Toast[];
  editing: number | null;

  boot: () => Promise<void>;
  retryBoot: () => void;
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
  loadOlder: (channelId: number) => Promise<void>;
  sendMessage: (channelId: number, text: string, file: File | null) => void;
  retrySend: (nonce: string) => void;
  discardSend: (nonce: string) => void;
  editMessage: (channelId: number, id: number, text: string) => Promise<boolean>;
  deleteMessage: (channelId: number, id: number) => Promise<void>;
  react: (channelId: number, id: number, emoji: string) => Promise<void>;
  kickMember: (serverId: number, userId: number) => Promise<void>;
  setPresence: (p: Presence) => void;
  showProfile: (id: number | null) => void;
  setSettingsOpen: (v: boolean) => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
  setEditing: (id: number | null) => void;
}

let toastSeq = 0;
const VIEW_KEY = 'vicinity.view';
const PAGE = 50;

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
function forgetView() {
  try {
    localStorage.removeItem(VIEW_KEY);
  } catch {
    /* ignore */
  }
}

export function activeChannelId(v: View): number | null {
  if (v.kind === 'dm' || v.kind === 'group') return v.channelId;
  if (v.kind === 'server') return v.channelId;
  return null;
}

/** Черновики поля ввода по каналам (живут до выхода из аккаунта) */
export const drafts = new Map<number, string>();

// ── Список сообщений канала: подтверждённые по возрастанию id, в конце — свои неотправленные ──

function ordered(list: Message[]): Message[] {
  const sent = list.filter((m) => !m.local).sort((a, b) => a.id - b.id);
  const local = list.filter((m) => m.local);
  return local.length ? [...sent, ...local] : sent;
}

// Заменить своё локальное сообщение подтверждённым (без дубля, если эхо уже пришло)
function confirmLocal(list: Message[], nonce: string, build: (local: Message) => Message): Message[] {
  const local = list.find((m) => m.local && m.nonce === nonce);
  if (!local) return list;
  const rest = list.filter((m) => m !== local);
  const sent = build(local);
  return rest.some((m) => m.id === sent.id) ? rest : ordered([...rest, sent]);
}

// Новое сообщение из WS. Своё заменяет локальную копию: по nonce, а у старого
// сервера (без nonce в событии) — первую ожидающую с тем же текстом.
function insertIncoming(list: Message[], msg: Message, meId: number | undefined): Message[] {
  if (list.some((m) => m.id === msg.id)) return list;
  if (msg.author_id === meId) {
    const local = list.find((m) =>
      msg.nonce
        ? m.local && m.nonce === msg.nonce
        : m.local === 'sending' && m.text === msg.text && !m.attachment === !msg.attachment,
    );
    if (local) return confirmLocal(list, local.nonce!, () => ({ ...msg, nonce: undefined }));
  }
  return ordered([...list, msg]);
}

function messageFromEvent(ev: WsEvent): Message {
  return {
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
    nonce: ev.nonce,
  };
}

// Применить событие к списку; повторное применение ничего не ломает
function applyMessageEvent(list: Message[], ev: WsEvent, meId: number | undefined): Message[] {
  switch (ev.type) {
    case 'new_message':
      return insertIncoming(list, messageFromEvent(ev), meId);
    case 'message_edited':
      return list.map((m) => (m.id === ev.id ? { ...m, text: ev.text, edited: true } : m));
    case 'message_deleted':
      return list.filter((m) => m.id !== ev.id);
    case 'reaction_update':
      return list.map((m) => (m.id === ev.message_id ? { ...m, reactions: ev.reactions ?? [] } : m));
  }
  return list;
}
const MESSAGE_EVENTS = new Set(['new_message', 'message_edited', 'message_deleted', 'reaction_update']);
// События, которые рассылает только сервер новой версии (docs/API.md)
const MODERN_EVENTS = new Set([
  'server_member_joined',
  'server_member_left',
  'server_channels_changed',
  'server_updated',
  'user_updated',
  'channel_updated',
  'channel_removed',
  'channel_member_joined',
  'channel_member_left',
  'read_state',
  'typing',
  'pins_updated',
]);

const maxSentId = (list: Message[] | undefined) =>
  (list ?? []).reduce((a, m) => (m.local ? a : Math.max(a, m.id)), 0);

// Слить снимок REST (последние PAGE сообщений) с тем, что уже в памяти: появившееся во время
// загрузки (id > startMax) и неотправленное сохраняется; более старое — только если нет разрыва.
// Известное до загрузки, но отсутствующее в снимке, удалено на сервере.
function mergeSnapshot(existing: Message[] | undefined, snap: Message[], startMax: number) {
  if (!existing) return { list: snap, keptOlder: false };
  const local = existing.filter((m) => m.local);
  const sent = existing.filter((m) => !m.local);
  const minSnap = snap.length ? snap[0].id : Infinity;
  const maxSnap = snap.length ? snap[snap.length - 1].id : 0;
  const newer = sent.filter((m) => m.id > maxSnap && m.id > startMax);
  const complete = snap.length < PAGE; // в снимке вся история канала
  const overlaps = sent.some((m) => m.id >= minSnap && m.id <= maxSnap);
  const older = !complete && overlaps ? sent.filter((m) => m.id < minSnap) : [];
  return { list: [...older, ...snap, ...newer, ...local], keptOlder: older.length > 0 };
}

function makeNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Время в формате сервера (UTC "YYYY-MM-DD HH:MM:SS") для локальных сообщений
function nowTs(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export const useStore = create<State>((set, get) => {
  const errorToast = (e: unknown) =>
    get().toast(e instanceof ApiError ? e.message : 'Что-то пошло не так', 'error');

  // Номер сессии: ответы, пришедшие после выхода/смены пользователя, отбрасываются
  let epoch = 0;
  // Загрузки истории в полёте: события канала, пришедшие за это время, применяются поверх снимка
  const inflight = new Map<number, { seq: number; events: WsEvent[] }>();
  let loadSeq = 0;
  // Неотправленные сообщения по nonce; отправка идёт строго по очереди, чтобы не путать порядок
  const outbox = new Map<string, { channelId: number; text: string; file: File | null; preview: string; url?: string }>();
  let sendQueue: Promise<void> = Promise.resolve();
  let localSeq = 0;
  // Незнакомые каналы, о которых уже запросили список (не дёргать REST на каждое сообщение)
  const requestedChannels = new Set<number>();
  const membersRefreshedAt = new Map<number, number>();
  // Сервер новой версии (has_more в истории, эхо nonce, новые типы событий) сам сообщает о составе серверов
  let modernServer = false;
  let sessionConnected = false;
  let bootTimer: number | undefined;
  let bootDelay = 2000;

  const updateList = (channelId: number, fn: (list: Message[]) => Message[], create = false) => {
    const list = get().messages[channelId];
    if (!list && !create) return;
    const next = fn(list ?? []);
    if (next !== list) set({ messages: { ...get().messages, [channelId]: next } });
  };

  const knownChannel = (s: State, ch: number) =>
    s.dms.some((d) => d.channel_id === ch) ||
    s.groups.some((g) => g.id === ch) ||
    Object.values(s.channelsByServer).some((chs) => chs.some((c) => c.id === ch));

  const viewForChannel = (s: State, ch: number): View | null => {
    if (s.dms.some((d) => d.channel_id === ch)) return { kind: 'dm', channelId: ch };
    if (s.groups.some((g) => g.id === ch)) return { kind: 'group', channelId: ch };
    for (const [sid, chs] of Object.entries(s.channelsByServer))
      if (chs.some((c) => c.id === ch)) return { kind: 'server', serverId: Number(sid), channelId: ch };
    return null;
  };

  const dropChannelState = (ids: number[]) => {
    if (!ids.length) return;
    const s = get();
    const messages = { ...s.messages };
    const unread = { ...s.unread };
    ids.forEach((id) => {
      delete messages[id];
      delete unread[id];
      drafts.delete(id);
    });
    set({ messages, unread });
  };

  // Каналы и участники серверов, из которых пользователь вышел или был удалён
  const forgetServers = (ids: number[]) => {
    if (!ids.length) return;
    const s = get();
    const channelsByServer = { ...s.channelsByServer };
    const membersByServer = { ...s.membersByServer };
    const channels = ids.flatMap((id) => (channelsByServer[id] ?? []).map((c) => c.id));
    ids.forEach((id) => {
      delete channelsByServer[id];
      delete membersByServer[id];
    });
    set({ channelsByServer, membersByServer });
    dropChannelState(channels);
  };

  // Непрочитанное по каналам, которых больше нет в списках, иначе оно навсегда висит в заголовке
  const pruneUnread = () => {
    const s = get();
    const stale = Object.keys(s.unread)
      .map(Number)
      .filter((ch) => !knownChannel(s, ch));
    if (stale.length) {
      const unread = { ...s.unread };
      stale.forEach((ch) => delete unread[ch]);
      set({ unread });
    }
  };

  const markActiveRead = () => {
    if (document.hidden) return;
    const s = get();
    const ch = activeChannelId(s.view);
    if (ch && s.unread[ch]) {
      const { [ch]: _, ...rest } = s.unread;
      set({ unread: rest });
    }
  };

  // Открытый экран исчез (удалили с сервера, из беседы) — уйти на «Друзей»
  const leaveViewIfGone = () => {
    const s = get();
    const v = s.view;
    const gone =
      (v.kind === 'dm' && !s.dms.some((d) => d.channel_id === v.channelId)) ||
      (v.kind === 'group' && !s.groups.some((g) => g.id === v.channelId)) ||
      (v.kind === 'server' && !s.servers.some((x) => x.id === v.serverId));
    if (gone) s.open({ kind: 'friends' });
  };

  const refreshMembers = async (serverId: number) => {
    const e = epoch;
    try {
      const members = await api.members(serverId);
      if (e !== epoch) return;
      const presence = { ...get().presence };
      members.forEach((m) => m.presence && (presence[m.id] = m.presence));
      set({ membersByServer: { ...get().membersByServer, [serverId]: members }, presence });
    } catch {
      /* список участников обновится при следующем открытии сервера */
    }
  };

  const refreshChannels = async (serverId: number) => {
    const e = epoch;
    try {
      const chs = await api.serverChannels(serverId);
      if (e !== epoch) return;
      const removed = (get().channelsByServer[serverId] ?? []).filter((c) => !chs.some((x) => x.id === c.id));
      set({ channelsByServer: { ...get().channelsByServer, [serverId]: chs } });
      dropChannelState(removed.map((c) => c.id));
      const v = get().view;
      if (v.kind === 'server' && v.serverId === serverId && (v.channelId === null || !chs.some((c) => c.id === v.channelId)))
        get().open({ kind: 'server', serverId, channelId: null });
    } catch (err) {
      errorToast(err);
    }
  };

  // Старый сервер не рассылает server_member_joined: новичка узнаём по первому сообщению
  // в канале этого сервера. Новому серверу запасной путь не нужен.
  const refreshMembersIfUnknown = (serverId: number, userId: number) => {
    const s = get();
    if (modernServer || userId === s.me?.user_id) return;
    const members = s.membersByServer[serverId];
    if (!members || members.some((m) => m.id === userId)) return;
    const now = Date.now();
    if (now - (membersRefreshedAt.get(serverId) ?? 0) < 10_000) return;
    membersRefreshedAt.set(serverId, now);
    void refreshMembers(serverId);
  };

  const notify = (msg: Message) => {
    if (!document.hidden || get().me?.presence === 'dnd') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(msg.author_name, {
        body: msg.text || '📎 Изображение',
        icon: msg.author_avatar || '/favicon.svg',
        tag: `ch-${msg.channel_id}`,
      });
      n.onclick = () => {
        window.focus();
        const v = viewForChannel(get(), msg.channel_id);
        if (v) get().open(v);
        n.close();
      };
    } catch {
      /* ignore */
    }
  };

  // Имя/аватар пользователя поменялись — обновить везде, где они показаны
  const applyUserUpdate = (ev: WsEvent) => {
    const s = get();
    const uid: number = ev.user_id;
    const name: string | undefined = typeof ev.display_name === 'string' ? ev.display_name : undefined;
    const avatar: string | undefined = typeof ev.avatar_path === 'string' ? ev.avatar_path : undefined;
    const patchUser = <T extends { display_name: string; avatar_path: string }>(u: T): T => ({
      ...u,
      display_name: name ?? u.display_name,
      avatar_path: avatar ?? u.avatar_path,
    });
    const messages: Record<number, Message[]> = {};
    for (const [ch, list] of Object.entries(s.messages))
      messages[Number(ch)] = list.some((m) => m.author_id === uid)
        ? list.map((m) =>
            m.author_id === uid ? { ...m, author_name: name ?? m.author_name, author_avatar: avatar ?? m.author_avatar } : m,
          )
        : list;
    const membersByServer: Record<number, Member[]> = {};
    for (const [sid, list] of Object.entries(s.membersByServer))
      membersByServer[Number(sid)] = list.map((m) => (m.id === uid ? patchUser(m) : m));
    const voice: Record<number, VoiceUser[]> = {};
    for (const [ch, list] of Object.entries(s.voice))
      voice[Number(ch)] = list.map((u) => (u.user_id === uid && name ? { ...u, name } : u));
    set({
      dms: s.dms.map((d) => (d.user_id === uid ? patchUser(d) : d)),
      friends: s.friends.map((f) => (f.id === uid ? patchUser(f) : f)),
      incoming: s.incoming.map((f) => (f.id === uid ? patchUser(f) : f)),
      outgoing: s.outgoing.map((f) => (f.id === uid ? patchUser(f) : f)),
      membersByServer,
      messages,
      voice,
      me:
        s.me && s.me.user_id === uid
          ? {
              ...patchUser(s.me),
              accent_color: typeof ev.accent_color === 'string' ? ev.accent_color : s.me.accent_color,
            }
          : s.me,
    });
  };

  const onMessageEvent = (ev: WsEvent) => {
    const ch: number = ev.channel_id;
    inflight.get(ch)?.events.push(ev);
    updateList(ch, (list) => applyMessageEvent(list, ev, get().me?.user_id));
    if (ev.type !== 'new_message') return;
    if (typeof ev.nonce === 'string' && ev.nonce) {
      modernServer = true;
      // Своё сообщение, помеченное «не отправлено», на деле дошло — повторять нечего
      if (outbox.has(ev.nonce) && !hasLocal(ch, ev.nonce)) settle(ev.nonce);
    }

    const s = get();
    const visible = activeChannelId(s.view) === ch && !document.hidden;
    if (!visible && ev.author_id !== s.me?.user_id) {
      set({ unread: { ...s.unread, [ch]: (s.unread[ch] ?? 0) + 1 } });
      notify(messageFromEvent(ev));
    }
    if (!knownChannel(s, ch)) {
      // Новая личка, которой ещё нет в списке, — один запрос, а не на каждое сообщение
      if (!requestedChannels.has(ch)) {
        requestedChannels.add(ch);
        void s.refreshDms();
      }
    } else if (s.view.kind === 'server' && (s.channelsByServer[s.view.serverId] ?? []).some((c) => c.id === ch)) {
      refreshMembersIfUnknown(s.view.serverId, ev.author_id);
    }
  };

  // ── Обработка событий WebSocket ──
  const handleEvent = (ev: WsEvent) => {
    if (MESSAGE_EVENTS.has(ev.type)) return onMessageEvent(ev);
    if (MODERN_EVENTS.has(ev.type)) modernServer = true;
    const s = get();
    switch (ev.type) {
      case 'presence':
        set({ presence: { ...s.presence, [ev.user_id]: ev.presence } });
        break;
      case 'voice_state': {
        const users: VoiceUser[] = ev.users ?? [];
        // Вышедший из канала больше не говорит, даже если не успел сообщить
        const speaking = { ...s.speaking };
        (s.voice[ev.channel_id] ?? []).forEach((u) => {
          if (!users.some((x) => x.user_id === u.user_id)) delete speaking[u.user_id];
        });
        set({ voice: { ...s.voice, [ev.channel_id]: users }, speaking });
        break;
      }
      case 'voice_speaking':
        set({ speaking: { ...s.speaking, [ev.user_id]: !!ev.speaking } });
        break;
      case 'server_added':
        s.toast(`Вас добавили на сервер «${ev.name}»`);
        void s.refreshServers();
        break;
      case 'server_removed':
        s.toast(`Вас удалили с сервера «${ev.name}»`, 'error');
        set({ servers: s.servers.filter((x) => x.id !== ev.server_id) });
        forgetServers([ev.server_id]);
        leaveViewIfGone();
        void s.refreshServers();
        break;
      case 'server_updated':
        set({
          servers: s.servers.map((x) =>
            x.id === ev.server_id
              ? { ...x, name: typeof ev.name === 'string' ? ev.name : x.name, icon: typeof ev.icon === 'string' ? ev.icon : x.icon }
              : x,
          ),
        });
        break;
      case 'server_channels_changed':
        if (s.servers.some((x) => x.id === ev.server_id)) void refreshChannels(ev.server_id);
        break;
      case 'server_member_joined':
        if (ev.user_id === s.me?.user_id) void s.refreshServers();
        else if (s.membersByServer[ev.server_id] && !s.membersByServer[ev.server_id].some((m) => m.id === ev.user_id))
          void refreshMembers(ev.server_id);
        break;
      case 'server_member_left':
        if (ev.user_id === s.me?.user_id) {
          set({ servers: s.servers.filter((x) => x.id !== ev.server_id) });
          forgetServers([ev.server_id]);
          leaveViewIfGone();
        } else if (s.membersByServer[ev.server_id]) {
          set({
            membersByServer: {
              ...s.membersByServer,
              [ev.server_id]: s.membersByServer[ev.server_id].filter((m) => m.id !== ev.user_id),
            },
          });
        }
        break;
      case 'channel_added':
        s.toast(`Вас добавили в беседу «${ev.name}»`);
        void s.refreshDms();
        break;
      case 'channel_updated':
        if (typeof ev.name !== 'string') break;
        set({
          groups: s.groups.map((g) => (g.id === ev.channel_id ? { ...g, name: ev.name } : g)),
          channelsByServer: Object.fromEntries(
            Object.entries(s.channelsByServer).map(([sid, chs]) => [
              sid,
              chs.map((c) => (c.id === ev.channel_id ? { ...c, name: ev.name } : c)),
            ]),
          ),
        });
        break;
      case 'channel_removed': {
        const group = s.groups.find((g) => g.id === ev.channel_id);
        if (group) s.toast(`Беседа «${group.name}» больше недоступна`);
        set({
          groups: s.groups.filter((g) => g.id !== ev.channel_id),
          dms: s.dms.filter((d) => d.channel_id !== ev.channel_id),
        });
        dropChannelState([ev.channel_id]);
        leaveViewIfGone();
        break;
      }
      case 'friend_event':
        void s.refreshFriends();
        if (ev.action === 'request') s.toast('Новая заявка в друзья');
        if (ev.action === 'accept') s.toast('Заявка в друзья принята');
        break;
      case 'profile_updated':
        void s.refreshMe();
        break;
      case 'user_updated':
        applyUserUpdate(ev);
        break;
    }
  };

  // После переподключения — догнать всё, что пропустили, пока не было связи
  const catchUp = async () => {
    const s = get();
    const ch = activeChannelId(s.view);
    if (ch) void s.loadMessages(ch);
    const serverId = s.view.kind === 'server' ? s.view.serverId : null;
    if (serverId !== null) socket.send({ type: 'voice_query', server_id: serverId });
    const e = epoch;
    await Promise.all([
      s.refreshServers(),
      s.refreshDms(),
      s.refreshFriends(),
      serverId !== null ? refreshMembers(serverId) : null,
    ]);
    if (e !== epoch) return;
    pruneUnread();
    leaveViewIfGone();
  };

  const startSession = async () => {
    const e = epoch;
    const me = await api.me();
    if (e !== epoch) return;
    socket.connect(getToken()!);
    await Promise.all([get().refreshServers(), get().refreshDms(), get().refreshFriends()]);
    if (e !== epoch) return;
    // Интерфейс показываем только с загруженными данными нового пользователя
    set({ me, presence: { ...get().presence, [me.user_id]: me.presence } });
    // Восстановить последний открытый экран, если он ещё доступен
    const v = recallView();
    const s = get();
    const ok =
      (v.kind === 'dm' && s.dms.some((d) => d.channel_id === v.channelId)) ||
      (v.kind === 'group' && s.groups.some((g) => g.id === v.channelId)) ||
      (v.kind === 'server' && s.servers.some((x) => x.id === v.serverId));
    get().open(ok ? v : { kind: 'friends' });
  };

  // Вход при загрузке страницы. Нет сети или 5xx (перезапуск сервера за nginx) — не выходим,
  // а повторяем с нарастающей паузой; настоящий 401 разлогинит через onUnauthorized.
  const tryBoot = async () => {
    window.clearTimeout(bootTimer);
    try {
      await startSession();
      set({ booting: false, unreachable: false });
    } catch {
      if (!getToken()) return set({ booting: false, unreachable: false });
      set({ booting: false, unreachable: true });
      bootTimer = window.setTimeout(() => void tryBoot(), bootDelay);
      bootDelay = Math.min(bootDelay * 2, 30_000);
    }
  };

  const initialSession = () => ({
    me: null,
    unreachable: false,
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
    hasMore: {},
    loadingOlder: {},
    unread: {},
    view: { kind: 'friends' } as View,
    profileUserId: null,
    settingsOpen: false,
    editing: null,
  });

  // Полный сброс при выходе/401: следующему пользователю в этой вкладке не должно достаться ничего
  const resetSession = () => {
    epoch++;
    socket.disconnect();
    setToken(null);
    forgetView();
    window.clearTimeout(bootTimer);
    bootDelay = 2000;
    inflight.clear();
    outbox.forEach((o) => o.preview && URL.revokeObjectURL(o.preview));
    outbox.clear();
    drafts.clear();
    requestedChannels.clear();
    membersRefreshedAt.clear();
    sessionConnected = false;
    set(initialSession());
  };

  const hasLocal = (channelId: number, nonce: string) =>
    !!get().messages[channelId]?.some((m) => m.local && m.nonce === nonce);

  // Сообщение подтверждено (или отменено) — убрать из очереди и освободить превью
  const settle = (nonce: string) => {
    const item = outbox.get(nonce);
    if (!item) return;
    outbox.delete(nonce);
    if (item.preview) URL.revokeObjectURL(item.preview);
  };

  // Отправка одного сообщения из очереди; при ошибке оно остаётся с кнопкой «Повторить»
  const deliver = async (nonce: string) => {
    const item = outbox.get(nonce);
    if (!item) return;
    const { channelId } = item;
    // Пока ждали очереди, его уже подтвердило эхо по WS
    if (!hasLocal(channelId, nonce)) return settle(nonce);
    try {
      if (item.file && !item.url) item.url = (await api.uploadAttachment(channelId, withExt(item.file))).url;
      const r = await api.send(channelId, item.text, item.url ?? '', nonce);
      if (outbox.get(nonce) !== item) return;
      if (r.nonce) modernServer = true;
      updateList(channelId, (list) =>
        confirmLocal(list, nonce, (local) => ({
          ...local,
          id: r.id,
          created_at: r.created_at || local.created_at,
          attachment: item.url ?? '',
          nonce: undefined,
          local: undefined,
        })),
      );
      settle(nonce);
    } catch (e) {
      if (outbox.get(nonce) !== item) return;
      // Эхо уже пришло — сообщение на сервере, ошибка ответа не важна
      if (!hasLocal(channelId, nonce)) return settle(nonce);
      updateList(channelId, (list) => list.map((m) => (m.local && m.nonce === nonce ? { ...m, local: 'failed' } : m)));
      errorToast(e);
    }
  };
  const enqueue = (nonce: string) => {
    sendQueue = sendQueue.then(() => deliver(nonce));
  };

  socket.on(handleEvent);
  socket.onStatus((connected) => {
    set({ connected });
    if (!connected) return;
    if (sessionConnected) void catchUp();
    sessionConnected = true;
  });
  // WS не может подключиться несколько раз подряд — возможно, токен истёк: REST-запрос
  // с 401 разлогинит через onUnauthorized, сетевую ошибку просто пропускаем
  socket.setAuthCheck(() => void api.me().catch(() => {}));

  setUnauthorizedHandler(() => {
    const wasIn = !!get().me;
    resetSession();
    if (wasIn) get().toast('Сессия истекла — войдите снова', 'error');
  });

  document.addEventListener('visibilitychange', markActiveRead);
  window.addEventListener('focus', markActiveRead);
  window.addEventListener('online', () => {
    if (get().unreachable) void tryBoot();
  });

  return {
    ...initialSession(),
    booting: true,
    toasts: [],

    boot: async () => {
      if (getToken()) await tryBoot();
      else set({ booting: false });
    },

    retryBoot: () => {
      bootDelay = 2000;
      void tryBoot();
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
      resetSession();
    },

    refreshMe: async () => {
      const e = epoch;
      try {
        const me = await api.me();
        if (e !== epoch) return;
        set({ me, presence: { ...get().presence, [me.user_id]: me.presence } });
      } catch (err) {
        errorToast(err);
      }
    },

    refreshServers: async () => {
      const e = epoch;
      try {
        const servers = await api.listServers();
        if (e !== epoch) return;
        set({ servers });
        forgetServers(Object.keys(get().channelsByServer).map(Number).filter((id) => !servers.some((x) => x.id === id)));
        await Promise.all(
          servers.map(async (srv) => {
            const chs = await api.serverChannels(srv.id);
            if (e === epoch) set({ channelsByServer: { ...get().channelsByServer, [srv.id]: chs } });
          }),
        );
      } catch (err) {
        errorToast(err);
      }
    },

    refreshServer: async (id) => {
      const e = epoch;
      try {
        const [chs, members] = await Promise.all([api.serverChannels(id), api.members(id)]);
        if (e !== epoch) return;
        const presence = { ...get().presence };
        members.forEach((m) => m.presence && (presence[m.id] = m.presence));
        set({
          channelsByServer: { ...get().channelsByServer, [id]: chs },
          membersByServer: { ...get().membersByServer, [id]: members },
          presence,
        });
      } catch (err) {
        errorToast(err);
      }
    },

    refreshDms: async () => {
      const e = epoch;
      try {
        const [dms, groups] = await Promise.all([api.listDms(), api.listGroups()]);
        if (e !== epoch) return;
        set({ dms, groups });
      } catch (err) {
        errorToast(err);
      }
    },

    refreshFriends: async () => {
      const e = epoch;
      try {
        const [friends, pend] = await Promise.all([api.friends(), api.pending()]);
        if (e !== epoch) return;
        const presence = { ...get().presence };
        friends.forEach((f) => f.presence && (presence[f.id] = f.presence));
        set({ friends, incoming: pend.incoming, outgoing: pend.outgoing, presence });
      } catch (err) {
        errorToast(err);
      }
    },

    open: (v) => {
      // Для сервера без выбранного канала — первый текстовый
      if (v.kind === 'server' && v.channelId === null) {
        const first = (get().channelsByServer[v.serverId] ?? []).find((c) => !c.is_voice);
        v = { ...v, channelId: first?.id ?? null };
      }
      const prev = get().view;
      set({ view: v, editing: null });
      rememberView(v);
      const ch = activeChannelId(v);
      if (ch) {
        const { [ch]: _, ...rest } = get().unread;
        set({ unread: rest });
        void get().loadMessages(ch);
      }
      // Каналы, участники и голос сервера — при входе в сервер; внутри него их обновляют события
      const entering = v.kind === 'server' && (prev.kind !== 'server' || prev.serverId !== v.serverId);
      if (v.kind === 'server' && (entering || !get().membersByServer[v.serverId])) {
        void get().refreshServer(v.serverId);
        socket.send({ type: 'voice_query', server_id: v.serverId });
      }
    },

    openDmWith: async (userId) => {
      const e = epoch;
      try {
        const r = await api.startDm(userId);
        if (!get().dms.some((d) => d.channel_id === r.channel_id)) await get().refreshDms();
        if (e !== epoch) return;
        get().open({ kind: 'dm', channelId: r.channel_id });
        set({ profileUserId: null });
      } catch (e) {
        errorToast(e);
      }
    },

    loadMessages: async (channelId) => {
      const seq = ++loadSeq;
      const startMax = maxSentId(get().messages[channelId]);
      inflight.set(channelId, { seq, events: [] });
      set({ loadingChannel: { ...get().loadingChannel, [channelId]: true } });
      const current = () => inflight.get(channelId)?.seq === seq;
      try {
        const page = await api.messages(channelId, { limit: PAGE });
        if (!current()) return; // ответ устарел: идёт более новая загрузка или сменилась сессия
        if (page.hasMore !== null) modernServer = true;
        const { list, keptOlder } = mergeSnapshot(get().messages[channelId], page.messages, startMax);
        const meId = get().me?.user_id;
        const merged = inflight.get(channelId)!.events.reduce((l, ev) => applyMessageEvent(l, ev, meId), list);
        set({
          messages: { ...get().messages, [channelId]: merged },
          hasMore: { ...get().hasMore, [channelId]: keptOlder ? get().hasMore[channelId] ?? null : page.hasMore },
        });
      } catch (e) {
        if (current()) errorToast(e);
      } finally {
        if (current()) {
          inflight.delete(channelId);
          set({ loadingChannel: { ...get().loadingChannel, [channelId]: false } });
        }
      }
    },

    loadOlder: async (channelId) => {
      const s = get();
      const oldest = s.messages[channelId]?.find((m) => !m.local);
      if (!oldest || s.hasMore[channelId] !== true || s.loadingOlder[channelId]) return;
      const e = epoch;
      set({ loadingOlder: { ...s.loadingOlder, [channelId]: true } });
      try {
        const page = await api.messages(channelId, { before: oldest.id, limit: PAGE });
        if (e !== epoch) return;
        updateList(channelId, (list) => ordered([...page.messages.filter((m) => !list.some((x) => x.id === m.id)), ...list]));
        set({ hasMore: { ...get().hasMore, [channelId]: page.hasMore === true } });
      } catch (err) {
        errorToast(err);
      } finally {
        if (e === epoch) set({ loadingOlder: { ...get().loadingOlder, [channelId]: false } });
      }
    },

    // Сообщение сразу появляется в ленте как «отправляется», подтверждается ответом REST
    // или эхом по WS (что придёт раньше) — без дублей
    sendMessage: (channelId, text, file) => {
      const me = get().me;
      if (!me) return;
      const nonce = makeNonce();
      const preview = file ? URL.createObjectURL(file) : '';
      outbox.set(nonce, { channelId, text, file, preview });
      const msg: Message = {
        id: -++localSeq,
        channel_id: channelId,
        author_id: me.user_id,
        author_name: me.display_name,
        author_avatar: me.avatar_path,
        text,
        created_at: nowTs(),
        edited: false,
        attachment: preview,
        reactions: [],
        nonce,
        local: 'sending',
      };
      updateList(channelId, (list) => [...list, msg], true);
      drafts.delete(channelId);
      enqueue(nonce);
    },

    retrySend: (nonce) => {
      const item = outbox.get(nonce);
      if (!item) return;
      updateList(item.channelId, (list) => list.map((m) => (m.local && m.nonce === nonce ? { ...m, local: 'sending' } : m)));
      enqueue(nonce);
    },

    discardSend: (nonce) => {
      const item = outbox.get(nonce);
      if (!item) return;
      settle(nonce);
      updateList(item.channelId, (list) => list.filter((m) => !(m.local && m.nonce === nonce)));
    },

    editMessage: async (channelId, id, text) => {
      try {
        await api.edit(channelId, id, text);
        updateList(channelId, (list) => list.map((m) => (m.id === id ? { ...m, text, edited: true } : m)));
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    deleteMessage: async (channelId, id) => {
      try {
        await api.remove(channelId, id);
        updateList(channelId, (list) => list.filter((m) => m.id !== id));
      } catch (e) {
        errorToast(e);
      }
    },

    kickMember: async (serverId, userId) => {
      try {
        await api.kick(serverId, userId);
        const list = get().membersByServer[serverId];
        if (list)
          set({ membersByServer: { ...get().membersByServer, [serverId]: list.filter((m) => m.id !== userId) } });
      } catch (e) {
        errorToast(e);
      }
    },

    react: async (channelId, id, emoji) => {
      try {
        const r = await api.react(channelId, id, emoji);
        if (Array.isArray(r.reactions))
          updateList(channelId, (list) => list.map((m) => (m.id === id ? { ...m, reactions: r.reactions } : m)));
      } catch (e) {
        errorToast(e);
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

    setEditing: (id) => set({ editing: id }),
  };
});

// Сервер определяет тип по расширению — у вставленных из буфера картинок его может не быть
function withExt(f: File): File {
  if (/\.(png|jpe?g|gif)$/i.test(f.name)) return f;
  const ext = f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1] || 'png';
  return new File([f], `image.${ext}`, { type: f.type });
}

/** Имя пользователя из уже загруженных списков: личек, друзей, участников серверов */
export function userName(id: number): string {
  const s = useStore.getState();
  return (
    s.dms.find((d) => d.user_id === id)?.display_name ??
    s.friends.find((f) => f.id === id)?.display_name ??
    Object.values(s.membersByServer)
      .flat()
      .find((m) => m.id === id)?.display_name ??
    'Пользователь'
  );
}
