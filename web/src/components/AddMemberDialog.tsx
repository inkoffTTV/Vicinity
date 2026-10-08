import { useEffect, useState } from 'react';
import { api, ApiError, UserSummary } from '../lib/api';
import { useChannelMembers } from '../lib/channelMembers';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

// ── Добавить участника в беседу/сервер ──

type AddTarget = { kind: 'group'; channelId: number } | { kind: 'server'; serverId: number };

export function AddMemberDialog({ target, onClose }: { target: AddTarget; onClose: () => void }) {
  const friends = useStore((s) => s.friends);
  const refreshServer = useStore((s) => s.refreshServer);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setResults(null);
    // Ответ на устаревший запрос (пользователь уже печатает дальше) не должен перетереть свежий
    let current = true;
    const t = window.setTimeout(() => {
      api.searchUsers(query).then(
        (r) => current && setResults(r),
        () => current && setResults([]),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const add = async (u: UserSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      if (target.kind === 'group') {
        await api.addGroupMember(target.channelId, u.id);
        void useChannelMembers.getState().load(target.channelId);
      } else {
        await api.addServerMember(target.serverId, u.id);
        void refreshServer(target.serverId);
      }
      toast(`${u.display_name} добавлен(а)`);
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
      setBusy(false);
    }
  };

  const list = results ?? friends;
  return (
    <Modal title="Добавить участника" onClose={onClose}>
      <input autoFocus placeholder="Поиск по логину или имени" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="user-list">
        {results === null && <div className="muted small">Друзья</div>}
        {list.length === 0 && <div className="muted">Никого не найдено</div>}
        {list.map((u) => (
          <div key={u.id} className="user-row">
            <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
            <div className="grow">
              <div>{u.display_name}</div>
              <div className="muted small">@{u.username}</div>
            </div>
            <button className="btn small primary" onClick={() => add(u)} disabled={busy}>
              Добавить
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
