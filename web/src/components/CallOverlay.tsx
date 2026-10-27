import { useVoice } from '../lib/voice';
import {
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  PhoneOff,
  PictureInPicture2,
  Settings,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Video as VideoIcon,
  VideoOff,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CallPhase, NetQuality, useCall } from '../lib/call';
import { applyOutput, streamGain, useMediaPrefs, useStreamVolume, useVoiceVolume, voiceGain, VOICE_VOLUME_MAX } from '../lib/media';
import { useStore } from '../lib/store';
import { AudioSettings } from './AudioSettings';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ScreenShareControl } from './ScreenShareControl';
import { ActivitiesButton } from './Activities';

/** Идущий звонок: окно с видео и кнопками или свёрнутая «таблетка» */
export function CallOverlay() {
  const phase = useCall((s) => s.phase);
  const minimized = useCall((s) => s.minimized);
  if (phase === 'idle' || phase === 'incoming') return null;
  return (
    <>
      <RemoteAudio />
      {minimized ? <CallPill /> : <CallWindow />}
    </>
  );
}

const STATUS: Partial<Record<CallPhase, string>> = { outgoing: 'Вызов…', connecting: 'Соединение…' };

function useCallTimer(): string {
  const phase = useCall((s) => s.phase);
  const startedAt = useCall((s) => s.startedAt);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return STATUS[phase] ?? '';
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(sec / 60) % 60).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return sec >= 3600 ? `${Math.floor(sec / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Звук собеседника: <audio> живёт, пока идёт звонок, — и в развёрнутом окне, и в свёрнутом
function RemoteAudio() {
  const stream = useCall((s) => s.remoteAudio);
  const outputId = useMediaPrefs((s) => s.outputId);
  const volume = useMediaPrefs((s) => s.volume);
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => applyOutput(ref.current!, outputId), [outputId]);
  useEffect(() => {
    ref.current!.volume = Math.min(1, volume);
  }, [volume]);
  return <audio ref={ref} className="call-remote-audio" autoPlay />;
}

/** <video> с потоком; ref наружу — для «картинки в картинке» */
export function StreamVideo({
  stream,
  className,
  videoRef,
  onDoubleClick,
  audible,
  gain,
}: {
  stream: MediaStream;
  className: string;
  videoRef?: React.Ref<HTMLVideoElement>;
  onDoubleClick?: () => void;
  /** Играть звук потока (трансляция экрана со звуком); громкость и устройство — из настроек звука */
  audible?: boolean;
  /** Множитель громкости этой трансляции 0…1 (ползунок у экрана) поверх общей громкости */
  gain?: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const outputId = useMediaPrefs((s) => s.outputId);
  const volume = useMediaPrefs((s) => s.volume);
  const deafened = useVoice((s) => s.deafened);
  useEffect(() => {
    const el = ref.current!;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !audible) return;
    applyOutput(el, outputId);
    el.volume = Math.min(1, volume * (gain ?? 1));
  }, [audible, outputId, volume, gain]);
  return (
    <video
      ref={(el) => {
        ref.current = el;
        if (typeof videoRef === 'function') videoRef(el);
        else if (videoRef) (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
      }}
      className={className}
      autoPlay
      playsInline
      muted={!audible || deafened}
      onDoubleClick={onDoubleClick}
    />
  );
}

/** Ползунок громкости трансляции экрана конкретного человека (запоминается, lib/media.ts) */
export function StreamVolume({ userId, compact }: { userId: number; compact?: boolean }) {
  const volumes = useStreamVolume((s) => s.volumes);
  const setVolume = useStreamVolume((s) => s.set);
  const v = streamGain(volumes, userId);
  return (
    <div className={`stream-volume${compact ? ' compact' : ''}`} role="group" aria-label="Громкость этого экрана" title="Громкость этого экрана" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="plain"
        aria-label={v === 0 ? 'Включить звук экрана' : 'Выключить звук экрана'}
        onClick={() => setVolume(userId, v === 0 ? 1 : 0)}
      >
        <Icon icon={v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2} size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        aria-label="Громкость экрана"
        aria-valuetext={`${Math.round(v * 100)}%`}
        onChange={(e) => setVolume(userId, Number(e.target.value))}
      />
    </div>
  );
}

/** Громкость голоса этого человека: 0…300%, усиление выше 100% — через WebAudio (lib/sfu.ts) */
export function VoiceVolume({ userId, compact }: { userId: number; compact?: boolean }) {
  const volumes = useVoiceVolume((s) => s.volumes);
  const setVolume = useVoiceVolume((s) => s.set);
  const v = voiceGain(volumes, userId);
  const pct = Math.round(v * 100);
  return (
    <div className={`stream-volume voice-volume${compact ? ' compact' : ''}`} role="group" aria-label="Громкость этого человека" title="Громкость этого человека" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="plain" aria-label={v === 0 ? 'Включить звук этого человека' : 'Заглушить этого человека'} onClick={() => setVolume(userId, v === 0 ? 1 : 0)}>
        <Icon icon={v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2} size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={VOICE_VOLUME_MAX}
        step={0.1}
        value={v}
        aria-label="Громкость голоса"
        aria-valuetext={`${pct}%`}
        onChange={(e) => setVolume(userId, Number(e.target.value))}
      />
      <span className={`voice-volume-pct${v > 1 ? ' boost' : ''}`}>{pct}%</span>
    </div>
  );
}

/** Аватар собеседника из уже загруженных личек и друзей */
export function usePeerAvatar(peerId: number) {
  return useStore(
    (s) => s.dms.find((d) => d.user_id === peerId)?.avatar_path ?? s.friends.find((f) => f.id === peerId)?.avatar_path,
  );
}

/** Полноэкранный режим элемента: настоящий (Fullscreen API) или запасной на весь вьюпорт (iOS) */
export function useFullscreen(ref: React.RefObject<HTMLElement>) {
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const on = () => setNative(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [ref]);
  // Esc выходит из запасного режима (из настоящего браузер выводит сам)
  useEffect(() => {
    if (!fallback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFallback(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fallback]);
  // Ушли со страницы элемента — выйти из полноэкранного режима
  useEffect(
    () => () => {
      if (document.fullscreenElement && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => {});
    },
    [ref],
  );
  const toggle = () => {
    if (native) return void document.exitFullscreen().catch(() => {});
    if (fallback) return setFallback(false);
    const el = ref.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFallback(true));
    else setFallback(true);
  };
  return { full: native || fallback, fallback, toggle };
}

const pipSupported = () =>
  typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

type SourceKey = 'remote-screen' | 'remote-camera' | 'local-screen' | 'local-camera' | 'peer';
interface Source {
  key: SourceKey;
  stream: MediaStream | null;
  label: string;
  /** Классы видео (совместимы с e2e: remote-screen, remote-camera, self) */
  cls: string;
}

const NET: Record<NetQuality, { icon: typeof Signal; text: string }> = {
  good: { icon: SignalHigh, text: 'хорошая' },
  fair: { icon: SignalMedium, text: 'средняя' },
  poor: { icon: SignalLow, text: 'плохая' },
  unknown: { icon: Signal, text: 'измеряется' },
};

function CallWindow() {
  const c = useCall();
  const avatar = usePeerAvatar(c.peerId);
  // Игры в звонке идут в личке с собеседником
  const dmChannel = useStore((s) => s.dms.find((d) => d.user_id === c.peerId)?.channel_id ?? null);
  const timer = useCallTimer();
  const [settings, setSettings] = useState(false);
  const [focus, setFocus] = useState<SourceKey | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mainVideo = useRef<HTMLVideoElement | null>(null);
  const fs = useFullscreen(stageRef);
  const [pip, setPip] = useState(false);

  const sources: Source[] = [];
  if (c.remoteScreen && c.remoteScreenStream)
    sources.push({ key: 'remote-screen', stream: c.remoteScreenStream, label: `Экран: ${c.peerName}`, cls: 'remote-screen' });
  if (c.remoteCamera && c.remoteCameraStream)
    sources.push({ key: 'remote-camera', stream: c.remoteCameraStream, label: `Камера: ${c.peerName}`, cls: 'remote-camera' });
  if (c.localScreen) sources.push({ key: 'local-screen', stream: c.localScreen, label: 'Ваш экран', cls: 'self-screen' });
  if (c.localCamera) sources.push({ key: 'local-camera', stream: c.localCamera, label: 'Вы', cls: 'self' });
  const remoteVideo = sources.some((s) => s.key.startsWith('remote'));
  const peer: Source = { key: 'peer', stream: null, label: c.peerName, cls: '' };

  // Крупно — выбранный источник; пропал — экран собеседника, его камера, иначе аватар
  const main =
    sources.find((s) => s.key === focus) ?? (focus === 'peer' ? peer : sources.find((s) => s.key.startsWith('remote')) ?? peer);
  const thumbs = sources.filter((s) => s.key !== main.key);
  if (main.key !== 'peer' && !remoteVideo) thumbs.unshift(peer);

  useEffect(() => {
    if (!main.stream && document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
  }, [main.stream]);
  useEffect(() => {
    const el = mainVideo.current;
    if (!el) return;
    const on = () => setPip(true);
    const off = () => setPip(false);
    el.addEventListener('enterpictureinpicture', on);
    el.addEventListener('leavepictureinpicture', off);
    return () => {
      el.removeEventListener('enterpictureinpicture', on);
      el.removeEventListener('leavepictureinpicture', off);
    };
  });

  const togglePip = () => {
    if (document.pictureInPictureElement) return void document.exitPictureInPicture().catch(() => {});
    void mainVideo.current?.requestPictureInPicture().catch(() => {});
  };

  const net = NET[c.net];
  const live = c.phase === 'active';
  const screenVolumes = useStreamVolume((s) => s.volumes);

  return (
    <div
      className={`call-window${fs.fallback ? ' fs-fallback' : ''}`}
      role="dialog"
      aria-label={`Звонок: ${c.peerName}`}
      data-call-phase={c.phase}
      data-call-connection={c.connection}
    >
      <div className="call-top">
        <span className="call-top-avatar">
          <Avatar name={c.peerName} src={avatar} id={c.peerId} size={36} />
        </span>
        <div className="grow call-top-info">
          <strong className="ellipsis">{c.peerName}</strong>
          <div className="call-top-meta">
            <span className="muted small call-status">{timer}</span>
            {live && (
              <span className={`call-net net-${c.net}`} title={`Связь: ${net.text}${c.rtt ? ` · ${c.rtt} мс` : ''}`}>
                <Icon icon={net.icon} size={14} />
                {c.rtt > 0 && <span className="small">{c.rtt} мс</span>}
              </span>
            )}
            {c.desktopPeer && live && <span className="call-tag">Десктоп</span>}
          </div>
        </div>
        {main.stream && pipSupported() && (
          <button
            className={`icon-btn${pip ? ' on' : ''}`}
            title="Картинка в картинке"
            aria-label="Картинка в картинке"
            aria-pressed={pip}
            onClick={togglePip}
          >
            <Icon icon={PictureInPicture2} />
          </button>
        )}
        <button
          className="icon-btn"
          title={fs.full ? 'Выйти из полноэкранного режима (Esc)' : 'Во весь экран'}
          aria-label={fs.full ? 'Выйти из полноэкранного режима' : 'Во весь экран'}
          onClick={fs.toggle}
        >
          <Icon icon={fs.full ? Minimize : Maximize} anim="pop" key={String(fs.full)} />
        </button>
        <button className="icon-btn" title="Свернуть" aria-label="Свернуть звонок" onClick={() => c.setMinimized(true)}>
          <Icon icon={Minimize2} />
        </button>
      </div>
      <div ref={stageRef} className={`call-stage${fs.full ? ' full' : ''}`} data-main={main.key}>
        {main.stream ? (
          <StreamVideo
            key={main.key}
            stream={main.stream}
            className={`call-video main ${main.cls}`}
            videoRef={mainVideo}
            onDoubleClick={fs.toggle}
            audible={main.key === 'remote-screen'}
            gain={streamGain(screenVolumes, c.peerId)}
          />
        ) : (
          <div className="call-peer">
            <span className={`call-peer-avatar${live ? '' : ' ringing'}`}>
              <Avatar name={c.peerName} src={avatar} id={c.peerId} size={112} />
            </span>
            <div className="muted">
              {live ? (c.desktopPeer && !c.canCamera ? 'Только звук' : 'Камера выключена') : timer}
            </div>
          </div>
        )}
        {main.stream && (
          <div className="call-main-label">
            {main.label}
            {main.key === 'remote-screen' && <StreamVolume userId={c.peerId} compact />}
          </div>
        )}
        {c.screen && (
          <div className="call-sharing">
            <span className="live-dot" /> Вы показываете экран{c.screenLabel ? ` · ${c.screenLabel}` : ''}
          </div>
        )}
        {fs.full && (
          <button className="call-fs-exit" aria-label="Выйти из полноэкранного режима" title="Выйти (Esc)" onClick={fs.toggle}>
            <Icon icon={Minimize} />
          </button>
        )}
        {thumbs.length > 0 && (
          <div className="call-thumbs">
            {thumbs.map((t) => (
              <button
                key={t.key}
                className={`call-thumb thumb-${t.key}`}
                title={`Показать крупно: ${t.label}`}
                aria-label={`Показать крупно: ${t.label}`}
                onClick={() => setFocus(t.key)}
              >
                {t.stream ? (
                  <StreamVideo stream={t.stream} className={`call-video side ${t.cls}`} />
                ) : (
                  <span className="call-thumb-avatar">
                    <Avatar name={c.peerName} src={avatar} id={c.peerId} size={48} />
                  </span>
                )}
                <span className="call-thumb-label ellipsis">{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="call-controls">
        <button
          className={`call-btn${c.muted ? ' off' : ''}`}
          aria-pressed={c.muted}
          title={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-label={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          onClick={c.toggleMute}
        >
          <Icon key={String(c.muted)} icon={c.muted ? MicOff : Mic} anim="pop" size={22} />
        </button>
        {c.canCamera && (
          <button
            className={`call-btn${c.camera ? ' on' : ''}`}
            aria-pressed={c.camera}
            title={c.camera ? 'Выключить камеру' : 'Включить камеру'}
            aria-label={c.camera ? 'Выключить камеру' : 'Включить камеру'}
            onClick={() => void c.toggleCamera()}
          >
            <Icon key={String(c.camera)} icon={c.camera ? VideoIcon : VideoOff} anim="pop" size={22} />
          </button>
        )}
        {c.canScreen && (
          <ScreenShareControl
            btnClass="call-btn"
            active={c.screen}
            activeLabel={c.screenLabel}
            desktopPeer={c.desktopPeer}
            onToggle={() => void c.toggleScreen()}
          />
        )}
        <ActivitiesButton btnClass="call-btn" channelId={c.phase === 'active' ? dmChannel : null} />
        <button className="call-btn" title="Настройки звука" aria-label="Настройки звука" onClick={() => setSettings(true)}>
          <Icon icon={Settings} anim="spin" size={24} />
        </button>
        <button className="call-btn hangup" title="Завершить звонок" aria-label="Завершить звонок" onClick={c.hangup}>
          <Icon icon={PhoneOff} anim="ring" size={24} />
        </button>
      </div>
      {settings && <AudioSettings onClose={() => setSettings(false)} micGain={false} />}
    </div>
  );
}

function CallPill() {
  const c = useCall();
  const timer = useCallTimer();
  return (
    <div className="call-pill" role="region" aria-label="Звонок" data-call-phase={c.phase} data-call-connection={c.connection}>
      <button className="call-pill-main" title="Развернуть звонок" aria-label="Развернуть звонок" onClick={() => c.setMinimized(false)}>
        <span className={`call-pill-dot${c.phase === 'active' ? ' live' : ''}`} />
        <span className="ellipsis">{c.peerName}</span>
        <span className="muted small">{timer}</span>
        {(c.remoteScreen || c.screen) && <span className="live-badge">LIVE</span>}
      </button>
      <button
        className={`icon-btn${c.muted ? ' on' : ''}`}
        aria-pressed={c.muted}
        title={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        aria-label={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        onClick={c.toggleMute}
      >
        <Icon key={String(c.muted)} icon={c.muted ? MicOff : Mic} anim="pop" />
      </button>
      <button className="icon-btn hangup" title="Завершить звонок" aria-label="Завершить звонок" onClick={c.hangup}>
        <Icon icon={PhoneOff} anim="ring" />
      </button>
    </div>
  );
}
