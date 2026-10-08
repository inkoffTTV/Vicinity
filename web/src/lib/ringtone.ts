// Сигналы звонка без звуковых файлов — синтез через WebAudio

type Tone = 'incoming' | 'outgoing';
type Note = [start: number, duration: number, freq: number];

const PATTERNS: Record<Tone, { period: number; notes: Note[] }> = {
  // Входящий: короткое арпеджио ми–ля–до каждые 2 с
  incoming: {
    period: 2,
    notes: [
      [0, 0.16, 659.25],
      [0.2, 0.16, 880],
      [0.4, 0.24, 1046.5],
    ],
  },
  // Исходящий: гудок 425 Гц — секунда звука, три тишины (как в телефонной сети)
  outgoing: { period: 4, notes: [[0, 1, 425]] },
};

function beep(ctx: AudioContext, [start, duration, freq]: Note, at: number) {
  const t = at + start;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.value = freq;
  // Плавные края — без щелчков
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.15, t + 0.015);
  env.gain.setValueAtTime(0.15, t + duration - 0.03);
  env.gain.linearRampToValueAtTime(0, t + duration);
  osc.connect(env).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

/** Играть сигнал по кругу; возвращает функцию остановки */
export function startTone(kind: Tone): () => void {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  // Без взаимодействия со страницей браузер может не дать звук — тогда звонок только виден
  void ctx.resume().catch(() => {});
  const { period, notes } = PATTERNS[kind];
  let next = ctx.currentTime + 0.05;
  const schedule = () => {
    while (next < ctx.currentTime + period) {
      notes.forEach((n) => beep(ctx, n, next));
      next += period;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 500);
  return () => {
    window.clearInterval(timer);
    void ctx.close().catch(() => {});
  };
}
