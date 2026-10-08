import { useEffect, useState } from 'react';
import { api, ApiError, UserSummary } from '../lib/api';
import { useStore } from '../lib/store';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { SearchBox } from './Search';

type Tab = 'online' | 'all' | 'pending' | 'add';

export function Friends({ onMenu }: { onMenu: () => void }) {
  const friends = useStore((s) => s.friends);
  const incoming = useStore((s) => s.incoming);
  const outgoing = useStore((s) => s.outgoing);
  const presence = useStore((s) => s.presence);
  const refreshFriends = useStore((s) => s.refreshFriends);
  const openDmWith = useStore((s) => s.openDmWith);
  const showProfile = useStore((s) => s.showProfile);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>('online');

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      await refreshFriends();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  };

  const online = friends.filter((f) => {
    const p = presence[f.id] ?? f.presence;
    return p && p !== 'offline' && p !== 'invisible';
  });
  const list = tab === 'online' ? online : friends;

  const row = (u: UserSummary, actions: JSX.Element) => {
    const p = presence[u.id] ?? u.presence ?? 'offline';
    return (
      <div key={u.id} className="friend-row">
        <button className="plain friend-main" onClick={() => showProfile(u.id)}>
          <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={36} presence={p} />
          <span className="friend-names">
            <strong className="ellipsis">{u.display_name}</strong>
            <span className="muted small">
              @{u.username} · {PRESENCE_LABEL[p] ?? ''}
            </span>
          </span>
        </button>
        <div className="friend-actions">{actions}</div>
      </div>
    );
  };

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню">
          ☰
        </button>
        <strong>👥 Друзья</strong>
        <div className="tabs">
          <button className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}>
            В сети
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            Все
          </button>
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>
            Заявки{incoming.length > 0 && <span className="badge inline">{incoming.length}</span>}
          </button>
          <button className={`add${tab === 'add' ? ' on' : ''}`} onClick={() => setTab('add')}>
            Добавить в друзья
          </button>
        </div>
        <div className="grow" />
        <SearchBox />
      </header>
      <div className="friends-body">
        {(tab === 'online' || tab === 'all') && (
          <>
            <div className="side-section">
              {tab === 'online' ? 'В сети' : 'Все друзья'} — {list.length}
            </div>
            {list.length === 0 && (
              <div className="empty-state">
                {friends.length === 0 ? 'У вас пока нет друзей. Найдите кого-нибудь во вкладке «Добавить в друзья».' : 'Никого нет в сети'}
              </div>
            )}
            {list.map((f) =>
              row(
                f,
                <>
                  <button className="icon-btn" title="Написать" aria-label="Написать" onClick={() => openDmWith(f.id)}>
                    💬
                  </button>
                  <button
                    className="icon-btn"
                    title="Удалить из друзей"
                    aria-label="Удалить из друзей"
                    onClick={() => confirm(`Удалить ${f.display_name} из друзей?`) && act(() => api.friendRemove(f.id))}
                  >
                    ✕
                  </button>
                </>,
              ),
            )}
          </>
        )}
        {tab === 'pending' && (
          <>
            <div className="side-section">Входящие — {incoming.length}</div>
            {incoming.map((u) =>
              row(
                u,
                <>
                  <button className="btn small primary" onClick={() => act(() => api.friendRespond(u.id, true), 'Заявка принята')}>
                    Принять
                  </button>
                  <button className="btn small" onClick={() => act(() => api.friendRespond(u.id, false))}>
                    Отклонить
                  </button>
                </>,
              ),
            )}
            <div className="side-section">Исходящие — {outgoing.length}</div>
            {outgoing.map((u) =>
              row(
                u,
                <button className="btn small" onClick={() => act(() => api.friendRemove(u.id))}>
                  Отменить
                </button>,
              ),
            )}
          </>
        )}
        {tab === 'add' && <AddFriend onAdd={(u) => act(() => api.friendRequest(u.id), `Заявка отправлена: ${u.display_name}`)} />}
      </div>
    </div>
  );
}

function AddFriend({ onAdd }: { onAdd: (u: UserSummary) => void }) {
  const openDmWith = useStore((s) => s.openDmWith);
  const friends = useStore((s) => s.friends);
  const outgoing = useStore((s) => s.outgoing);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setSearched(false);
      return;
    }
    // Ответ на устаревший запрос (пользователь уже печатает дальше) не должен перетереть свежий
    let current = true;
    const t = window.setTimeout(() => {
      api.searchUsers(query).then(
        (r) => current && (setResults(r), setSearched(true)),
        () => current && (setResults([]), setSearched(true)),
      );
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="add-friend">
      <p className="muted">Найдите человека по логину или имени.</p>
      <input autoFocus placeholder="Например, @username" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="user-list">
        {searched && results.length === 0 && <div className="muted">Никого не найдено</div>}
        {results.map((u) => {
          const isFriend = friends.some((f) => f.id === u.id);
          const sent = outgoing.some((f) => f.id === u.id);
          return (
            <div key={u.id} className="user-row">
              <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
              <div className="grow">
                <div>{u.display_name}</div>
                <div className="muted small">@{u.username}</div>
              </div>
              <button className="btn small" onClick={() => openDmWith(u.id)}>
                Написать
              </button>
              {!isFriend && (
                <button className="btn small primary" disabled={sent} onClick={() => onAdd(u)}>
                  {sent ? 'Отправлено' : 'В друзья'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
