// Звук целиком процедурный (Web Audio): никаких файлов, всё синтезируется на лету.
// Громкость: общая, эффекты, фон. Звуки далёких событий тише, одинаковые подряд — не чаще 12 раз в секунду.
import { ABILITIES, type SimEvent, type Snapshot } from '@pereprava/shared';

export interface Volumes {
  master: number;
  sfx: number;
  ambient: number;
}

type Wave = OscillatorType;

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private ambientOn = false;
  private birdTimer = 0;
  night = false;

  constructor(public vol: Volumes) {
    // Браузеры разрешают звук только после действия пользователя
    const unlock = () => {
      this.init();
      void this.ctx?.resume();
    };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
  }

  private init() {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    // Лёгкий компрессор: пачка ударов не «рвёт» динамики
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    this.applyVolumes();
  }

  setVolumes(v: Volumes) {
    this.vol = v;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.ambient * 0.5, t, 0.2);
  }

  // ── Синтез ──

  private tone(
    freq: number,
    dur: number,
    wave: Wave = 'sine',
    gain = 0.3,
    slideTo?: number,
    delay = 0,
    out?: AudioNode,
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    freq: number,
    q = 1,
    gain = 0.3,
    type: BiquadFilterType = 'bandpass',
    slideTo?: number,
    delay = 0,
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Сыграть звук по имени; vol — множитель (дальние события тише) */
  play(name: string, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || vol <= 0.02) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < 80) return;
    this.last.set(name, now);
    const v = Math.min(1, vol);
    switch (name) {
      case 'ui':
        this.tone(1200, 0.06, 'square', 0.06 * v);
        break;
      case 'buy':
        this.tone(1320, 0.08, 'triangle', 0.18 * v);
        this.tone(1760, 0.14, 'triangle', 0.18 * v, undefined, 0.07);
        break;
      case 'coin':
        this.tone(1900, 0.06, 'triangle', 0.08 * v);
        this.tone(2500, 0.08, 'triangle', 0.06 * v, undefined, 0.04);
        break;
      case 'melee':
        this.noise(0.12, 1800, 1.4, 0.16 * v, 'bandpass', 600);
        break;
      case 'shot':
        this.tone(900, 0.08, 'triangle', 0.08 * v, 400);
        break;
      case 'tower':
        this.tone(320, 0.18, 'sawtooth', 0.07 * v, 140);
        break;
      case 'hit':
        this.tone(150, 0.1, 'sine', 0.22 * v, 70);
        this.noise(0.06, 900, 1, 0.08 * v);
        break;
      case 'cast':
        this.noise(0.35, 500, 2, 0.14 * v, 'bandpass', 2400);
        break;
      case 'fire':
        this.noise(0.4, 300, 1.2, 0.2 * v, 'lowpass', 1600);
        break;
      case 'boom':
        this.tone(90, 0.5, 'sine', 0.4 * v, 40);
        this.noise(0.5, 700, 0.8, 0.3 * v, 'lowpass', 120);
        break;
      case 'blink':
        this.tone(400, 0.25, 'sine', 0.14 * v, 1600);
        this.tone(600, 0.25, 'triangle', 0.06 * v, 2400, 0.03);
        break;
      case 'shield':
        for (let k = 0; k < 4; k++) this.tone(900 + k * 260, 0.4, 'sine', 0.05 * v, undefined, k * 0.03);
        break;
      case 'heal':
        this.tone(523, 0.5, 'sine', 0.1 * v);
        this.tone(659, 0.5, 'sine', 0.08 * v, undefined, 0.06);
        this.tone(784, 0.6, 'sine', 0.08 * v, undefined, 0.12);
        break;
      case 'stun':
        this.tone(1400, 0.3, 'square', 0.05 * v, 700);
        break;
      case 'death':
        this.tone(440, 0.6, 'sawtooth', 0.12 * v, 110);
        break;
      case 'creepDeath':
        this.noise(0.12, 500, 1, 0.08 * v, 'lowpass', 200);
        break;
      case 'level':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12 * v, undefined, i * 0.07));
        break;
      case 'crumble':
        this.noise(1.2, 400, 0.7, 0.35 * v, 'lowpass', 80);
        this.tone(70, 1.1, 'sine', 0.3 * v, 35);
        break;
      case 'ping':
        this.tone(880, 0.12, 'sine', 0.16 * v);
        this.tone(1320, 0.18, 'sine', 0.14 * v, undefined, 0.11);
        break;
      case 'danger':
        this.tone(660, 0.12, 'square', 0.1 * v);
        this.tone(440, 0.18, 'square', 0.1 * v, undefined, 0.13);
        break;
      case 'rune':
        [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.07 * v, undefined, i * 0.05));
        break;
      case 'win':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.16 * v, undefined, i * 0.12));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.08 * v, undefined, i * 0.18));
        break;
      case 'wave':
        this.tone(220, 0.3, 'triangle', 0.06 * v, 330);
        break;
    }
  }

  // ── Фон: ветер, река, птицы днём и сверчки ночью ──

  startAmbient() {
    this.init();
    if (!this.ctx || this.ambientOn) return;
    this.ambientOn = true;
    const ctx = this.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    const wg = ctx.createGain();
    wg.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(wf).connect(wg).connect(this.amb);
    const river = ctx.createBufferSource();
    river.buffer = this.noiseBuf;
    river.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1100;
    rf.Q.value = 0.6;
    const rg = ctx.createGain();
    rg.gain.value = 0.035;
    river.connect(rf).connect(rg).connect(this.amb);
    wind.start();
    river.start();
    lfo.start();
  }

  /** Раз в несколько секунд — птица (день) или сверчок (ночь) */
  tick(dt: number) {
    if (!this.ctx || !this.ambientOn || this.ctx.state !== 'running') return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    this.birdTimer = 3 + Math.random() * 6;
    if (this.night) for (let k = 0; k < 3; k++) this.tone(4200, 0.05, 'sine', 0.02, undefined, k * 0.09, this.amb);
    else {
      const f = 2200 + Math.random() * 1400;
      this.tone(f, 0.12, 'sine', 0.03, f * 1.4, 0, this.amb);
      this.tone(f * 1.2, 0.1, 'sine', 0.025, f * 0.9, 0.15, this.amb);
    }
  }

  /** Звуки событий матча: громкость по расстоянию от центра экрана */
  events(events: SimEvent[], s: Snapshot, center: { x: number; z: number }, myUnit: number, mySlot: number) {
    const near = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - center.x, z - center.z) / 38);
    const pos = (id: number) => s.units.find((u) => u.id === id);
    for (const e of events) {
      switch (e.e) {
        case 'attack': {
          const u = pos(e.id);
          if (!u) break;
          const v = near(u.x, u.z) * (e.id === myUnit ? 1 : 0.5);
          this.play(u.k === 'tower' ? 'tower' : e.ranged ? 'shot' : 'melee', v);
          break;
        }
        case 'hit': {
          if (e.id !== myUnit && e.src !== myUnit) break;
          const u = pos(e.id);
          if (u && u.k === 'hero') this.play('hit', 0.7);
          break;
        }
        case 'cast': {
          const u = pos(e.id);
          const v = u ? near(u.x, u.z) : 0.5;
          const a = ABILITIES[e.ability];
          const id = e.ability;
          this.play(
            id === 'blink' || id === 'charge'
              ? 'blink'
              : id === 'shield' || id === 'stoneskin' || id === 'dome'
                ? 'shield'
                : id === 'mend'
                  ? 'heal'
                  : id === 'fireball' || id === 'meteor'
                    ? 'fire'
                    : a?.castTime
                      ? 'stun'
                      : 'cast',
            v,
          );
          break;
        }
        case 'fx':
          if (e.size >= 1.1 && (e.color === 0xff7a1f || e.color === 0xb08a5a || e.color === 0x9a7a52))
            this.play('boom', near(e.x, e.z));
          break;
        case 'death':
          if (e.kind === 'hero') this.play('death', 0.9);
          else if (e.kind === 'tower' || e.kind === 'ancient') this.play('crumble', 1);
          else this.play('creepDeath', near(e.x, e.z) * 0.6);
          break;
        case 'gold':
          if (e.player === mySlot) this.play('coin', 0.7);
          break;
        case 'level':
          if (e.player === mySlot) this.play('level');
          break;
        case 'buy':
          if (e.player === mySlot && e.item) this.play('buy');
          break;
        case 'ping':
          this.play(e.kind === 'danger' ? 'danger' : 'ping');
          break;
        case 'rune':
          if (e.taker) this.play('rune', near(e.x, e.z) + (e.taker === myUnit ? 1 : 0));
          break;
        case 'wave':
          this.play('wave', 0.4);
          break;
      }
    }
  }
}
