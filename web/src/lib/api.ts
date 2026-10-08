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

export interface Message {
  id: number;
  channel_id: number;
  author_id: number;
  author_name: string;
  author_avatar: string;
  text: string;
  created_at: string;
  edited: boolean;
  attachment: string;
  reactions: Reaction[];
  /** Эхо клиентского nonce (новый сервер присылает его в new_message и ответе на отправку) */
  nonce?: string;
  /** Только у своих ещё не подтверждённых сервером сообщений */
  local?: 'sending' | 'failed';
}

export interface MessagePage {
  /** По возрастанию id */
  messages: Message[];
  /** Есть ли более старые; null — сервер не сообщает (старая версия без постраничной загрузки) */
  hasMore: boolean | null;
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

export interface Dm {
  channel_id: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_path: string;
}

export interface Group {
  id: number;
  type: string;
  name: string;
  created_at: string;
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

  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    const msg =
      data?.error ||
      (res.status === 429
        ? 'Слишком много запросов, подождите минуту'
        : res.status === 413
          ? 'Файл слишком большой'
          : `Ошибка ${res.status}`);
    throw new ApiError(res.status, msg);
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
  logout: () => post('/auth/logout'),
  me: () => get<Me>('/auth/me'),

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
          .map((m) => ({ ...m, channel_id: channelId }))
          .sort((a, b) => a.id - b.id),
        hasMore: typeof r.has_more === 'boolean' ? r.has_more : null,
      }),
    );
  },
  send: (channelId: number, text: string, attachment: string, nonce: string) =>
    post<{ id: number; created_at: string; nonce?: string }>(`/channels/${channelId}/messages`, {
      text,
      attachment,
      nonce,
    }),
  edit: (channelId: number, mid: number, text: string) =>
    post(`/channels/${channelId}/messages/${mid}/edit`, { text }),
  remove: (channelId: number, mid: number) => del(`/channels/${channelId}/messages/${mid}`),
  react: (channelId: number, mid: number, emoji: string) =>
    post<{ reactions: Reaction[] }>(`/channels/${channelId}/messages/${mid}/react`, { emoji }),
  uploadAttachment: (channelId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return request<{ url: string }>('POST', `/channels/${channelId}/attachments`, fd);
  },

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
};

// SQLite CURRENT_TIMESTAMP — "YYYY-MM-DD HH:MM:SS" в UTC
export function parseTs(ts: string): Date {
  if (!ts) return new Date();
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}
