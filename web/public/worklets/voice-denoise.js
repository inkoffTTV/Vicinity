// Нейросетевое шумоподавление RNNoise (xiph.org, BSD-3) в AudioWorklet: кадры по 480 сэмплов (10 мс при 48 кГц).
// Сборка wasm — @shiguredo/rnnoise-wasm (Apache-2.0), Vite отдаёт её как /worklets/rnnoise.js.
// Пока модель грузится — звук идёт без обработки; после загрузки задержка — один кадр.
import './rnnoise-shim.js';
import { Rnnoise } from './rnnoise.js';

const SCALE = 32768; // RNNoise ждёт float в диапазоне 16-битного PCM

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
    this.port.onmessage = (e) => {
      if (typeof e.data?.enabled === 'boolean') this.enabled = e.data.enabled;
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
        this.state.processFrame(this.inBuf);
        // Вход и выход идут одним темпом, очередь не длиннее пары кадров; упираемся в конец буфера — сдвигаем к началу
        if (this.outRead + this.outLen + this.frameSize > this.outBuf.length) {
          this.outBuf.copyWithin(0, this.outRead, this.outRead + this.outLen);
          this.outRead = 0;
        }
        for (let j = 0; j < this.frameSize; j++) this.outBuf[this.outRead + this.outLen + j] = this.inBuf[j] / SCALE;
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
