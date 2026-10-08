// Справочник известных клиенту пользователей: для @упоминаний (по логину) и подписей реакций (по id).
// Собирается из того, что уже загружено: я, лички, друзья, заявки, участники серверов и бесед.
import { ChannelMember, Dm, Me, Member, UserSummary } from './api';
import { useChannelMembers } from './channelMembers';
import { useStore } from './store';

export interface KnownUser {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
}

export interface Directory {
  byLogin: Map<string, KnownUser>;
  byId: Map<number, KnownUser>;
}

type Sources = [
  Me | null,
  Dm[],
  UserSummary[],
  UserSummary[],
  UserSummary[],
  Record<number, Member[]>,
  Record<number, ChannelMember[]>,
];

let cached: { sources: Sources; dir: Directory } | null = null;

// Один справочник на все сообщения: пересобирается, только когда меняется какой-то из списков
function build(sources: Sources): Directory {
  if (cached && cached.sources.every((x, i) => x === sources[i])) return cached.dir;
  const [me, dms, friends, incoming, outgoing, servers, channels] = sources;
  const byLogin = new Map<string, KnownUser>();
  const byId = new Map<number, KnownUser>();
  const add = (u: KnownUser) => {
    if (!u.username) return;
    byLogin.set(u.username.toLowerCase(), u);
    byId.set(u.id, u);
  };
  Object.values(servers).forEach((list) => list.forEach(add));
  Object.values(channels).forEach((list) => list.forEach(add));
  [...outgoing, ...incoming, ...friends].forEach(add);
  dms.forEach((d) => add({ id: d.user_id, username: d.username, display_name: d.display_name, avatar_path: d.avatar_path }));
  if (me) add({ id: me.user_id, username: me.username, display_name: me.display_name, avatar_path: me.avatar_path });
  const dir = { byLogin, byId };
  cached = { sources, dir };
  return dir;
}

export function useUserDirectory(): Directory {
  const me = useStore((s) => s.me);
  const dms = useStore((s) => s.dms);
  const friends = useStore((s) => s.friends);
  const incoming = useStore((s) => s.incoming);
  const outgoing = useStore((s) => s.outgoing);
  const servers = useStore((s) => s.membersByServer);
  const channels = useChannelMembers((s) => s.byChannel);
  return build([me, dms, friends, incoming, outgoing, servers, channels]);
}

/** Пользователь по @логину из текста; «@bob.» в конце фразы — это bob */
export function resolveLogin(dir: Directory, name: string): { user: KnownUser; rest: string } | null {
  const user = dir.byLogin.get(name.toLowerCase());
  if (user) return { user, rest: '' };
  if (/[.-]$/.test(name)) {
    const short = dir.byLogin.get(name.slice(0, -1).toLowerCase());
    if (short) return { user: short, rest: name.slice(-1) };
  }
  return null;
}
