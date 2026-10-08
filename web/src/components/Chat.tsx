import { useEffect, useRef, useState } from 'react';
import { api, ApiError, UserSummary } from '../lib/api';
import { useCall } from '../lib/call';
import { useChannelMembers } from '../lib/channelMembers';
import { useNotifySettings } from '../lib/notify';
import { activeChannelId, useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { Modal } from './Modal';
import { NotifyMenu } from './NotifyMenu';
import { PinsPanel } from './PinsPanel';
import { SearchBox } from './Search';
import { VoiceRoom } from './VoiceRoom';

interface Props {
  onMenu: () => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
}

export function Chat({ onMenu, membersOpen, onToggleMembers }: Props) {
  const view = useStore((s) => s.view);
  const channelId = activeChannelId(view);
  const dm = useStore((s) => (view.kind === 'dm' ? s.dms.find((d) => d.channel_id === view.channelId) : undefined));
  const group = useStore((s) => (view.kind === 'group' ? s.groups.find((g) => g.id === view.channelId) : undefined));
  const serverChannel = useStore((s) =>
    view.kind === 'server' ? (s.channelsByServer[view.serverId] ?? []).find((c) => c.id === view.channelId) : undefined,
  );
  const presence = useStore((s) => (dm ? s.presence[dm.user_id] : undefined));
  const showProfile = useStore((s) => s.showProfile);
  const callIdle = useCall((s) => s.phase === 'idle');
  const startCall = useCall((s) => s.start);
  const inGroupRoom = useVoice((s) => group !== undefined && s.channelId === group.id);
  const joinVoice = useVoice((s) => s.join);
  const leaveVoice = useVoice((s) => s.leave);
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<'pins' | 'notify' | null>(null);
  const pinsBtn = useRef<HTMLButtonElement>(null);
  const notifyBtn = useRef<HTMLButtonElement>(null);
  const muted = useNotifySettings((s) => channelId !== null && s.muted.includes(channelId));
  const serverId = view.kind === 'server' ? view.serverId : null;

  // Участники беседы — для @упоминаний в ленте и подсказок в поле ввода
  useEffect(() => {
    if (group) void useChannelMembers.getState().load(group.id);
  }, [group?.id]);

  // Сменился канал — панели прежнего закрываются
  useEffect(() => setPanel(null), [channelId]);

  let title = '';
  let placeholder = '';
  if (dm) {
    title = dm.display_name;
    placeholder = `Написать @${dm.display_name}`;
  } else if (group) {
    title = group.name;
    placeholder = `Написать в «${group.name}»`;
  } else if (serverChannel) {
    title = serverChannel.name;
    placeholder = `Написать в #${serverChannel.name}`;
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню">
          ☰
        </button>
        {dm ? (
          <button className="chat-title clickable" onClick={() => showProfile(dm.user_id)}>
            <Avatar name={dm.display_name} src={dm.avatar_path} id={dm.user_id} size={26} presence={presence ?? 'offline'} />
            <strong className="ellipsis">{dm.display_name}</strong>
          </button>
        ) : (
          <div className="chat-title">
            <span className="muted">#</span>
            <strong className="ellipsis">{title}</strong>
          </div>
        )}
        <div className="grow" />
        {dm && (
          <button
            className="icon-btn"
            title="Позвонить"
            aria-label="Позвонить"
            disabled={!callIdle}
            onClick={() => void startCall(dm.user_id, dm.display_name)}
          >
            📞
          </button>
        )}
        {group && (
          <button
            className={`icon-btn${inGroupRoom ? ' on' : ''}`}
            title={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-label={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-pressed={inGroupRoom}
            onClick={() => (inGroupRoom ? leaveVoice() : void joinVoice(group.id))}
          >
            🎙
          </button>
        )}
        {(view.kind === 'group' || view.kind === 'server') && (
          <button className="icon-btn" title="Добавить участника" aria-label="Добавить участника" onClick={() => setAdding(true)}>
            ➕
          </button>
        )}
        {view.kind === 'server' && (
          <button
            className={`icon-btn${membersOpen ? ' on' : ''}`}
            title="Участники"
            aria-label="Участники"
            aria-pressed={membersOpen}
            onClick={onToggleMembers}
          >
            👥
          </button>
        )}
        {channelId && (
          <>
            <button
              ref={pinsBtn}
              className={`icon-btn${panel === 'pins' ? ' on' : ''}`}
              title="Закреплённые сообщения"
              aria-label="Закреплённые сообщения"
              aria-haspopup="dialog"
              aria-expanded={panel === 'pins'}
              onClick={() => setPanel((p) => (p === 'pins' ? null : 'pins'))}
            >
              📌
            </button>
            <button
              ref={notifyBtn}
              className={`icon-btn${panel === 'notify' ? ' on' : ''}${muted ? ' muted-bell' : ''}`}
              title={muted ? 'Уведомления канала выключены' : 'Уведомления'}
              aria-label="Уведомления"
              aria-haspopup="menu"
              aria-expanded={panel === 'notify'}
              onClick={() => setPanel((p) => (p === 'notify' ? null : 'notify'))}
            >
              {muted ? '🔕' : '🔔'}
            </button>
          </>
        )}
        <SearchBox />
      </header>
      {(dm || group) && channelId && <VoiceRoom channelId={channelId} />}
      {channelId ? (
        <>
          <MessageList key={channelId} channelId={channelId} />
          <Composer key={`c${channelId}`} channelId={channelId} placeholder={placeholder} />
        </>
      ) : (
        <div className="empty-state">В этом сервере пока нет текстовых каналов</div>
      )}
      {adding && <AddMemberDialog onClose={() => setAdding(false)} />}
      {panel === 'pins' && channelId && pinsBtn.current && (
        <PinsPanel channelId={channelId} anchor={pinsBtn.current} onClose={() => setPanel(null)} />
      )}
      {panel === 'notify' && channelId && notifyBtn.current && (
        <NotifyMenu channelId={channelId} serverId={serverId} anchor={notifyBtn.current} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

// ── Добавить участника в беседу/сервер ──

function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const view = useStore((s) => s.view);
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
      if (view.kind === 'group') await api.addGroupMember(view.channelId, u.id);
      else if (view.kind === 'server') {
        await api.addServerMember(view.serverId, u.id);
        void refreshServer(view.serverId);
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
