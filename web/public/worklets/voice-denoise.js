// Нейросетевое шумоподавление RNNoise (xiph.org, BSD-3) в AudioWorklet: кадры по 480 сэмплов (10 мс при 48 кГц).
// Сборка wasm — @shiguredo/rnnoise-wasm (Apache-2.0), Vite отдаёт её как /worklets/rnnoise.js.
// Пока модель грузится — звук идёт без обработки; после загрузки задержка — один кадр.
import './rnnoise-shim.js';
import { Rnnoise } from './rnnoise.js';

const SCALE = 32768; // RNNoise ждёт float в диапазоне 16-битного PCM
const GATE_FLOOR = 0.08; // −22 дБ: фон между фразами почти не слышен, но без «обрыва» звука

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.state = null;
    this.frameSize = 480;
    this.inBuf = null;
    this.inLen = 0;
    this.outBuf = null;
    this.outRead = 0;
    this.outLen = 0;
    this.enabled = true;
    // Гейт по голосовой активности: между фразами остаточный шум прижимается до −22 дБ,
    // голос открывает гейт мгновенно, закрывается он через 300 мс тишины
    this.gate = true;
    this.gain = 1;
    this.hold = 0;
    this.port.onmessage = (e) => {
      if (typeof e.data?.enabled === 'boolean') this.enabled = e.data.enabled;
      if (typeof e.data?.gate === 'boolean') this.gate = e.data.gate;
    };
    Rnnoise.load().then(
      (r) => {
        this.frameSize = r.frameSize;
        this.inBuf = new Float32Array(r.frameSize);
        this.outBuf = new Float32Array(r.frameSize * 4);
        this.state = r.createDenoiseState();
        this.port.postMessage({ ready: true, frameSize: r.frameSize, rate: sampleRate });
      },
      (e) => this.port.postMessage({ error: String((e && e.message) || e) }),
    );
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!input) {
      out.fill(0);
      return true;
    }
    if (!this.state || !this.enabled) {
      out.set(input);
      return true;
    }
    // Копим входные сэмплы до кадра; готовые кадры после обработки — в выходную очередь
    for (let i = 0; i < input.length; i++) {
      this.inBuf[this.inLen++] = input[i] * SCALE;
      if (this.inLen === this.frameSize) {
        this.inLen = 0;
        const vad = this.state.processFrame(this.inBuf);
        // Усиление меняется плавно внутри кадра (от прежнего к новому), а не ступенькой раз в 10 мс:
        // ступенька — это щелчок на границе кадра, на открытии и закрытии гейта слышно как треск
        const from = this.gain;
        if (this.gate) {
          if (vad > 0.5) this.hold = 30; // 300 мс после последней уверенной речи
          else if (this.hold > 0) this.hold--;
          const target = vad > 0.5 || this.hold > 0 ? 1 : GATE_FLOOR;
          this.gain += (target - this.gain) * (target > this.gain ? 0.6 : 0.12);
        } else {
          this.gain = 1;
        }
        const step = (this.gain - from) / this.frameSize;
        // Вход и выход идут одним темпом, очередь не длиннее пары кадров; упираемся в конец буфера — сдвигаем к началу
        if (this.outRead + this.outLen + this.frameSize > this.outBuf.length) {
          this.outBuf.copyWithin(0, this.outRead, this.outRead + this.outLen);
          this.outRead = 0;
        }
        for (let j = 0; j < this.frameSize; j++) this.outBuf[this.outRead + this.outLen + j] = (this.inBuf[j] / SCALE) * (from + step * (j + 1));
        this.outLen += this.frameSize;
      }
    }
    // Первые 10 мс после загрузки очередь пуста — тишина вместо щелчка
    const n = Math.min(out.length, this.outLen);
    for (let i = 0; i < n; i++) out[i] = this.outBuf[this.outRead + i];
    for (let i = n; i < out.length; i++) out[i] = 0;
    this.outRead += n;
    this.outLen -= n;
    if (this.outLen === 0) this.outRead = 0;
    return true;
  }
}

registerProcessor('vicinity-denoise', DenoiseProcessor);
