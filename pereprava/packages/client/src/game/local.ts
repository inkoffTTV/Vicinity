// Одиночная игра: та же симуляция, что на сервере, крутится прямо в браузере с шагом 1/30 с.
import { createWorld, DT, makeSnapshot, queueCommand, step, type Command, type MatchSetup, type Snapshot, type Team, type World } from '@pereprava/shared';
import type { Session } from './session';

export class LocalSession implements Session {
  readonly kind = 'local';
  readonly world: World;
  readonly team: Team;
  private acc = 0;
  private last: Snapshot;
  /** Ускорение времени (#x4 для отладки) */
  speed = 1;
  paused = false;
  /** Видеть всю карту (отладка) */
  revealAll = false;

  constructor(
    setup: MatchSetup,
    readonly slot = 0,
  ) {
    this.world = createWorld(setup);
    this.team = this.world.players[slot].team;
    this.last = makeSnapshot(this.world, slot);
  }

  get alpha() {
    return this.acc / DT;
  }
  get renderTick() {
    return this.last.tick - 1 + this.alpha;
  }

  /** Начальный снимок (до первого тика) */
  snapshot(): Snapshot {
    return this.last;
  }

  update(dt: number): Snapshot[] {
    if (this.paused) return [];
    this.acc += dt * this.speed;
    const out: Snapshot[] = [];
    // Не больше 12 тиков за кадр: после сворачивания вкладки не «догоняем» минуты
    let n = 0;
    while (this.acc >= DT && n < 12) {
      this.acc -= DT;
      n++;
      this.stepOnce(out);
    }
    if (n === 12) this.acc = 0;
    return out;
  }

  private stepOnce(out: Snapshot[]) {
    step(this.world);
    this.last = makeSnapshot(this.world, this.slot, { all: this.revealAll });
    out.push(this.last);
  }

  /** Отладка: n тиков сразу */
  advance(n: number): Snapshot[] {
    const out: Snapshot[] = [];
    for (let i = 0; i < n && this.world.winner === -1; i++) this.stepOnce(out);
    return out;
  }

  send(cmd: Command) {
    queueCommand(this.world, this.slot, cmd);
  }

  dispose() {}
}
