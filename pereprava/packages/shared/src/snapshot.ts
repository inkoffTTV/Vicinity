// Снимок мира для одного игрока. Туман войны считается здесь, на стороне симуляции:
// враги вне видимости команды в снимок не попадают вовсе, поэтому клиент не может их «подсмотреть».
// Тот же код работает и в одиночной игре — клиент рисует только снимки, как в сетевой.
import { FULL_REFUND_TIME, sellValue } from './sim/shop';
import { ABILITIES, abilityAt, manaCost } from './sim/abilities';
import { attrsOf, HERO } from './data/heroes';
import { hasFlag, modValue } from './sim/modifiers';
import { canLearn, nearShop, unitById, xpNeed, type World } from './sim/world';
import type { SimEvent, Side, Team, Unit, UnitKind } from './types';

export const VISION: Record<UnitKind, number> = { hero: 14, creep: 10, tower: 14, ancient: 14, neutral: 0 };

export interface UnitSnap {
  id: number;
  k: UnitKind;
  tm: Side;
  m: string;
  x: number;
  z: number;
  r: number;
  hp: number;
  mhp: number;
  rad: number;
  bh: number;
  inv?: 1;
  mv?: 1;
  dead?: 1;
  /** Тики последней атаки, полученного урона, каста */
  at: number;
  ht: number;
  ct: number;
  /** Запас щита */
  sh?: number;
  /** Герой: игрок и уровень */
  pl?: number;
  lv?: number;
  /** Идёт замах: способность, сколько осталось, сколько всего */
  cast?: { a: string; t: number; T: number };
  /** Значимые эффекты (оглушение, замедление…) */
  fx?: string[];
}

export interface ProjSnap {
  id: number;
  k: string;
  x: number;
  z: number;
  y0: number;
  tid: number;
  c: number;
  s: number;
  /** Модель того, кто выпустил (клиент выбирает вид снаряда: стрела, сгусток, болт) */
  sm?: string;
}

export interface ZoneSnap {
  id: number;
  k: string;
  x: number;
  z: number;
  r: number;
  t: number;
  d: number;
  tm: number;
}

export interface MeSnap {
  mana: number;
  maxMana: number;
  manaRegen: number;
  hpRegen: number;
  hp: number;
  maxHp: number;
  /** Уровни умений, свободные очки и можно ли сейчас повысить умение в слоте */
  skill: number[];
  points: number;
  canLearn: boolean[];
  manaCost: number[];
  attrs: { str: number; agi: number; int: number };
  primary: 'str' | 'agi' | 'int';
  /** Ударов в секунду */
  atkSpeed: number;
  tp: number;
  tpCd: number;
  neutral: string | null;
  stash: string[];
  courier: 'idle' | 'go' | 'back' | 'dead';
  courierAt: number;
  slot: number;
  unit: number;
  hero: string;
  alive: boolean;
  gold: number;
  level: number;
  xp: number;
  need: number;
  items: (string | null)[];
  itemCd: number[];
  /** Сколько вернут за предмет в слоте сейчас и сколько ещё секунд действует полный возврат */
  sell: number[];
  full: number[];
  /** Заряды умений по слотам (−1 — без зарядов) */
  charges: number[];
  cd: number[];
  cdMax: number[];
  respawn: number;
  nearShop: boolean;
  spellAmp: number;
  dmg: number;
  speed: number;
  armor: number;
}

export interface PlayerSnap {
  slot: number;
  team: Team;
  name: string;
  hero: string;
  bot: string | null;
  level: number;
  alive: boolean;
  respawn: number;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  gold: number;
  heroDamage: number;
  items: (string | null)[];
}

export interface Snapshot {
  tick: number;
  time: number;
  kills: [number, number];
  winner: -1 | Team;
  nextWave: number;
  units: UnitSnap[];
  projs: ProjSnap[];
  zones: ZoneSnap[];
  players: PlayerSnap[];
  events: SimEvent[];
  me: MeSnap | null;
  rune: { kind: string; x: number; z: number } | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Кто виден команде (свои — всегда; здания — всегда; остальные — в радиусе обзора своих) */
export function visibleIds(w: World, team: Team | -1): Set<number> {
  const out = new Set<number>();
  if (team === -1) {
    for (const u of w.units) out.add(u.id);
    return out;
  }
  const eyes: Unit[] = [];
  for (const u of w.units)
    if (u.team === team) {
      out.add(u.id);
      if (u.alive) eyes.push(u);
    }
  for (const u of w.units) {
    if (u.team === team) continue;
    if (u.kind === 'tower' || u.kind === 'ancient') {
      out.add(u.id);
      continue;
    }
    if (!u.alive || hasFlag(u, 'invisible')) continue;
    for (const e of eyes)
      if (Math.hypot(e.x - u.x, e.z - u.z) < VISION[e.kind] + u.radius) {
        out.add(u.id);
        break;
      }
  }
  return out;
}

/** Видна ли точка команде */
export function pointVisible(w: World, team: Team | -1, x: number, z: number): boolean {
  if (team === -1) return true;
  for (const u of w.units) if (u.team === team && u.alive && Math.hypot(u.x - x, u.z - z) < VISION[u.kind]) return true;
  return false;
}

function unitSnap(u: Unit): UnitSnap {
  const s: UnitSnap = {
    id: u.id,
    k: u.kind,
    tm: u.team,
    m: u.model,
    x: r2(u.x),
    z: r2(u.z),
    r: r2(u.rot),
    hp: Math.ceil(u.hp),
    mhp: Math.round(u.maxHp),
    rad: u.radius,
    bh: u.barH,
    at: u.atkTick,
    ht: u.hurtTick,
    ct: u.castTick,
  };
  if (u.invuln) s.inv = 1;
  if (u.moving) s.mv = 1;
  if (!u.alive) s.dead = 1;
  const sh = u.mods.find((m) => m.id === 'shield');
  if (sh && sh.v > 0) s.sh = Math.ceil(sh.v);
  if (u.hero) {
    s.pl = u.hero.player;
    s.lv = u.hero.level;
    const c = u.hero.casting;
    if (c) s.cast = { a: c.ability, t: r2(c.t), T: c.total };
  }
  const fxs = u.mods.filter((m) => m.id !== 'shield' && m.id !== 'potion').map((m) => m.id);
  if (u.mods.some((m) => m.id === 'potion')) fxs.push('potion');
  if (fxs.length) s.fx = fxs;
  return s;
}

function eventVisible(w: World, e: SimEvent, team: Team | -1, slot: number, vis: Set<number>): boolean {
  if (team === -1) return true;
  switch (e.e) {
    case 'fx':
    case 'rune':
      return pointVisible(w, team, e.x, e.z);
    case 'hit':
      return vis.has(e.id);
    case 'attack':
    case 'cast':
      return vis.has(e.id);
    case 'death':
      return e.team === team || pointVisible(w, team, e.x, e.z);
    case 'gold':
    case 'buy':
    case 'castFail':
      return e.player === slot;
    case 'level':
    case 'respawn':
      return e.player === slot || vis.has(e.id);
    case 'ping':
      return e.team === team;
    default:
      return true;
  }
}

/** События текущего тика, которые положено знать игроку slot (сервер копит их между снимками) */
export function eventsFor(w: World, slot: number, all = false): SimEvent[] {
  const p = w.players[slot];
  const team: Team | -1 = all || !p ? -1 : p.team;
  const vis = visibleIds(w, team);
  return w.events.filter((e) => eventVisible(w, e, team, slot, vis));
}

/** Снимок для игрока slot (team -1 — всё видно: наблюдатель, отладка) */
export function makeSnapshot(w: World, slot: number, opts: { all?: boolean; events?: SimEvent[] } = {}): Snapshot {
  const p = w.players[slot];
  const team: Team | -1 = opts.all || !p ? -1 : p.team;
  const vis = visibleIds(w, team);
  const units: UnitSnap[] = [];
  for (const u of w.units) if (vis.has(u.id)) units.push(unitSnap(u));
  const projs: ProjSnap[] = [];
  for (const pr of w.projs)
    if (pr.team === team || pointVisible(w, team, pr.x, pr.z))
      projs.push({
        id: pr.id,
        k: pr.kind,
        x: r2(pr.x),
        z: r2(pr.z),
        y0: pr.y0,
        tid: pr.target,
        c: pr.color,
        s: pr.size,
        sm: unitById(w, pr.src)?.model,
      });
  const zones: ZoneSnap[] = [];
  for (const z of w.zones)
    if (z.team === team || team === -1 || (!z.hidden && pointVisible(w, team, z.x, z.z)))
      zones.push({ id: z.id, k: z.kind, x: r2(z.x), z: r2(z.z), r: z.r, t: r2(z.t), d: r2(z.delay), tm: z.team });
  let me: MeSnap | null = null;
  const mu = p && unitById(w, p.unit);
  if (mu?.hero) {
    const h = mu.hero;
    me = {
      slot,
      unit: mu.id,
      hero: h.def,
      alive: mu.alive,
      gold: Math.floor(h.gold),
      level: h.level,
      xp: Math.floor(h.xp),
      need: xpNeed(h.level),
      items: [...h.items],
      itemCd: h.itemCd.map(r2),
      charges: [...h.charges],
      sell: h.items.map((id, i) => (id ? sellValue(id, h.itemT[i], h.itemPaid[i], w.time) : 0)),
      full: h.items.map((id, i) =>
        id && h.itemPaid[i] > 0 ? r2(Math.max(0, FULL_REFUND_TIME - (w.time - h.itemT[i]))) : 0,
      ),
      // Заряды кончились — показываем, сколько до следующего
      cd: h.cd.map((c, i) => r2(h.charges[i] === 0 ? Math.max(c, h.chargeT[i]) : c)),
      cdMax: HERO[h.def].abilities.map((_, i) => abilityAt(mu, i)?.cd ?? 1),
      respawn: r2(h.respawn),
      nearShop: nearShop(w, mu),
      spellAmp: h.spellAmp,
      dmg: Math.round(mu.dmg),
      speed: r2(mu.speed * (1 - modValue(mu, 'slow'))),
      armor: r2(mu.armor + modValue(mu, 'armor')),
      mana: Math.floor(h.mana),
      maxMana: h.maxMana,
      manaRegen: r2(h.manaRegen),
      hpRegen: r2(h.regen + modValue(mu, 'heal')),
      hp: Math.ceil(mu.hp),
      maxHp: Math.round(mu.maxHp),
      skill: [...h.skill],
      points: h.points,
      canLearn: [0, 1, 2, 3].map((i) => canLearn(mu, i)),
      manaCost: HERO[h.def].abilities.map((id) => manaCost(ABILITIES[id])),
      attrs: { ...h.attrs },
      primary: attrsOf(HERO[h.def]).primary,
      atkSpeed: r2(1 / mu.atkInt),
      tp: h.tp,
      tpCd: r2(h.tpCd),
      neutral: h.neutral,
      stash: h.stash.map((s) => s.id),
      courier: (() => {
        const c = unitById(w, h.courier);
        return c?.alive ? (c.cState ?? 'idle') : 'dead';
      })(),
      courierAt: r2(Math.max(0, h.courierAt)),
    };
  }
  const players: PlayerSnap[] = w.players.map((q) => {
    const u = unitById(w, q.unit)!;
    return {
      slot: q.slot,
      team: q.team,
      name: q.name,
      hero: q.heroDef,
      bot: q.bot,
      level: u.hero!.level,
      alive: u.alive,
      respawn: r2(u.hero!.respawn),
      ...q.stats,
      gold: Math.floor(q.stats.gold),
      heroDamage: Math.round(q.stats.heroDamage),
      items: q.team === team || team === -1 || w.winner !== -1 ? [...u.hero!.items] : [],
    };
  });
  const rune = w.rune && pointVisible(w, team, w.rune.x, w.rune.z) ? { ...w.rune } : null;
  return {
    tick: w.tick,
    time: r2(w.time),
    kills: [...w.kills],
    winner: w.winner,
    nextWave: w.nextWave,
    units,
    projs,
    zones,
    players,
    events: opts.events ?? w.events.filter((e) => eventVisible(w, e, team, slot, vis)),
    me,
    rune,
  };
}

export { ABILITIES };
