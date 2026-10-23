import { Check, MessagesSquare, X } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { ServerIcon } from './ServerRail';

/** Приглашения в беседы и на серверы, ждущие ответа: принять или отклонить (docs/API.md §7.1) */
export function InviteList() {
  const invites = useStore((s) => s.invites);
  const answer = useStore((s) => s.answerInvite);
  const [busy, setBusy] = useState<number | null>(null);
  if (invites.length === 0) return null;

  const act = async (id: number, accept: boolean) => {
    if (busy !== null) return;
    setBusy(id);
    await answer(id, accept);
    setBusy(null);
  };

  return (
    <section className="invite-list" aria-label="Приглашения">
      <div className="side-section">
        Приглашения
        <span className="badge inline">{invites.length}</span>
      </div>
      {invites.map((inv) => (
        <div key={inv.id} className="invite-item">
          <div className="invite-item-head">
            {inv.kind === 'server' ? (
              <span className="invite-item-icon server">
                <ServerIcon name={inv.name} icon={inv.icon} />
              </span>
            ) : (
              <span className="invite-item-icon" aria-hidden="true">
                <Icon icon={MessagesSquare} />
              </span>
            )}
            <div className="grow invite-item-text">
              <div className="ellipsis invite-item-name" title={inv.name}>
                {inv.name}
              </div>
              <div className="muted small ellipsis">
                {inv.kind === 'group' ? 'Беседа' : 'Сервер'} · {inv.members} уч. · от {inv.inviter.display_name}
              </div>
            </div>
          </div>
          <div className="invite-item-actions">
            <button className="btn small primary" disabled={busy !== null} onClick={() => void act(inv.id, true)}>
              <Icon icon={Check} size={16} anim="pop" />
              Принять
            </button>
            <button className="btn small" disabled={busy !== null} onClick={() => void act(inv.id, false)}>
              <Icon icon={X} size={16} />
              Отклонить
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
