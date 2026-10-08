// Голосовые каналы Vicinity (docs/CALLS.md §2): AudioWorklet-процессоры захвата и воспроизведения.
// Обычный JS без сборки: Vite копирует public/ как есть, а addModule() нужен готовый URL.
//
// Формат кадра на проводе — PCM s16le, 16 кГц, моно, 320 сэмплов (640 байт, 20 мс).
// Частота AudioContext — какая есть у устройства (обычно 48 или 44.1 кГц): контекст на 16 кГц
// в Firefox не принимает микрофон с другой частотой, поэтому передискретизация — здесь.

const VOICE_RATE = 16000;
const FRAME = 320;

// Модифицированная функция Бесселя нулевого порядка — для окна Кайзера
function besselI0(x) {
  const q = (x * x) / 4;
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

// Потоковая передискретизация произвольных частот: интерполяция окном sinc с окном Кайзера
// (подавление ~70 дБ). Срез — 0.45 от меньшей частоты (7.2 кГц для 16 кГц), переходная полоса —
// 0.1 от неё: при 48→16 и 44.1→16 всё выше 8 кГц подавлено до децимации, без наложения спектра.
// Ядро заранее посчитано для PHASES дробных положений; позиция ведётся в целых числах, без дрейфа.
const PHASES = 256;
const KAISER_BETA = 6.76;

class Resampler {
  constructor(inRate, outRate) {
    this.inRate = inRate;
    this.outRate = outRate;
    const band = Math.min(inRate, outRate);
    const fc = (0.45 * band) / inRate;
    const transition = (0.1 * band) / inRate;
    let taps = Math.ceil((70 - 8) / (2.285 * 2 * Math.PI * transition));
    taps += taps % 2;
    const half = taps / 2;
    this.taps = taps;
    this.half = half;
    // Строка p — веса для дробной части p/PHASES; лишняя строка PHASES избавляет от переноса
    this.table = new Float32Array((PHASES + 1) * taps);
    const norm = besselI0(KAISER_BETA);
    for (let p = 0; p <= PHASES; p++) {
      const f = p / PHASES;
      let sum = 0;
      for (let k = 0; k < taps; k++) {
        const d = k - half + 1 - f;
        const x = 2 * fc * d;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const u = d / half;
        const w = Math.abs(u) >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - u * u)) / norm;
        const h = 2 * fc * sinc * w;
        this.table[p * taps + k] = h;
        sum += h;
      }
      for (let k = 0; k < taps; k++) this.table[p * taps + k] /= sum;
    }
    // История входа; первые half-1 нулей — «прошлое» до начала потока
    this.x = new Float32Array(taps + 2048);
    this.len = half - 1;
    this.pos = half - 1; // индекс входного сэмпла слева от следующего выходного
    this.frac = 0; // дробная часть позиции, в долях 1/outRate
  }

  // Принять кусок входа и выдать все выходные сэмплы, для которых уже хватает данных
  push(input, emit) {
    if (this.len + input.length > this.x.length) {
      const grown = new Float32Array(this.len + input.length + this.taps);
      grown.set(this.x.subarray(0, this.len));
      this.x = grown;
    }
    this.x.set(input, this.len);
    this.len += input.length;

    const { x, table, taps, half, inRate, outRate } = this;
    while (this.pos + half < this.len) {
      const row = Math.round((this.frac * PHASES) / outRate) * taps;
      const base = this.pos - half + 1;
      let s = 0;
      for (let k = 0; k < taps; k++) s += table[row + k] * x[base + k];
      emit(s);
      this.frac += inRate;
      while (this.frac >= outRate) {
        this.frac -= outRate;
        this.pos++;
      }
    }
    const drop = this.pos - half + 1;
    if (drop > 0) {
      x.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.pos -= drop;
    }
  }
}

// ── Захват: вход (любое число каналов, частота контекста) → кадры s16le 16 кГц ──
// Усиление микрофона применяется до упаковки, RMS считается по уже усиленному кадру — как у десктопа.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1;
    this.resampler = new Resampler(sampleRate, VOICE_RATE);
    this.mono = new Float32Array(128);
    this.frame = new Float32Array(FRAME);
    this.n = 0;
    this.emit = (s) => {
      this.frame[this.n++] = s;
      if (this.n === FRAME) this.flush();
    };
    this.port.onmessage = (e) => {
      if (typeof e.data?.gain === 'number') this.gain = e.data.gain;
    };
  }

  flush() {
    this.n = 0;
    const pcm = new ArrayBuffer(FRAME * 2);
    const view = new DataView(pcm);
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = Math.round(Math.max(-1, Math.min(1, this.frame[i] * this.gain)) * 32767);
      view.setInt16(i * 2, v, true);
      sum += v * v;
    }
    this.port.postMessage({ pcm, rms: Math.sqrt(sum / FRAME) }, [pcm]);
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const len = channels[0].length;
      if (this.mono.length < len) this.mono = new Float32Array(len);
      const mono = this.mono;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let c = 0; c < channels.length; c++) s += channels[c][i];
        mono[i] = s / channels.length;
      }
      this.resampler.push(mono.subarray(0, len), this.emit);
    }
    return true;
  }
}

// ── Воспроизведение: у каждого отправителя свой буфер джиттера, затем микс и передискретизация ──
const PREBUFFER = 960; // 60 мс накопить перед началом (и после опустошения)
const MAX_BUFFERED = 4000; // больше 250 мс — отставание: выбросить старое...
const TRIM_TO = 1280; // ...оставив 80 мс
const FLUSH_IDLE = 1600; // кадры не идут 100 мс — доиграть то, что меньше PREBUFFER
const FORGET_IDLE = 5 * VOICE_RATE; // тишина 5 с — забыть отправителя
const RING = 8192; // ёмкость буфера, степень двойки; кадр сервера не больше 4092 сэмплов
const CHUNK = 16; // микшируем порциями по 1 мс

class Jitter {
  constructor() {
    this.buf = new Float32Array(RING);
    this.read = 0;
    this.count = 0;
    this.playing = false;
    this.idle = 0;
  }

  push(view) {
    const n = view.byteLength >> 1;
    for (let i = 0; i < n; i++)
      this.buf[(this.read + this.count + i) & (RING - 1)] = view.getInt16(i * 2, true) / 32768;
    this.count += n;
    if (this.count > MAX_BUFFERED) {
      const drop = this.count - TRIM_TO;
      this.read = (this.read + drop) & (RING - 1);
      this.count -= drop;
    }
    this.idle = 0;
  }

  // Подмешать n сэмплов в out
  mixInto(out, n) {
    this.idle += n;
    if (!this.playing) {
      if (this.count >= PREBUFFER || (this.count > 0 && this.idle >= FLUSH_IDLE)) this.playing = true;
      else return;
    }
    const take = Math.min(n, this.count);
    for (let i = 0; i < take; i++) out[i] += this.buf[(this.read + i) & (RING - 1)];
    this.read = (this.read + take) & (RING - 1);
    this.count -= take;
    if (this.count === 0) this.playing = false;
  }
}

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.senders = new Map();
    this.resampler = new Resampler(VOICE_RATE, sampleRate);
    this.chunk = new Float32Array(CHUNK);
    this.queue = new Float32Array(1024);
    this.qRead = 0;
    this.qCount = 0;
    this.silent = Infinity; // сколько нулевых сэмплов подряд ушло в передискретизацию
    this.emit = (s) => {
      this.queue[(this.qRead + this.qCount) & 1023] = s;
      this.qCount++;
    };
    // {id, buf}: buf — кадр v2 целиком (8 байт id отправителя + PCM); {reset:true} — сбросить всё
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d?.reset) {
        this.senders.clear();
        return;
      }
      if (!(d?.buf instanceof ArrayBuffer) || d.buf.byteLength <= 8) return;
      let j = this.senders.get(d.id);
      if (!j) this.senders.set(d.id, (j = new Jitter()));
      j.push(new DataView(d.buf, 8));
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    // Все молчат, а хвост фильтра уже отыгран — нули без вычислений
    if (this.senders.size === 0 && this.qCount === 0 && this.silent >= this.resampler.taps) return true;
    while (this.qCount < out.length) {
      this.chunk.fill(0);
      for (const [id, j] of this.senders) {
        j.mixInto(this.chunk, CHUNK);
        if (j.count === 0 && j.idle >= FORGET_IDLE) this.senders.delete(id);
      }
      let quiet = true;
      for (let i = 0; i < CHUNK; i++) if (this.chunk[i] !== 0) quiet = false;
      this.silent = quiet ? this.silent + CHUNK : 0;
      this.resampler.push(this.chunk, this.emit);
    }
    for (let i = 0; i < out.length; i++) {
      const s = this.queue[(this.qRead + i) & 1023];
      out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }
    this.qRead = (this.qRead + out.length) & 1023;
    this.qCount -= out.length;
    return true;
  }
}

registerProcessor('vicinity-capture', CaptureProcessor);
registerProcessor('vicinity-playback', PlaybackProcessor);
