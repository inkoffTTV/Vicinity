import { create } from 'zustand';
import {
  api,
  ApiError,
  Dm,
  getToken,
  Group,
  LastMessage,
  Me,
  Member,
  Message,
  Presence,
  Server,
  ServerChannel,
  setToken,
  setUnauthorizedHandler,
  UploadedFile,
  UserSummary,
} from './api';
import { mentionsUser } from './markdown';
import { notifyMessage } from './notify';
import { parsePath, viewForRoute } from './routes';
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

  // ── Чат: ответы, переходы к сообщениям, прочитанное (docs/API.md §2, §4) ──
  /** Непрочитанные упоминания меня по каналам */
  mentions: Record<number, number>;
  /** Загружено окно истории, после которого на сервере есть более новые сообщения */
  hasNewer: Record<number, boolean>;
  loadingNewer: Record<number, boolean>;
  /** Сообщение, к которому надо прокрутить ленту и подсветить; key — новый при каждом переходе */
  focusMessage: { channelId: number; id: number; key: number } | null;
  /** Ответ, который готовится в поле ввода канала */
  replyingTo: Record<number, Message | undefined>;
  /** Сколько было непрочитанного в канале, когда его открыли, — для черты «Новые сообщения» */
  unreadAtOpen: { channelId: number; count: number } | null;
  setReplyingTo: (channelId: number, msg: Message | null) => void;
  /** Перейти к сообщению (в том числе в другом канале), подгрузив историю вокруг него */
  jumpTo: (channelId: number, messageId: number) => Promise<void>;
  /** Вернуться из старой истории к последним сообщениям */
  jumpToPresent: (channelId: number) => Promise<void>;
  loadNewer: (channelId: number) => Promise<void>;
  /** Непрочитанное с сервера: при входе и после переподключения */
  loadUnread: () => Promise<void>;
  /** Канал прочитан до последнего загруженного сообщения (лента внизу, вкладка на экране) */
  markRead: (channelId: number) => void;

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
  sendMessage: (channelId: number, text: string, file: File | null, replyTo?: Message | null) => void;
  retrySend: (nonce: string) => void;
  discardSend: (nonce: string) => void;
  editMessage: (channelId: number, id: number, text: string) => Promise<boolean>;
  deleteMessage: (channelId: number, id: number) => Promise<void>;
  react: (channelId: number, id: number, emoji: string) => Promise<void>;
  kickMember: (serverId: number, userId: number) => Promise<void>;
  // ── Управление серверами и беседами (docs/API.md §7, §8) ──
  /** Изменить сервер в списке (новый код приглашения, имя, иконка из ответа API) */
  patchServer: (id: number, patch: Partial<Server>) => void;
  /** Забанить участника; true — получилось */
  banMember: (serverId: number, userId: number) => Promise<boolean>;
  leaveServer: (id: number) => Promise<boolean>;
  deleteServer: (id: number) => Promise<boolean>;
  /** Переименовать беседу или канал сервера */
  renameChannel: (channelId: number, name: string) => Promise<boolean>;
  /** Удалить канал сервера или беседу */
  deleteChannel: (channelId: number) => Promise<boolean>;
  leaveGroup: (channelId: number) => Promise<boolean>;
  /** auto — статус поставлен автоматически (простой), а не выбран пользователем */
  setPresence: (p: Presence, auto?: boolean) => void;
  /** Текущий «Не активен» поставлен автоматически — снимается сам, когда пользователь вернётся */
  presenceAuto: boolean;
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
    attachment_name: ev.attachment_name,
    attachment_size: ev.attachment_size,
    attachment_type: ev.attachment_type,
    reply_to: ev.reply_to,
    reply: ev.reply,
  };
}

// Применить событие к списку; повторное применение ничего не ломает
function applyMessageEvent(list: Message[], ev: WsEvent, meId: number | undefined): Message[] {
  switch (ev.type) {
    case 'new_message':
      return insertIncoming(list, messageFromEvent(ev), meId);
    case 'message_edited':
      return patchReplies(
        list.map((m) => (m.id === ev.id ? { ...m, text: ev.text, edited: true, edited_at: Date.now() } : m)),
        ev.id,
        (r) => ({ ...r, text: [...String(ev.text)].slice(0, REPLY_PREVIEW).join('') }),
      );
    case 'message_deleted':
      // Цитаты удалённого сообщения в ответах на него пропадают — как у сервера (reply: null)
      return patchReplies(
        list.filter((m) => m.id !== ev.id),
        ev.id,
        () => null,
      );
    case 'reaction_update':
      return list.map((m) => (m.id === ev.message_id ? { ...m, reactions: ev.reactions ?? [] } : m));
  }
  return list;
}
// Цитата в ответе — не длиннее этого (как у сервера)
const REPLY_PREVIEW = 200;

function patchReplies(list: Message[], id: number, fn: (r: NonNullable<Message['reply']>) => Message['reply']) {
  return list.some((m) => m.reply?.id === id) ? list.map((m) => (m.reply?.id === id ? { ...m, reply: fn(m.reply) } : m)) : list;
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
  const outbox = new Map<string, OutboxItem>();
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
  // ── Прочитанное: что уже отправлено серверу и самые новые известные id по каналам ──
  const readSent = new Map<number, number>();
  const latestId = new Map<number, number>();
  // Пока идёт GET /unread, новые сообщения считаются здесь и добавляются к ответу сервера
  let unreadDuring: Map<number, { unread: number; mentions: number }> | null = null;
  let unreadTimer: number | undefined;
  let readUnsupported = false;
  let focusSeq = 0;

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
    const mentions = { ...s.mentions };
    const replyingTo = { ...s.replyingTo };
    ids.forEach((id) => {
      delete messages[id];
      delete unread[id];
      delete mentions[id];
      delete replyingTo[id];
      drafts.delete(id);
    });
    set({ messages, unread, mentions, replyingTo });
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

  // Сервер больше недоступен этому пользователю (вышел, удалил) — убрать без ожидания событий
  const dropServer = (id: number) => {
    set({ servers: get().servers.filter((x) => x.id !== id) });
    forgetServers([id]);
    leaveViewIfGone();
  };

  const dropGroup = (id: number) => {
    set({ groups: get().groups.filter((g) => g.id !== id) });
    dropChannelState([id]);
    leaveViewIfGone();
  };

  // Непрочитанное по каналам, которых больше нет в списках, иначе оно навсегда висит в заголовке
  const pruneUnread = () => {
    const s = get();
    const stale = Object.keys(s.unread)
      .map(Number)
      .filter((ch) => !knownChannel(s, ch));
    if (stale.length) {
      const unread = { ...s.unread };
      const mentions = { ...s.mentions };
      stale.forEach((ch) => {
        delete unread[ch];
        delete mentions[ch];
      });
      set({ unread, mentions });
    }
  };

  // Счётчики канала обнулить локально (на сервер прочтение отправляет markRead)
  const clearUnread = (ch: number) => {
    const s = get();
    if (!s.unread[ch] && !s.mentions[ch]) return;
    const { [ch]: _u, ...unread } = s.unread;
    const { [ch]: _m, ...mentions } = s.mentions;
    set({ unread, mentions });
  };

  const markActiveRead = () => {
    if (document.hidden) return;
    const ch = activeChannelId(get().view);
    if (ch) clearUnread(ch);
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

  const notify = (msg: Message, mentioned: boolean) => {
    const s = get();
    const v = viewForChannel(s, msg.channel_id);
    notifyMessage(msg, {
      serverId: v?.kind === 'server' ? v.serverId : null,
      mentioned,
      active: activeChannelId(s.view) === msg.channel_id,
      dnd: s.me?.presence === 'dnd',
      open: () => {
        const target = viewForChannel(get(), msg.channel_id);
        if (target) get().open(target);
      },
    });
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

  // Последнее сообщение лички/беседы для списка слева (только если сервер его присылает — иначе
  // поле не появляется, и список остаётся в серверном порядке)
  let lastRefreshTimer: number | undefined;
  const applyLastMessage = (ev: WsEvent) => {
    const s = get();
    const ch: number = ev.channel_id;
    const patch = (lm: LastMessage | null | undefined): LastMessage | null | undefined => {
      if (lm === undefined) return lm;
      if (ev.type === 'new_message')
        return lm && lm.id > ev.id
          ? lm
          : {
              id: ev.id,
              author_id: ev.author_id,
              author_name: ev.author_name,
              text: [...String(ev.text ?? '')].slice(0, REPLY_PREVIEW).join(''),
              attachment: ev.attachment ?? '',
              created_at: ev.created_at,
            };
      if (!lm || lm.id !== ev.id) return lm;
      if (ev.type === 'message_edited') return { ...lm, text: [...String(ev.text ?? '')].slice(0, REPLY_PREVIEW).join('') };
      // Удалили последнее — каким стало новое последнее, знает только сервер
      window.clearTimeout(lastRefreshTimer);
      lastRefreshTimer = window.setTimeout(() => void get().refreshDms(), 300);
      return lm;
    };
    const dm = s.dms.find((d) => d.channel_id === ch);
    const group = s.groups.find((g) => g.id === ch);
    if (dm) {
      const lm = patch(dm.last_message);
      if (lm !== dm.last_message) set({ dms: s.dms.map((d) => (d === dm ? { ...d, last_message: lm } : d)) });
    } else if (group) {
      const lm = patch(group.last_message);
      if (lm !== group.last_message) set({ groups: s.groups.map((g) => (g === group ? { ...g, last_message: lm } : g)) });
    }
  };

  const onMessageEvent = (ev: WsEvent) => {
    const ch: number = ev.channel_id;
    inflight.get(ch)?.events.push(ev);
    if (ev.type !== 'reaction_update') applyLastMessage(ev);
    // В ленте открыто окно старой истории — новое сообщение встанет на место при возврате к последним
    if (ev.type !== 'new_message' || !get().hasNewer[ch]) updateList(ch, (list) => applyMessageEvent(list, ev, get().me?.user_id));
    if (ev.type !== 'new_message') return;
    latestId.set(ch, Math.max(latestId.get(ch) ?? 0, ev.id));
    if (typeof ev.nonce === 'string' && ev.nonce) {
      modernServer = true;
      // Своё сообщение, помеченное «не отправлено», на деле дошло — повторять нечего
      if (outbox.has(ev.nonce) && !hasLocal(ch, ev.nonce)) settle(ev.nonce);
    }

    const s = get();
    const visible = activeChannelId(s.view) === ch && !document.hidden;
    if (!visible && ev.author_id !== s.me?.user_id) {
      const mentioned = !!s.me && mentionsUser(ev.text ?? '', s.me.username);
      set({
        unread: { ...s.unread, [ch]: (s.unread[ch] ?? 0) + 1 },
        mentions: mentioned ? { ...s.mentions, [ch]: (s.mentions[ch] ?? 0) + 1 } : s.mentions,
      });
      if (unreadDuring) {
        const d = unreadDuring.get(ch) ?? { unread: 0, mentions: 0 };
        unreadDuring.set(ch, { unread: d.unread + 1, mentions: d.mentions + (mentioned ? 1 : 0) });
      }
      notify(messageFromEvent(ev), mentioned);
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
        // Свой выход или удаление сервера уже убраны из списка — сообщать не о чем
        if (!s.servers.some((x) => x.id === ev.server_id)) break;
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
      case 'read_state':
        applyReadState(ev.channel_id, ev.last_read_id);
        break;
    }
  };

  // Канал прочитан на другом устройстве (или в другой вкладке) до last_read_id
  const applyReadState = (ch: number, lastRead: number) => {
    if (typeof ch !== 'number' || typeof lastRead !== 'number') return;
    readSent.set(ch, Math.max(readSent.get(ch) ?? 0, lastRead));
    const s = get();
    const list = s.messages[ch];
    if (lastRead >= Math.max(latestId.get(ch) ?? 0, maxSentId(list))) return clearUnread(ch);
    // Вся история после отметки загружена — пересчитать на месте, иначе спросить сервер
    const sent = (list ?? []).filter((m) => !m.local);
    if (!s.hasNewer[ch] && sent.length && sent[0].id <= lastRead) {
      const meId = s.me?.user_id;
      const rest = sent.filter((m) => m.id > lastRead && m.author_id !== meId);
      const mentions = rest.filter((m) => s.me && mentionsUser(m.text, s.me.username)).length;
      set({
        unread: { ...s.unread, [ch]: Math.min(s.unread[ch] ?? 0, rest.length) },
        mentions: { ...s.mentions, [ch]: Math.min(s.mentions[ch] ?? 0, mentions) },
      });
      return;
    }
    window.clearTimeout(unreadTimer);
    unreadTimer = window.setTimeout(() => void get().loadUnread(), 500);
  };

  // Окно истории вокруг сообщения; true — сообщение нашлось. Перебивает идущую загрузку канала.
  const loadAround = async (channelId: number, messageId: number): Promise<boolean> => {
    const seq = ++loadSeq;
    inflight.set(channelId, { seq, events: [] });
    set({ loadingChannel: { ...get().loadingChannel, [channelId]: true } });
    const current = () => inflight.get(channelId)?.seq === seq;
    try {
      const page = await api.messagesAround(channelId, messageId, PAGE);
      if (!current()) return false;
      const meId = get().me?.user_id;
      const local = (get().messages[channelId] ?? []).filter((m) => m.local);
      const merged = inflight
        .get(channelId)!
        .events.filter((ev) => !(page.hasNewer && ev.type === 'new_message'))
        .reduce((l, ev) => applyMessageEvent(l, ev, meId), [...page.messages, ...local]);
      set({
        messages: { ...get().messages, [channelId]: merged },
        hasMore: { ...get().hasMore, [channelId]: page.hasMore },
        hasNewer: { ...get().hasNewer, [channelId]: page.hasNewer },
      });
      return page.messages.some((m) => m.id === messageId);
    } catch (e) {
      if (current()) errorToast(e);
      return false;
    } finally {
      if (current()) {
        inflight.delete(channelId);
        set({ loadingChannel: { ...get().loadingChannel, [channelId]: false } });
      }
    }
  };

  // После переподключения — догнать всё, что пропустили, пока не было связи
  const catchUp = async () => {
    const s = get();
    const ch = activeChannelId(s.view);
    // Окно старой истории не трогаем — к последним сообщениям пользователь вернётся сам
    if (ch && !s.hasNewer[ch]) void s.loadMessages(ch);
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
    await s.loadUnread();
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
    // Экран из адреса (прямая ссылка, перезагрузка), иначе последний открытый — если он ещё доступен
    const route = parsePath(location.pathname);
    const s = get();
    let v: View | null = route && route.kind !== 'invite' ? viewForRoute(s, route) : null;
    if (!v) {
      const last = recallView();
      const ok =
        last.kind === 'friends' ||
        (last.kind === 'dm' && s.dms.some((d) => d.channel_id === last.channelId)) ||
        (last.kind === 'group' && s.groups.some((g) => g.id === last.channelId)) ||
        (last.kind === 'server' && s.servers.some((x) => x.id === last.serverId));
      v = ok ? last : { kind: 'friends' };
    }
    // Интерфейс показываем только с загруженными данными нового пользователя
    set({ me, presence: { ...get().presence, [me.user_id]: me.presence } });
    get().open(v);
    void get().loadUnread();
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
    mentions: {},
    hasNewer: {},
    loadingNewer: {},
    focusMessage: null,
    replyingTo: {},
    unreadAtOpen: null,
    presenceAuto: false,
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
    outbox.forEach((o) => {
      o.upload?.abort();
      if (o.preview) URL.revokeObjectURL(o.preview);
    });
    outbox.clear();
    drafts.clear();
    requestedChannels.clear();
    membersRefreshedAt.clear();
    readSent.clear();
    latestId.clear();
    unreadDuring = null;
    window.clearTimeout(unreadTimer);
    window.clearTimeout(lastRefreshTimer);
    readUnsupported = false;
    sessionConnected = false;
    set(initialSession());
  };

  const hasLocal = (channelId: number, nonce: string) =>
    !!get().messages[channelId]?.some((m) => m.local && m.nonce === nonce);

  // Сообщение подтверждено (или отменено) — убрать из очереди, прервать загрузку и освободить превью
  const settle = (nonce: string) => {
    const item = outbox.get(nonce);
    if (!item) return;
    outbox.delete(nonce);
    item.upload?.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
  };

  const patchLocal = (channelId: number, nonce: string, patch: Partial<Message>) =>
    updateList(channelId, (list) => list.map((m) => (m.local && m.nonce === nonce ? { ...m, ...patch } : m)));

  // Отправка одного сообщения из очереди; при ошибке оно остаётся с кнопкой «Повторить»
  const deliver = async (nonce: string) => {
    const item = outbox.get(nonce);
    if (!item) return;
    const { channelId } = item;
    // Пока ждали очереди, его уже подтвердило эхо по WS
    if (!hasLocal(channelId, nonce)) return settle(nonce);
    try {
      if (item.file && !item.uploaded) {
        // Прогресс — в самом сообщении, не чаще раза в процент
        item.upload = new AbortController();
        let shown = -1;
        item.uploaded = await api.uploadAttachment(
          channelId,
          withExt(item.file),
          (f) => {
            const pct = Math.floor(f * 100);
            if (pct !== shown) patchLocal(channelId, nonce, { progress: (shown = pct) / 100 });
          },
          item.upload.signal,
        );
        item.upload = undefined;
      }
      const up = item.uploaded;
      const r = await api.send(channelId, {
        text: item.text,
        attachment: up?.url ?? '',
        nonce,
        ...(up ? { attachment_name: up.name } : {}),
        ...(item.replyTo ? { reply_to: item.replyTo } : {}),
      });
      if (outbox.get(nonce) !== item) return;
      if (r.nonce) modernServer = true;
      updateList(channelId, (list) =>
        confirmLocal(list, nonce, (local) => ({
          ...local,
          id: r.id,
          created_at: r.created_at || local.created_at,
          attachment: up?.url ?? '',
          attachment_name: r.attachment_name ?? local.attachment_name,
          attachment_size: r.attachment_size ?? local.attachment_size,
          attachment_type: r.attachment_type ?? local.attachment_type,
          reply: r.reply !== undefined ? r.reply : local.reply,
          nonce: undefined,
          local: undefined,
          progress: undefined,
        })),
      );
      settle(nonce);
    } catch (e) {
      if (outbox.get(nonce) !== item) return;
      item.upload = undefined;
      // Эхо уже пришло — сообщение на сервере, ошибка ответа не важна
      if (!hasLocal(channelId, nonce)) return settle(nonce);
      patchLocal(channelId, nonce, { local: 'failed', progress: undefined });
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
      const ch = activeChannelId(v);
      set({ view: v, editing: null, unreadAtOpen: ch ? { channelId: ch, count: get().unread[ch] ?? 0 } : null });
      rememberView(v);
      if (ch) {
        clearUnread(ch);
        // Окно старой истории с прошлого раза не держим — канал открывается на последних сообщениях
        if (get().hasNewer[ch]) {
          const { [ch]: _, ...messages } = get().messages;
          set({ messages, hasNewer: { ...get().hasNewer, [ch]: false } });
        }
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
    sendMessage: (channelId, text, file, replyTo) => {
      const me = get().me;
      if (!me) return;
      // Открыто окно старой истории — своё сообщение показываем среди последних
      if (get().hasNewer[channelId]) void get().jumpToPresent(channelId);
      const nonce = makeNonce();
      const preview = file ? URL.createObjectURL(file) : '';
      outbox.set(nonce, { channelId, text, file, preview, replyTo: replyTo?.id });
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
        ...(file
          ? {
              attachment_name: file.name,
              attachment_size: file.size,
              attachment_type: isImageFile(file) ? 'image' : 'file',
              progress: 0,
            }
          : {}),
        ...(replyTo
          ? {
              reply_to: replyTo.id,
              reply: {
                id: replyTo.id,
                author_id: replyTo.author_id,
                author_name: replyTo.author_name,
                text: [...replyTo.text].slice(0, REPLY_PREVIEW).join(''),
                attachment: replyTo.attachment,
              },
            }
          : {}),
      };
      updateList(channelId, (list) => [...list, msg], true);
      drafts.delete(channelId);
      enqueue(nonce);
    },

    retrySend: (nonce) => {
      const item = outbox.get(nonce);
      if (!item) return;
      patchLocal(item.channelId, nonce, { local: 'sending', ...(item.file && !item.uploaded ? { progress: 0 } : {}) });
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
        updateList(channelId, (list) =>
          patchReplies(
            list.map((m) => (m.id === id ? { ...m, text, edited: true, edited_at: Date.now() } : m)),
            id,
            (r) => ({ ...r, text: [...text].slice(0, REPLY_PREVIEW).join('') }),
          ),
        );
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    deleteMessage: async (channelId, id) => {
      try {
        await api.remove(channelId, id);
        updateList(channelId, (list) =>
          patchReplies(
            list.filter((m) => m.id !== id),
            id,
            () => null,
          ),
        );
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

    patchServer: (id, patch) => set({ servers: get().servers.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),

    banMember: async (serverId, userId) => {
      try {
        await api.ban(serverId, userId);
        const list = get().membersByServer[serverId];
        if (list)
          set({ membersByServer: { ...get().membersByServer, [serverId]: list.filter((m) => m.id !== userId) } });
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    leaveServer: async (id) => {
      try {
        await api.leaveServer(id);
        dropServer(id);
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    deleteServer: async (id) => {
      try {
        await api.deleteServer(id);
        dropServer(id);
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    renameChannel: async (channelId, name) => {
      try {
        const r = await api.renameChannel(channelId, name);
        const s = get();
        set({
          groups: s.groups.map((g) => (g.id === channelId ? { ...g, name: r.name } : g)),
          channelsByServer: Object.fromEntries(
            Object.entries(s.channelsByServer).map(([sid, chs]) => [
              sid,
              chs.map((c) => (c.id === channelId ? { ...c, name: r.name } : c)),
            ]),
          ),
        });
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    deleteChannel: async (channelId) => {
      try {
        await api.deleteChannel(channelId);
        const v = viewForChannel(get(), channelId);
        if (v?.kind === 'server') await refreshChannels(v.serverId);
        else dropGroup(channelId);
        return true;
      } catch (e) {
        errorToast(e);
        return false;
      }
    },

    leaveGroup: async (channelId) => {
      try {
        await api.leaveGroup(channelId);
        dropGroup(channelId);
        return true;
      } catch (e) {
        errorToast(e);
        return false;
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

    setPresence: (p, auto = false) => {
      const me = get().me;
      if (!me) return;
      socket.send({ type: 'set_presence', presence: p });
      set({ me: { ...me, presence: p }, presence: { ...get().presence, [me.user_id]: p }, presenceAuto: auto && p === 'idle' });
    },

    showProfile: (id) => set({ profileUserId: id }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),

    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      set({ toasts: [...get().toasts, { id, text, kind }] });
      window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4000);
    },

    setEditing: (id) => set({ editing: id }),

    // ── Ответы, переходы, прочитанное ──

    setReplyingTo: (channelId, msg) => set({ replyingTo: { ...get().replyingTo, [channelId]: msg ?? undefined } }),

    jumpTo: async (channelId, messageId) => {
      const s = get();
      const here = activeChannelId(s.view) === channelId;
      if (!here) {
        const v = viewForChannel(s, channelId);
        if (!v) return s.toast('Канал недоступен', 'error');
        s.open(v);
      }
      const focus = () => set({ focusMessage: { channelId, id: messageId, key: ++focusSeq } });
      if (here && get().messages[channelId]?.some((m) => m.id === messageId)) return focus();
      const e = epoch;
      const found = await loadAround(channelId, messageId);
      if (e !== epoch) return;
      if (found) focus();
      else get().toast('Сообщение не найдено — возможно, его удалили', 'error');
    },

    jumpToPresent: async (channelId) => {
      if (!get().hasNewer[channelId]) return;
      const local = (get().messages[channelId] ?? []).filter((m) => m.local);
      const { [channelId]: _, ...rest } = get().messages;
      set({
        messages: local.length ? { ...rest, [channelId]: local } : rest,
        hasNewer: { ...get().hasNewer, [channelId]: false },
        focusMessage: null,
      });
      await get().loadMessages(channelId);
    },

    loadNewer: async (channelId) => {
      const s = get();
      const newest = maxSentId(s.messages[channelId]);
      if (!newest || !s.hasNewer[channelId] || s.loadingNewer[channelId]) return;
      const e = epoch;
      set({ loadingNewer: { ...s.loadingNewer, [channelId]: true } });
      try {
        // around=последнее загруженное: до половины окна — более новые сообщения
        const page = await api.messagesAround(channelId, newest, 100);
        if (e !== epoch || !get().hasNewer[channelId]) return;
        updateList(channelId, (list) => ordered([...list, ...page.messages.filter((m) => !list.some((x) => x.id === m.id))]));
        set({ hasNewer: { ...get().hasNewer, [channelId]: page.hasNewer } });
      } catch (err) {
        errorToast(err);
      } finally {
        if (e === epoch) set({ loadingNewer: { ...get().loadingNewer, [channelId]: false } });
      }
    },

    loadUnread: async () => {
      const e = epoch;
      unreadDuring = new Map();
      try {
        const list = await api.unread();
        if (e !== epoch) return;
        modernServer = true;
        const s = get();
        // Открытый на экране канал прочитан — его отметку отправит лента
        const active = document.hidden ? null : activeChannelId(s.view);
        const unread: Record<number, number> = {};
        const mentions: Record<number, number> = {};
        for (const u of list) {
          latestId.set(u.channel_id, Math.max(latestId.get(u.channel_id) ?? 0, u.last_message_id));
          if (u.channel_id === active) continue;
          unread[u.channel_id] = u.unread;
          if (u.mentions) mentions[u.channel_id] = u.mentions;
        }
        unreadDuring.forEach((d, ch) => {
          if (ch === active) return;
          unread[ch] = (unread[ch] ?? 0) + d.unread;
          if (d.mentions) mentions[ch] = (mentions[ch] ?? 0) + d.mentions;
        });
        set({ unread, mentions });
      } catch {
        /* старый сервер без /unread — счётчики ведутся только на клиенте */
      } finally {
        if (e === epoch) unreadDuring = null;
      }
    },

    markRead: (channelId) => {
      clearUnread(channelId);
      const newest = maxSentId(get().messages[channelId]);
      const prev = readSent.get(channelId) ?? 0;
      if (!newest || readUnsupported || newest <= prev) return;
      readSent.set(channelId, newest);
      const e = epoch;
      api.markRead(channelId, newest).then(
        (r) => {
          if (e === epoch) readSent.set(channelId, Math.max(readSent.get(channelId) ?? 0, r.last_read_id));
        },
        (err) => {
          if (e !== epoch) return;
          // Старый сервер не знает /read — больше не пытаемся; иначе повторим при следующем случае
          if (err instanceof ApiError && err.status === 404 && !modernServer) readUnsupported = true;
          else if (readSent.get(channelId) === newest) readSent.set(channelId, prev);
        },
      );
    },
  };
});

interface OutboxItem {
  channelId: number;
  text: string;
  file: File | null;
  preview: string;
  replyTo?: number;
  /** Файл уже на сервере — при повторе не загружаем заново */
  uploaded?: UploadedFile;
  upload?: AbortController;
}

/** Картинки сервер показывает в ленте, остальное — файлом (docs/API.md §2) */
export function isImageFile(f: File): boolean {
  return /^image\/(png|jpeg|gif|webp)$/.test(f.type);
}

// У вставленных из буфера картинок может не быть имени с расширением
function withExt(f: File): File {
  if (!isImageFile(f) || /\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f;
  const ext = f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1];
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
