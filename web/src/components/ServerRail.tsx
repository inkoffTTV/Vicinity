import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useNotifySettings } from '../lib/notify';
import { useStore } from '../lib/store';
import { homeUnread, serverHasUnread, serverMentions, useUnreadSlice } from '../lib/unread';
import { Modal } from './Modal';

export function ServerRail() {
  const servers = useStore((s) => s.servers);
  const view = useStore((s) => s.view);
  const open = useStore((s) => s.open);
  const state = useUnreadSlice();
  const muted = useNotifySettings((s) => s.muted);
  const [adding, setAdding] = useState(false);

  const home = homeUnread(state);
  const homeActive = view.kind !== 'server';

  return (
    <nav className="rail">
      <button
        className={`rail-item home${homeActive ? ' active' : ''}`}
        title="Личные сообщения"
        aria-label="Личные сообщения"
        onClick={() => open({ kind: 'friends' })}
      >
        <img src="/favicon.svg" alt="" width={28} height={28} />
        {home > 0 && <span className="badge">{home}</span>}
      </button>
      <div className="rail-sep" />
      {servers.map((srv) => {
        const active = view.kind === 'server' && view.serverId === srv.id;
        // Красный бейдж — упоминания меня, полоска слева — непрочитанные каналы
        const n = serverMentions(state, srv.id);
        const unread = serverHasUnread(state, srv.id, muted);
        return (
          <button
            key={srv.id}
            className={`rail-item${active ? ' active' : ''}${unread ? ' has-unread' : ''}`}
            title={srv.name}
            aria-label={n > 0 ? `${srv.name}, упоминаний: ${n}` : unread ? `${srv.name}, есть непрочитанные` : srv.name}
            aria-current={active ? 'page' : undefined}
            onClick={() => open({ kind: 'server', serverId: srv.id, channelId: null })}
          >
            {srv.icon ? <img src={srv.icon} alt="" /> : <span>{initials(srv.name)}</span>}
            {n > 0 && <span className="badge">{n}</span>}
          </button>
        );
      })}
      <button
        className="rail-item add"
        title="Создать или вступить в сервер"
        aria-label="Создать или вступить в сервер"
        onClick={() => setAdding(true)}
      >
        +
      </button>
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </nav>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function AddServerDialog({ onClose }: { onClose: () => void }) {
  const refreshServers = useStore((s) => s.refreshServers);
  const open = useStore((s) => s.open);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (fn: () => Promise<number>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const id = await fn();
      await refreshServers();
      open({ kind: 'server', serverId: id, channelId: null });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void go(async () => {
      const r = await api.createServer(name.trim());
      toast(`Сервер создан. Код приглашения: ${r.invite_code}`);
      return r.server_id;
    });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    void go(async () => (await api.joinByCode(code.trim())).server_id);
  };

  return (
    <Modal title="Сервер" onClose={onClose}>
      <form onSubmit={create} className="stack">
        <label>
          Создать новый сервер
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="Название" />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>
          Создать
        </button>
      </form>
      <div className="divider">или</div>
      <form onSubmit={join} className="stack">
        <label>
          Вступить по коду приглашения
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Например, AB3XK9" />
        </label>
        <button className="btn" disabled={busy || !code.trim()}>
          Вступить
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
