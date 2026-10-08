// Адреса экранов (History API, без роутера):
//   /channels/@me                      — друзья
//   /channels/@me/<channelId>          — личка или беседа
//   /channels/<serverId>/<channelId>   — канал сервера (без channelId — первый текстовый)
//   /invite/<CODE>                     — приглашение на сервер
// nginx и vite preview отдают index.html на любой путь, так что прямая ссылка и перезагрузка работают.
import type { Dm, Group, Server, ServerChannel } from './api';
import type { View } from './store';

export type Route =
  | { kind: 'home'; channelId: number | null }
  | { kind: 'server'; serverId: number; channelId: number | null }
  | { kind: 'invite'; code: string };

const id = (s: string | undefined) => (s && /^\d{1,15}$/.test(s) ? Number(s) : null);

/** Разобрать путь; null — путь не относится к экранам приложения («/» и прочее) */
export function parsePath(path: string): Route | null {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'invite' && parts.length === 2 && /^[A-Za-z0-9]{1,32}$/.test(parts[1]))
    return { kind: 'invite', code: parts[1].toUpperCase() };
  if (parts[0] !== 'channels' || parts.length < 2 || parts.length > 3) return null;
  const channelId = parts.length === 3 ? id(parts[2]) : null;
  if (parts.length === 3 && channelId === null) return null;
  if (parts[1] === '@me') return { kind: 'home', channelId };
  const serverId = id(parts[1]);
  return serverId === null ? null : { kind: 'server', serverId, channelId };
}

interface Lists {
  servers: Server[];
  channelsByServer: Record<number, ServerChannel[]>;
  dms: Dm[];
  groups: Group[];
}

/** Экран по адресу; null — такого экрана у пользователя нет (чужой сервер, удалённая беседа) */
export function viewForRoute(s: Lists, r: Route): View | null {
  if (r.kind === 'home') {
    if (r.channelId === null) return { kind: 'friends' };
    if (s.dms.some((d) => d.channel_id === r.channelId)) return { kind: 'dm', channelId: r.channelId };
    if (s.groups.some((g) => g.id === r.channelId)) return { kind: 'group', channelId: r.channelId };
    return null;
  }
  if (r.kind !== 'server' || !s.servers.some((x) => x.id === r.serverId)) return null;
  const chs = s.channelsByServer[r.serverId] ?? [];
  const known = chs.some((c) => c.id === r.channelId && !c.is_voice);
  return { kind: 'server', serverId: r.serverId, channelId: known ? r.channelId : null };
}

export function pathFor(v: View): string {
  switch (v.kind) {
    case 'friends':
      return '/channels/@me';
    case 'dm':
    case 'group':
      return `/channels/@me/${v.channelId}`;
    case 'server':
      return v.channelId === null ? `/channels/${v.serverId}` : `/channels/${v.serverId}/${v.channelId}`;
  }
}

/** Ссылка-приглашение для копирования: открывает приложение и предлагает вступить */
export const inviteLink = (code: string) => `${location.origin}/invite/${encodeURIComponent(code)}`;
