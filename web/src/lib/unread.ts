// Сводки непрочитанного для бейджей и заголовка вкладки. Лички и беседы — личное: считаются все
// сообщения; на серверах красный бейдж — только упоминания, остальное — жирное имя канала.
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store';

type S = ReturnType<typeof useStore.getState>;
type UnreadSlice = Pick<S, 'unread' | 'mentions' | 'channelsByServer' | 'dms' | 'groups' | 'servers'>;

const pick = (s: S): UnreadSlice => ({
  unread: s.unread,
  mentions: s.mentions,
  channelsByServer: s.channelsByServer,
  dms: s.dms,
  groups: s.groups,
  servers: s.servers,
});

/** Подписка только на то, из чего считаются бейджи */
export const useUnreadSlice = () => useStore(useShallow(pick));

const sum = (ids: number[], counts: Record<number, number>) => ids.reduce((a, id) => a + (counts[id] ?? 0), 0);

const serverChannels = (s: UnreadSlice, serverId: number) => (s.channelsByServer[serverId] ?? []).map((c) => c.id);

/** Непрочитанное в личках и беседах */
export const homeUnread = (s: UnreadSlice) =>
  sum(
    s.dms.map((d) => d.channel_id),
    s.unread,
  ) +
  sum(
    s.groups.map((g) => g.id),
    s.unread,
  );

/** Упоминания меня в каналах сервера */
export const serverMentions = (s: UnreadSlice, serverId: number) => sum(serverChannels(s, serverId), s.mentions);

/** Есть ли на сервере непрочитанные каналы, кроме заглушённых */
export const serverHasUnread = (s: UnreadSlice, serverId: number, muted: number[]) =>
  serverChannels(s, serverId).some((id) => (s.unread[id] ?? 0) > 0 && !muted.includes(id));

/** Число в заголовке вкладки: личное непрочитанное и упоминания на серверах */
export const attentionCount = (s: UnreadSlice) =>
  homeUnread(s) + s.servers.reduce((a, srv) => a + serverMentions(s, srv.id), 0);
