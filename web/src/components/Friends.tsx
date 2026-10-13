import { Menu, MessageCircle, UserMinus, Users } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, ApiError, UserSummary } from '../lib/api';
import { useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Icon } from './Icon';
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
        <button className="plain friend-main" onClick={() => showProfile(u.id)} {...userMenuProps(u.id)}>
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
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню" title="Меню">
          <Icon icon={Menu} size={22} />
        </button>
        <strong className="chat-title">
          <Icon icon={Users} size={20} className="chat-title-icon" />
          Друзья
        </strong>
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
                    <Icon icon={MessageCircle} anim="wiggle" />
                  </button>
                  <button
                    className="icon-btn"
                    title="Удалить из друзей"
                    aria-label="Удалить из друзей"
                    onClick={() => confirm(`Удалить ${f.display_name} из друзей?`) && act(() => api.friendRemove(f.id))}
                  >
                    <Icon icon={UserMinus} anim="wiggle" />
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
        {tab === 'add' && <AddFriend />}
      </div>
    </div>
  );
}

/** Добавить в друзья — как в Discord: только по полному нику, без подсказок и списков людей */
function AddFriend() {
  const refreshFriends = useStore((s) => s.refreshFriends);
  const friends = useStore((s) => s.friends);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nick = q.trim().replace(/^@/, '');
    if (!nick || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const [u] = await api.searchUsers(nick);
      if (!u) {
        setResult({ ok: false, text: `Пользователь «${nick}» не найден. Проверьте ник — его нужно ввести полностью, как в профиле.` });
      } else if (friends.some((f) => f.id === u.id)) {
        setResult({ ok: true, text: `${u.display_name} уже у вас в друзьях` });
      } else {
        await api.friendRequest(u.id);
        await refreshFriends();
        setResult({ ok: true, text: `Заявка отправлена: ${u.display_name} (@${u.username})` });
        setQ('');
      }
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Не удалось отправить заявку' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-friend" onSubmit={submit}>
      <p className="muted">Введите ник человека полностью — например, inkoff. Найти кого-то по части ника или по имени нельзя: так никто не увидит ваш аккаунт случайно.</p>
      <div className={`add-friend-row${result ? (result.ok ? ' ok' : ' bad') : ''}`}>
        <input
          autoFocus
          placeholder="Полный ник"
          value={q}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setResult(null);
          }}
        />
        <button className="btn primary" disabled={busy || !q.trim().replace(/^@/, '')}>
          Отправить заявку
        </button>
      </div>
      {result && (
        <div className={`add-friend-result small${result.ok ? ' ok' : ' bad'}`} role="status">
          {result.text}
        </div>
      )}
    </form>
  );
}
