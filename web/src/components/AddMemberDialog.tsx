import { useEffect, useState } from 'react';
import { api, ApiError, UserSummary } from '../lib/api';
import { useChannelMembers } from '../lib/channelMembers';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

// ── Пригласить в беседу/на сервер: человек сам принимает или отклоняет приглашение ──

type AddTarget = { kind: 'group'; channelId: number } | { kind: 'server'; serverId: number };

export function AddMemberDialog({ target, onClose }: { target: AddTarget; onClose: () => void }) {
  const friends = useStore((s) => s.friends);
  const refreshServer = useStore((s) => s.refreshServer);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  // Точное совпадение ника с сервера (не друг) — поиск по части ника отключён
  const [exact, setExact] = useState<UserSummary | null>(null);
  const [busy, setBusy] = useState(false);
  // Кому уже отправлено в этом окне — можно пригласить нескольких подряд
  const [sent, setSent] = useState<Record<number, string>>({});

  useEffect(() => {
    const query = q.trim().replace(/^@/, '');
    setExact(null);
    if (query.length < 2) return;
    // Ответ на устаревший запрос (пользователь уже печатает дальше) не должен перетереть свежий
    let current = true;
    const t = window.setTimeout(() => {
      api.searchUsers(query).then(
        (r) => current && setExact(r[0] ?? null),
        () => {},
      );
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const add = async (u: UserSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      const r =
        target.kind === 'group'
          ? await api.addGroupMember(target.channelId, u.id)
          : await api.addServerMember(target.serverId, u.id);
      // Сервер старой версии добавляет сразу — обновим состав
      if (r.status === 'added') {
        if (target.kind === 'group') void useChannelMembers.getState().load(target.channelId);
        else void refreshServer(target.serverId);
      }
      const label = r.status === 'added' ? 'Добавлен(а)' : r.status === 'already_invited' ? 'Уже приглашён(а)' : 'Отправлено';
      setSent((m) => ({ ...m, [u.id]: label }));
      toast(
        r.status === 'added'
          ? `${u.display_name} добавлен(а)`
          : r.status === 'already_invited'
            ? `${u.display_name} уже приглашён(а) — ждём ответа`
            : `Приглашение отправлено: ${u.display_name}`,
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
    setBusy(false);
  };

  // Друзей ищем у себя по нику и имени; остальных — только по полному нику
  const needle = q.trim().replace(/^@/, '').toLowerCase();
  const mine = needle ? friends.filter((f) => f.username.toLowerCase().includes(needle) || f.display_name.toLowerCase().includes(needle)) : friends;
  const list = exact && !mine.some((f) => f.id === exact.id) ? [...mine, exact] : mine;
  return (
    <Modal title={target.kind === 'group' ? 'Пригласить в беседу' : 'Пригласить на сервер'} onClose={onClose}>
      <p className="muted small no-margin">Человек получит приглашение и сам решит, принять его или нет.</p>
      <input autoFocus placeholder="Друг или полный ник" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="user-list">
        {!needle && <div className="muted small">Друзья</div>}
        {list.length === 0 && <div className="muted">{needle ? 'Среди друзей нет. Другого человека найдёт только полный ник.' : 'Пока нет друзей'}</div>}
        {list.map((u) => (
          <div key={u.id} className="user-row">
            <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
            <div className="grow">
              <div>{u.display_name}</div>
              <div className="muted small">@{u.username}</div>
            </div>
            {sent[u.id] ? (
              <span className="muted small">{sent[u.id]}</span>
            ) : (
              <button className="btn small primary" onClick={() => add(u)} disabled={busy}>
                Пригласить
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
