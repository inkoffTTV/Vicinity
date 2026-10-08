// Тонкая обёртка над REST API бэкенда Vicinity (/api/v1/...).
// Веб-клиент отдаётся с того же origin, что и API, поэтому пути относительные.

export type Presence = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface Me {
  user_id: number;
  username: string;
  display_name: string;
  avatar_path: string;
  banner_path: string;
  bio: string;
  accent_color: string;
  pronouns: string;
  presence: Presence;
  profile_json: string;
  created_at: string;
  subscription_tier: number;
  developer: number | boolean;
}

/** Что требует регистрация на этом сервере (GET /auth/registration) */
export interface RegistrationInfo {
  mode: 'email' | 'captcha' | 'open' | 'closed';
  captcha: boolean;
  email: boolean;
  open: boolean;
}

/** Задача капчи ALTCHA (GET /auth/challenge) */
export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export interface RegisterStart {
  username: string;
  password: string;
  display_name: string;
  email?: string;
  /** base64(JSON решения капчи) */
  altcha?: string;
  /** ловушка для ботов — всегда пустая */
  website?: string;
}

export type RegisterStartResult =
  | { token: string; user_id: number; display_name: string }
  | { pending_id: string; email: string; expires_in: number; resend_in: number };

/** Настройки оформления на сервере (GET/PATCH /settings/appearance) */
export interface AppearanceSettings {
  follow_system: boolean;
  base_theme: 'light' | 'dark' | 'graphite' | 'black';
  color_theme: string | null;
  custom_theme: { colors: string[]; angle: number; base: 'light' | 'dark' } | null;
  sync_devices: boolean;
  apply_to_profiles: boolean;
  server_theme: 'mine' | 'default';
  accent: string;
  font_size: 's' | 'm' | 'l';
  compact: boolean;
  reduce_motion: boolean;
  saturation: number;
  high_contrast: boolean;
}

export interface AppearanceResponse {
  settings: AppearanceSettings;
  access: { color_themes: boolean; custom_theme: boolean; tier: number };
  stored: boolean;
}

/** Что даёт подписка (GET /subscription) — лимиты проверяет сервер */
export interface Plan {
  tier: number;
  name: string;
  files_mb: number;
  screen: { height: number; fps: number };
  camera_height: number;
  /** -1 — без лимита */
  servers: number;
  bio: number;
  animated_banner: boolean;
  color_themes: boolean;
  custom_theme: boolean;
  name_color: boolean;
  gradient_name: boolean;
}

/** Пользователь в админ-панели (GET /admin/users) */
export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
  email: string;
  signup_ip: string;
  created_at: string;
  banned: boolean;
  developer: boolean;
  subscription_tier: number;
}

export interface AdminUsers {
  users: AdminUser[];
  top_ips: { ip: string; count: number; last: string }[];
  total: number;
  last_day: number;
  banned: number;
}

export interface BlockedIp {
  ip: string;
  note: string;
  created_at: string;
  accounts: number;
}

export interface UserSummary {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
  presence?: Presence;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: number[];
}

/** Цитата сообщения, на которое ответили (docs/API.md §2) */
export interface ReplyPreview {
  id: number;
  author_id: number;
  author_name: string;
  /** Не длиннее 200 символов */
  text: string;
  attachment: string;
}

export type AttachmentType = 'image' | 'file' | '';

export interface Message {
  id: number;
  channel_id: number;
  author_id: number;
  author_name: string;
  author_avatar: string;
  /** Подписка автора (цветной ник с Basic, градиентный с Ultra) — нет у старых серверов */
  author_tier?: number;
  author_accent?: string;
  text: string;
  created_at: string;
  edited: boolean;
  /** URL вложения любого типа ("" — нет). Сервер кладёт в своё `attachment` только картинки
   *  (для старых десктопов), URL файла — в `attachment_url`; withAttachmentUrl сводит их сюда. */
  attachment: string;
  reactions: Reaction[];
  // Поля нового сервера; старый их не присылает
  attachment_url?: string;
  attachment_name?: string;
  attachment_size?: number;
  attachment_type?: AttachmentType;
  reply_to?: number;
  /** null — ответа нет или исходное сообщение удалено */
  reply?: ReplyPreview | null;
  /** Когда правку увидел этот клиент (сервер время правки не хранит) */
  edited_at?: number;
  /** Доля загрузки вложения своего ещё не отправленного сообщения (0..1) */
  progress?: number;
  /** Эхо клиентского nonce (новый сервер присылает его в new_message и ответе на отправку) */
  nonce?: string;
  /** Только у своих ещё не подтверждённых сервером сообщений */
  local?: 'sending' | 'failed';
}

/** Сообщение с сервера: URL вложения любого типа — в `attachment` (docs/API.md §2) */
export function withAttachmentUrl<T extends { attachment?: string; attachment_url?: string }>(m: T): T {
  return m.attachment_url ? { ...m, attachment: m.attachment_url } : m;
}

export interface MessagePage {
  /** По возрастанию id */
  messages: Message[];
  /** Есть ли более старые; null — сервер не сообщает (старая версия без постраничной загрузки) */
  hasMore: boolean | null;
}

/** Окно истории вокруг сообщения (around=) */
export interface AroundPage {
  messages: Message[];
  hasMore: boolean;
  hasNewer: boolean;
}

export interface UnreadEntry {
  channel_id: number;
  unread: number;
  mentions: number;
  last_message_id: number;
}

export interface PinnedMessage extends Message {
  pinned_by: number;
  pinned_at: string;
}

export interface SearchResult extends Message {
  channel_name: string;
  /** 0 — личка или беседа */
  server_id: number;
}

export interface ChannelMember extends UserSummary {
  is_owner: boolean;
}

export interface UploadedFile {
  url: string;
  name: string;
  size: number;
  type: AttachmentType;
}

export interface Server {
  id: number;
  name: string;
  icon: string;
  owner_id: number;
  invite_code: string;
}

export interface ServerChannel {
  id: number;
  name: string;
  is_voice: number;
}

export interface Member extends UserSummary {
  is_owner: boolean;
  developer: number;
  tier: number;
  roles: { name: string; color: string }[];
}

/** Последнее сообщение лички/беседы для списка слева (docs/API.md §7); у старого сервера его нет */
export interface LastMessage {
  id: number;
  author_id: number;
  author_name: string;
  /** Не длиннее 200 символов */
  text: string;
  attachment: string;
  created_at: string;
}

export interface Dm {
  channel_id: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_path: string;
  last_message?: LastMessage | null;
}

export interface Group {
  id: number;
  type: string;
  name: string;
  created_at: string;
  owner_id?: number;
  last_message?: LastMessage | null;
}

/** Сессия входа (docs/API.md §9) */
export interface Session {
  id: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}

export interface BannedUser {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
}

export interface ServerUpdate {
  server_id: number;
  name: string;
  icon: string;
}

export interface Profile {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
  banner_path: string;
  bio: string;
  accent_color: string;
  pronouns: string;
  profile_json: string;
  created_at: string;
  subscription_tier: number;
  developer: number | boolean;
  badges: { id: string; label: string; color: string }[];
  presence: Presence;
  friendship_status: string;
  mutual_servers: { id: number; name: string }[];
  mutual_friends: UserSummary[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const TOKEN_KEY = 'vicinity.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим — токен живёт только в памяти */
  }
}

let token: string | null = loadToken();
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
  saveToken(t);
}
export function getToken() {
  return token;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Сервер недоступен');
  }

  return settle<T>(res.status, await res.text());
}

// Разобрать ответ сервера: данные или ApiError с понятным текстом
function settle<T>(status: number, text: string): T {
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (status < 200 || status >= 300) {
    if (status === 401 && token && onUnauthorized) onUnauthorized();
    const msg =
      data?.error ||
      (status === 429
        ? 'Слишком много запросов, подождите минуту'
        : status === 413
          ? 'Файл слишком большой'
          : `Ошибка ${status}`);
    throw new ApiError(status, msg);
  }
  // Часть эндпоинтов профиля сообщает об ошибке БД кодом 200 + {status:"error"}
  if (data && data.status === 'error') throw new ApiError(500, data.message || 'Ошибка сервера');
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
const del = <T>(p: string) => request<T>('DELETE', p);

export const api = {
  // ── Аккаунт ──
  login: (username: string, password: string) =>
    post<{ token: string; user_id: number }>('/auth/login', { username, password }),
  register: (username: string, password: string, display_name: string) =>
    post<{ token: string; user_id: number }>('/auth/register', { username, password, display_name }),
  registrationInfo: () => get<RegistrationInfo>('/auth/registration'),
  challenge: () => get<AltchaChallenge>('/auth/challenge'),
  /** Режим email → {pending_id, …} (код ушёл на почту); иначе сразу {token, user_id} */
  registerStart: (b: RegisterStart) => post<RegisterStartResult>('/auth/register/start', b),
  registerVerify: (pending_id: string, code: string) =>
    post<{ token: string; user_id: number }>('/auth/register/verify', { pending_id, code }),
  registerResend: (pending_id: string) =>
    post<{ resend_in: number; expires_in: number }>('/auth/register/resend', { pending_id }),
  logout: () => post('/auth/logout'),
  me: () => get<Me>('/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    post<{ status: string; revoked: number }>('/auth/password', { old_password, new_password }),
  sessions: () => get<{ sessions: Session[] }>('/auth/sessions').then((r) => r.sessions),
  revokeSession: (id: string) => del(`/auth/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => del<{ status: string; revoked: number }>('/auth/sessions/others'),

  // ── Подписка и оформление ──
  subscription: () => get<{ tier: number; current: Plan; plans: Plan[] }>('/subscription'),
  appearance: () => get<AppearanceResponse>('/settings/appearance'),
  saveAppearance: (s: Partial<AppearanceSettings>) => request<AppearanceResponse>('PATCH', '/settings/appearance', s),

  // ── Админ-панель (developer) ──
  adminSetTier: (id: number, tier: number) => post<{ id: number; tier: number }>(`/admin/users/${id}/tier`, { tier }),
  adminUsers: (q = '') => get<AdminUsers>(`/admin/users?q=${encodeURIComponent(q)}`),
  adminBan: (id: number, banned: boolean) => post<{ id: number; banned: boolean }>(`/admin/users/${id}/ban`, { banned }),
  adminDeleteUser: (id: number) => del<{ status: string }>(`/admin/users/${id}`),
  adminBlockedIps: () => get<{ blocked: BlockedIp[] }>('/admin/blocked-ips').then((r) => r.blocked),
  adminBlockIp: (ip: string, note: string, ban_accounts: boolean) =>
    post<{ ip: string; banned: number }>('/admin/blocked-ips', { ip, note, ban_accounts }),
  adminUnblockIp: (ip: string) => del<{ status: string }>(`/admin/blocked-ips/${encodeURIComponent(ip)}`),

  // ── Пользователи / лички ──
  searchUsers: (q: string) =>
    get<{ users: UserSummary[] }>(`/users/search?q=${encodeURIComponent(q)}`).then((r) => r.users),
  profile: (id: number) => get<Profile>(`/users/${id}/profile`),
  listDms: () => get<{ dms: Dm[] }>('/dms').then((r) => r.dms),
  startDm: (user_id: number) =>
    post<{ channel_id: number; display_name: string; username: string }>('/dms', { user_id }),

  // ── Группы (беседы вне серверов) ──
  listGroups: () => get<{ channels: Group[] }>('/channels').then((r) => r.channels),
  createGroup: (name: string) =>
    post<{ channel_id: number }>('/channels', { type: 'group', name }),
  addGroupMember: (channelId: number, user_id: number) =>
    post(`/channels/${channelId}/members`, { user_id }),
  /** Переименовать беседу или канал сервера */
  renameChannel: (channelId: number, name: string) =>
    post<{ channel_id: number; name: string }>(`/channels/${channelId}/update`, { name }),
  /** Удалить канал сервера (владелец) или беседу (её владелец) */
  deleteChannel: (channelId: number) => del(`/channels/${channelId}`),
  leaveGroup: (channelId: number) => post(`/channels/${channelId}/leave`),

  // ── Сообщения ──
  messages: (channelId: number, opts: { before?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.before) q.set('before', String(opts.before));
    const qs = q.toString();
    return get<{ messages: Omit<Message, 'channel_id'>[]; has_more?: boolean }>(
      `/channels/${channelId}/messages${qs ? `?${qs}` : ''}`,
    ).then(
      (r): MessagePage => ({
        // Старый сервер сортирует по времени и игнорирует before — порядок и границу задаём сами
        messages: r.messages
          .filter((m) => !opts.before || m.id < opts.before)
          .map((m) => withAttachmentUrl({ ...m, channel_id: channelId }))
          .sort((a, b) => a.id - b.id),
        hasMore: typeof r.has_more === 'boolean' ? r.has_more : null,
      }),
    );
  },
  send: (
    channelId: number,
    body: { text: string; attachment: string; nonce: string; attachment_name?: string; reply_to?: number },
  ) =>
    post<
      { id: number; created_at: string; nonce?: string } & Partial<
        Pick<Message, 'reply_to' | 'reply' | 'attachment_name' | 'attachment_size' | 'attachment_type'>
      >
    >(`/channels/${channelId}/messages`, body),
  edit: (channelId: number, mid: number, text: string) =>
    post(`/channels/${channelId}/messages/${mid}/edit`, { text }),
  remove: (channelId: number, mid: number) => del(`/channels/${channelId}/messages/${mid}`),
  react: (channelId: number, mid: number, emoji: string) =>
    post<{ reactions: Reaction[] }>(`/channels/${channelId}/messages/${mid}/react`, { emoji }),
  uploadAttachment,

  // ── Серверы ──
  listServers: () => get<{ servers: Server[] }>('/servers').then((r) => r.servers),
  createServer: (name: string) =>
    post<{ server_id: number; invite_code: string }>('/servers', { name }),
  joinByCode: (code: string) => post<{ server_id: number; name: string }>('/servers/join', { code }),
  serverChannels: (id: number) =>
    get<{ channels: ServerChannel[] }>(`/servers/${id}/channels`).then((r) => r.channels),
  createServerChannel: (id: number, name: string, is_voice: boolean) =>
    post(`/servers/${id}/channels`, { name, is_voice: is_voice ? 1 : 0 }),
  members: (id: number) => get<{ members: Member[] }>(`/servers/${id}/members`).then((r) => r.members),
  addServerMember: (id: number, user_id: number) => post(`/servers/${id}/members`, { user_id }),
  kick: (id: number, uid: number) => del(`/servers/${id}/members/${uid}`),
  renameServer: (id: number, name: string) => post<ServerUpdate>(`/servers/${id}/update`, { name }),
  uploadServerIcon: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return request<ServerUpdate>('POST', `/servers/${id}/icon`, fd);
  },
  regenerateInvite: (id: number) => post<{ invite_code: string }>(`/servers/${id}/invite`),
  bans: (id: number) => get<{ bans: BannedUser[] }>(`/servers/${id}/bans`).then((r) => r.bans),
  ban: (id: number, user_id: number) => post(`/servers/${id}/bans`, { user_id }),
  unban: (id: number, uid: number) => del(`/servers/${id}/bans/${uid}`),
  leaveServer: (id: number) => post(`/servers/${id}/leave`),
  deleteServer: (id: number) => del(`/servers/${id}`),

  // ── Друзья ──
  friends: () => get<{ friends: UserSummary[] }>('/friends').then((r) => r.friends),
  pending: () => get<{ incoming: UserSummary[]; outgoing: UserSummary[] }>('/friends/pending'),
  friendRequest: (user_id: number) => post<{ status: string }>('/friends/request', { user_id }),
  friendRespond: (user_id: number, accept: boolean) =>
    post<{ status: string }>('/friends/respond', { user_id, accept }),
  friendRemove: (id: number) => del(`/friends/${id}`),

  // ── Профиль ──
  customize: (p: {
    display_name: string;
    bio: string;
    pronouns: string;
    presence: string;
    accent_color: string;
    profile_json: string;
  }) => post('/profile/customize', p),
  uploadMedia: (field: 'avatar' | 'banner', file: File) => {
    const fd = new FormData();
    fd.append(field, file, file.name);
    return request<{ file_url: string }>('POST', '/profile/upload', fd);
  },
  clearMedia: (field: 'avatar' | 'banner') => post('/profile/clear_media', { field }),

  // ── Ответы, прочитанное, поиск, закрепы, участники бесед (docs/API.md §2–§7) ──
  messagesAround: (channelId: number, around: number, limit = 50) =>
    get<{ messages: Omit<Message, 'channel_id'>[]; has_more?: boolean; has_newer?: boolean }>(
      `/channels/${channelId}/messages?around=${around}&limit=${limit}`,
    ).then(
      (r): AroundPage => ({
        messages: r.messages.map((m) => withAttachmentUrl({ ...m, channel_id: channelId })).sort((a, b) => a.id - b.id),
        hasMore: r.has_more === true,
        hasNewer: r.has_newer === true,
      }),
    ),
  unread: () => get<{ channels: UnreadEntry[] }>('/unread').then((r) => r.channels),
  markRead: (channelId: number, message_id: number) =>
    post<{ channel_id: number; last_read_id: number }>(`/channels/${channelId}/read`, { message_id }),
  search: (q: string, scope: { channel_id?: number; server_id?: number }) => {
    const p = new URLSearchParams({ q });
    if (scope.channel_id) p.set('channel_id', String(scope.channel_id));
    else if (scope.server_id) p.set('server_id', String(scope.server_id));
    return get<{ results: SearchResult[] }>(`/search?${p}`).then((r) => r.results.map(withAttachmentUrl));
  },
  pins: (channelId: number) => get<{ pins: PinnedMessage[] }>(`/channels/${channelId}/pins`).then((r) => r.pins.map(withAttachmentUrl)),
  pin: (channelId: number, message_id: number) => post(`/channels/${channelId}/pins`, { message_id }),
  unpin: (channelId: number, mid: number) => del(`/channels/${channelId}/pins/${mid}`),
  channelMembers: (channelId: number) =>
    get<{ members: ChannelMember[] }>(`/channels/${channelId}/members`).then((r) => r.members),

  // ── Звонки ──
  /** STUN/TURN для RTCPeerConnection (TURN — временные учётки, docs/API.md §12) */
  rtcIce: () =>
    get<{ ice_servers?: RTCIceServer[] }>('/rtc/ice').then((r) => (Array.isArray(r.ice_servers) ? r.ice_servers : [])),
};

/**
 * Загрузить вложение (POST /channels/{id}/attachments) через XMLHttpRequest — ради событий прогресса.
 * onProgress получает долю 0..1; signal отменяет загрузку (ApiError с кодом 0 и name «AbortError»).
 */
function uploadAttachment(
  channelId: number,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      const e = new ApiError(0, 'Загрузка отменена');
      e.name = 'AbortError';
      reject(e);
    };
    if (signal?.aborted) return aborted();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/channels/${channelId}/attachments`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const r = settle<Partial<UploadedFile> & { url: string }>(xhr.status, xhr.responseText);
        // Старый сервер отвечает только {url} и принимает лишь картинки
        resolve({ url: r.url, name: r.name ?? file.name, size: r.size ?? file.size, type: r.type ?? 'image' });
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Сервер недоступен'));
    xhr.onabort = aborted;
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

// SQLite CURRENT_TIMESTAMP — "YYYY-MM-DD HH:MM:SS" в UTC
export function parseTs(ts: string): Date {
  if (!ts) return new Date();
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}
