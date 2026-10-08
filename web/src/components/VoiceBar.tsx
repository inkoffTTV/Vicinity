import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { AudioSettings } from './AudioSettings';
import { Avatar } from './Avatar';
import { useVoiceUsers } from './VoiceRoom';

type StoreState = ReturnType<typeof useStore.getState>;

// Название голосового канала и где он: сервер, личка или беседа
function voicePlace(s: StoreState, ch: number | null): { name: string; place: string } {
  if (ch === null) return { name: '', place: '' };
  const dm = s.dms.find((d) => d.channel_id === ch);
  if (dm) return { name: dm.display_name, place: 'Личные сообщения' };
  const group = s.groups.find((g) => g.id === ch);
  if (group) return { name: group.name, place: 'Беседа' };
  for (const [sid, chs] of Object.entries(s.channelsByServer)) {
    const c = chs.find((x) => x.id === ch);
    if (c) return { name: c.name, place: s.servers.find((x) => x.id === Number(sid))?.name ?? '' };
  }
  return { name: 'Голосовой канал', place: '' };
}

/** Панель подключённого голоса над панелью пользователя — видна на любом экране */
export function VoiceBar() {
  const channelId = useVoice((s) => s.channelId);
  const joined = useVoice((s) => s.joined);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const toggleMute = useVoice((s) => s.toggleMute);
  const toggleDeafen = useVoice((s) => s.toggleDeafen);
  const leave = useVoice((s) => s.leave);
  const connected = useStore((s) => s.connected);
  const users = useVoiceUsers(channelId);
  const speaking = useStore((s) => s.speaking);
  const { name, place } = useStore(useShallow((s) => voicePlace(s, channelId)));
  const [settings, setSettings] = useState(false);
  if (channelId === null) return null;

  const live = connected && joined;
  const micOff = muted || deafened;
  return (
    <div className="voice-bar" role="region" aria-label="Голосовое подключение">
      <div className="voice-bar-head">
        <div className="grow">
          <div className={`voice-bar-status${live ? ' live' : ''}`}>
            {!connected ? 'Нет связи…' : joined ? 'Голос подключён' : 'Подключение…'}
          </div>
          <div className="voice-bar-channel ellipsis" title={place ? `${name} · ${place}` : name}>
            {name}
            {place && <span className="muted"> · {place}</span>}
          </div>
        </div>
        <button
          className="icon-btn"
          title="Настройки звука"
          aria-label="Настройки звука"
          onClick={() => setSettings(true)}
        >
          ⚙
        </button>
        <button
          className="icon-btn hangup"
          title="Отключиться"
          aria-label="Отключиться от голосового канала"
          onClick={leave}
        >
          ✕
        </button>
      </div>
      <div className="voice-bar-row">
        <button
          className={`voice-toggle${micOff ? ' off' : ''}`}
          aria-pressed={micOff}
          title={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-label={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
          onClick={toggleMute}
        >
          {micOff ? '🔇' : '🎙'}
        </button>
        <button
          className={`voice-toggle${deafened ? ' off' : ''}`}
          aria-pressed={deafened}
          title={deafened ? 'Включить звук' : 'Выключить звук'}
          aria-label={deafened ? 'Включить звук' : 'Выключить звук'}
          onClick={toggleDeafen}
        >
          {deafened ? '🔕' : '🎧'}
        </button>
        <div className="voice-bar-users">
          {users.map((u) => (
            <span key={u.user_id} title={u.name}>
              <Avatar name={u.name} id={u.user_id} size={24} speaking={!!speaking[u.user_id]} />
            </span>
          ))}
        </div>
      </div>
      {settings && <AudioSettings onClose={() => setSettings(false)} />}
    </div>
  );
}
