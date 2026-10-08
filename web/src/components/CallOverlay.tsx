import { useEffect, useRef, useState } from 'react';
import { CallPhase, useCall } from '../lib/call';
import { applyOutput, useMediaPrefs } from '../lib/media';
import { useStore } from '../lib/store';
import { AudioSettings } from './AudioSettings';
import { Avatar } from './Avatar';

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

function Video({ stream, className }: { stream: MediaStream; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    ref.current!.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted />;
}

/** Аватар собеседника из уже загруженных личек и друзей */
export function usePeerAvatar(peerId: number) {
  return useStore(
    (s) => s.dms.find((d) => d.user_id === peerId)?.avatar_path ?? s.friends.find((f) => f.id === peerId)?.avatar_path,
  );
}

function CallWindow() {
  const c = useCall();
  const avatar = usePeerAvatar(c.peerId);
  const timer = useCallTimer();
  const [settings, setSettings] = useState(false);
  const screen = c.remoteScreen ? c.remoteScreenStream : null;
  const camera = c.remoteCamera ? c.remoteCameraStream : null;

  return (
    <div
      className="call-window"
      role="dialog"
      aria-label={`Звонок: ${c.peerName}`}
      data-call-phase={c.phase}
      data-call-connection={c.connection}
    >
      <div className="call-top">
        <div className="grow">
          <strong className="ellipsis">{c.peerName}</strong>
          <div className="muted small call-status">{timer}</div>
        </div>
        <button className="icon-btn" title="Свернуть" aria-label="Свернуть звонок" onClick={() => c.setMinimized(true)}>
          ▁
        </button>
      </div>
      <div className="call-stage">
        {/* Экран собеседника — крупно, его камера — рядом (как у десктопа) */}
        {screen ? (
          <Video stream={screen} className="call-video main remote-screen" />
        ) : camera ? (
          <Video stream={camera} className="call-video main remote-camera" />
        ) : (
          <div className="call-peer">
            <Avatar name={c.peerName} src={avatar} id={c.peerId} size={112} />
            <div className="muted">{c.phase === 'active' ? 'Камера выключена' : timer}</div>
          </div>
        )}
        {screen && camera && <Video stream={camera} className="call-video side remote-camera" />}
        {c.localCamera && <Video stream={c.localCamera} className="call-video self" />}
        {c.screen && <div className="call-sharing">Вы показываете экран</div>}
      </div>
      <div className="call-controls">
        <button
          className={`call-btn${c.muted ? ' off' : ''}`}
          aria-pressed={c.muted}
          title={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-label={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          onClick={c.toggleMute}
        >
          {c.muted ? '🔇' : '🎙'}
        </button>
        {c.canCamera && (
          <button
            className={`call-btn${c.camera ? ' on' : ''}`}
            aria-pressed={c.camera}
            title={c.camera ? 'Выключить камеру' : 'Включить камеру'}
            aria-label={c.camera ? 'Выключить камеру' : 'Включить камеру'}
            onClick={() => void c.toggleCamera()}
          >
            📷
          </button>
        )}
        {c.canScreen && (
          <button
            className={`call-btn${c.screen ? ' on' : ''}`}
            aria-pressed={c.screen}
            title={c.screen ? 'Остановить показ экрана' : 'Показать экран'}
            aria-label={c.screen ? 'Остановить показ экрана' : 'Показать экран'}
            onClick={() => void c.toggleScreen()}
          >
            🖥
          </button>
        )}
        <button
          className="call-btn"
          title="Настройки звука"
          aria-label="Настройки звука"
          onClick={() => setSettings(true)}
        >
          ⚙
        </button>
        <button className="call-btn hangup" title="Завершить звонок" aria-label="Завершить звонок" onClick={c.hangup}>
          📞
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
    <div
      className="call-pill"
      role="region"
      aria-label="Звонок"
      data-call-phase={c.phase}
      data-call-connection={c.connection}
    >
      <button
        className="call-pill-main"
        title="Развернуть звонок"
        aria-label="Развернуть звонок"
        onClick={() => c.setMinimized(false)}
      >
        <span className={`call-pill-dot${c.phase === 'active' ? ' live' : ''}`} />
        <span className="ellipsis">{c.peerName}</span>
        <span className="muted small">{timer}</span>
      </button>
      <button
        className={`icon-btn${c.muted ? ' on' : ''}`}
        aria-pressed={c.muted}
        title={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        aria-label={c.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        onClick={c.toggleMute}
      >
        {c.muted ? '🔇' : '🎙'}
      </button>
      <button className="icon-btn hangup" title="Завершить звонок" aria-label="Завершить звонок" onClick={c.hangup}>
        📞
      </button>
    </div>
  );
}
