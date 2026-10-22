// Голосовые сообщения: запись через MediaRecorder и разбор записи (длительность и пики для волны).
// Формат — какой умеет браузер: Chrome/Firefox пишут webm/ogg с Opus, Safari — m4a (AAC); играют все.
import { VoiceMeta } from './api';
import { micConstraints } from './media';

export const VOICE_MAX_SEC = 600;
const PEAKS = 64;

const CANDIDATES: [string, string][] = [
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/webm', 'webm'],
];

export const canRecordVoice = () =>
  typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

function pickFormat(): [string, string] | null {
  for (const c of CANDIDATES) if (MediaRecorder.isTypeSupported(c[0])) return c;
  return null;
}

export interface Recording {
  file: File;
  meta: VoiceMeta;
}

export interface Recorder {
  /** Закончить и получить файл с метаданными; null — записи нет (пусто или ошибка) */
  stop: () => Promise<Recording | null>;
  cancel: () => void;
  startedAt: number;
}

/** Начать запись с микрофона из настроек; бросает ошибку getUserMedia */
export async function startRecording(inputId: string): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(inputId) });
  const format = pickFormat();
  const rec = format ? new MediaRecorder(stream, { mimeType: format[0], audioBitsPerSecond: 32_000 }) : new MediaRecorder(stream);
  const ext = format?.[1] ?? 'webm';
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startedAt = Date.now();
  rec.start(250);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  let done = false;

  return {
    startedAt,
    cancel: () => {
      if (done) return;
      done = true;
      try {
        rec.stop();
      } catch {
        /* уже остановлен */
      }
      release();
    },
    stop: () =>
      new Promise<Recording | null>((resolve) => {
        if (done) return resolve(null);
        done = true;
        rec.onstop = async () => {
          release();
          const blob = new Blob(chunks, { type: rec.mimeType || format?.[0] || 'audio/webm' });
          const elapsed = Math.min(VOICE_MAX_SEC, (Date.now() - startedAt) / 1000);
          if (!blob.size || elapsed < 0.5) return resolve(null);
          const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const file = new File([blob], `voice-${stamp}.${ext}`, { type: blob.type });
          resolve({ file, meta: await analyze(blob, elapsed) });
        };
        try {
          rec.stop();
        } catch {
          release();
          resolve(null);
        }
      }),
  };
}

/** Длительность и PEAKS пиков 0..1 по записи; если браузер не декодирует формат — ровная волна */
async function analyze(blob: Blob, fallbackSec: number): Promise<VoiceMeta> {
  try {
    const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 16000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const bin = Math.max(1, Math.floor(data.length / PEAKS));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < PEAKS; i++) {
      let sum = 0;
      const start = i * bin;
      const end = Math.min(data.length, start + bin);
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
      peaks.push(rms);
      if (rms > max) max = rms;
    }
    const norm = peaks.map((p) => (max > 0 ? Math.round((p / max) * 100) / 100 : 0));
    return { duration: Math.round(buf.duration * 10) / 10 || fallbackSec, peaks: norm };
  } catch {
    return { duration: Math.round(fallbackSec * 10) / 10, peaks: [] };
  }
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
