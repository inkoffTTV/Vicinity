// Сетевая сессия. Снимки приходят 15 раз в секунду; отрисовка идёт чуть в прошлом (≈120 мс)
// и интерполирует между двумя снимками — движение плавное даже при неровной сети.
// Свой герой предсказывается: после приказа «идти» он сразу идёт на экране, а сервер его догоняет;
// если расхождение большое (скачок, оглушение, упёрся в дерево) — позиция поправляется.
import { DT, type Command, type Snapshot, type Team } from '@pereprava/shared';
import type { Connection } from '../net/connection';
import type { Session } from './session';

const INTERP_DELAY = 0.12;

export class NetSession implements Session {
  readonly kind = 'net';
  private buffer: Snapshot[] = [];
  private prevC: Snapshot | null = null;
  private curC: Snapshot | null = null;
  /** Последний полученный (самый свежий) снимок */
  latest: Snapshot | null = null;
  private offset: number | null = null;
  private seq = 0;
  private renderT = 0;
  alpha = 1;
  // Предсказание своего героя
  private pred: { x: number; z: number } | null = null;
  private target: { x: number; z: number } | null = null;
  private unsub: () => void;

  constructor(
    readonly conn: Connection,
    readonly slot: number,
    readonly team: Team,
  ) {
    this.unsub = conn.on((m) => {
      if (m.t === 'snap') this.receive(m.s);
    });
  }

  get renderTick() {
    return this.renderT / DT;
  }

  private now() {
    return performance.now() / 1000;
  }

  receive(s: Snapshot) {
    if (this.latest && s.tick <= this.latest.tick) return;
    // Смещение часов сервера: берём самую «быструю» доставку, плавно отпускаем при росте задержки
    const o = s.tick * DT - this.now();
    if (this.offset === null || o > this.offset) this.offset = o;
    else this.offset += (o - this.offset) * 0.02;
    this.latest = s;
    this.buffer.push(s);
  }

  update(): Snapshot[] {
    const out: Snapshot[] = [];
    if (this.offset === null) return out;
    this.renderT = this.now() + this.offset - INTERP_DELAY;
    // Прошли время текущего снимка — нужен следующий, к которому интерполировать
    while (this.buffer.length && (!this.curC || this.renderT >= this.curC.tick * DT)) {
      this.prevC = this.curC;
      this.curC = this.buffer.shift()!;
      out.push(this.curC);
    }
    // Сильно отстали (вкладка была в фоне) — не проигрываем всё подряд
    if (this.buffer.length > 30) {
      const skip = this.buffer.splice(0, this.buffer.length - 2);
      out.push(...skip);
      this.prevC = skip[skip.length - 1];
    }
    if (this.prevC && this.curC && this.curC.tick > this.prevC.tick)
      this.alpha = Math.max(
        0,
        Math.min(1, (this.renderT - this.prevC.tick * DT) / ((this.curC.tick - this.prevC.tick) * DT)),
      );
    else this.alpha = 1;
    return out;
  }

  send(cmd: Command) {
    this.seq++;
    this.conn.send({ t: 'cmd', seq: this.seq, cmd });
    if (cmd.c === 'move') this.target = { x: cmd.x, z: cmd.z };
    else if (cmd.c === 'attack' || cmd.c === 'amove' || cmd.c === 'stop' || cmd.c === 'cast') this.target = null;
  }

  /** Позиция своего героя на экране: предсказанная, а без приказа — свежая серверная */
  predictOwn(dt: number, shown: { x: number; z: number } | null): { x: number; z: number } | null {
    const s = this.latest;
    const me = s?.me;
    const u = me && s.units.find((x) => x.id === me.unit);
    if (!u || u.dead || !me) {
      this.pred = null;
      this.target = null;
      return null;
    }
    if (!this.pred) this.pred = shown ? { ...shown } : { x: u.x, z: u.z };
    const p = this.pred;
    const speed = me.speed;
    if (this.target && !u.cast) {
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const d = Math.hypot(dx, dz);
      const st = Math.min(d, speed * dt);
      if (d > 0.05) {
        p.x += (dx / d) * st;
        p.z += (dz / d) * st;
      } else this.target = null;
      // Сервер отстаёт на задержку сети; поправляем, только если ушли дальше ожидаемого
      const err = Math.hypot(p.x - u.x, p.z - u.z);
      const allowed = speed * (this.conn.rtt / 1000 + 0.2) + 0.6;
      if (err > allowed) {
        const k = Math.min(1, dt * 4);
        p.x += (u.x - p.x) * k;
        p.z += (u.z - p.z) * k;
      }
      if (!u.mv && d < 0.5) this.target = null;
    } else {
      const k = Math.min(1, dt * 8);
      p.x += (u.x - p.x) * k;
      p.z += (u.z - p.z) * k;
    }
    if (Math.hypot(p.x - u.x, p.z - u.z) > 5 + speed * 0.4) {
      // Скачок, возрождение, оглушение — не спорим с сервером
      p.x = u.x;
      p.z = u.z;
      this.target = null;
    }
    return p;
  }

  dispose() {
    this.unsub();
  }
}
