// Короткие звуки интерфейса без файлов — синтез через WebAudio.
// Вход/выход из голосового канала и звонка, начало/конец демонстрации, микрофон, соединение звонка.
// Громкость общая и небольшая; выключаются вместе со звуком уведомлений (Настройки → Уведомления).
import { useNotifySettings } from './notify';

export type SoundName =
  | 'join' // я зашёл в голосовой канал / звонок соединился
  | 'leave' // я вышел
  | 'userJoin' // кто-то зашёл в мой голосовой канал
  | 'userLeave' // кто-то вышел из моего голосового канала
  | 'streamStart' // кто-то начал демонстрацию/камеру
  | 'streamStop'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'callEnd'; // звонок завершён / отклонён

type Step = { f: number; f2?: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const SOUNDS: Record<SoundName, Step[]> = {
  join: [
    { f: 523.25, at: 0, dur: 0.09 },
    { f: 783.99, at: 0.08, dur: 0.14 },
  ],
  leave: [
    { f: 783.99, at: 0, dur: 0.09 },
    { f: 523.25, at: 0.08, dur: 0.16 },
  ],
  userJoin: [{ f: 600, f2: 900, at: 0, dur: 0.14, type: 'triangle' }],
  userLeave: [{ f: 900, f2: 560, at: 0, dur: 0.16, type: 'triangle' }],
  streamStart: [
    { f: 659.25, at: 0, dur: 0.07, type: 'triangle' },
    { f: 880, at: 0.07, dur: 0.07, type: 'triangle' },
    { f: 1174.66, at: 0.14, dur: 0.12, type: 'triangle' },
  ],
  streamStop: [
    { f: 1174.66, at: 0, dur: 0.07, type: 'triangle' },
    { f: 880, at: 0.07, dur: 0.07, type: 'triangle' },
    { f: 659.25, at: 0.14, dur: 0.12, type: 'triangle' },
  ],
  mute: [{ f: 440, f2: 330, at: 0, dur: 0.08, gain: 0.1 }],
  unmute: [{ f: 330, f2: 494, at: 0, dur: 0.08, gain: 0.1 }],
  deafen: [
    { f: 392, at: 0, dur: 0.07, gain: 0.1 },
    { f: 294, at: 0.07, dur: 0.1, gain: 0.1 },
  ],
  undeafen: [
    { f: 294, at: 0, dur: 0.07, gain: 0.1 },
    { f: 392, at: 0.07, dur: 0.1, gain: 0.1 },
  ],
  callEnd: [
    { f: 480, at: 0, dur: 0.18, gain: 0.12 },
    { f: 380, at: 0.2, dur: 0.18, gain: 0.12 },
    { f: 300, at: 0.4, dur: 0.26, gain: 0.12 },
  ],
};

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Проиграть звук интерфейса (если звуки не выключены в настройках) */
export function playSound(name: SoundName) {
  if (!useNotifySettings.getState().sound) return;
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + 0.01;
  for (const s of SOUNDS[name]) {
    const t = t0 + s.at;
    const peak = s.gain ?? 0.14;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = s.type ?? 'sine';
    osc.frequency.setValueAtTime(s.f, t);
    if (s.f2) osc.frequency.exponentialRampToValueAtTime(s.f2, t + s.dur);
    // Плавные края — без щелчков
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
    osc.connect(env).connect(c.destination);
    osc.start(t);
    osc.stop(t + s.dur + 0.02);
  }
}
