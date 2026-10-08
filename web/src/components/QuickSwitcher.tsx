import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNotifySettings } from '../lib/notify';
import { sortRecent } from '../lib/recent';
import { useStore, View } from '../lib/store';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

interface Item {
  key: string;
  label: string;
  /** Где это: сервер, @логин, «беседа» */
  hint: string;
  icon: ReactNode;
  unread: number;
  go: () => void;
}

const LIMIT = 40;

/** Нечёткое совпадение: подстрока лучше разбросанных букв, начало слова лучше середины. -1 — нет совпадения */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at === 0) return 1000 - t.length;
  if (at > 0) return (/[\s#@._-]/.test(t[at - 1]) ? 800 : 600) - at - t.length / 10;
  // Буквы по порядку, но не подряд: чем плотнее, тем лучше
  let score = 300;
  let from = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return -1;
    score -= i - from;
    from = i + 1;
  }
  return score;
}

/** Ctrl+K: быстрый переход к личке, беседе, каналу сервера или другу */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const s = useStore(
    useShallow((st) => ({
      dms: st.dms,
      groups: st.groups,
      servers: st.servers,
      channelsByServer: st.channelsByServer,
      friends: st.friends,
      unread: st.unread,
      open: st.open,
      openDmWith: st.openDmWith,
    })),
  );
  const muted = useNotifySettings((n) => n.muted);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const go = (v: View) => () => s.open(v);
    const count = (ch: number) => (muted.includes(ch) ? 0 : s.unread[ch] ?? 0);
    const list: Item[] = [];
    for (const d of sortRecent(s.dms))
      list.push({
        key: `dm${d.channel_id}`,
        label: d.display_name,
        hint: `@${d.username}`,
        icon: <Avatar name={d.display_name} src={d.avatar_path} id={d.user_id} size={22} />,
        unread: count(d.channel_id),
        go: go({ kind: 'dm', channelId: d.channel_id }),
      });
    for (const g of sortRecent(s.groups))
      list.push({ key: `g${g.id}`, label: g.name, hint: 'Беседа', icon: '👥', unread: count(g.id), go: go({ kind: 'group', channelId: g.id }) });
    for (const srv of s.servers)
      for (const c of s.channelsByServer[srv.id] ?? [])
        if (!c.is_voice)
          list.push({
            key: `c${c.id}`,
            label: c.name,
            hint: srv.name,
            icon: '#',
            unread: count(c.id),
            go: go({ kind: 'server', serverId: srv.id, channelId: c.id }),
          });
    // Друзья, с которыми ещё нет лички, — откроется новая
    for (const f of s.friends)
      if (!s.dms.some((d) => d.user_id === f.id))
        list.push({
          key: `f${f.id}`,
          label: f.display_name,
          hint: `@${f.username} · друг`,
          icon: <Avatar name={f.display_name} src={f.avatar_path} id={f.id} size={22} />,
          unread: 0,
          go: () => void s.openDmWith(f.id),
        });
    return list;
  }, [s, muted]);

  const shown = useMemo(() => {
    const q = query.trim().replace(/^[#@]/, '');
    if (!q) return [...items.filter((i) => i.unread > 0), ...items.filter((i) => !i.unread)].slice(0, LIMIT);
    return items
      .map((item) => ({ item, score: Math.max(fuzzyScore(q, item.label), fuzzyScore(q, item.hint) - 200) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || b.item.unread - a.item.unread)
      .slice(0, LIMIT)
      .map((x) => x.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.go();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + d + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(shown[active]);
    }
  };

  return (
    <Modal onClose={onClose} className="switcher" label="Быстрый переход">
      <input
        className="switcher-input"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="switcher-list"
        aria-activedescendant={shown[active] ? `switcher-${shown[active].key}` : undefined}
        aria-label="Куда перейти"
        placeholder="Куда перейти? Личка, беседа, канал или друг"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <ul className="switcher-list" id="switcher-list" role="listbox" ref={listRef}>
        {shown.map((item, i) => (
          <li
            key={item.key}
            id={`switcher-${item.key}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            className={`switcher-item${i === active ? ' active' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(item)}
          >
            <span className="switcher-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="ellipsis switcher-label">{item.label}</span>
            <span className="muted small ellipsis switcher-hint">{item.hint}</span>
            {item.unread > 0 && <span className="badge inline">{item.unread}</span>}
          </li>
        ))}
        {shown.length === 0 && <li className="switcher-empty muted">Ничего не найдено</li>}
      </ul>
      <div className="switcher-help muted small">
        <kbd>↑</kbd> <kbd>↓</kbd> выбрать · <kbd>Enter</kbd> открыть · <kbd>Esc</kbd> закрыть · <kbd>Alt</kbd>+<kbd>↑↓</kbd> соседний канал
      </div>
    </Modal>
  );
}
