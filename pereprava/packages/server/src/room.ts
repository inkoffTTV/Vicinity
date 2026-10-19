// Комната: лобби (выбор героя, «Готов») и матч. Симуляция идёт здесь, на сервере, с шагом 1/30 с;
// клиентам уходят снимки 15 раз в секунду, каждому — со своим туманом войны.
import {
  createWorld,
  DT,
  eventsFor,
  HEROES,
  HERO,
  makeSnapshot,
  MODE_SIZE,
  queueCommand,
  RECONNECT_GRACE_S,
  step,
  TICK_RATE,
  DIFFICULTIES,
  type Command,
  type GameMode,
  type LobbySlot,
  type RoomInfo,
  type ServerMsg,
  type SimEvent,
  type Team,
  type World,
} from '@pereprava/shared';
import type { Client } from './client';

const SNAP_EVERY = 2;
const START_COUNTDOWN_MS = 3000;
const OVER_LINGER_MS = 5 * 60_000;

export class Room {
  mode: GameMode;
  host: number;
  slots: LobbySlot[] = [];
  state: RoomInfo['state'] = 'lobby';
  difficulty = 'normal';
  world: World | null = null;
  /** Клиент в слоте (по id), только для людей */
  private clients = new Map<number, Client>();
  private pending: SimEvent[][] = [];
  private acks: number[] = [];
  private grace = new Map<number, NodeJS.Timeout>();
  private loop: NodeJS.Timeout | null = null;
  private countdown: NodeJS.Timeout | null = null;
  private acc = 0;
  private lastT = 0;
  lastActive = Date.now();

  constructor(
    readonly code: string,
    mode: GameMode,
    host: Client,
    private onEmpty: (room: Room) => void,
  ) {
    this.mode = mode;
    this.host = host.id;
    this.layout();
  }

  private layout() {
    const per = MODE_SIZE[this.mode];
    const humans = this.slots.filter((s) => s.client);
    this.slots = [];
    for (const team of [0, 1] as Team[])
      for (let i = 0; i < per; i++)
        this.slots.push({ team, client: 0, name: '', hero: HEROES[(i * 2 + team) % HEROES.length].id, ready: false, bot: true, online: false });
    for (const h of humans) {
      const s = this.freeSlot(h.team) ?? this.freeSlot(h.team ? 0 : 1);
      if (s) Object.assign(s, { ...h, ready: false });
      else this.clients.get(h.client)?.send({ t: 'room', room: null });
    }
  }

  private freeSlot(team?: Team): LobbySlot | undefined {
    const free = this.slots.filter((s) => !s.client && (team === undefined || s.team === team));
    return free[0];
  }

  info(): RoomInfo {
    return { code: this.code, mode: this.mode, host: this.host, slots: this.slots.map((s) => ({ ...s })), state: this.state, botDifficulty: this.difficulty };
  }

  broadcast(msg: ServerMsg) {
    for (const c of this.clients.values()) c.send(msg);
  }

  private sync() {
    this.lastActive = Date.now();
    this.broadcast({ t: 'room', room: this.info() });
  }

  slotOf(c: Client) {
    return this.slots.findIndex((s) => s.client === c.id);
  }

  get humans() {
    return this.slots.filter((s) => s.client).length;
  }

  // ── Лобби ──

  join(c: Client): string | null {
    if (this.state !== 'lobby') return 'Матч уже идёт';
    if (this.slotOf(c) >= 0) return null;
    const t0 = this.slots.filter((s) => s.team === 0 && s.client).length;
    const t1 = this.slots.filter((s) => s.team === 1 && s.client).length;
    const s = this.freeSlot(t0 <= t1 ? 0 : 1) ?? this.freeSlot();
    if (!s) return 'Комната заполнена';
    // Свободный герой, если на нём уже кто-то
    const used = new Set(this.slots.filter((x) => x.client).map((x) => x.hero));
    const hero = used.has(s.hero) ? (HEROES.find((h) => !used.has(h.id))?.id ?? s.hero) : s.hero;
    Object.assign(s, { client: c.id, name: c.name, hero, ready: false, bot: false, online: true });
    this.clients.set(c.id, c);
    c.room = this;
    this.sync();
    return null;
  }

  leave(c: Client) {
    const i = this.slotOf(c);
    this.clearGrace(c.id);
    this.clients.delete(c.id);
    if (c.room === this) c.room = null;
    if (i >= 0) {
      const s = this.slots[i];
      if (this.state === 'game' && this.world) {
        // Ушёл из матча — героя берёт бот
        this.world.players[i].bot = this.difficulty;
        Object.assign(s, { client: 0, bot: true, online: false });
      } else Object.assign(s, { client: 0, name: '', ready: false, bot: true, online: false });
    }
    this.cancelCountdown();
    if (this.host === c.id) this.host = [...this.clients.keys()][0] ?? 0;
    if (!this.clients.size) {
      this.stop();
      this.onEmpty(this);
      return;
    }
    this.sync();
  }

  pick(c: Client, hero: string) {
    const i = this.slotOf(c);
    if (i < 0 || this.state !== 'lobby' || !HERO[hero] || this.slots[i].ready) return;
    this.slots[i].hero = hero;
    this.sync();
  }

  switchTeam(c: Client, team: Team) {
    const i = this.slotOf(c);
    if (i < 0 || this.state !== 'lobby' || this.slots[i].team === team) return;
    const s = this.freeSlot(team);
    if (!s) return;
    Object.assign(s, { ...this.slots[i], team, ready: false });
    Object.assign(this.slots[i], { client: 0, name: '', ready: false, bot: true, online: false });
    this.sync();
  }

  setMode(c: Client, mode: GameMode) {
    if (c.id !== this.host || this.state !== 'lobby' || !MODE_SIZE[mode] || mode === this.mode) return;
    if (MODE_SIZE[mode] * 2 < this.humans) return;
    this.mode = mode;
    this.cancelCountdown();
    this.layout();
    this.sync();
  }

  setDifficulty(c: Client, d: string) {
    if (c.id !== this.host || this.state !== 'lobby' || !DIFFICULTIES[d]) return;
    this.difficulty = d;
    this.sync();
  }

  setReady(c: Client, ready: boolean) {
    const i = this.slotOf(c);
    if (i < 0 || this.state !== 'lobby') return;
    this.slots[i].ready = ready;
    this.sync();
    const humans = this.slots.filter((s) => s.client);
    if (humans.length && humans.every((s) => s.ready)) {
      if (!this.countdown) {
        this.broadcast({ t: 'error', text: 'Все готовы — матч начнётся через 3 секунды' });
        this.countdown = setTimeout(() => {
          this.countdown = null;
          this.start();
        }, START_COUNTDOWN_MS);
      }
    } else this.cancelCountdown();
  }

  private cancelCountdown() {
    if (this.countdown) {
      clearTimeout(this.countdown);
      this.countdown = null;
    }
  }

  // ── Матч ──

  start() {
    if (this.state !== 'lobby') return;
    const per = MODE_SIZE[this.mode];
    // Боты в пустых слотах берут героев, которых ещё нет в их команде
    for (const team of [0, 1] as Team[]) {
      const used = new Set(this.slots.filter((s) => s.team === team && s.client).map((s) => s.hero));
      for (const s of this.slots.filter((x) => x.team === team && !x.client)) {
        const free = HEROES.find((h) => !used.has(h.id)) ?? HEROES[0];
        s.hero = free.id;
        used.add(free.id);
        s.name = `Бот · ${free.name}`;
      }
    }
    void per;
    this.world = createWorld({
      seed: (Date.now() % 2147483646) + 1,
      players: this.slots.map((s) => ({ name: s.name, team: s.team, hero: s.hero, bot: s.client ? null : this.difficulty })),
      jungle: true,
    });
    this.state = 'game';
    this.pending = this.slots.map(() => []);
    this.acks = this.slots.map(() => 0);
    const players = this.slots.map((s) => ({ name: s.name, team: s.team, hero: s.hero, bot: !s.client }));
    this.slots.forEach((s, slot) => {
      const c = s.client ? this.clients.get(s.client) : undefined;
      c?.send({ t: 'start', slot, tick: 0, players });
    });
    this.sync();
    this.lastT = performance.now();
    this.acc = 0;
    this.loop = setInterval(() => this.tickLoop(), 1000 / TICK_RATE / 2);
  }

  private tickLoop() {
    const w = this.world;
    if (!w) return;
    const now = performance.now();
    this.acc += (now - this.lastT) / 1000;
    this.lastT = now;
    let n = 0;
    while (this.acc >= DT && n < 6) {
      this.acc -= DT;
      n++;
      step(w);
      this.slots.forEach((s, slot) => {
        if (s.client && s.online) this.pending[slot].push(...eventsFor(w, slot));
      });
      if (w.tick % SNAP_EVERY === 0 || w.winner !== -1) this.sendSnapshots();
      if (w.winner !== -1) {
        this.finish();
        return;
      }
    }
    if (n === 6) this.acc = 0;
  }

  private sendSnapshots() {
    const w = this.world!;
    this.slots.forEach((s, slot) => {
      const c = s.client ? this.clients.get(s.client) : undefined;
      if (!c || !s.online) {
        this.pending[slot] = [];
        return;
      }
      c.send({ t: 'snap', s: makeSnapshot(w, slot, { events: this.pending[slot] }), ack: this.acks[slot] });
      this.pending[slot] = [];
    });
  }

  /** Полный снимок одному игроку (после переподключения) */
  resend(c: Client) {
    const slot = this.slotOf(c);
    if (slot < 0 || !this.world) return;
    const players = this.slots.map((s) => ({ name: s.name, team: s.team, hero: s.hero, bot: !s.client }));
    c.send({ t: 'start', slot, tick: this.world.tick, players });
    c.send({ t: 'snap', s: makeSnapshot(this.world, slot, { events: [] }), ack: this.acks[slot] });
  }

  private finish() {
    this.stop();
    this.state = 'over';
    this.sync();
    // Комната живёт ещё немного: итоги, «Ещё раз»
    setTimeout(() => {
      if (this.state === 'over' && Date.now() - this.lastActive >= OVER_LINGER_MS - 1000) {
        for (const c of [...this.clients.values()]) this.leave(c);
      }
    }, OVER_LINGER_MS);
  }

  /** После матча — обратно в лобби тем же составом */
  rematch(c: Client) {
    if (this.state !== 'over' || this.slotOf(c) < 0) return;
    this.world = null;
    this.state = 'lobby';
    for (const s of this.slots) {
      s.ready = false;
      if (!s.client) Object.assign(s, { name: '', bot: true });
    }
    this.sync();
  }

  command(c: Client, seq: number, cmd: Command) {
    const slot = this.slotOf(c);
    if (slot < 0 || this.state !== 'game' || !this.world) return;
    queueCommand(this.world, slot, cmd);
    if (Number.isInteger(seq) && seq > this.acks[slot]) this.acks[slot] = seq;
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.cancelCountdown();
  }

  // ── Обрывы связи ──

  disconnected(c: Client) {
    const i = this.slotOf(c);
    if (i < 0) return;
    this.slots[i].online = false;
    this.slots[i].ready = this.state === 'lobby' ? false : this.slots[i].ready;
    this.cancelCountdown();
    this.sync();
    this.clearGrace(c.id);
    this.grace.set(
      c.id,
      setTimeout(() => {
        this.grace.delete(c.id);
        if (!c.online) this.leave(c);
      }, RECONNECT_GRACE_S * 1000),
    );
  }

  reconnected(c: Client) {
    this.clearGrace(c.id);
    const i = this.slotOf(c);
    if (i < 0) return;
    this.slots[i].online = true;
    if (this.state === 'lobby') this.slots[i].name = c.name;
    this.clients.set(c.id, c);
    this.sync();
    if (this.state === 'game') this.resend(c);
  }

  private clearGrace(id: number) {
    const t = this.grace.get(id);
    if (t) clearTimeout(t);
    this.grace.delete(id);
  }
}

export const isMode = (m: unknown): m is GameMode => m === '1v1' || m === '2v2';
