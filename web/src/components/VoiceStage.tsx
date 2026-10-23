import {
  ArrowLeft,
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Maximize,
  Menu,
  Mic,
  MicOff,
  Minimize,
  PhoneOff,
  Settings,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Member } from '../lib/api';
import { useStore, VoiceUser } from '../lib/store';
import { useVoice } from '../lib/voice';
import { MAX_VIEWERS, useVoiceVideo, Watch } from '../lib/voiceVideo';
import { AudioSettings } from './AudioSettings';
import { Avatar } from './Avatar';
import { StreamVideo, useFullscreen, StreamVolume } from './CallOverlay';
import { Icon } from './Icon';
import { streamGain, useStreamVolume } from '../lib/media';
import { ScreenShareControl } from './ScreenShareControl';
import { ActivitiesButton } from './Activities';
import { voicePlace } from './VoiceBar';
import { useVoiceUsers } from './VoiceRoom';

type StoreState = ReturnType<typeof useStore.getState>;

/** Аватар участника: из списков участников серверов, личек и друзей */
function avatarOf(s: StoreState, uid: number): string | undefined {
  for (const list of Object.values(s.membersByServer) as Member[][]) {
    const m = list.find((x) => x.id === uid);
    if (m) return m.avatar_path;
  }
  return s.dms.find((d) => d.user_id === uid)?.avatar_path ?? s.friends.find((f) => f.id === uid)?.avatar_path;
}

/** Экран голосового канала: участники плитками, трансляции, свои кнопки */
export function VoiceStage({ onMenu }: { onMenu: () => void }) {
  const channelId = useVoice((s) => s.channelId);
  const joined = useVoice((s) => s.joined);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const v = useVoice.getState();
  const users = useVoiceUsers(channelId);
  const { name, place } = useStore(useShallow((s) => voicePlace(s, channelId)));
  const connected = useStore((s) => s.connected);
  const camera = useVoiceVideo((s) => s.camera);
  const screen = useVoiceVideo((s) => s.screen);
  const screenLabel = useVoiceVideo((s) => s.screenLabel);
  const watching = useVoiceVideo((s) => s.watching);
  const viewers = useVoiceVideo((s) => s.viewers);
  const vv = useVoiceVideo.getState();
  const [settings, setSettings] = useState(false);
  if (channelId === null) return null;

  const live = connected && joined;
  const micOff = muted || deafened;
  // Крупно — экраны, которые смотрим (несколько — рядом); камеры — в плитках участников
  const streams = Object.entries(watching).filter(([, w]) => w.kind === 'screen');
  const streaming = users.filter((u) => u.screen).length;

  return (
    <div className="voice-stage" role="region" aria-label="Голосовой канал" data-channel={channelId}>
      <header className="chat-head stage-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню">
          <Icon icon={Menu} />
        </button>
        <button className="icon-btn" title="Вернуться к чату" aria-label="Вернуться к чату" onClick={vv.closeStage}>
          <Icon icon={ArrowLeft} anim="bounce" />
        </button>
        <div className="chat-title stage-title">
          <strong className="ellipsis">{name}</strong>
          {place && <span className="muted small ellipsis">{place}</span>}
        </div>
        <div className="grow" />
        <span className="stage-count" title="Участников в канале">
          <Icon icon={Users} size={16} /> {users.length}
        </span>
        {streaming > 0 && (
          <span className="live-badge" title="Идут трансляции">
            LIVE {streaming}
          </span>
        )}
      </header>

      <div className={`stage-body${streams.length ? ' has-focus' : ''}`}>
        {streams.length > 0 && (
          <div className={`stage-focus n${Math.min(streams.length, 4)}`}>
            {streams.map(([key, w]) => (
              <FocusStream key={key} watch={w} name={users.find((u) => u.user_id === w.userId)?.name ?? ''} />
            ))}
          </div>
        )}
        <div className="stage-grid" data-count={users.length}>
          {users.map((u) => (
            <Tile key={u.user_id} user={u} watching={watching} compact={streams.length > 0} />
          ))}
          {!live && <div className="stage-wait muted">{connected ? 'Подключение…' : 'Нет связи…'}</div>}
        </div>
      </div>

      <div className="stage-controls" role="toolbar" aria-label="Управление голосом">
        <button
          className={`stage-btn${micOff ? ' off' : ''}`}
          aria-pressed={micOff}
          title={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-label={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
          onClick={v.toggleMute}
        >
          <Icon key={String(micOff)} icon={micOff ? MicOff : Mic} anim="pop" size={22} />
        </button>
        <button
          className={`stage-btn${deafened ? ' off' : ''}`}
          aria-pressed={deafened}
          title={deafened ? 'Включить звук' : 'Выключить звук'}
          aria-label={deafened ? 'Включить звук' : 'Выключить звук'}
          onClick={v.toggleDeafen}
        >
          <Icon key={String(deafened)} icon={deafened ? HeadphoneOff : Headphones} anim="pop" size={22} />
        </button>
        <button
          className={`stage-btn${camera ? ' on' : ''}`}
          aria-pressed={!!camera}
          disabled={!live}
          title={camera ? 'Выключить камеру' : 'Включить камеру'}
          aria-label={camera ? 'Выключить камеру' : 'Включить камеру'}
          onClick={() => void vv.toggleCamera()}
        >
          <Icon key={String(!!camera)} icon={camera ? Video : VideoOff} anim="pop" size={22} />
        </button>
        <ScreenShareControl
          btnClass="stage-btn"
          active={!!screen}
          activeLabel={screenLabel}
          onToggle={() => void vv.toggleScreen()}
        />
        <ActivitiesButton btnClass="stage-btn" channelId={live ? channelId : null} />
        <button className="stage-btn" title="Настройки звука" aria-label="Настройки звука" onClick={() => setSettings(true)}>
          <Icon icon={Settings} anim="spin" size={24} />
        </button>
        <button
          className="stage-btn hangup"
          title="Отключиться"
          aria-label="Отключиться от голосового канала"
          onClick={v.leave}
        >
          <Icon icon={PhoneOff} anim="ring" size={24} />
        </button>
      </div>
      {(screen || camera) && (
        <div className="stage-viewers muted small" aria-live="polite">
          {screen ? `Ваш экран · ${screenLabel} · зрителей: ${viewers.screen} из ${MAX_VIEWERS}` : ''}
          {screen && camera ? ' · ' : ''}
          {camera ? `камеру смотрят: ${viewers.camera}` : ''}
        </div>
      )}
      {settings && <AudioSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

/** Плитка участника: аватар или камера, «говорит», микрофон/звук, LIVE и кнопка «Смотреть» */
function Tile({ user, watching, compact }: { user: VoiceUser; watching: Record<string, Watch>; compact: boolean }) {
  const me = useStore((s) => s.me?.user_id === user.user_id);
  const speaking = useStore((s) => !!s.speaking[user.user_id]);
  const avatar = useStore((s) => avatarOf(s, user.user_id));
  const flag = useVoice((s) => (me ? (s.deafened ? 'deafened' : s.muted ? 'muted' : '') : ''));
  const ownCamera = useVoiceVideo((s) => (me ? s.camera : null));
  const ownScreen = useVoiceVideo((s) => (me ? s.screen : null));
  const vv = useVoiceVideo.getState();
  const cam = watching[`${user.user_id}:camera`];
  const scr = watching[`${user.user_id}:screen`];
  const camStream = me ? ownCamera : cam?.stream ?? null;
  return (
    <div
      className={`stage-tile${speaking ? ' speaking' : ''}${user.screen ? ' live' : ''}${compact ? ' compact' : ''}${camStream ? ' has-video' : ''}`}
      data-user={user.user_id}
      aria-label={user.name}
    >
      {camStream ? (
        <StreamVideo stream={camStream} className={`stage-tile-video${me ? ' mirror' : ''}`} />
      ) : me && ownScreen && !compact ? (
        <StreamVideo stream={ownScreen} className="stage-tile-video screen-preview" />
      ) : (
        <Avatar name={user.name} src={avatar} id={user.user_id} size={compact ? 48 : 80} speaking={speaking} />
      )}
      <div className="stage-tile-name">
        <span className="ellipsis">{me ? `${user.name} (вы)` : user.name}</span>
        {flag && (
          <span className="stage-tile-flag" title={flag === 'deafened' ? 'Звук выключен' : 'Микрофон выключен'}>
            <Icon icon={flag === 'deafened' ? HeadphoneOff : MicOff} size={14} />
          </span>
        )}
        {user.camera && !camStream && (
          <span className="stage-tile-flag" title="Камера включена">
            <Icon icon={Video} size={14} />
          </span>
        )}
      </div>
      {user.screen && (
        <span className="live-badge stage-live" title="Показывает экран">
          LIVE
        </span>
      )}
      {cam && cam.state === 'connecting' && <span className="stage-tile-wait">Подключение камеры…</span>}
      {!me && user.screen && (
        <button
          className={`btn small stage-watch${scr ? '' : ' primary'}`}
          aria-label={scr ? 'Скрыть' : 'Смотреть'}
          title={scr ? 'Перестать смотреть экран' : 'Смотреть экран'}
          onClick={() => (scr ? vv.unwatch(user.user_id, 'screen') : vv.watch(user.user_id, 'screen'))}
        >
          <Icon icon={scr ? EyeOff : Eye} size={16} />
          <span className="stage-watch-text">{scr ? 'Скрыть' : 'Смотреть'}</span>
        </button>
      )}
    </div>
  );
}

/** Экран участника крупно: во весь экран, закрыть */
function FocusStream({ watch, name }: { watch: Watch; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const volumes = useStreamVolume((s) => s.volumes);
  const fs = useFullscreen(ref);
  const unwatch = useVoiceVideo((s) => s.unwatch);
  return (
    <div
      ref={ref}
      className={`stage-stream${fs.full ? ' full' : ''}${fs.fallback ? ' fs-fallback' : ''}`}
      data-streamer={watch.userId}
      data-state={watch.state}
    >
      {watch.stream ? (
        <StreamVideo
          stream={watch.stream}
          className="stage-stream-video"
          onDoubleClick={fs.toggle}
          audible={watch.kind === 'screen'}
          gain={streamGain(volumes, watch.userId)}
        />
      ) : (
        <div className="stage-stream-wait">
          <span className="spinner" /> Подключение к трансляции…
        </div>
      )}
      <div className="stage-stream-bar">
        <span className="live-badge">LIVE</span>
        <span className="ellipsis">Экран: {name}</span>
        <div className="grow" />
        {watch.kind === 'screen' && <StreamVolume userId={watch.userId} />}
        <button
          className="icon-btn"
          title={fs.full ? 'Выйти из полноэкранного режима (Esc)' : 'Во весь экран'}
          aria-label={fs.full ? 'Выйти из полноэкранного режима' : 'Во весь экран'}
          onClick={fs.toggle}
        >
          <Icon key={String(fs.full)} icon={fs.full ? Minimize : Maximize} anim="pop" />
        </button>
        <button className="icon-btn" title="Перестать смотреть" aria-label="Перестать смотреть" onClick={() => unwatch(watch.userId, watch.kind)}>
          <Icon icon={X} />
        </button>
      </div>
    </div>
  );
}
