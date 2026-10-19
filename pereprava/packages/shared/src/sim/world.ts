// Мир Переправы и его тик. Шаг фиксированный — 1/30 с. Всё случайное идёт через world.seed,
// поэтому одинаковые команды в одинаковые тики дают одинаковый мир (на сервере, у клиента, в тестах).
//
// Порядок тика повторяет прототип 0.3: волна → таймеры атак → герои (игрок или бот) → крипы и вышки →
// нейтралы → столкновения → снаряды → уборка мёртвых.
import { difficulty } from '../data/difficulty';
import { HERO } from '../data/heroes';
import { ITEM } from '../data/items';
import {
  getMap,
  laneAhead,
  laneDir,
  lanePoints,
  mapIdForTeamSize,
  treeGrid,
  type MapDef,
  type MapId,
  type P2,
  type Tree,
} from '../map';
import { findPath } from '../nav';
import { RNG_MOD, rngNext } from '../rng';
import type {
  Camp,
  Command,
  DamageType,
  Modifier,
  Order,
  Player,
  Projectile,
  Rune,
  Side,
  SimEvent,
  Team,
  Unit,
  UnitKind,
  Zone,
} from '../types';
import { ABILITIES, abilityAt, castAbility, fireCasting } from './abilities';
import { botThink } from './ai';
import { aggroNeutral, updateCamps, updateNeutral, setupCamps, updateRunes } from './jungle';
import { addMod, hasFlag, modValue, removeMod, tickModifiers } from './modifiers';
import { useItem } from './items';

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const WAVE_INTERVAL = 25;
export const SHOP_RADIUS = 14;
export const MAX_LEVEL = 10;
export const ULT_LEVEL = 6;
export const INVENTORY = 6;
export const TEAM_COLORS = [0x3ec7a1, 0xe2504a] as const;

/** Числа баланса зданий и крипов (подбирались прогонами бот против бота: npm run balance) */
export const BALANCE = {
  towerHp: 2600,
  towerDmg: 95,
  towerArmor: 6,
  ancientHp: 5500,
  ancientArmor: 6,
  /** Рост здоровья и урона крипов за минуту матча, доля */
  creepGrowth: 0.05,
  /** «Укрепления»: первые минуты здания получают меньше урона */
  fortifyUntil: 10 * 60,
  fortify: 0.5,
  /** Каждая разрушенная вражеская вышка усиливает свои волны */
  creepPerTower: 0.25,
  /** После этой минуты здания с каждой минутой получают больше урона (затяжные матчи заканчиваются) */
  decayFrom: 20,
  decayPerMin: 0.08,
  /** Возрождение: база + за уровень, с (прототип: 4 + 1,2 за уровень) */
  respawnBase: 4,
  respawnLvl: 2,
};

export interface PlayerSetup {
  name: string;
  team: Team;
  hero: string;
  /** null — человек; иначе сложность бота */
  bot: string | null;
}

export interface MatchSetup {
  seed?: number;
  players: PlayerSetup[];
  /** Карта: по умолчанию — по числу игроков в команде (1v1 / 2v2 / 3v3) */
  mode?: MapId;
  /** Лесные лагеря и руна (фаза 3); прототип — без них */
  jungle?: boolean;
}

export interface World {
  /** Карта матча (MapDef — getMap(w.mapId)) */
  mapId: MapId;
  tick: number;
  time: number;
  nextWave: number;
  seed: number;
  units: Unit[];
  nextId: number;
  projs: Projectile[];
  players: Player[];
  kills: [number, number];
  winner: -1 | Team;
  events: SimEvent[];
  pending: { player: number; cmd: Command }[];
  camps: Camp[];
  rune: Rune | null;
  nextRune: number;
  jungle: boolean;
  zones: Zone[];
}

// Индекс юнитов по id — вне состояния (его можно пересобрать в любой момент)
const indexes = new WeakMap<World, Map<number, Unit>>();
function index(w: World): Map<number, Unit> {
  let m = indexes.get(w);
  if (!m) {
    m = new Map(w.units.map((u) => [u.id, u]));
    indexes.set(w, m);
  }
  return m;
}
export const unitById = (w: World, id: number): Unit | undefined => (id ? index(w).get(id) : undefined);

/** Случайное число [0, 1) из состояния мира */
export function rand(w: World): number {
  w.seed = rngNext(w.seed);
  return w.seed / RNG_MOD;
}

export const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Дистанция атаки до края цели */
export const reach = (u: Unit, t: Unit) => u.range + t.radius + (u.ranged ? 0 : u.radius);
export const xpNeed = (level: number) => 80 + level * 40;
export const isEnemy = (a: Side, b: Side) => a !== b;

export function emit(w: World, e: SimEvent) {
  w.events.push(e);
}
export function fx(w: World, x: number, z: number, h: number, color: number, size: number, life: number, grow = 1.6) {
  emit(w, { e: 'fx', k: 'puff', x, z, h, color, size, life, grow });
}

// ── Создание ──

const UNIT_DEFAULTS = {
  alive: true,
  invuln: false,
  radius: 0.7,
  rot: 0,
  speed: 0,
  dmg: 0,
  range: 0,
  atkInt: 1,
  atkTimer: 0,
  ranged: false,
  armor: 0,
  magicRes: 0,
  target: 0,
  retarget: 0,
  forced: 0,
  moving: false,
  atkTick: -100,
  hurtTick: -100,
  castTick: -100,
  barH: 2,
};

export function addUnit(
  w: World,
  o: Partial<Unit> & { kind: UnitKind; team: Side; x: number; z: number; maxHp: number; model: string },
): Unit {
  const u: Unit = { ...UNIT_DEFAULTS, id: w.nextId++, hp: o.maxHp, mods: [], ...o } as Unit;
  w.units.push(u);
  index(w).set(u.id, u);
  return u;
}

/** Пересчёт характеристик героя от уровня и предметов (как recalc в прототипе) */
export function recalc(u: Unit) {
  const h = u.hero!;
  const def = HERO[h.def];
  const old = u.maxHp || 0;
  let hp = h.baseHp + def.hpLvl * (h.level - 1);
  let dmg = h.baseDmg + def.dmgLvl * (h.level - 1);
  let sp = def.baseSpeed;
  let rg = 2.5;
  let amp = 1;
  let armor = def.armor;
  let atkSpeed = 0;
  let lifesteal = 0;
  let cdr = 0;
  for (const id of h.items) {
    if (!id) continue;
    const it = ITEM[id];
    hp += it.hp ?? 0;
    dmg += it.dmg ?? 0;
    sp += it.speed ?? 0;
    rg += it.regen ?? 0;
    amp += it.spellAmp ?? 0;
    armor += it.armor ?? 0;
    atkSpeed += it.atkSpeed ?? 0;
    lifesteal += it.lifesteal ?? 0;
    cdr += it.cdr ?? 0;
  }
  u.maxHp = hp;
  u.dmg = dmg;
  u.speed = sp;
  u.armor = armor;
  u.atkInt = def.atkInt / (1 + atkSpeed);
  h.regen = rg;
  h.spellAmp = amp;
  h.bonusAtkSpeed = atkSpeed;
  h.lifesteal = lifesteal;
  h.cdr = Math.min(0.4, cdr);
  if (old) u.hp = Math.min(u.maxHp, u.hp + Math.max(0, u.maxHp - old));
}

/** Где стоит герой при старте и после возрождения: слоты одной команды — рядом */
function heroSpot(base: P2, team: Team, idx: number): P2 {
  if (!idx) return { x: base.x, z: base.z };
  const d = laneDir(team);
  const side = idx % 2 ? 1 : -1;
  const k = Math.ceil(idx / 2) * 2.4 * side;
  return { x: base.x - d.z * k, z: base.z + d.x * k };
}

/** Карта мира */
export const mapOf = (w: World): MapDef => getMap(w.mapId);

export function createWorld(setup: MatchSetup): World {
  const teamSize = Math.max(1, ...[0, 1].map((t) => setup.players.filter((p) => p.team === t).length));
  const mapId = setup.mode ?? mapIdForTeamSize(teamSize);
  const map = getMap(mapId);
  const w: World = {
    mapId,
    tick: 0,
    time: 0,
    nextWave: 1,
    seed: setup.seed ?? 20261019,
    units: [],
    nextId: 1,
    projs: [],
    players: [],
    kills: [0, 0],
    winner: -1,
    events: [],
    pending: [],
    camps: [],
    rune: null,
    nextRune: 90,
    jungle: !!setup.jungle,
    zones: [],
  };
  const perTeam = [0, 0];
  setup.players.forEach((ps, slot) => {
    const def = HERO[ps.hero] ?? HERO.mage;
    const diff = difficulty(ps.bot);
    const idx = perTeam[ps.team]++;
    const start = heroSpot(map.starts[ps.team], ps.team, idx);
    const u = addUnit(w, {
      kind: 'hero',
      team: ps.team,
      model: def.id,
      x: start.x,
      z: start.z,
      maxHp: 0,
      radius: def.radius,
      range: def.range,
      ranged: def.ranged,
      barH: def.barH,
      rot: ps.team ? -Math.PI * 0.25 : Math.PI * 0.75,
    });
    u.hero = {
      def: def.id,
      player: slot,
      level: 1,
      xp: 0,
      gold: 0,
      items: Array(INVENTORY).fill(null),
      cd: [0, 0, 0, 0],
      itemCd: Array(INVENTORY).fill(0),
      respawn: 0,
      order: null,
      casting: null,
      queued: null,
      // Сложность усиливает только героя бота (как в прототипе)
      baseHp: def.baseHp * (ps.bot ? diff.hp : 1),
      baseDmg: def.baseDmg * (ps.bot ? diff.dmg : 1),
      regen: 2.5,
      spellAmp: 1,
      bonusArmor: 0,
      bonusAtkSpeed: 0,
      lifesteal: 0,
      cdr: 0,
      stacks: 0,
    };
    recalc(u);
    u.hp = u.maxHp;
    w.players.push({
      slot,
      team: ps.team,
      name: ps.name,
      heroDef: def.id,
      unit: u.id,
      bot: ps.bot,
      // Линия бота: игроки команды по очереди раскладываются по линиям карты
      ai: { mode: 'lane', think: 0, buyIdx: 0, lane: botLane(map, idx) },
      stats: { kills: 0, deaths: 0, assists: 0, lastHits: 0, denies: 0, gold: 0, heroDamage: 0 },
      hurtBy: {},
    });
  });
  for (const tw of map.towers)
    addUnit(w, {
      kind: 'tower',
      team: tw.team,
      model: 'tower',
      tier: tw.tier,
      lane: tw.lane,
      x: tw.x,
      z: tw.z,
      maxHp: BALANCE.towerHp,
      dmg: BALANCE.towerDmg,
      armor: BALANCE.towerArmor,
      range: 12,
      atkInt: 1.2,
      ranged: true,
      radius: 2.2,
      barH: 8.4,
      // Внутренняя вышка неуязвима, пока стоит внешняя на той же линии
      invuln: tw.tier === 2,
    });
  for (const t of [0, 1] as Team[])
    addUnit(w, {
      kind: 'ancient',
      team: t,
      model: 'ancient',
      x: map.ancients[t].x,
      z: map.ancients[t].z,
      maxHp: BALANCE.ancientHp,
      armor: BALANCE.ancientArmor,
      radius: 3.6,
      barH: 8.6,
      invuln: true,
    });
  if (w.jungle) setupCamps(w);
  return w;
}

// ── Запросы ──

export const heroOf = (w: World, slot: number) => unitById(w, w.players[slot]?.unit ?? 0);
export const playerOf = (w: World, u: Unit) => (u.hero ? w.players[u.hero.player] : undefined);
export const heroes = (w: World) => w.units.filter((u) => u.kind === 'hero');
/** Передняя вышка команды на линии (без линии — на любой): живая с наименьшим ярусом
 *  (или последняя павшая, если живых нет) */
export const towerOf = (w: World, team: number, lane?: number) => {
  const ts = w.units
    .filter((u) => u.kind === 'tower' && u.team === team && (lane === undefined || u.lane === lane))
    .sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1));
  return ts.find((u) => u.alive) ?? ts[ts.length - 1];
};
export const ancientOf = (w: World, team: number) => w.units.find((u) => u.kind === 'ancient' && u.team === team);
export const nearShop = (w: World, u: Unit) => {
  if (!u.alive || u.team === 2) return false;
  const f = mapOf(w).fountains[u.team];
  return Math.hypot(u.x - f.x, u.z - f.z) < SHOP_RADIUS;
};

/** Линия бота по номеру в команде: 1v1 — единственная, 2v2 — верх/низ, 3v3 — центр, верх, низ */
function botLane(map: MapDef, idx: number): number {
  const n = map.lanes.length;
  if (n === 3) return [1, 0, 2][idx % 3];
  return idx % n;
}

/** Ближайший враг в радиусе (до края цели); нейтралов не трогает — их бьют только приказом */
export function nearestEnemy(w: World, u: Unit, r: number, filter?: (v: Unit) => boolean): Unit | null {
  let best: Unit | null = null;
  let bd = 1e9;
  for (const v of w.units) {
    if (!v.alive || v.team === u.team || v.team === 2 || v.invuln || hasFlag(v, 'invisible') || (filter && !filter(v)))
      continue;
    const d = dist(u, v) - v.radius;
    if (d < r && d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

// ── Приказы ──

export function queueCommand(w: World, player: number, cmd: Command) {
  w.pending.push({ player, cmd });
}

const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Сбитый замах не тратит перезарядку */
export function cancelCast(u: Unit) {
  if (u.hero) u.hero.queued = null;
  const c = u.hero?.casting;
  if (!c) return;
  const slot = HERO[u.hero!.def].abilities.indexOf(c.ability);
  if (slot >= 0) u.hero!.cd[slot] = 0;
  u.hero!.casting = null;
}

function applyCommand(w: World, slot: number, cmd: Command) {
  const p = w.players[slot];
  const u = p && unitById(w, p.unit);
  if (!u?.hero || w.winner !== -1) return;
  const h = u.hero;
  switch (cmd.c) {
    case 'move':
      if (!u.alive || !okNum(cmd.x) || !okNum(cmd.z)) return;
      cancelCast(u);
      removeMod(u, 'recall');
      h.order = { type: 'move', x: clamp(cmd.x, -58, 58), z: clamp(cmd.z, -58, 58), st: 0, best: Infinity };
      return;
    case 'attack': {
      const t = unitById(w, cmd.id);
      if (!u.alive || !t?.alive || t.team === u.team || t.invuln) return;
      cancelCast(u);
      h.order = { type: 'attack', id: t.id, auto: false };
      return;
    }
    case 'stop':
      h.order = null;
      cancelCast(u);
      return;
    case 'cast':
      if (!Number.isInteger(cmd.slot)) return;
      castAbility(w, u, cmd.slot, okNum(cmd.x) && okNum(cmd.z) ? { x: cmd.x, z: cmd.z, id: cmd.id ?? 0 } : null);
      return;
    case 'buy':
      buyItem(w, u, cmd.item);
      return;
    case 'sell':
      sellItem(w, u, cmd.slot);
      return;
    case 'use':
      if (!Number.isInteger(cmd.slot)) return;
      useItem(w, u, cmd.slot, okNum(cmd.x) && okNum(cmd.z) ? { x: cmd.x, z: cmd.z } : null);
      return;
    case 'ping':
      // Не чаще двух раз в секунду — чтобы пинги не превращались в спам
      if (!okNum(cmd.x) || !okNum(cmd.z) || w.time - (p.pingAt ?? -9) < 0.5) return;
      p.pingAt = w.time;
      emit(w, {
        e: 'ping',
        player: slot,
        team: p.team,
        x: clamp(cmd.x, -60, 60),
        z: clamp(cmd.z, -60, 60),
        kind: cmd.kind === 'danger' || cmd.kind === 'go' ? cmd.kind : 'look',
      });
      return;
  }
}

// ── Лавка ──

/** Цена с учётом компонентов, которые уже лежат в инвентаре (клиент считает так же) */
export function itemCostFor(items: readonly (string | null)[], id: string): { cost: number; consume: number[] } {
  const it = ITEM[id];
  const consume: number[] = [];
  let cost = it.price;
  if (it.parts) {
    const used = new Set<number>();
    for (const part of it.parts) {
      const i = items.findIndex((x, j) => x === part && !used.has(j));
      if (i >= 0) {
        used.add(i);
        consume.push(i);
        cost -= ITEM[part].price;
      }
    }
  }
  return { cost: Math.max(0, cost), consume };
}
export const itemCost = (u: Unit, id: string) => itemCostFor(u.hero!.items, id);

/** Можно ли купить, если известны только золото и инвентарь (для интерфейса) */
export function canAfford(items: readonly (string | null)[], gold: number, id: string): boolean {
  const it = ITEM[id];
  if (!it) return false;
  const { cost, consume } = itemCostFor(items, id);
  if (gold < cost) return false;
  if (items.filter((x) => !x).length + consume.length < 1) return false;
  return !(it.unique && items.includes(id));
}

export function canBuy(w: World, u: Unit, id: string): boolean {
  return !!u.hero && nearShop(w, u) && canAfford(u.hero.items, u.hero.gold, id);
}

export function buyItem(w: World, u: Unit, id: string, force = false): boolean {
  if (!force && !canBuy(w, u, id)) return false;
  const h = u.hero!;
  const { cost, consume } = itemCost(u, id);
  if (h.gold < cost) return false;
  for (const i of consume) h.items[i] = null;
  const slot = h.items.indexOf(null);
  if (slot < 0) return false;
  h.gold -= cost;
  h.items[slot] = id;
  h.itemCd[slot] = 0;
  recalc(u);
  emit(w, { e: 'buy', player: h.player, item: id });
  return true;
}

function sellItem(w: World, u: Unit, slot: number) {
  const h = u.hero;
  if (!h || !nearShop(w, u) || !Number.isInteger(slot)) return;
  const id = h.items[slot];
  if (!id) return;
  h.items[slot] = null;
  h.gold += Math.floor(ITEM[id].price / 2);
  recalc(u);
  emit(w, { e: 'buy', player: h.player, item: '' });
}

// ── Урон, смерть, награды ──

/** Множитель физического урона от брони (формула со знаком: отрицательная броня — больше урона) */
export const armorMult = (a: number) => 1 - (0.06 * a) / (1 + 0.06 * Math.abs(a));

export function damage(w: World, t: Unit, amt: number, src: Unit | null, type: DamageType = 'physical'): number {
  if (!t.alive || t.invuln || amt <= 0) return 0;
  // Вышка заступается за своего героя, на которого напал вражеский герой рядом с ней
  if (src?.kind === 'hero' && t.kind === 'hero')
    for (const tw of w.units)
      if (tw.kind === 'tower' && tw.alive && tw.team === t.team && dist(tw, src) <= tw.range + src.radius) {
        tw.target = src.id;
        tw.forced = 2.5;
      }
  if (type === 'physical') amt *= armorMult(t.armor + modValue(t, 'armor'));
  else if (type === 'magical') amt *= 1 - t.magicRes;
  amt *= 1 + modValue(t, 'vuln');
  amt *= 1 - Math.min(0.8, modValue(t, 'resist'));
  if (t.kind === 'tower' || t.kind === 'ancient') {
    if (w.time < BALANCE.fortifyUntil) amt *= 1 - BALANCE.fortify;
    const late = w.time / 60 - BALANCE.decayFrom;
    if (late > 0) amt *= 1 + BALANCE.decayPerMin * late;
  }
  // Здания без своих вражеских крипов рядом получают меньше урона (защита от «прокрадывания»)
  if (
    (t.kind === 'tower' || t.kind === 'ancient') &&
    src?.kind === 'hero' &&
    !w.units.some((c) => c.alive && c.kind === 'creep' && c.team === src.team && dist(c, t) < 14)
  )
    amt *= 1 - BACKDOOR;
  // Щит поглощает урон первым
  let shielded = false;
  for (const m of t.mods)
    if (m.id === 'shield' && m.v > 0) {
      const a = Math.min(m.v, amt);
      m.v -= a;
      amt -= a;
      shielded = true;
      if (m.v <= 0) m.t = 0;
    }
  if (amt <= 0) {
    emit(w, { e: 'hit', id: t.id, src: src?.id ?? 0, amt: 0, shield: shielded });
    return 0;
  }
  t.hp -= amt;
  t.hurtTick = w.tick;
  if (t.kind === 'neutral' && src) aggroNeutral(w, t, src);
  emit(w, { e: 'hit', id: t.id, src: src?.id ?? 0, amt, shield: shielded });
  if (src?.hero && t.kind === 'hero') {
    const sp = w.players[src.hero.player];
    sp.stats.heroDamage += amt;
    w.players[t.hero!.player].hurtBy[sp.slot] = w.tick;
  }
  if (src?.hero && src.hero.lifesteal > 0 && type === 'physical')
    src.hp = Math.min(src.maxHp, src.hp + amt * src.hero.lifesteal);
  if (t.hp <= 0) {
    t.hp = 0;
    kill(w, t, src);
  }
  return amt;
}

export function addGold(w: World, u: Unit, n: number, at?: P2) {
  const h = u.hero!;
  h.gold += n;
  w.players[h.player].stats.gold += n;
  if (at) emit(w, { e: 'gold', player: h.player, amt: n, x: at.x, z: at.z });
}

export function addXp(w: World, u: Unit, n: number) {
  const h = u.hero!;
  if (h.level >= MAX_LEVEL) return;
  h.xp += n;
  while (h.level < MAX_LEVEL && h.xp >= xpNeed(h.level)) {
    h.xp -= xpNeed(h.level);
    h.level++;
    recalc(u);
    emit(w, { e: 'level', id: u.id, player: h.player, level: h.level });
    if (u.alive) fx(w, u.x, u.z, 1, 0xf1c453, 1, 0.6, 2.5);
  }
}

function kill(w: World, t: Unit, src: Unit | null) {
  t.alive = false;
  emit(w, { e: 'death', id: t.id, kind: t.kind, team: t.team, killer: src?.id ?? 0, x: t.x, z: t.z });
  if (t.kind === 'hero') {
    const h = t.hero!;
    h.order = null;
    h.casting = null;
    t.mods = [];
    h.respawn = BALANCE.respawnBase + h.level * BALANCE.respawnLvl;
    const team = t.team as Team;
    w.kills[1 - team]++;
    fx(w, t.x, t.z, 1, team ? 0xff6a5a : 0x8f95ff, 1, 0.6, 2);
    const victim = w.players[h.player];
    victim.stats.deaths++;
    // Убийца — напавший герой, иначе ближайший живой вражеский герой (фонтан, крипы, вышка)
    let killer: Unit | null = src?.kind === 'hero' ? src : null;
    if (!killer) {
      let bd = 15;
      for (const v of w.units)
        if (v.kind === 'hero' && v.alive && v.team !== t.team && dist(v, t) < bd) {
          bd = dist(v, t);
          killer = v;
        }
    }
    if (killer) {
      addGold(w, killer, 200 + h.level * 10, t);
      addXp(w, killer, 100 + h.level * 20);
      w.players[killer.hero!.player].stats.kills++;
    }
    for (const [slot, tick] of Object.entries(victim.hurtBy)) {
      const p = w.players[+slot];
      if (p && p.unit !== killer?.id && w.tick - tick < 10 * TICK_RATE) p.stats.assists++;
    }
    victim.hurtBy = {};
    emit(w, { e: 'heroKill', victim: t.id, killer: killer?.id ?? 0, victimTeam: team });
    return;
  }
  if (t.kind === 'creep' || t.kind === 'neutral') {
    if (src?.hero) {
      const p = w.players[src.hero.player];
      if (src.team !== t.team) {
        const bounty = t.kind === 'neutral' ? neutralBounty(t) : 34 + Math.floor(rand(w) * 10);
        addGold(w, src, bounty, t);
        p.stats.lastHits++;
      } else p.stats.denies++;
    }
    const xpKill = t.kind === 'neutral' ? 55 : 45;
    const xpNear = t.kind === 'neutral' ? 0 : 25;
    for (const v of w.units)
      if (v.kind === 'hero' && v.alive && v.team !== t.team && dist(v, t) < 15) {
        const n = src === v ? xpKill : xpNear;
        if (n) addXp(w, v, n);
      }
    return;
  }
  if (t.kind === 'tower') {
    const inner = w.units.find(
      (u) => u.kind === 'tower' && u.team === t.team && u.lane === t.lane && u.alive && (u.tier ?? 1) > (t.tier ?? 1),
    );
    if (inner) inner.invuln = false;
    else {
      const an = ancientOf(w, t.team);
      if (an) an.invuln = false;
    }
    fx(w, t.x, t.z, 5, 0x9c9484, 2, 0.9, 2.5);
    for (const v of w.units) if (v.kind === 'hero' && v.team !== t.team) addGold(w, v, 150, v === src ? t : undefined);
    emit(w, { e: 'tower', team: t.team as Team, tier: t.tier ?? 1, lane: t.lane ?? 0 });
    return;
  }
  if (t.kind === 'ancient') {
    fx(w, t.x, t.z, 5, TEAM_COLORS[t.team as Team], 3, 1.2, 3);
    w.winner = (1 - (t.team as Team)) as Team;
    emit(w, { e: 'win', team: w.winner });
  }
}

const neutralBounty = (t: Unit) => (t.model === 'n_big' ? 62 : 38);

/** Насколько здания без крипов рядом защищены от героев */
export const BACKDOOR = 0.5;

/** Лечение (не выше максимума) */
export function heal(w: World, u: Unit, amt: number) {
  if (!u.alive || amt <= 0) return;
  u.hp = Math.min(u.maxHp, u.hp + amt);
  fx(w, u.x, u.z, 1.2, 0x7dff9a, 0.6, 0.45, 1.8);
}

// ── Движение и атака ──

export function speedOf(u: Unit): number {
  if (hasFlag(u, 'root') || hasFlag(u, 'stun')) return 0;
  return Math.max(0.5, u.speed * (1 - modValue(u, 'slow')) * (1 + modValue(u, 'haste')));
}

export function moveToward(u: Unit, tx: number, tz: number, stop = 0): boolean {
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop + 0.05) return true;
  const s = Math.min(speedOf(u) * DT, d - stop);
  if (s <= 0) return false;
  u.x += (dx / d) * s;
  u.z += (dz / d) * s;
  u.rot = Math.atan2(dx, dz);
  u.moving = true;
  return false;
}

export function tryAttack(w: World, u: Unit, t: Unit) {
  if (u.speed) u.rot = Math.atan2(t.x - u.x, t.z - u.z);
  if (u.atkTimer > 0 || hasFlag(u, 'disarm') || hasFlag(u, 'stun')) return;
  u.atkTimer = u.atkInt / (1 + modValue(u, 'atkSpeed'));
  u.atkTick = w.tick;
  emit(w, { e: 'attack', id: u.id, target: t.id, ranged: u.ranged });
  let dmg = u.dmg * (1 + modValue(u, 'dmgAmp'));
  if (u.hero) {
    // Выход из невидимости — с усиленным первым ударом
    const veil = u.mods.find((m) => m.id === 'invisible');
    if (veil) {
      dmg += veil.v;
      removeMod(u, 'invisible');
    }
    for (const id of HERO[u.hero.def].abilities) {
      const on = ABILITIES[id]?.onAttack;
      if (on) dmg = on(w, u, t, dmg);
    }
  }
  if (u.ranged) shoot(w, u, t, dmg);
  else damage(w, t, dmg, u, 'physical');
}

function shoot(w: World, u: Unit, t: Unit, dmg: number) {
  const tower = u.kind === 'tower';
  w.projs.push({
    id: w.nextId++,
    kind: 'attack',
    x: u.x,
    z: u.z,
    y0: tower ? 6.9 : u.kind === 'hero' ? 2.5 : 1.4,
    dx: 0,
    dz: 0,
    speed: tower ? 24 : 22,
    dist: 0,
    max: 1e9,
    target: t.id,
    src: u.id,
    team: u.team,
    dmg,
    color: u.kind === 'hero' ? 0xffa040 : u.team === 2 ? 0xc8b48a : TEAM_COLORS[u.team],
    size: tower ? 1.7 : 1,
  });
}

/** Линейный снаряд способности (огненный шар и подобные) */
export function launch(
  w: World,
  u: Unit,
  kind: string,
  dx: number,
  dz: number,
  speed: number,
  max: number,
  dmg: number,
  color: number,
  size = 1,
): Projectile {
  const p: Projectile = {
    id: w.nextId++,
    kind,
    x: u.x + dx * 1.2,
    z: u.z + dz * 1.2,
    y0: 1.8,
    dx,
    dz,
    speed,
    dist: 0,
    max,
    target: 0,
    src: u.id,
    team: u.team,
    dmg,
    color,
    size,
  };
  w.projs.push(p);
  return p;
}

function doOrder(w: World, u: Unit) {
  const h = u.hero!;
  const o = h.order;
  if (!o) return;
  if (o.type === 'move') {
    // Путь в обход деревьев считаем один раз на приказ; по прямой — одна точка
    if (!o.path) o.path = findPath(mapOf(w), u.x, u.z, o.x, o.z);
    while (o.path.length > 1 && Math.hypot(o.path[0].x - u.x, o.path[0].z - u.z) < 0.8) o.path.shift();
    const wp = o.path[0] ?? { x: o.x, z: o.z };
    if (moveToward(u, wp.x, wp.z) && o.path.length <= 1) {
      h.order = null;
      return;
    }
    // Упёрся (в дерево, в здание) — бросаем приказ, как в прототипе. Мерим остаток пути
    let d = Math.hypot(wp.x - u.x, wp.z - u.z);
    for (let i = 1; i < o.path.length; i++)
      d += Math.hypot(o.path[i].x - o.path[i - 1].x, o.path[i].z - o.path[i - 1].z);
    o.st += DT;
    if (o.st > 0.6) {
      if (o.best - d < 0.15) {
        h.order = null;
        return;
      }
      o.best = d;
      o.st = 0;
    }
  } else if (o.type === 'cast') {
    // Подходим к цели умения, на дальности — применяем
    const t = unitById(w, o.id);
    const a = abilityAt(u, o.slot);
    if (!t?.alive || t.invuln || !a || hasFlag(t, 'invisible')) {
      h.order = null;
      return;
    }
    if (dist(u, t) <= a.range + t.radius) {
      h.order = null;
      castAbility(w, u, o.slot, { x: t.x, z: t.z, id: t.id });
    } else moveToward(u, t.x, t.z);
  } else {
    const t = unitById(w, o.id);
    if (!t?.alive || t.invuln) {
      h.order = null;
      return;
    }
    if (dist(u, t) > reach(u, t)) moveToward(u, t.x, t.z);
    else tryAttack(w, u, t);
  }
}

// ── Герои ──

/** Свиток возвращения: к своему фонтану */
export function recallHome(w: World, u: Unit) {
  if (!u.alive || !u.hero) return;
  const p = w.players[u.hero.player];
  const idx = w.players.filter((q) => q.team === p.team && q.slot < p.slot).length;
  const s = heroSpot(mapOf(w).spawns[u.team as Team], u.team as Team, idx);
  fx(w, u.x, u.z, 1.2, 0xf1c453, 0.9, 0.5, 2);
  u.x = s.x;
  u.z = s.z;
  u.hero.order = null;
  fx(w, u.x, u.z, 1.2, 0xf1c453, 0.9, 0.5, 2);
}

function respawn(w: World, u: Unit) {
  const h = u.hero!;
  const p = w.players[h.player];
  const idx = w.players.filter((q) => q.team === p.team && q.slot < p.slot).length;
  const s = heroSpot(mapOf(w).spawns[u.team as Team], u.team as Team, idx);
  Object.assign(u, { alive: true, hp: u.maxHp, x: s.x, z: s.z });
  h.order = null;
  h.casting = null;
  p.ai.mode = 'lane';
  emit(w, { e: 'respawn', id: u.id, player: h.player });
}

/** Таймеры, лечение, золото со временем, фонтан. false — герой мёртв */
function heroTick(w: World, u: Unit): boolean {
  const h = u.hero!;
  for (let i = 0; i < h.cd.length; i++) h.cd[i] = Math.max(0, h.cd[i] - DT);
  for (let i = 0; i < h.itemCd.length; i++) h.itemCd[i] = Math.max(0, h.itemCd[i] - DT);
  if (!u.alive) {
    h.respawn -= DT;
    if (h.respawn <= 0) respawn(w, u);
    return false;
  }
  const team = u.team as Team;
  const f = mapOf(w).fountains[team];
  const ef = mapOf(w).fountains[1 - team];
  const heal = h.regen + modValue(u, 'heal') + (Math.hypot(u.x - f.x, u.z - f.z) < 8 ? 90 : 0);
  u.hp = Math.min(u.maxHp, u.hp + heal * DT);
  h.gold += 1.5 * DT;
  if (Math.hypot(u.x - ef.x, u.z - ef.z) < 9) damage(w, u, 170 * DT, null, 'pure');
  return u.alive;
}

/** Игрок: если приказа нет — сам бьёт ближайшего крипа или героя в радиусе атаки */
function playerLogic(w: World, u: Unit) {
  const h = u.hero!;
  let o: Order | null = h.order;
  if (o?.type === 'attack') {
    const t = unitById(w, o.id);
    if (!t?.alive || t.invuln || (o.auto && dist(u, t) > reach(u, t) + 1.5)) h.order = o = null;
  }
  if (!o) {
    const t = nearestEnemy(w, u, u.range, (v) => v.kind === 'creep' || v.kind === 'hero');
    if (t) h.order = { type: 'attack', id: t.id, auto: true };
  }
  doOrder(w, u);
}

function heroUpdate(w: World, u: Unit) {
  const h = u.hero!;
  const p = w.players[h.player];
  if (!heroTick(w, u)) return;
  applyAuras(w, u);
  if (hasFlag(u, 'stun')) {
    cancelCast(u);
    return;
  }
  if (h.casting) {
    h.casting.t -= DT;
    if (h.casting.t <= 0) {
      fireCasting(w, u);
      // Нажатое во время замаха — сразу следом
      const q = h.queued;
      h.queued = null;
      if (q) castAbility(w, u, q.slot, q.aim);
    }
    return;
  }
  if (p.bot) {
    p.ai.think -= DT;
    if (p.ai.think <= 0) {
      p.ai.think = difficulty(p.bot).think;
      botThink(w, u, p);
      if (h.casting) return;
    }
    doOrder(w, u);
  } else playerLogic(w, u);
}

// ── Крипы и вышки ──

function pickCreepTarget(w: World, u: Unit, r: number): Unit | null {
  let best: Unit | null = null;
  let bs = 1e9;
  for (const v of w.units) {
    if (!v.alive || v.team === u.team || v.team === 2 || v.invuln || hasFlag(v, 'invisible')) continue;
    const d = dist(u, v) - v.radius;
    if (d > r) continue;
    const s = d + (v.kind === 'hero' ? 3 : v.kind === 'creep' ? 0 : 5);
    if (s < bs) {
      bs = s;
      best = v;
    }
  }
  return best;
}

function updateCreep(w: World, u: Unit) {
  if (hasFlag(u, 'stun')) return;
  let t = unitById(w, u.target);
  if (t && (!t.alive || t.invuln || dist(u, t) > 11)) {
    u.target = 0;
    t = undefined;
  }
  u.retarget -= DT;
  if (!t || u.retarget <= 0) {
    u.retarget = 0.5;
    const n = pickCreepTarget(w, u, 8);
    if (n) {
      u.target = n.id;
      t = n;
    }
  }
  if (t) {
    if (dist(u, t) > reach(u, t)) moveToward(u, t.x, t.z);
    else tryAttack(w, u, t);
  } else {
    const g = ancientOf(w, 1 - (u.team as Team));
    const m = mapOf(w);
    const lane = m.lanes[u.lane ?? 0];
    if (!lane || lane.points.length <= 2) {
      if (g) moveToward(u, g.x, g.z, 6);
      return;
    }
    const pts = lanePoints(m, u.lane ?? 0, u.team);
    const end = pts[pts.length - 1];
    if (Math.hypot(u.x - end.x, u.z - end.z) < 14) {
      if (g) moveToward(u, g.x, g.z, 6);
    } else {
      const p = laneAhead(m, u.lane ?? 0, u.team, u.x, u.z, 4);
      moveToward(u, p.x, p.z);
    }
  }
}

function updateTower(w: World, u: Unit) {
  u.forced = Math.max(0, u.forced - DT);
  let t = unitById(w, u.target);
  if (t && (!t.alive || dist(u, t) > u.range + t.radius || hasFlag(t, 'invisible'))) {
    u.target = 0;
    t = undefined;
  }
  if (!t) {
    t =
      nearestEnemy(w, u, u.range, (v) => v.kind === 'creep') ??
      nearestEnemy(w, u, u.range, (v) => v.kind === 'hero') ??
      undefined;
    u.target = t?.id ?? 0;
  }
  if (t) tryAttack(w, u, t);
}

export function spawnWave(w: World) {
  const m = mapOf(w);
  for (let lane = 0; lane < m.lanes.length; lane++)
    for (const team of [0, 1] as Team[]) {
      // Волна выходит из кристалла вдоль первого отрезка своей линии
      const pts = lanePoints(m, lane, team);
      const a = pts[0];
      const l0 = Math.hypot(pts[1].x - a.x, pts[1].z - a.z);
      const ux = (pts[1].x - a.x) / l0;
      const uz = (pts[1].z - a.z) / l0;
      // Боковой шаг в строю — как в прототипе: у обеих команд в одну и ту же сторону карты
      const sg = team ? -1 : 1;
      const px = -uz * sg;
      const pz = ux * sg;
      for (let i = 0; i < 4; i++) {
        const ranged = i === 3;
        const along = ranged ? 7 : 9.5;
        const lat = ranged ? 0 : (i - 1) * 1.5;
        const fallen = w.units.filter(
          (u) => u.kind === 'tower' && u.team !== team && u.lane === lane && !u.alive,
        ).length;
        const g = (1 + BALANCE.creepGrowth * Math.floor(w.time / 60)) * (1 + BALANCE.creepPerTower * fallen);
        const u = addUnit(w, {
          kind: 'creep',
          team,
          model: ranged ? 'ranged' : 'melee',
          lane,
          x: a.x + ux * along + px * lat,
          z: a.z + uz * along + pz * lat,
          speed: 4.2,
          radius: 0.6,
          rot: Math.atan2(ux, uz),
          ...(ranged
            ? { maxHp: 90, dmg: 18, range: 5, atkInt: 1.3, ranged: true, barH: 2.3 }
            : { maxHp: 120, dmg: 12, range: 1.2, atkInt: 1, barH: 1.9 }),
        });
        u.maxHp = u.hp = Math.round(u.maxHp * g);
        u.dmg *= g;
      }
    }
  emit(w, { e: 'wave' });
}

// ── Столкновения ──

function push(u: Unit, x: number, z: number, r: number) {
  const dx = u.x - x;
  const dz = u.z - z;
  const d = Math.hypot(dx, dz);
  if (d >= r) return;
  if (d < 1e-4) {
    u.x += r;
    return;
  }
  const k = (r - d) / d;
  u.x += dx * k;
  u.z += dz * k;
}

/** Здание на пути: выталкиваем и, если юнит шёл, сдвигаем вбок по касательной — чтобы обходил,
 *  а не стоял лбом в стену (лоб в лоб — всегда в одну сторону, детерминированно) */
function pushStatic(u: Unit, x: number, z: number, r: number) {
  const dx = u.x - x;
  const dz = u.z - z;
  const d = Math.hypot(dx, dz);
  if (d >= r) return;
  push(u, x, z, r);
  if (!u.moving || d < 1e-4) return;
  const tx = -dz / d;
  const tz = dx / d;
  const side = Math.sin(u.rot) * tx + Math.cos(u.rot) * tz >= 0 ? 1 : -1;
  const s = Math.min(0.12, speedOf(u) * DT * 0.6);
  u.x += tx * side * s;
  u.z += tz * side * s;
}

const treeBuf: Tree[] = [];
export function resolveCollisions(w: World) {
  const mob = w.units.filter((u) => u.alive && u.speed > 0);
  for (let i = 0; i < mob.length; i++)
    for (let j = i + 1; j < mob.length; j++) {
      const a = mob[i];
      const b = mob[j];
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const d = Math.hypot(dx, dz);
      const r = (a.radius + b.radius) * 0.8;
      if (d < r && d > 1e-4) {
        const k = ((r - d) / d) * 0.5;
        a.x += dx * k;
        a.z += dz * k;
        b.x -= dx * k;
        b.z -= dz * k;
      }
    }
  const m = mapOf(w);
  const grid = treeGrid(m);
  for (const u of mob) {
    for (const f of m.fountains) pushStatic(u, f.x, f.z, 2.8 + u.radius);
    for (const s of w.units)
      if ((s.kind === 'tower' && s.alive) || s.kind === 'ancient') pushStatic(u, s.x, s.z, s.radius + u.radius);
    for (const t of grid.near(u.x, u.z, treeBuf)) {
      const dx = u.x - t.x;
      if (dx > 2.5 || dx < -2.5) continue;
      const dz = u.z - t.z;
      if (dz > 2.5 || dz < -2.5) continue;
      push(u, t.x, t.z, 0.75 * t.s + u.radius * 0.6);
    }
    u.x = clamp(u.x, -m.limit, m.limit);
    u.z = clamp(u.z, -m.limit, m.limit);
  }
}

// ── Снаряды ──

function updateProjectiles(w: World) {
  for (let i = w.projs.length - 1; i >= 0; i--) {
    const p = w.projs[i];
    if (p.target) {
      // Самонаводящийся: атака или способность в цель
      const t = unitById(w, p.target);
      if (!t?.alive) {
        w.projs.splice(i, 1);
        continue;
      }
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const L = Math.hypot(dx, dz);
      const s = p.speed * DT;
      if (L <= s + 0.2) {
        w.projs.splice(i, 1);
        if (p.kind === 'attack') {
          damage(w, t, p.dmg, unitById(w, p.src) ?? null, 'physical');
          fx(
            w,
            t.x,
            t.z,
            t.kind === 'creep' || t.kind === 'neutral' ? 0.8 : t.kind === 'hero' ? 1.4 : 4,
            p.color,
            0.25,
            0.2,
            2,
          );
        } else ABILITIES[p.kind]?.onProjectileEnd?.(w, p, t);
      } else {
        p.x += (dx / L) * s;
        p.z += (dz / L) * s;
      }
      continue;
    }
    const s = p.speed * DT;
    p.x += p.dx * s;
    p.z += p.dz * s;
    p.dist += s;
    let hit: Unit | null = null;
    for (const v of w.units)
      if (v.alive && v.team !== p.team && !v.invuln && Math.hypot(v.x - p.x, v.z - p.z) < v.radius + 0.8) {
        if (p.pierce) {
          if (p.hits?.includes(v.id)) continue;
          (p.hits ??= []).push(v.id);
          ABILITIES[p.kind]?.onProjectileHit?.(w, p, v);
          continue;
        }
        hit = v;
        break;
      }
    if (hit || p.dist > p.max) {
      w.projs.splice(i, 1);
      ABILITIES[p.kind]?.onProjectileEnd?.(w, p, hit);
    }
  }
}

/** Области на земле: задержка, импульсы, окончание */
function updateZones(w: World) {
  for (let i = w.zones.length - 1; i >= 0; i--) {
    const z = w.zones[i];
    const def = ABILITIES[z.kind]?.zone;
    const src = unitById(w, z.src) ?? null;
    if (z.delay > 0) {
      z.delay -= DT;
      if (z.delay <= 0) def?.start?.(w, z, src);
      continue;
    }
    z.t -= DT;
    z.next -= DT;
    if (z.next <= 0) {
      z.next = z.period;
      def?.pulse?.(w, z, src);
    }
    if (z.t <= 0) {
      w.zones.splice(i, 1);
      def?.end?.(w, z, src);
    }
  }
}

export function addZone(w: World, o: Omit<Zone, 'id' | 'next'> & { next?: number }): Zone {
  const z: Zone = { next: 0, ...o, id: w.nextId++ };
  w.zones.push(z);
  return z;
}

/** Ауры героев: каждый тик обновляют короткий модификатор союзникам рядом */
function applyAuras(w: World, u: Unit) {
  for (const id of HERO[u.hero!.def].abilities) {
    const aura = ABILITIES[id]?.aura;
    if (!aura) continue;
    for (const v of w.units)
      if (v.alive && v.team === u.team && (v.kind === 'hero' || v.kind === 'creep') && dist(v, u) < aura.radius)
        addMod(v, aura.mod, 0.25, aura.v, u.id);
  }
}

// ── Тик ──

export function step(w: World) {
  w.events.length = 0;
  if (w.winner !== -1) return;
  const pending = w.pending;
  w.pending = [];
  for (const { player, cmd } of pending) applyCommand(w, player, cmd);
  w.tick++;
  w.time += DT;
  if (w.time >= w.nextWave) {
    spawnWave(w);
    w.nextWave += WAVE_INTERVAL;
  }
  for (const u of w.units) {
    u.atkTimer -= DT;
    u.moving = false;
    if (u.mods.length) tickModifiers(w, u);
  }
  for (const p of w.players) {
    const u = unitById(w, p.unit);
    if (u) heroUpdate(w, u);
    if (w.winner !== -1) return;
  }
  for (const u of w.units) {
    if (!u.alive) continue;
    if (u.kind === 'creep') updateCreep(w, u);
    else if (u.kind === 'tower') updateTower(w, u);
    else if (u.kind === 'neutral') updateNeutral(w, u);
  }
  resolveCollisions(w);
  updateProjectiles(w);
  updateZones(w);
  if (w.jungle) {
    updateCamps(w);
    updateRunes(w);
  }
  // Мёртвые крипы и нейтралы больше не нужны: клиент доиграет их смерть сам
  if (w.units.some((u) => !u.alive && (u.kind === 'creep' || u.kind === 'neutral'))) {
    const idx = index(w);
    w.units = w.units.filter((u) => {
      if (u.alive || (u.kind !== 'creep' && u.kind !== 'neutral')) return true;
      idx.delete(u.id);
      return false;
    });
  }
}

export type { Modifier };
