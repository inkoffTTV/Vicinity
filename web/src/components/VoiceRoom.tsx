import { useStore, VoiceUser } from '../lib/store';
import { useVoice } from '../lib/voice';
import { Avatar } from './Avatar';

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

// Строка подписана только на «говорит» своего пользователя: списков в панели много, перерисовывается одна
function VoiceUserRow({ user, mine }: { user: VoiceUser; mine: boolean }) {
  const speaking = useStore((s) => !!s.speaking[user.user_id]);
  const isMe = useStore((s) => s.me?.user_id === user.user_id);
  const flag = useVoice((s) => (mine && isMe ? (s.deafened ? 'deafened' : s.muted ? 'muted' : '') : ''));
  return (
    <div className="voice-user">
      <Avatar name={user.name} id={user.user_id} size={22} speaking={speaking} />
      <span className="grow ellipsis">{user.name}</span>
      {flag && (
        <span className="voice-user-flag" title={flag === 'deafened' ? 'Звук выключен' : 'Микрофон выключен'}>
          {flag === 'deafened' ? '🔕' : '🔇'}
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
  if (!inRoom && users.length === 0) return null;
  return (
    <div className={`voice-room${inRoom ? ' in' : ''}`} role="region" aria-label="Голосовая комната">
      <div className="voice-room-status">
        <strong>{inRoom ? '🔊 Вы в голосовой комнате' : '🔊 Голосовая комната'}</strong>
        <span className="muted small">{inRoom ? 'зелёный — говорит' : 'вас ждут'}</span>
      </div>
      <div className="voice-room-users">
        {users.map((u) => (
          <span key={u.user_id} className={`voice-chip${speaking[u.user_id] ? ' speaking' : ''}`}>
            <span className="voice-chip-dot" />
            {u.user_id === meId ? 'Вы' : u.name}
          </span>
        ))}
      </div>
      <button
        className={`btn small ${inRoom ? 'danger' : 'ok'}`}
        onClick={() => (inRoom ? leave() : void join(channelId))}
      >
        {inRoom ? 'Выйти' : 'Присоединиться'}
      </button>
    </div>
  );
}
