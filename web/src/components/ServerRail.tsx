import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Modal } from './Modal';

export function ServerRail() {
  const servers = useStore((s) => s.servers);
  const view = useStore((s) => s.view);
  const open = useStore((s) => s.open);
  const unread = useStore((s) => s.unread);
  const channelsByServer = useStore((s) => s.channelsByServer);
  const dms = useStore((s) => s.dms);
  const groups = useStore((s) => s.groups);
  const [adding, setAdding] = useState(false);

  const homeUnread =
    dms.reduce((a, d) => a + (unread[d.channel_id] ?? 0), 0) +
    groups.reduce((a, g) => a + (unread[g.id] ?? 0), 0);
  const homeActive = view.kind !== 'server';

  return (
    <nav className="rail">
      <button
        className={`rail-item home${homeActive ? ' active' : ''}`}
        title="Личные сообщения"
        onClick={() => open({ kind: 'friends' })}
      >
        <img src="/favicon.svg" alt="" width={28} height={28} />
        {homeUnread > 0 && <span className="badge">{homeUnread}</span>}
      </button>
      <div className="rail-sep" />
      {servers.map((srv) => {
        const active = view.kind === 'server' && view.serverId === srv.id;
        const n = (channelsByServer[srv.id] ?? []).reduce((a, c) => a + (unread[c.id] ?? 0), 0);
        return (
          <button
            key={srv.id}
            className={`rail-item${active ? ' active' : ''}`}
            title={srv.name}
            onClick={() => open({ kind: 'server', serverId: srv.id, channelId: null })}
          >
            {srv.icon ? <img src={srv.icon} alt="" /> : <span>{initials(srv.name)}</span>}
            {n > 0 && <span className="badge">{n}</span>}
          </button>
        );
      })}
      <button className="rail-item add" title="Создать или вступить в сервер" onClick={() => setAdding(true)}>
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

  const go = async (fn: () => Promise<number>) => {
    setError('');
    try {
      const id = await fn();
      await refreshServers();
      open({ kind: 'server', serverId: id, channelId: null });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void go(async () => {
      const r = await api.createServer(name.trim());
      toast(`Сервер создан. Код приглашения: ${r.invite_code}`);
      return r.server_id;
    });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void go(async () => (await api.joinByCode(code)).server_id);
  };

  return (
    <Modal title="Сервер" onClose={onClose}>
      <form onSubmit={create} className="stack">
        <label>
          Создать новый сервер
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="Название" />
        </label>
        <button className="btn primary" disabled={!name.trim()}>
          Создать
        </button>
      </form>
      <div className="divider">или</div>
      <form onSubmit={join} className="stack">
        <label>
          Вступить по коду приглашения
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Например, AB3XK9" />
        </label>
        <button className="btn" disabled={!code.trim()}>
          Вступить
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
