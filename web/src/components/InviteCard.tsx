import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useInvite } from '../lib/router';
import { useStore } from '../lib/store';
import { Modal } from './Modal';
import { ServerIcon } from './ServerRail';

/** Приглашение по ссылке /invite/<код>: вступить на сервер или открыть его, если уже там */
export function InviteCard({ code }: { code: string }) {
  const dismiss = useInvite((s) => s.dismiss);
  const joined = useStore((s) => s.servers.find((x) => x.invite_code === code));
  const refreshServers = useStore((s) => s.refreshServers);
  const open = useStore((s) => s.open);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.joinByCode(code);
      await refreshServers();
      open({ kind: 'server', serverId: r.server_id, channelId: null });
      toast(`Вы вступили на сервер «${r.name}»`);
      dismiss();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? 'Приглашение недействительно: код сменили или сервер удалён'
          : e instanceof ApiError
            ? e.message
            : 'Ошибка',
      );
      setBusy(false);
    }
  };

  return (
    <Modal onClose={dismiss} bare>
      <div className="invite-card" role="group" aria-label="Приглашение на сервер">
        {joined ? (
          <>
            <span className="invite-card-icon">
              <ServerIcon name={joined.name} icon={joined.icon} />
            </span>
            <div className="muted small">Вы уже участник сервера</div>
            <h2>{joined.name}</h2>
            <div className="invite-card-actions">
              <button className="btn" onClick={dismiss}>
                Закрыть
              </button>
              <button
                className="btn primary"
                autoFocus
                onClick={() => {
                  open({ kind: 'server', serverId: joined.id, channelId: null });
                  dismiss();
                }}
              >
                Открыть сервер
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="invite-card-icon" aria-hidden="true">
              ✉️
            </span>
            <div className="muted small">Вас пригласили на сервер</div>
            <h2>Приглашение {code}</h2>
            <p className="muted small no-margin">Название сервера откроется после вступления.</p>
            {error && <div className="form-error">{error}</div>}
            <div className="invite-card-actions">
              <button className="btn" onClick={dismiss}>
                Не сейчас
              </button>
              <button className="btn primary" autoFocus disabled={busy} onClick={accept}>
                Принять приглашение
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
