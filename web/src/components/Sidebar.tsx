import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, ApiError, LastMessage, parseTs, Presence, ServerChannel } from '../lib/api';
import { useNotifySettings } from '../lib/notify';
import { previewText, sortRecent, useMinuteClock } from '../lib/recent';
import { useStore } from '../lib/store';
import { fullWhen, shortWhen } from '../lib/time';
import { useVoice } from '../lib/voice';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { NotifyMenu } from './NotifyMenu';
import { ServerSettings, ServerTab } from './ServerSettings';
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
  const muted = useNotifySettings((s) => s.muted);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useChannelMenu();
  const now = useMinuteClock();

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
        {sortRecent(dms).map((d) => (
          <div key={d.channel_id}>
            <button
              className={`side-item${d.last_message ? ' two-line' : ''}${view.kind === 'dm' && view.channelId === d.channel_id ? ' active' : ''}${itemState(d.channel_id, unread, muted)}`}
              onClick={() => open({ kind: 'dm', channelId: d.channel_id })}
              onContextMenu={(e) => setMenu(e, d.channel_id, null)}
            >
              <Avatar name={d.display_name} src={d.avatar_path} id={d.user_id} size={32} presence={presence[d.user_id] ?? 'offline'} />
              <ItemText name={d.display_name} last={d.last_message} group={false} now={now} />
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
        {sortRecent(groups).map((g) => (
          <div key={g.id}>
            <button
              className={`side-item${g.last_message ? ' two-line' : ''}${view.kind === 'group' && view.channelId === g.id ? ' active' : ''}${itemState(g.id, unread, muted)}`}
              onClick={() => open({ kind: 'group', channelId: g.id })}
              onContextMenu={(e) => setMenu(e, g.id, null)}
            >
              <span className="side-icon" aria-hidden="true">
                #
              </span>
              <ItemText name={g.name} last={g.last_message} group now={now} />
              {unread[g.id] > 0 && <span className="badge inline">{unread[g.id]}</span>}
            </button>
            <VoiceUsers channelId={g.id} />
          </div>
        ))}
      </div>
      {creating && <CreateGroupDialog onClose={() => setCreating(false)} />}
      {menu}
    </>
  );
}

// Имя лички/беседы, время и строка-превью последнего сообщения
function ItemText({ name, last, group, now }: { name: string; last?: LastMessage | null; group: boolean; now: Date }) {
  const meId = useStore((s) => s.me?.user_id);
  if (!last) return <span className="grow ellipsis side-name">{name}</span>;
  const when = parseTs(last.created_at);
  return (
    <span className="grow side-text">
      <span className="side-line">
        <span className="grow ellipsis side-name">{name}</span>
        <time className="side-time" dateTime={when.toISOString()} title={fullWhen(when)}>
          {shortWhen(when, now)}
        </time>
      </span>
      <span className="side-preview ellipsis">{previewText(last, meId, group)}</span>
    </span>
  );
}

// Непрочитанный канал — жирным, заглушённый — приглушённым
function itemState(channelId: number, unread: Record<number, number>, muted: number[]) {
  if (muted.includes(channelId)) return ' muted-ch';
  return unread[channelId] ? ' unread' : '';
}

// Контекстное меню канала (правая кнопка, Shift+F10): уведомления канала и сервера;
// extra — пункты над ними (действия владельца)
function useChannelMenu(extra?: (channelId: number, close: () => void) => ReactNode) {
  const [at, setAt] = useState<{ channelId: number; serverId: number | null; point: { x: number; y: number } } | null>(null);
  const show = (e: MouseEvent, channelId: number, serverId: number | null) => {
    e.preventDefault();
    setAt({ channelId, serverId, point: { x: e.clientX, y: e.clientY } });
  };
  const close = () => setAt(null);
  const menu = at && (
    <NotifyMenu channelId={at.channelId} serverId={at.serverId} point={at.point} onClose={close}>
      {extra?.(at.channelId, close)}
    </NotifyMenu>
  );
  return [menu, show] as const;
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
  const amOwner = useStore((s) => !!server && s.me?.user_id === server.owner_id);
  const view = useStore((s) => s.view);
  const unread = useStore((s) => s.unread);
  const mentions = useStore((s) => s.mentions);
  const open = useStore((s) => s.open);
  const leaveServer = useStore((s) => s.leaveServer);
  const toast = useStore((s) => s.toast);
  const muted = useNotifySettings((s) => s.muted);
  const [editing, setEditing] = useState<ServerChannel | null>(null);
  const [channelMenu, setChannelMenu] = useChannelMenu(
    amOwner
      ? (id, close) => (
          <button
            role="menuitem"
            onClick={() => {
              close();
              setEditing(channels.find((c) => c.id === id) ?? null);
            }}
          >
            ✏️ Изменить канал
          </button>
        )
      : undefined,
  );
  const myVoice = useVoice((s) => s.channelId);
  const joinVoice = useVoice((s) => s.join);
  const [adding, setAdding] = useState<null | 'text' | 'voice'>(null);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState<ServerTab | null>(null);
  const [leaving, setLeaving] = useState(false);
  const closeSettings = useCallback(() => setSettings(null), []);
  const closeEditing = useCallback(() => setEditing(null), []);

  if (!server) return <div className="side-scroll" />;
  const text = channels.filter((c) => !c.is_voice);
  const voiceChs = channels.filter((c) => c.is_voice);
  const activeCh = view.kind === 'server' ? view.channelId : null;

  const pick = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  // Владельцу — шестерёнка у канала (видна при наведении и фокусе)
  const gear = (c: ServerChannel) =>
    amOwner && (
      <button
        className="icon-btn small side-gear"
        title="Изменить канал"
        aria-label={`Изменить канал ${c.name}`}
        onClick={() => setEditing(c)}
      >
        ⚙
      </button>
    );

  return (
    <>
      <button className="side-head clickable" onClick={() => setMenu((v) => !v)} aria-haspopup="true" aria-expanded={menu}>
        <strong className="ellipsis">{server.name}</strong>
        <span>{menu ? '✕' : '▾'}</span>
      </button>
      {menu && (
        <div className="dropdown">
          {server.invite_code && <button onClick={pick(() => setSettings('invites'))}>🔗 Пригласить людей</button>}
          {amOwner && <button onClick={pick(() => setSettings('overview'))}>⚙ Настройки сервера</button>}
          <button onClick={pick(() => setAdding('text'))}># Создать текстовый канал</button>
          <button onClick={pick(() => setAdding('voice'))}>🔊 Создать голосовой канал</button>
          {!amOwner && (
            <button className="danger-item" onClick={pick(() => setLeaving(true))}>
              🚪 Покинуть сервер
            </button>
          )}
        </div>
      )}
      <div className="side-scroll">
        <div className="side-section">Текстовые каналы</div>
        {text.map((c) => (
          <div key={c.id} className="side-row">
            <button
              className={`side-item channel${activeCh === c.id ? ' active' : ''}${itemState(c.id, unread, muted)}`}
              onClick={() => open({ kind: 'server', serverId, channelId: c.id })}
              onContextMenu={(e) => setChannelMenu(e, c.id, serverId)}
            >
              <span className="side-icon">#</span>
              <span className="grow ellipsis">{c.name}</span>
              {mentions[c.id] > 0 && (
                <span className="badge inline mention" title={`Упоминаний: ${mentions[c.id]}`}>
                  @{mentions[c.id]}
                </span>
              )}
            </button>
            {gear(c)}
          </div>
        ))}
        {voiceChs.length > 0 && <div className="side-section">Голосовые каналы</div>}
        {voiceChs.map((c) => (
          <div key={c.id}>
            <div className="side-row">
              <button
                className={`side-item channel voice${myVoice === c.id ? ' active' : ''}`}
                title={myVoice === c.id ? 'Вы в этом канале' : 'Подключиться к голосовому каналу'}
                onClick={() => void joinVoice(c.id)}
              >
                <span className="side-icon">🔊</span>
                <span className="grow ellipsis">{c.name}</span>
              </button>
              {gear(c)}
            </div>
            <VoiceUsers channelId={c.id} />
          </div>
        ))}
      </div>
      {adding && <AddChannelDialog serverId={serverId} voice={adding === 'voice'} onClose={() => setAdding(null)} />}
      {editing && <ChannelSettings channel={editing} onClose={closeEditing} />}
      {settings && <ServerSettings serverId={serverId} tab={settings} onClose={closeSettings} />}
      {leaving && (
        <ConfirmDialog
          title="Покинуть сервер"
          action="Покинуть"
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            const name = server.name;
            if (await leaveServer(serverId)) toast(`Вы покинули сервер «${name}»`);
            setLeaving(false);
          }}
        >
          Покинуть сервер «{server.name}»? Вернуться можно по приглашению.
        </ConfirmDialog>
      )}
      {channelMenu}
    </>
  );
}

/** Переименование и удаление канала сервера (владелец) */
function ChannelSettings({ channel, onClose }: { channel: ServerChannel; onClose: () => void }) {
  const renameChannel = useStore((s) => s.renameChannel);
  const deleteChannel = useStore((s) => s.deleteChannel);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(channel.name);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const exists = useStore((s) => Object.values(s.channelsByServer).some((chs) => chs.some((c) => c.id === channel.id)));
  const label = channel.is_voice ? `🔊 ${channel.name}` : `#${channel.name}`;

  // Канал удалили (в другой вкладке или вместе с сервером) — окно больше ни к чему
  useEffect(() => {
    if (!exists) onClose();
  }, [exists, onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    if (name.trim() === channel.name) return onClose();
    setBusy(true);
    if (await renameChannel(channel.id, name.trim())) {
      toast('Канал переименован');
      onClose();
    } else setBusy(false);
  };

  return (
    <Modal title={`Канал ${label}`} onClose={onClose}>
      <form onSubmit={save} className="stack">
        <label>
          Название канала
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <div className="row end">
          <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
            Удалить канал
          </button>
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Сохранить
          </button>
        </div>
      </form>
      {confirming && (
        <ConfirmDialog
          title="Удалить канал"
          action="Удалить"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            if (await deleteChannel(channel.id)) {
              toast(`Канал ${label} удалён`);
              onClose();
            }
          }}
        >
          Канал {label} будет удалён вместе со всеми сообщениями и закрепами. Это нельзя отменить.
        </ConfirmDialog>
      )}
    </Modal>
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
