// Порядок каналов для перехода с клавиатуры (Alt+↑/↓, Alt+Shift+↑/↓) — такой же, как в списках слева.
import { useNotifySettings } from './notify';
import { sortRecent } from './recent';
import { activeChannelId, useStore, View } from './store';

type S = ReturnType<typeof useStore.getState>;

const home = (s: S): View[] => [
  ...sortRecent(s.dms).map((d): View => ({ kind: 'dm', channelId: d.channel_id })),
  ...sortRecent(s.groups).map((g): View => ({ kind: 'group', channelId: g.id })),
];

const serverText = (s: S, serverId: number): View[] =>
  (s.channelsByServer[serverId] ?? [])
    .filter((c) => !c.is_voice)
    .map((c): View => ({ kind: 'server', serverId, channelId: c.id }));

/** Все текстовые каналы: лички и беседы, затем серверы по порядку рейки */
const everything = (s: S): View[] => [...home(s), ...s.servers.flatMap((srv) => serverText(s, srv.id))];

function step(list: View[], current: number | null, dir: 1 | -1, wrap: boolean): View | null {
  if (!list.length) return null;
  const i = list.findIndex((v) => activeChannelId(v) === current);
  if (i < 0) return dir > 0 ? list[0] : list[list.length - 1];
  const j = i + dir;
  if (j >= 0 && j < list.length) return list[j];
  return wrap ? list[(j + list.length) % list.length] : null;
}

/** Соседний канал в текущем списке (лички и беседы или каналы открытого сервера) */
export function adjacentChannel(dir: 1 | -1): View | null {
  const s = useStore.getState();
  const list = s.view.kind === 'server' ? serverText(s, s.view.serverId) : home(s);
  return step(list, activeChannelId(s.view), dir, false);
}

/** Следующий (предыдущий) канал с непрочитанным — по всем серверам, кроме заглушённых */
export function adjacentUnread(dir: 1 | -1): View | null {
  const s = useStore.getState();
  const muted = useNotifySettings.getState().muted;
  const current = activeChannelId(s.view);
  const all = everything(s);
  const unread = all.filter((v) => {
    const ch = activeChannelId(v)!;
    return ch === current || ((s.unread[ch] ?? 0) > 0 && !muted.includes(ch));
  });
  // Текущий канал без непрочитанного нужен только как точка отсчёта
  const next = step(unread, current, dir, true);
  return next && activeChannelId(next) !== current ? next : null;
}
