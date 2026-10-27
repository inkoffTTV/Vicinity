import {
  Activity,
  Headphones,
  HeadphoneOff,
  LayoutGrid,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { canShareScreen } from '../lib/media';
import { useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { useVoiceVideo } from '../lib/voiceVideo';
import { AudioSettings } from './AudioSettings';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useVoiceUsers } from './VoiceRoom';

type StoreState = ReturnType<typeof useStore.getState>;

/** Название голосового канала и где он: сервер, личка или беседа */
export function voicePlace(s: StoreState, ch: number | null): { name: string; place: string } {
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

const NET_TEXT = { good: 'хорошая', fair: 'средняя', poor: 'плохая', unknown: '' };

/** Живой пинг до голосового сервера: чип с задержкой в мс, цвет по качеству; без данных не показывается */
export function VoicePing() {
  const rtt = useVoice((s) => s.rtt);
  const net = useVoice((s) => s.net);
  if (!rtt || net === 'unknown') return null;
  return (
    <span className={`voice-ping net-${net}`} title={`Связь ${NET_TEXT[net]} · задержка ${rtt} мс`} aria-label={`Задержка ${rtt} мс`} aria-live="off">
      <Icon icon={Activity} size={12} />
      {rtt} мс
    </span>
  );
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
  const camera = useVoiceVideo((s) => !!s.camera);
  const screen = useVoiceVideo((s) => !!s.screen);
  const stageOpen = useVoiceVideo((s) => s.stageOpen);
  const vv = useVoiceVideo.getState();
  if (channelId === null) return null;

  const live = connected && joined;
  const micOff = muted || deafened;
  return (
    <div className="voice-bar" role="region" aria-label="Голосовое подключение">
      <div className="voice-bar-head">
        <div className="grow">
          <div className={`voice-bar-status${live ? ' live' : ''}`}>
            {!connected ? 'Нет связи…' : joined ? 'Голос подключён' : 'Подключение…'}
            {live && <VoicePing />}
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
          <Icon icon={Settings} anim="spin" size={20} />
        </button>
        <button
          className="icon-btn hangup"
          title="Отключиться"
          aria-label="Отключиться от голосового канала"
          onClick={leave}
        >
          <Icon icon={PhoneOff} anim="ring" size={20} />
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
          <Icon key={String(micOff)} icon={micOff ? MicOff : Mic} anim="pop" size={18} />
        </button>
        <button
          className={`voice-toggle${deafened ? ' off' : ''}`}
          aria-pressed={deafened}
          title={deafened ? 'Включить звук' : 'Выключить звук'}
          aria-label={deafened ? 'Включить звук' : 'Выключить звук'}
          onClick={toggleDeafen}
        >
          <Icon key={String(deafened)} icon={deafened ? HeadphoneOff : Headphones} anim="pop" size={18} />
        </button>
        <button
          className={`voice-toggle${camera ? ' on' : ''}`}
          aria-pressed={camera}
          disabled={!live}
          title={camera ? 'Выключить камеру' : 'Включить камеру'}
          aria-label={camera ? 'Выключить камеру' : 'Включить камеру'}
          onClick={() => void vv.toggleCamera()}
        >
          <Icon key={String(camera)} icon={camera ? Video : VideoOff} anim="pop" size={18} />
        </button>
        {canShareScreen() && (
          <button
            className={`voice-toggle${screen ? ' on' : ''}`}
            aria-pressed={screen}
            disabled={!live}
            title={screen ? 'Остановить показ экрана' : 'Показать экран'}
            aria-label={screen ? 'Остановить показ экрана' : 'Показать экран'}
            onClick={() => void vv.toggleScreen()}
          >
            <Icon key={String(screen)} icon={screen ? ScreenShareOff : ScreenShare} anim="pop" size={18} />
          </button>
        )}
        <button
          className={`voice-toggle${stageOpen ? ' on' : ''}`}
          aria-pressed={stageOpen}
          title="Открыть голосовой канал"
          aria-label="Открыть голосовой канал"
          onClick={() => (stageOpen ? vv.closeStage() : vv.openStage())}
        >
          <Icon icon={LayoutGrid} size={20} />
        </button>
      </div>
      {users.length > 0 && (
        // Участники — отдельной строкой: в ряду с кнопками они не помещались в ширину боковой панели
        <div className="voice-bar-users" aria-label={`В канале: ${users.length}`}>
          {users.slice(0, 7).map((u) => (
            <span key={u.user_id} title={u.name}>
              <Avatar name={u.name} id={u.user_id} size={24} speaking={!!speaking[u.user_id]} />
            </span>
          ))}
          {users.length > 7 && <span className="voice-bar-more">+{users.length - 7}</span>}
        </div>
      )}
      {settings && <AudioSettings onClose={() => setSettings(false)} />}
    </div>
  );
}
