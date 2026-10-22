import { Pause, Play } from 'lucide-react';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import { Message, VoiceMeta } from '../lib/api';
import { formatClock } from '../lib/voiceNote';
import { Icon } from './Icon';

const RATES = [1, 1.5, 2] as const;
const RATE_KEY = 'vicinity.voiceRate';
const BARS = 48;

function loadRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(r as (typeof RATES)[number]) ? r : 1;
  } catch {
    return 1;
  }
}

// Играет только одно голосовое за раз: новое ставит предыдущее на паузу
let current: HTMLAudioElement | null = null;
const rateListeners = new Set<(r: number) => void>();
let rate = loadRate();

function setRate(r: number) {
  rate = r;
  try {
    localStorage.setItem(RATE_KEY, String(r));
  } catch {
    /* приватный режим */
  }
  rateListeners.forEach((fn) => fn(r));
}

/** Голосовое сообщение: кнопка, волна с перемоткой, время, скорость 1×/1.5×/2× */
export function VoiceMessage({ msg }: { msg: Message }) {
  const meta = (msg.meta ?? { duration: 0, peaks: [] }) as VoiceMeta;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(meta.duration || 0);
  const [speed, setSpeed] = useState(rate);
  const ready = !msg.local;

  useEffect(() => {
    const fn = (r: number) => {
      setSpeed(r);
      if (audio.current) audio.current.playbackRate = r;
    };
    rateListeners.add(fn);
    return () => {
      rateListeners.delete(fn);
      if (audio.current) {
        audio.current.pause();
        if (current === audio.current) current = null;
      }
    };
  }, []);

  const ensure = () => {
    if (audio.current) return audio.current;
    const a = new Audio(msg.attachment);
    a.preload = 'metadata';
    a.playbackRate = rate;
    a.ontimeupdate = () => setPos(a.currentTime);
    a.onloadedmetadata = () => Number.isFinite(a.duration) && a.duration > 0 && setDuration(a.duration);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.onended = () => {
      setPlaying(false);
      setPos(0);
    };
    audio.current = a;
    return a;
  };

  const toggle = () => {
    if (!ready) return;
    const a = ensure();
    if (a.paused) {
      if (current && current !== a) current.pause();
      current = a;
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!ready || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const a = ensure();
    a.currentTime = frac * duration;
    setPos(a.currentTime);
    if (a.paused) toggle();
  };

  const peaks = meta.peaks?.length ? resample(meta.peaks, BARS) : Array.from({ length: BARS }, () => 0.35);
  const frac = duration ? pos / duration : 0;
  const shown = playing || pos > 0 ? pos : duration;

  return (
    <div className={`voice-msg${playing ? ' playing' : ''}`} data-testid="voice-message">
      <button
        className="voice-play"
        onClick={toggle}
        disabled={!ready}
        aria-label={playing ? 'Пауза' : 'Слушать голосовое сообщение'}
        title={playing ? 'Пауза' : 'Слушать'}
      >
        <Icon icon={playing ? Pause : Play} size={20} />
      </button>
      <div className="voice-wave" role="slider" aria-label="Перемотка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} onClick={seek}>
        {peaks.map((p, i) => (
          <i key={i} className={i / BARS < frac ? 'done' : undefined} style={{ height: `${Math.max(12, Math.round(p * 100))}%` }} />
        ))}
      </div>
      <span className="voice-time muted small" aria-live="off">
        {formatClock(shown)}
      </span>
      <button
        className="voice-rate"
        onClick={() => setRate(RATES[(RATES.indexOf(speed as (typeof RATES)[number]) + 1) % RATES.length])}
        aria-label={`Скорость ${speed}×`}
        title="Скорость"
      >
        {speed}×
      </button>
    </div>
  );
}

function resample(src: number[], n: number): number[] {
  if (src.length === n) return src;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * src.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / n));
    let m = 0;
    for (let j = a; j < b && j < src.length; j++) m = Math.max(m, src[j]);
    out.push(m);
  }
  return out;
}
