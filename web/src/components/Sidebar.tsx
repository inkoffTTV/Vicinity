import { FormEvent, useState } from 'react';
import { api, ApiError, Presence } from '../lib/api';
import { useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Modal } from './Modal';
import { VoiceBar } from './VoiceBar';
import { VoiceUsers } from './VoiceRoom';

export function Sidebar() {
  const view = useStore((s) => s.view);
  return (
    <aside className="sidebar">
      {view.kind === 'server' ? <ServerSide serverId={view.serverId} /> : <HomeSide />}
      <VoiceBar />
      <UserPanel />
    </aside>
  );
}

function HomeSide() {
  const view = useStore((s) => s.view);
  const dms = useStore((s) => s.dms);
  const groups = useStore((s) => s.groups);
  const unread = useStore((s) => s.unread);
  const presence = useStore((s) => s.presence);
  const incoming = useStore((s) => s.incoming);
  const open = useStore((s) => s.open);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="side-head">
        <strong>Личные сообщения</strong>
      </div>
      <div className="side-scroll">
        <button
          className={`side-item${view.kind === 'friends' ? ' active' : ''}`}
          onClick={() => open({ kind: 'friends' })}
        >
          <span className="side-icon">👥</span>
          <span className="grow">Друзья</span>
          {incoming.length > 0 && <span className="badge inline">{incoming.length}</span>}
        </button>

        <div className="side-section">Личные сообщения</div>
        {dms.length === 0 && <div className="side-empty">Найдите друга и напишите ему</div>}
        {dms.map((d) => (
          <div key={d.channel_id}>
            <button
              className={`side-item${view.kind === 'dm' && view.channelId === d.channel_id ? ' active' : ''}`}
              onClick={() => open({ kind: 'dm', channelId: d.channel_id })}
            >
              <Avatar name={d.display_name} src={d.avatar_path} id={d.user_id} size={32} presence={presence[d.user_id] ?? 'offline'} />
              <span className="grow ellipsis">{d.display_name}</span>
              {unread[d.channel_id] > 0 && <span className="badge inline">{unread[d.channel_id]}</span>}
            </button>
            <VoiceUsers channelId={d.channel_id} />
          </div>
        ))}

        <div className="side-section">
          Беседы
          <button className="icon-btn small" title="Создать беседу" aria-label="Создать беседу" onClick={() => setCreating(true)}>
            +
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.id}>
            <button
              className={`side-item${view.kind === 'group' && view.channelId === g.id ? ' active' : ''}`}
              onClick={() => open({ kind: 'group', channelId: g.id })}
            >
              <span className="side-icon">#</span>
              <span className="grow ellipsis">{g.name}</span>
              {unread[g.id] > 0 && <span className="badge inline">{unread[g.id]}</span>}
            </button>
            <VoiceUsers channelId={g.id} />
          </div>
        ))}
      </div>
      {creating && <CreateGroupDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const refreshDms = useStore((s) => s.refreshDms);
  const open = useStore((s) => s.open);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const r = await api.createGroup(name.trim());
      await refreshDms();
      open({ kind: 'group', channelId: r.channel_id });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка');
      setBusy(false);
    }
  };
  return (
    <Modal title="Новая беседа" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          Название
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary" disabled={busy || !name.trim()}>
          Создать
        </button>
      </form>
    </Modal>
  );
}

function ServerSide({ serverId }: { serverId: number }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const channels = useStore((s) => s.channelsByServer[serverId] ?? []);
  const view = useStore((s) => s.view);
  const unread = useStore((s) => s.unread);
  const open = useStore((s) => s.open);
  const toast = useStore((s) => s.toast);
  const myVoice = useVoice((s) => s.channelId);
  const joinVoice = useVoice((s) => s.join);
  const [adding, setAdding] = useState<null | 'text' | 'voice'>(null);
  const [menu, setMenu] = useState(false);

  if (!server) return <div className="side-scroll" />;
  const text = channels.filter((c) => !c.is_voice);
  const voiceChs = channels.filter((c) => c.is_voice);
  const activeCh = view.kind === 'server' ? view.channelId : null;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(server.invite_code);
      toast(`Код приглашения ${server.invite_code} скопирован`);
    } catch {
      toast(`Код приглашения: ${server.invite_code}`);
    }
    setMenu(false);
  };

  return (
    <>
      <button className="side-head clickable" onClick={() => setMenu((v) => !v)} aria-haspopup="true" aria-expanded={menu}>
        <strong className="ellipsis">{server.name}</strong>
        <span>{menu ? '✕' : '▾'}</span>
      </button>
      {menu && (
        <div className="dropdown">
          {server.invite_code && <button onClick={copyInvite}>🔗 Пригласить (код {server.invite_code})</button>}
          <button onClick={() => (setAdding('text'), setMenu(false))}># Создать текстовый канал</button>
          <button onClick={() => (setAdding('voice'), setMenu(false))}>🔊 Создать голосовой канал</button>
        </div>
      )}
      <div className="side-scroll">
        <div className="side-section">Текстовые каналы</div>
        {text.map((c) => (
          <button
            key={c.id}
            className={`side-item channel${activeCh === c.id ? ' active' : ''}${unread[c.id] ? ' unread' : ''}`}
            onClick={() => open({ kind: 'server', serverId, channelId: c.id })}
          >
            <span className="side-icon">#</span>
            <span className="grow ellipsis">{c.name}</span>
            {unread[c.id] > 0 && <span className="badge inline">{unread[c.id]}</span>}
          </button>
        ))}
        {voiceChs.length > 0 && <div className="side-section">Голосовые каналы</div>}
        {voiceChs.map((c) => (
          <div key={c.id}>
            <button
              className={`side-item channel voice${myVoice === c.id ? ' active' : ''}`}
              title={myVoice === c.id ? 'Вы в этом канале' : 'Подключиться к голосовому каналу'}
              onClick={() => void joinVoice(c.id)}
            >
              <span className="side-icon">🔊</span>
              <span className="grow ellipsis">{c.name}</span>
            </button>
            <VoiceUsers channelId={c.id} />
          </div>
        ))}
      </div>
      {adding && <AddChannelDialog serverId={serverId} voice={adding === 'voice'} onClose={() => setAdding(null)} />}
    </>
  );
}

function AddChannelDialog({ serverId, voice, onClose }: { serverId: number; voice: boolean; onClose: () => void }) {
  const refreshServer = useStore((s) => s.refreshServer);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await api.createServerChannel(serverId, name.trim(), voice);
      await refreshServer(serverId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка');
      setBusy(false);
    }
  };
  return (
    <Modal title={voice ? 'Новый голосовой канал' : 'Новый текстовый канал'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          Название
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary" disabled={busy || !name.trim()}>
          Создать
        </button>
      </form>
    </Modal>
  );
}

function UserPanel() {
  const me = useStore((s) => s.me)!;
  const connected = useStore((s) => s.connected);
  const setPresence = useStore((s) => s.setPresence);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const showProfile = useStore((s) => s.showProfile);
  const [menu, setMenu] = useState(false);
  const statuses: Presence[] = ['online', 'idle', 'dnd', 'invisible'];

  return (
    <div className="user-panel">
      {menu && (
        <div className="dropdown up">
          {statuses.map((p) => (
            <button
              key={p}
              onClick={() => {
                setPresence(p);
                setMenu(false);
              }}
            >
              <span className={`presence-dot static p-${p}`} /> {PRESENCE_LABEL[p]}
            </button>
          ))}
          <button onClick={() => (showProfile(me.user_id), setMenu(false))}>👤 Мой профиль</button>
        </div>
      )}
      <button className="user-panel-me" onClick={() => setMenu((v) => !v)} title="Статус" aria-haspopup="true" aria-expanded={menu}>
        <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={34} presence={connected ? me.presence : 'offline'} />
        <span className="user-panel-names">
          <span className="ellipsis">{me.display_name}</span>
          <span className="muted small ellipsis">{connected ? PRESENCE_LABEL[me.presence] ?? '' : 'Подключение…'}</span>
        </span>
      </button>
      <button className="icon-btn" title="Настройки" aria-label="Настройки" onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
    </div>
  );
}
