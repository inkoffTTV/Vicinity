import { HeadphoneOff, LayoutGrid, LogOut, MicOff, PhoneCall, Video, Volume2 } from 'lucide-react';
import { useStore, VoiceUser } from '../lib/store';
import { useVoice } from '../lib/voice';
import { useVoiceVideo } from '../lib/voiceVideo';
import { Avatar } from './Avatar';
import { avatarOf } from './VoiceStage';
import { Icon } from './Icon';

const NOBODY: VoiceUser[] = [];

export const useVoiceUsers = (channelId: number | null) =>
  useStore((s) => (channelId === null ? NOBODY : (s.voice[channelId] ?? NOBODY)));

/** Кто сидит в голосовом канале — строки под каналом в боковой панели */
export function VoiceUsers({ channelId }: { channelId: number }) {
  const users = useVoiceUsers(channelId);
  const mine = useVoice((s) => s.channelId === channelId);
  return (
    <>
      {users.map((u) => (
        <VoiceUserRow key={u.user_id} user={u} mine={mine} />
      ))}
    </>
  );
}

/** Значки трансляций участника: «LIVE» (показывает экран) и камера */
export function StreamBadges({ user }: { user: VoiceUser }) {
  return (
    <>
      {user.camera && (
        <span className="voice-user-cam" title="Камера включена" aria-label="Камера включена">
          <Icon icon={Video} size={14} />
        </span>
      )}
      {user.screen && (
        <span className="live-badge" title="Показывает экран">
          LIVE
        </span>
      )}
    </>
  );
}

// Строка подписана только на «говорит» своего пользователя: списков в панели много, перерисовывается одна
function VoiceUserRow({ user, mine }: { user: VoiceUser; mine: boolean }) {
  const speaking = useStore((s) => !!s.speaking[user.user_id]);
  const isMe = useStore((s) => s.me?.user_id === user.user_id);
  const flag = useVoice((s) => (mine && isMe ? (s.deafened ? 'deafened' : s.muted ? 'muted' : '') : ''));
  const openStage = useVoiceVideo((s) => s.openStage);
  const avatar = useStore((s) => avatarOf(s, user.user_id));
  return (
    <div
      className={`voice-user${mine && user.screen ? ' clickable' : ''}`}
      onClick={mine && user.screen ? openStage : undefined}
      data-user={user.user_id}
    >
      <Avatar name={user.name} src={avatar} id={user.user_id} size={22} speaking={speaking} />
      <span className="grow ellipsis">{user.name}</span>
      <StreamBadges user={user} />
      {flag && (
        <span className="voice-user-flag" title={flag === 'deafened' ? 'Звук выключен' : 'Микрофон выключен'}>
          <Icon icon={flag === 'deafened' ? HeadphoneOff : MicOff} size={14} />
        </span>
      )}
    </div>
  );
}

/** Голосовая комната лички или беседы (как у десктопа): кто в ней, кто говорит, войти/выйти */
export function VoiceRoom({ channelId }: { channelId: number }) {
  const users = useVoiceUsers(channelId);
  const speaking = useStore((s) => s.speaking);
  const meId = useStore((s) => s.me?.user_id);
  const inRoom = useVoice((s) => s.channelId === channelId);
  const join = useVoice((s) => s.join);
  const leave = useVoice((s) => s.leave);
  const openStage = useVoiceVideo((s) => s.openStage);
  if (!inRoom && users.length === 0) return null;
  return (
    <div className={`voice-room${inRoom ? ' in' : ''}`} role="region" aria-label="Голосовая комната">
      <div className="voice-room-status">
        <strong>
          <Icon icon={Volume2} size={16} anim={inRoom ? 'pulse' : undefined} />{' '}
          {inRoom ? 'Вы в голосовой комнате' : 'Голосовая комната'}
        </strong>
        <span className="muted small">{inRoom ? 'зелёный — говорит' : 'вас ждут'}</span>
      </div>
      <div className="voice-room-users">
        {users.map((u) => (
          <span key={u.user_id} className={`voice-chip${speaking[u.user_id] ? ' speaking' : ''}`}>
            <span className="voice-chip-dot" />
            {u.user_id === meId ? 'Вы' : u.name}
            <StreamBadges user={u} />
          </span>
        ))}
      </div>
      {inRoom && (
        <button className="btn small" onClick={openStage}>
          <Icon icon={LayoutGrid} size={16} /> Открыть
        </button>
      )}
      <button
        className={`btn small ${inRoom ? 'danger' : 'ok'}`}
        onClick={() => (inRoom ? leave() : void join(channelId))}
      >
        <Icon icon={inRoom ? LogOut : PhoneCall} size={16} /> {inRoom ? 'Выйти' : 'Присоединиться'}
      </button>
    </div>
  );
}
