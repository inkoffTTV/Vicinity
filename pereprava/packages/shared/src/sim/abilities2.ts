// Умения героев 0.4 (19 новых героев). Устройство то же, что в abilities.ts: данные + функции cast /
// fire / onProjectileEnd / zone. Новые механики — общими модификаторами (modifiers.ts) и помощниками
// ниже: заряды, призыв, ловушки, провокация, шипы, уклонение, сон, бессмертие, метка смерти,
// превращение, откат во времени, воскрешение, цепная молния, отбрасывание.
import type { Unit } from '../types';
import { aimDir, aimPoint, aimUnit, amp, aoe, facing, launchAt, lvl } from './abil-util';
import type { AbilityDef } from './abilities';
import { addMod, dispel, getMod, removeMod } from './modifiers';
import {
  addZone,
  clamp,
  damage,
  dist,
  DT,
  fx,
  heal,
  launch,
  mapOf,
  nearestEnemy,
  rand,
  resolveCollisions,
  reviveHero,
  summon,
  unitById,
  type World,
} from './world';

// ── Помощники ──

const isBuilding = (v: Unit) => v.kind === 'tower' || v.kind === 'ancient';

/** Враги в круге (без зданий, если не сказано иначе) */
function enemiesIn(w: World, u: Unit, x: number, z: number, r: number, buildings = false): Unit[] {
  const out: Unit[] = [];
  for (const v of w.units)
    if (
      v.alive &&
      v.team !== u.team &&
      !v.invuln &&
      (buildings || !isBuilding(v)) &&
      Math.hypot(v.x - x, v.z - z) < r + v.radius
    )
      out.push(v);
  return out;
}

/** Союзные герои в круге (вместе с самим героем) */
function alliesIn(w: World, u: Unit, x: number, z: number, r: number): Unit[] {
  return w.units.filter(
    (v) => v.alive && v.team === u.team && v.kind === 'hero' && Math.hypot(v.x - x, v.z - z) < r + v.radius,
  );
}

/** Мгновенно переместить юнита (в границах карты) */
function place(w: World, v: Unit, x: number, z: number) {
  const L = mapOf(w).limit - 1;
  v.x = clamp(x, -L, L);
  v.z = clamp(z, -L, L);
  if (v.hero) v.hero.order = null;
}

/** Отбросить от точки на d метров */
function knock(w: World, v: Unit, fromX: number, fromZ: number, d: number) {
  if (isBuilding(v) || !v.speed) return;
  const dx = v.x - fromX;
  const dz = v.z - fromZ;
  const L = Math.hypot(dx, dz) || 1;
  place(w, v, v.x + (dx / L) * d, v.z + (dz / L) * d);
}

/** Враги вдоль отрезка */
function lineHit(w: World, u: Unit, x0: number, z0: number, x1: number, z1: number, width: number): Unit[] {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L2 = dx * dx + dz * dz || 1;
  return w.units.filter((v) => {
    if (!v.alive || v.team === u.team || v.invuln || isBuilding(v)) return false;
    const t = clamp(((v.x - x0) * dx + (v.z - z0) * dz) / L2, 0, 1);
    return Math.hypot(x0 + dx * t - v.x, z0 + dz * t - v.z) < width + v.radius;
  });
}

/** Направление броска: к прицелу или к ближайшему врагу, иначе вперёд (нормированное) */
function throwDir(w: World, u: Unit, aim: { x: number; z: number } | null, range: number) {
  const { dx, dz } = aimDir(u, aim as never, () => {
    const t = nearestEnemy(w, u, range, (v) => v.kind === 'hero') ?? nearestEnemy(w, u, range);
    return t ? { dx: t.x - u.x, dz: t.z - u.z } : facing(u);
  });
  const L = Math.hypot(dx, dz) || 1;
  u.rot = Math.atan2(dx, dz);
  return { dx: dx / L, dz: dz / L };
}

/** Накопить яд: сила растёт, время обновляется */
function poison(v: Unit, dps: number, t: number, src: number) {
  const m = getMod(v, 'poison');
  if (m) {
    m.v = Math.min(m.v + dps, dps * 4);
    m.t = Math.max(m.t, t);
  } else addMod(v, 'poison', t, dps, src);
}

const C = (a: string, b: string, c: string, d: string): [string, string, string, string] => [a, b, c, d];

export const ABILITIES_2: Record<string, AbilityDef> = {
  // ═══ Морозная ведьма (маг) ═══
  icelance: {
    id: 'icelance',
    name: 'Ледяное копьё',
    desc: 'Копьё в первого врага: 90 урона, +14 за уровень, замедление 35% на 2 с. По замедленной цели — вдвое больше урона.',
    cd: 6,
    target: 'point',
    range: 18,
    colors: C('#bfe8ff', '#e6f7ff', '#4ab0e8', '#145478'),
    ai: { kind: 'nuke', range: 16 },
    cast(w, u, aim) {
      const { dx, dz } = throwDir(w, u, aim, 18);
      launch(w, u, 'icelance', dx, dz, 30, 18, (90 + lvl(u) * 14) * amp(u), 0xbfe8ff, 0.7);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      const slowed = !!getMod(hit, 'slow') || !!getMod(hit, 'root');
      damage(w, hit, p.dmg * (slowed ? 2 : 1), unitById(w, p.src) ?? null, 'magical');
      if (hit.alive) addMod(hit, 'slow', 2, 0.35, p.src);
      fx(w, hit.x, hit.z, 1.2, 0xbfe8ff, 0.8, 0.4, 1.8);
    },
  },
  frostnova: {
    id: 'frostnova',
    name: 'Кольцо льда',
    desc: 'Лёд вокруг себя на 4,5 м: 70 урона, +10 за уровень, и враги примерзают на 1,4 с.',
    cd: 13,
    target: 'none',
    range: 4.5,
    colors: C('#9ee0ff', '#dff5ff', '#2a9ad0', '#0e4a6a'),
    ai: { kind: 'aoe', range: 4, creeps: 4, radius: 4.5 },
    cast(w, u) {
      fx(w, u.x, u.z, 0.3, 0xbfe8ff, 2, 0.5, 2.2);
      for (const v of aoe(w, u, u.x, u.z, 4.5, (70 + lvl(u) * 10) * amp(u), 'magical', (v) => !isBuilding(v)))
        if (v.alive) addMod(v, 'root', 1.4, 0, u.id);
      return true;
    },
  },
  iceblock: {
    id: 'iceblock',
    name: 'Ледяная глыба',
    desc: 'Вмерзает в лёд на 2,5 с: неуязвима, но не двигается; восстанавливает 25% здоровья.',
    cd: 30,
    target: 'none',
    range: 0,
    colors: C('#e6f7ff', '#ffffff', '#8fd0f0', '#3a7aa0'),
    ai: { kind: 'defend', hp: 0.3, range: 8 },
    cast(w, u) {
      addMod(u, 'iceblock', 2.5, 0, u.id);
      heal(w, u, u.maxHp * 0.25);
      for (const v of w.units) if (v.target === u.id) v.target = 0;
      fx(w, u.x, u.z, 1.4, 0xe6f7ff, 1.4, 0.6, 1.2);
      return true;
    },
  },
  blizzard: {
    id: 'blizzard',
    name: 'Буран',
    desc: '4 с метель в круге 6 м: 45 урона, +7 за уровень, каждые 0,5 с и замедление 45%.',
    cd: 55,
    target: 'point',
    range: 16,
    ult: true,
    colors: C('#cfeeff', '#f4fbff', '#5ab8e8', '#1a5a80'),
    ai: { kind: 'nuke', range: 14 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 16);
      addZone(w, {
        kind: 'blizzard',
        x: p.x,
        z: p.z,
        r: 6,
        t: 4,
        delay: 0.2,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: (45 + lvl(u) * 7) * amp(u),
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        for (let k = 0; k < 4; k++)
          fx(
            w,
            z.x + Math.sin(w.tick * 0.7 + k * 1.6) * z.r * 0.7,
            z.z + Math.cos(w.tick * 0.9 + k) * z.r * 0.7,
            2,
            0xe6f7ff,
            0.35,
            0.5,
            0.6,
          );
        if (!src) return;
        for (const v of aoe(w, src, z.x, z.z, z.r, z.v, 'magical', (v) => !isBuilding(v)))
          if (v.alive) addMod(v, 'slow', 0.6, 0.45, src.id);
      },
    },
  },

  // ═══ Грозовик (маг) ═══
  chain: {
    id: 'chain',
    name: 'Цепная молния',
    desc: 'Молния бьёт цель и перескакивает ещё на 3 врага рядом: 100 урона, +15 за уровень, каждый скачок на 15% слабее.',
    cd: 8,
    target: 'unit',
    range: 12,
    colors: C('#c8d8ff', '#eef2ff', '#6a8aff', '#22307a'),
    ai: { kind: 'nuke', range: 12, creeps: 3, radius: 5 },
    cast(w, u, aim) {
      let t: Unit | undefined = aimUnit(w, u, aim, 12) ?? undefined;
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      let dmg = (100 + lvl(u) * 15) * amp(u);
      const hit = new Set<number>();
      let from: Unit = u;
      for (let k = 0; k < 4 && t; k++) {
        hit.add(t.id);
        for (let s = 0; s <= 3; s++)
          fx(w, from.x + ((t.x - from.x) * s) / 3, from.z + ((t.z - from.z) * s) / 3, 1.6, 0xc8d8ff, 0.3, 0.2, 0.8);
        damage(w, t, dmg, u, 'magical');
        dmg *= 0.85;
        from = t;
        const prev: Unit = t;
        t = w.units
          .filter(
            (v) => v.alive && v.team !== u.team && !v.invuln && !isBuilding(v) && !hit.has(v.id) && dist(v, prev) < 6,
          )
          .sort((a, b) => dist(a, prev) - dist(b, prev))[0];
      }
      return true;
    },
  },
  static: {
    id: 'static',
    name: 'Искра',
    desc: 'Три заряда: самонаводящаяся искра, 55 урона, +8 за уровень. Заряд копится за 5 с.',
    cd: 5,
    charges: 3,
    target: 'unit',
    range: 13,
    colors: C('#fff6a0', '#fffbe0', '#e8d040', '#6a5a10'),
    ai: { kind: 'nuke', range: 12 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 13);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      launchAt(w, u, 'static', t, 34, (55 + lvl(u) * 8) * amp(u), 0xfff6a0, 0.5);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'magical');
      fx(w, hit.x, hit.z, 1.4, 0xfff6a0, 0.5, 0.25, 1.6);
    },
  },
  overload: {
    id: 'overload',
    name: 'Перегрузка',
    desc: 'Пассивно: после каждого умения следующий удар бьёт молнией по площади 2,5 м — 40 урона, +8 за уровень, и обрывает умения (безмолвие 1 с).',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#b0c0ff', '#e0e6ff', '#5060d0', '#1a2060'),
    cast: () => false,
    onAttack(w, u, t, dmg) {
      if (u.castTick < w.tick - 30 * 4 || u.hero!.stacks === u.castTick) return dmg;
      u.hero!.stacks = u.castTick;
      fx(w, t.x, t.z, 1.2, 0xc8d8ff, 1, 0.3, 2);
      for (const v of aoe(w, u, t.x, t.z, 2.5, (40 + lvl(u) * 8) * amp(u), 'magical', (v) => !isBuilding(v)))
        if (v.alive) addMod(v, 'silence', 1, 0, u.id);
      return dmg;
    },
  },
  thunder: {
    id: 'thunder',
    name: 'Гроза',
    desc: 'Через 0,6 с молнии бьют всех вражеских героев в 15 м: 190 урона, +25 за уровень, оглушение 1 с.',
    cd: 60,
    target: 'none',
    range: 15,
    castTime: 0.6,
    ult: true,
    colors: C('#e0e8ff', '#ffffff', '#7a8aff', '#1a2270'),
    ai: { kind: 'nuke', range: 13 },
    cast: () => true,
    fire(w, u) {
      u.castTick = w.tick;
      for (const v of w.units)
        if (v.alive && v.kind === 'hero' && v.team !== u.team && dist(u, v) < 15) {
          for (let k = 0; k < 4; k++) fx(w, v.x, v.z, 1 + k * 1.5, 0xe0e8ff, 0.4, 0.3, 0.5);
          damage(w, v, (190 + lvl(u) * 25) * amp(u), u, 'magical');
          if (v.alive) addMod(v, 'stun', 1, 0, u.id);
        }
    },
  },

  // ═══ Хронист (маг) ═══
  timebolt: {
    id: 'timebolt',
    name: 'Сгусток времени',
    desc: 'Снаряд: 85 урона, +13 за уровень; цель 3 с бьёт на 40% медленнее.',
    cd: 7,
    target: 'point',
    range: 17,
    colors: C('#ffe0a0', '#fff4d6', '#d4a040', '#5a4010'),
    ai: { kind: 'nuke', range: 15 },
    cast(w, u, aim) {
      const { dx, dz } = throwDir(w, u, aim, 17);
      launch(w, u, 'timebolt', dx, dz, 26, 17, (85 + lvl(u) * 13) * amp(u), 0xffe0a0, 0.7);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'magical');
      if (hit.alive) addMod(hit, 'atkSlow', 3, -0.4, p.src);
      fx(w, hit.x, hit.z, 1.4, 0xffe0a0, 0.7, 0.4, 1.6);
    },
  },
  rewind: {
    id: 'rewind',
    name: 'Возврат',
    desc: 'Возвращается туда, где был 3 с назад, и к тому здоровью, если тогда было больше.',
    cd: 20,
    target: 'none',
    range: 0,
    colors: C('#d6c0ff', '#f0e8ff', '#9070e0', '#3a2470'),
    ai: { kind: 'escape', hp: 0.35 },
    cast(w, u) {
      const hist = u.hero!.hist;
      const past = hist[Math.max(0, hist.length - 12)];
      if (!past) return false;
      fx(w, u.x, u.z, 1.2, 0xd6c0ff, 0.9, 0.4, 1.8);
      place(w, u, past.x, past.z);
      u.hp = Math.min(u.maxHp, Math.max(u.hp, past.hp));
      resolveCollisions(w);
      fx(w, u.x, u.z, 1.2, 0xf0e8ff, 0.9, 0.5, 2);
      for (const v of w.units) if (v.target === u.id && v.kind !== 'tower') v.target = 0;
      return true;
    },
  },
  quicken: {
    id: 'quicken',
    name: 'Ускорение',
    desc: 'Себе и союзникам в 5 м от точки на 4 с: +30% к скорости бега и +40% к скорости атаки.',
    cd: 16,
    target: 'point',
    range: 10,
    colors: C('#ffeab0', '#fff8e6', '#e0b040', '#6a4a10'),
    ai: { kind: 'buff', range: 6 },
    cast(w, u, aim) {
      const x = aim ? aim.x : u.x;
      const z = aim ? aim.z : u.z;
      const list = alliesIn(w, u, x, z, 5);
      if (!list.includes(u)) list.push(u);
      for (const v of list) {
        addMod(v, 'haste', 4, 0.3, u.id);
        addMod(v, 'frenzy', 4, 0.4, u.id);
        fx(w, v.x, v.z, 0.8, 0xffeab0, 0.7, 0.4, 1.6);
      }
      return true;
    },
  },
  stasis: {
    id: 'stasis',
    name: 'Остановка времени',
    desc: 'Враги в круге 5 м вокруг точки замирают на 2,2 с (оглушение) и получают 120 урона, +18 за уровень.',
    cd: 60,
    target: 'point',
    range: 14,
    ult: true,
    colors: C('#fff0c0', '#fffae8', '#d8b050', '#5a4410'),
    ai: { kind: 'disable', range: 12 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 14);
      fx(w, p.x, p.z, 0.4, 0xfff0c0, 2.6, 0.8, 1.2);
      for (const v of aoe(w, u, p.x, p.z, 5, (120 + lvl(u) * 18) * amp(u), 'magical', (v) => !isBuilding(v)))
        if (v.alive) addMod(v, 'stun', 2.2, 0, u.id);
      return true;
    },
  },

  // ═══ Канонир (стрелок) ═══
  grenade: {
    id: 'grenade',
    name: 'Граната',
    desc: 'Граната летит в точку и взрывается: 90 урона, +14 за уровень, враги отлетают на 2,5 м.',
    cd: 8,
    target: 'point',
    range: 14,
    colors: C('#ffb080', '#ffd8c0', '#e05a20', '#6a2008'),
    ai: { kind: 'nuke', range: 13, creeps: 3, radius: 3 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 14);
      const d = Math.hypot(p.x - u.x, p.z - u.z) || 1;
      launch(w, u, 'grenade', (p.x - u.x) / d, (p.z - u.z) / d, 22, d, 0, 0xffb080, 0.6);
      return true;
    },
    onProjectileEnd(w, p) {
      const u = unitById(w, p.src);
      fx(w, p.x, p.z, 1, 0xff8a40, 1.4, 0.4, 2.4);
      if (!u?.hero) return;
      for (const v of aoe(w, u, p.x, p.z, 3, 90 + lvl(u) * 14, 'physical', (v) => !isBuilding(v)))
        if (v.alive) knock(w, v, p.x, p.z, 2.5);
      resolveCollisions(w);
    },
  },
  rocketjump: {
    id: 'rocketjump',
    name: 'Отскок',
    desc: 'Взрыв под ногами отбрасывает на 8 м от врагов; рядом стоящие враги получают 60 урона, +8 за уровень.',
    cd: 14,
    target: 'point',
    range: 8,
    colors: C('#ffd080', '#ffecc0', '#e09a20', '#6a4008'),
    ai: { kind: 'escape', hp: 0.4 },
    cast(w, u, aim) {
      const { dx, dz, len } = aimDir(u, aim, () => {
        const t = nearestEnemy(w, u, 9);
        return t ? { dx: u.x - t.x, dz: u.z - t.z } : facing(u);
      });
      const L = Math.hypot(dx, dz) || 1;
      const d = Math.min(8, len || 8);
      fx(w, u.x, u.z, 0.4, 0xffa040, 1.3, 0.4, 2);
      aoe(w, u, u.x, u.z, 2.5, 60 + lvl(u) * 8, 'physical', (v) => !isBuilding(v));
      place(w, u, u.x + (dx / L) * d, u.z + (dz / L) * d);
      resolveCollisions(w);
      return true;
    },
  },
  bigshot: {
    id: 'bigshot',
    name: 'Картечь',
    desc: 'Пассивно: выстрелы задевают врагов в 2 м от цели — 40% урона.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#d0c0a0', '#ece4d0', '#8a7a50', '#3a3018'),
    cast: () => false,
    onAttack(w, u, t, dmg) {
      for (const v of w.units)
        if (v !== t && v.alive && v.team !== u.team && v.team !== 2 && !isBuilding(v) && dist(v, t) < 2 + v.radius)
          damage(w, v, dmg * 0.4, u, 'physical');
      return dmg;
    },
  },
  barrage: {
    id: 'barrage',
    name: 'Залп',
    desc: 'Пять снарядов ложатся линией к точке за 1,5 с: 110 урона, +16 за уровень, каждый, в круге 2,5 м.',
    cd: 55,
    target: 'point',
    range: 18,
    ult: true,
    colors: C('#ff9a60', '#ffd0b0', '#d04a10', '#5a1a04'),
    ai: { kind: 'nuke', range: 15 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 18);
      const dx = p.x - u.x;
      const dz = p.z - u.z;
      for (let k = 0; k < 5; k++) {
        const f = 0.4 + (k / 4) * 0.6;
        addZone(w, {
          kind: 'barrage',
          x: u.x + dx * f,
          z: u.z + dz * f,
          r: 2.5,
          t: 0.05,
          delay: 0.3 + k * 0.3,
          period: 0,
          src: u.id,
          team: u.team,
          v: 110 + lvl(u) * 16,
        });
      }
      return true;
    },
    zone: {
      start(w, z, src) {
        fx(w, z.x, z.z, 0.6, 0xff7a20, 1.6, 0.45, 2.2);
        fx(w, z.x, z.z, 1.4, 0x6a5a4a, 1, 0.6, 1.6);
        if (src) aoe(w, src, z.x, z.z, z.r, z.v, 'physical');
      },
    },
  },

  // ═══ Звероловка (стрелок) ═══
  snare: {
    id: 'snare',
    name: 'Капкан',
    desc: 'Прячет капкан (живёт 40 с, до 3 сразу): враг, наступивший на него, получает 80 урона, +12 за уровень, и не может двигаться 2 с.',
    cd: 9,
    charges: 2,
    target: 'point',
    range: 8,
    colors: C('#c8a070', '#e8d4b8', '#8a6030', '#3a2810'),
    ai: { kind: 'disable', range: 7 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 8);
      const mine = w.zones.filter((z) => z.kind === 'snare' && z.src === u.id);
      if (mine.length >= 3) w.zones.splice(w.zones.indexOf(mine[0]), 1);
      addZone(w, {
        kind: 'snare',
        x: p.x,
        z: p.z,
        r: 1.4,
        t: 40,
        delay: 0.5,
        period: 0,
        src: u.id,
        team: u.team,
        v: 80 + lvl(u) * 12,
        hidden: true,
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        const v = w.units.find(
          (e) =>
            e.alive &&
            e.team !== z.team &&
            e.team !== 2 &&
            !isBuilding(e) &&
            Math.hypot(e.x - z.x, e.z - z.z) < z.r + e.radius,
        );
        if (!v) return;
        z.t = 0;
        fx(w, z.x, z.z, 0.3, 0xc8a070, 1, 0.4, 1.6);
        damage(w, v, z.v, src, 'physical');
        if (v.alive) addMod(v, 'root', 2, 0, z.src);
      },
    },
  },
  netshot: {
    id: 'netshot',
    name: 'Сеть',
    desc: 'Сеть в первого врага: 60 урона, +10 за уровень, связывает на 1,3 с, потом замедляет на 30% ещё 2 с.',
    cd: 11,
    target: 'point',
    range: 15,
    colors: C('#e0d0a0', '#f4ecd6', '#a89050', '#4a3a14'),
    ai: { kind: 'disable', range: 13 },
    cast(w, u, aim) {
      const { dx, dz } = throwDir(w, u, aim, 15);
      launch(w, u, 'netshot', dx, dz, 26, 15, 60 + lvl(u) * 10, 0xe0d0a0, 0.7);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'physical');
      if (!hit.alive) return;
      addMod(hit, 'root', 1.3, 0, p.src);
      addMod(hit, 'slow', 3.3, 0.3, p.src);
    },
  },
  prey: {
    id: 'prey',
    name: 'Добыча',
    desc: 'Пассивно: по связанным и замедленным врагам удары на 30% сильнее.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#d8b080', '#f0e0c8', '#9a6a30', '#3a2410'),
    cast: () => false,
    onAttack(_w, _u, t, dmg) {
      return getMod(t, 'root') || getMod(t, 'slow') ? dmg * 1.3 : dmg;
    },
  },
  packhunt: {
    id: 'packhunt',
    name: 'Стая',
    desc: 'Зовёт двух призрачных волков на 14 с: у каждого 350 здоровья, +40 за уровень, и 30 урона.',
    cd: 60,
    target: 'none',
    range: 0,
    ult: true,
    colors: C('#a0c8ff', '#dceaff', '#4a7ad0', '#14306a'),
    ai: { kind: 'buff', range: 10 },
    cast(w, u) {
      for (const sx of [-1, 1]) {
        const s = summon(w, u, 'spiritwolf', u.x + sx * 1.5, u.z - 1, 14, {
          maxHp: 350 + lvl(u) * 40,
          dmg: 30 + lvl(u) * 3,
          speed: 10,
          radius: 0.6,
          barH: 1.8,
        });
        fx(w, s.x, s.z, 0.8, 0xa0c8ff, 1, 0.5, 1.4);
      }
      return true;
    },
  },

  // ═══ Орлиный глаз (стрелок) ═══
  pinshot: {
    id: 'pinshot',
    name: 'Прицельный выстрел',
    desc: 'Целится 0,6 с и стреляет на 26 м: 150 урона, +22 за уровень.',
    cd: 10,
    target: 'unit',
    range: 26,
    castTime: 0.6,
    colors: C('#ffe8b0', '#fff8e6', '#d8a838', '#5a4010'),
    ai: { kind: 'nuke', range: 24 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 26);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      return true;
    },
    fire(w, u, c) {
      const t = unitById(w, c.id) ?? aimUnit(w, u, { x: c.x, z: c.z, id: c.id }, 28);
      if (!t?.alive) return;
      launchAt(w, u, 'pinshot', t, 60, 150 + lvl(u) * 22, 0xffe8b0, 0.6);
    },
    onProjectileEnd(w, p, hit) {
      if (hit) damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'physical');
    },
  },
  smoke: {
    id: 'smoke',
    name: 'Дымовая шашка',
    desc: 'Облако на 5 с в круге 4 м: враги внутри не могут применять умения и замедлены на 25%.',
    cd: 18,
    target: 'point',
    range: 10,
    colors: C('#b0b0b8', '#e0e0e6', '#6a6a74', '#26262c'),
    ai: { kind: 'disable', range: 9 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 10);
      addZone(w, { kind: 'smoke', x: p.x, z: p.z, r: 4, t: 5, delay: 0, period: 0, src: u.id, team: u.team, v: 0 });
      return true;
    },
    zone: {
      pulse(w, z) {
        if (w.tick % 6 === 0)
          fx(w, z.x + Math.sin(w.tick) * 2, z.z + Math.cos(w.tick * 1.3) * 2, 1, 0xb0b0b8, 1.2, 0.8, 0.6);
        for (const v of w.units)
          if (
            v.alive &&
            v.team !== z.team &&
            v.team !== 2 &&
            !isBuilding(v) &&
            Math.hypot(v.x - z.x, v.z - z.z) < z.r + v.radius
          ) {
            addMod(v, 'silence', DT * 2, 0, z.src);
            addMod(v, 'slow', DT * 2, 0.25, z.src);
          }
      },
    },
  },
  longshot: {
    id: 'longshot',
    name: 'Длинный ствол',
    desc: 'Пассивно: чем дальше цель, тем больнее — +4% урона за каждый метр дальше 3 м.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#c8b890', '#e8e0c8', '#8a7a4a', '#3a3018'),
    cast: () => false,
    onAttack(_w, u, t, dmg) {
      return dmg * (1 + Math.max(0, dist(u, t) - 3) * 0.04);
    },
  },
  lastshot: {
    id: 'lastshot',
    name: 'Последний выстрел',
    desc: 'Целится 1,5 с и стреляет в героя до 32 м: 300 урона, +40 за уровень.',
    cd: 70,
    target: 'unit',
    range: 32,
    castTime: 1.5,
    ult: true,
    colors: C('#ff9a8a', '#ffd6d0', '#d03a2a', '#5a1008'),
    ai: { kind: 'finish', range: 30, hp: 0.5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 32);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      return true;
    },
    fire(w, u, c) {
      const t = unitById(w, c.id) ?? aimUnit(w, u, { x: c.x, z: c.z, id: c.id }, 34);
      if (!t?.alive) return;
      launchAt(w, u, 'lastshot', t, 70, 300 + lvl(u) * 40, 0xff9a8a, 0.8);
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'physical');
      fx(w, hit.x, hit.z, 1.4, 0xff9a8a, 1, 0.4, 2);
    },
  },

  // ═══ Страж (танк) ═══
  challenge: {
    id: 'challenge',
    name: 'Вызов',
    desc: 'Враги в 5 м 2,2 с бьют только Стража; сам Страж получает +6 к броне.',
    cd: 14,
    target: 'none',
    range: 5,
    colors: C('#ffc080', '#ffe4c0', '#d07020', '#5a2a08'),
    ai: { kind: 'aoe', range: 4.5, creeps: 4, radius: 5 },
    cast(w, u) {
      fx(w, u.x, u.z, 1.6, 0xffc080, 1.5, 0.5, 2);
      addMod(u, 'armorUp', 2.2, 6, u.id);
      for (const v of enemiesIn(w, u, u.x, u.z, 5)) {
        addMod(v, 'taunt', 2.2, 0, u.id);
        if (!v.hero) v.target = u.id;
      }
      return true;
    },
  },
  shieldbash: {
    id: 'shieldbash',
    name: 'Удар щитом',
    desc: 'Бьёт щитом цель рядом: 70 урона, +12 за уровень, оглушение 1 с и отброс на 3 м.',
    cd: 11,
    target: 'unit',
    range: 3,
    colors: C('#c8d0dc', '#eef0f4', '#7a8496', '#2a3040'),
    ai: { kind: 'disable', range: 3.5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 3);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      fx(w, t.x, t.z, 1.2, 0xc8d0dc, 0.9, 0.3, 1.8);
      damage(w, t, 70 + lvl(u) * 12, u, 'physical');
      if (t.alive) {
        addMod(t, 'stun', 1, 0, u.id);
        knock(w, t, u.x, u.z, 3);
        resolveCollisions(w);
      }
      return true;
    },
  },
  spikes: {
    id: 'spikes',
    name: 'Шипы',
    desc: 'Пассивно: 20% физического урона вблизи возвращается напавшему.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#b8a890', '#e0d8c8', '#7a6a50', '#2e2618'),
    cast: () => false,
    // Шипы держатся постоянно: аура радиусом 0,1 м — только на самого Стража
    aura: { radius: 0.1, mod: 'thorns', v: 0.2 },
  },
  fortress: {
    id: 'fortress',
    name: 'Крепость',
    desc: '5 с: +18 к броне, на 30% меньше любого урона, и все враги в 6 м бьют только Стража первые 2 с.',
    cd: 60,
    target: 'none',
    range: 6,
    ult: true,
    colors: C('#ffd8a0', '#fff0d8', '#d09030', '#5a3608'),
    ai: { kind: 'defend', hp: 0.75, range: 6 },
    cast(w, u) {
      addMod(u, 'fortress', 5, 0, u.id);
      fx(w, u.x, u.z, 0.4, 0xffd8a0, 2.2, 0.7, 1.6);
      for (const v of enemiesIn(w, u, u.x, u.z, 6)) {
        addMod(v, 'taunt', 2, 0, u.id);
        if (!v.hero) v.target = u.id;
      }
      return true;
    },
  },

  // ═══ Древень (танк) ═══
  roots: {
    id: 'roots',
    name: 'Корни',
    desc: 'Через 0,5 с из земли в круге 3 м бьют корни: 70 урона, +11 за уровень, и держат 1,6 с.',
    cd: 10,
    target: 'point',
    range: 12,
    colors: C('#a0d080', '#d8f0c8', '#5a9a30', '#204010'),
    ai: { kind: 'disable', range: 11 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 12);
      addZone(w, {
        kind: 'roots',
        x: p.x,
        z: p.z,
        r: 3,
        t: 0.05,
        delay: 0.5,
        period: 0,
        src: u.id,
        team: u.team,
        v: 70 + lvl(u) * 11,
      });
      return true;
    },
    zone: {
      start(w, z, src) {
        fx(w, z.x, z.z, 0.4, 0x6a9a40, 1.6, 0.5, 1.6);
        if (!src) return;
        for (const v of aoe(w, src, z.x, z.z, z.r, z.v, 'magical', (v) => !isBuilding(v)))
          if (v.alive) addMod(v, 'root', 1.6, 0, src.id);
      },
    },
  },
  bark: {
    id: 'bark',
    name: 'Кора',
    desc: 'Щит на 20% от максимума здоровья на 6 с и +4 здоровья в секунду на это время.',
    cd: 16,
    target: 'none',
    range: 0,
    colors: C('#c0a070', '#e4d4b8', '#806030', '#30220c'),
    ai: { kind: 'defend', hp: 0.7, range: 7 },
    cast(w, u) {
      const m = addMod(u, 'shield', 6, 0, u.id);
      m.v = Math.max(m.v, u.maxHp * 0.2);
      m.t = 6;
      addMod(u, 'regen', 6, 4, u.id);
      fx(w, u.x, u.z, 1.2, 0xc0a070, 1.2, 0.5, 1.4);
      return true;
    },
  },
  sap: {
    id: 'sap',
    name: 'Сок земли',
    desc: 'Пассивно: стоя на месте, восстанавливает 1,5% здоровья в секунду.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#90c870', '#d0ecc0', '#4a8a28', '#1a3a0c'),
    cast: () => false,
    aura: { radius: 0.1, mod: 'sap', v: 0 },
  },
  overgrowth: {
    id: 'overgrowth',
    name: 'Буйство леса',
    desc: 'Лес оживает в 8 м вокруг: 130 урона, +20 за уровень, и корни на 2,2 с всем врагам.',
    cd: 65,
    target: 'none',
    range: 8,
    castTime: 0.4,
    ult: true,
    colors: C('#80e060', '#d0f8c0', '#3aa020', '#144808'),
    ai: { kind: 'aoe', range: 6.5 },
    cast: () => true,
    fire(w, u) {
      u.castTick = w.tick;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        fx(w, u.x + Math.cos(a) * 5, u.z + Math.sin(a) * 5, 0.4, 0x5a9a30, 1.4, 0.6, 1.4);
      }
      for (const v of aoe(w, u, u.x, u.z, 8, 130 + lvl(u) * 20, 'magical', (v) => !isBuilding(v)))
        if (v.alive) addMod(v, 'root', 2.2, 0, u.id);
    },
  },

  // ═══ Обжора (танк) ═══
  devour: {
    id: 'devour',
    name: 'Проглотить',
    desc: 'Съедает крипа или лесного зверя рядом (не героя): лечит 15% здоровья и навсегда +15 к максимуму здоровья.',
    cd: 20,
    target: 'unit',
    range: 3,
    colors: C('#e0a080', '#f4d8c8', '#a05a30', '#40200c'),
    ai: { kind: 'nuke', range: 3.5, creeps: 1, radius: 3 },
    cast(w, u, aim) {
      const chosen = aim?.id ? unitById(w, aim.id) : undefined;
      const t =
        chosen &&
        chosen.alive &&
        chosen.team !== u.team &&
        !chosen.hero &&
        !isBuilding(chosen) &&
        !chosen.owner &&
        dist(u, chosen) < 4.5
          ? chosen
          : nearestEnemy(w, u, 3.5, (v) => (v.kind === 'creep' || v.kind === 'neutral') && !v.owner);
      if (!t) return false;
      fx(w, t.x, t.z, 0.8, 0xe0a080, 1, 0.4, 1.4);
      damage(w, t, t.hp + 1, u, 'pure');
      u.hero!.baseHp += 15;
      u.maxHp += 15;
      heal(w, u, u.maxHp * 0.15);
      return true;
    },
  },
  roll: {
    id: 'roll',
    name: 'Перекат',
    desc: 'Катится на 9 м: враги на пути получают 80 урона, +12 за уровень, и разлетаются в стороны.',
    cd: 13,
    target: 'point',
    range: 9,
    colors: C('#d8b090', '#f0e0d0', '#9a6a40', '#3a2410'),
    ai: { kind: 'disable', range: 8 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 9);
      const x0 = u.x;
      const z0 = u.z;
      const hit = lineHit(w, u, x0, z0, p.x, p.z, 1.5);
      for (let k = 0; k <= 4; k++)
        fx(w, x0 + ((p.x - x0) * k) / 4, z0 + ((p.z - z0) * k) / 4, 0.4, 0xb08a5a, 0.8, 0.4, 1.6);
      place(w, u, p.x, p.z);
      for (const v of hit) {
        damage(w, v, 80 + lvl(u) * 12, u, 'physical');
        if (v.alive) {
          // В сторону от линии качения
          const side = (v.x - x0) * (p.z - z0) - (v.z - z0) * (p.x - x0) > 0 ? 1 : -1;
          const L = Math.hypot(p.x - x0, p.z - z0) || 1;
          place(w, v, v.x + ((p.z - z0) / L) * 2.5 * side, v.z - ((p.x - x0) / L) * 2.5 * side);
          addMod(v, 'slow', 1.5, 0.3, u.id);
        }
      }
      resolveCollisions(w);
      return true;
    },
  },
  thickhide: {
    id: 'thickhide',
    name: 'Толстокожесть',
    desc: 'Пассивно: получает на 1% меньше урона за каждые 100 максимального здоровья (растёт с едой и предметами).',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#c8a888', '#e8dccc', '#8a6848', '#36261a'),
    cast: () => false,
    aura: { radius: 0.1, mod: 'thickhide', v: 0 },
  },
  bellyflop: {
    id: 'bellyflop',
    name: 'Прыжок великана',
    desc: 'Прыгает на 11 м и приземляется: 160 урона, +24 за уровень, и оглушение 1,3 с в круге 4 м.',
    cd: 60,
    target: 'point',
    range: 11,
    castTime: 0.3,
    ult: true,
    colors: C('#ffb090', '#ffe0d0', '#d06030', '#5a200c'),
    ai: { kind: 'disable', range: 10 },
    cast: () => true,
    fire(w, u, c) {
      const p = aimPoint(w, u, c.id || c.x !== u.x ? { x: c.x, z: c.z, id: c.id } : null, 11);
      fx(w, u.x, u.z, 0.4, 0xb08a5a, 1, 0.4, 1.6);
      place(w, u, p.x, p.z);
      u.castTick = w.tick;
      fx(w, u.x, u.z, 0.3, 0xb08a5a, 2.4, 0.6, 2);
      for (const v of aoe(w, u, u.x, u.z, 4, 160 + lvl(u) * 24, 'physical', (v) => !isBuilding(v)))
        if (v.alive) addMod(v, 'stun', 1.3, 0, u.id);
      resolveCollisions(w);
    },
  },

  // ═══ Дуэлянтка (убийца) ═══
  lunge: {
    id: 'lunge',
    name: 'Выпад',
    desc: 'Рывок к цели до 7 м и укол: 80 урона, +13 за уровень.',
    cd: 8,
    target: 'unit',
    range: 7,
    colors: C('#e0d0ff', '#f4eeff', '#9a7ae0', '#3a2a70'),
    ai: { kind: 'nuke', range: 7 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 7);
      if (!t) return false;
      const d = dist(u, t) || 1;
      fx(w, u.x, u.z, 0.8, 0xe0d0ff, 0.6, 0.3, 1.6);
      place(
        w,
        u,
        t.x - ((t.x - u.x) / d) * (t.radius + u.radius + 0.3),
        t.z - ((t.z - u.z) / d) * (t.radius + u.radius + 0.3),
      );
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      damage(w, t, 80 + lvl(u) * 13, u, 'physical');
      if (u.hero) u.hero.order = { type: 'attack', id: t.id, auto: false };
      return true;
    },
  },
  parry: {
    id: 'parry',
    name: 'Парирование',
    desc: 'В течение 1,5 с первый физический удар вблизи отражается обратно, а напавший оглушён на 1 с.',
    cd: 12,
    target: 'none',
    range: 0,
    colors: C('#fff2c0', '#fffae8', '#d8b040', '#5a4410'),
    ai: { kind: 'defend', hp: 0.85, range: 4 },
    cast(w, u) {
      addMod(u, 'parry', 1.5, 0, u.id);
      fx(w, u.x, u.z, 1.4, 0xfff2c0, 0.8, 0.3, 1.4);
      return true;
    },
  },
  flurry: {
    id: 'flurry',
    name: 'Серия',
    desc: 'Пассивно: каждый третий удар подряд по той же цели — двойной урон и замедление 40% на 1,5 с.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#c8b8f0', '#ece6ff', '#7a5ad0', '#2a1a60'),
    cast: () => false,
    onAttack(w, u, t, dmg) {
      const m = getMod(u, 'combo');
      if (!m || m.src !== t.id) {
        addMod(u, 'combo', 3, 1, u.id).src = t.id;
        getMod(u, 'combo')!.v = 1;
        return dmg;
      }
      m.t = 3;
      m.v++;
      if (m.v < 3) return dmg;
      m.v = 0;
      fx(w, t.x, t.z, 1.4, 0xc8b8f0, 0.7, 0.3, 2);
      addMod(t, 'slow', 1.5, 0.4, u.id);
      return dmg * 2;
    },
  },
  deathmark: {
    id: 'deathmark',
    name: 'Метка смерти',
    desc: 'Метит героя рядом на 4 с; когда метка спадает, он ещё раз получает 45% всего урона, полученного за это время (чистый).',
    cd: 50,
    target: 'unit',
    range: 6,
    ult: true,
    colors: C('#ff8aa0', '#ffd6de', '#c02a50', '#4a0a1a'),
    ai: { kind: 'nuke', range: 5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 6);
      if (!t) return false;
      addMod(t, 'deathmark', 4, 0, u.id).v = 1;
      fx(w, t.x, t.z, 2.4, 0xff8aa0, 0.6, 0.6, 1);
      return true;
    },
  },

  // ═══ Отравительница (убийца) ═══
  toxin: {
    id: 'toxin',
    name: 'Ядовитый плевок',
    desc: 'Плевок в первого врага: 50 урона, +8 за уровень, и яд 25 урона в секунду, +4 за уровень, 4 с (копится).',
    cd: 6,
    target: 'point',
    range: 14,
    colors: C('#b0f080', '#e0ffd0', '#5ab030', '#1e4a0c'),
    ai: { kind: 'nuke', range: 12 },
    cast(w, u, aim) {
      const { dx, dz } = throwDir(w, u, aim, 14);
      launch(w, u, 'toxin', dx, dz, 24, 14, (50 + lvl(u) * 8) * amp(u), 0xb0f080, 0.6);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      const u = unitById(w, p.src);
      damage(w, hit, p.dmg, u ?? null, 'magical');
      if (hit.alive && u?.hero) poison(hit, (25 + lvl(u) * 4) * amp(u), 4, u.id);
      fx(w, hit.x, hit.z, 1, 0xb0f080, 0.6, 0.4, 1.4);
    },
  },
  miasma: {
    id: 'miasma',
    name: 'Ядовитое облако',
    desc: 'Облако 4 с в круге 3,5 м: яд 30 урона в секунду, +5 за уровень, и замедление 20%.',
    cd: 14,
    target: 'point',
    range: 11,
    colors: C('#90d870', '#d4f4c4', '#3a8a20', '#123808'),
    ai: { kind: 'nuke', range: 10, creeps: 3, radius: 3.5 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 11);
      addZone(w, {
        kind: 'miasma',
        x: p.x,
        z: p.z,
        r: 3.5,
        t: 4,
        delay: 0,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: (30 + lvl(u) * 5) * amp(u),
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        fx(w, z.x + Math.sin(w.tick) * 1.5, z.z + Math.cos(w.tick * 1.2) * 1.5, 0.6, 0x90d870, 1, 0.7, 0.8);
        if (!src) return;
        for (const v of enemiesIn(w, src, z.x, z.z, z.r)) {
          poison(v, z.v * 0.5, 1.5, src.id);
          addMod(v, 'slow', 0.6, 0.2, src.id);
        }
      },
    },
  },
  venomblade: {
    id: 'venomblade',
    name: 'Отравленный клинок',
    desc: 'Пассивно: удары травят — яд 10 урона в секунду, +2 за уровень, 3 с, копится до четырёх раз.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#a0e070', '#d8f4c8', '#4a9a28', '#183c0a'),
    cast: () => false,
    onAttack(_w, u, t, dmg) {
      if (t.team !== 2 || t.kind === 'neutral') poison(t, 10 + lvl(u) * 2, 3, u.id);
      return dmg;
    },
  },
  plague: {
    id: 'plague',
    name: 'Эпидемия',
    desc: 'Все враги в 8 м отравлены на 6 с: 50 урона в секунду, +7 за уровень, и бьют на 25% медленнее.',
    cd: 60,
    target: 'none',
    range: 8,
    ult: true,
    colors: C('#c0ff80', '#ecffd8', '#6ac030', '#204a0c'),
    ai: { kind: 'aoe', range: 7 },
    cast(w, u) {
      fx(w, u.x, u.z, 0.6, 0xc0ff80, 2.4, 0.7, 1.6);
      for (const v of enemiesIn(w, u, u.x, u.z, 8)) {
        const m = addMod(v, 'poison', 6, (50 + lvl(u) * 7) * amp(u), u.id);
        m.t = 6;
        addMod(v, 'atkSlow', 6, -0.25, u.id);
      }
      return true;
    },
  },

  // ═══ Призрак (убийца) ═══
  shadowstep: {
    id: 'shadowstep',
    name: 'Шаг сквозь тень',
    desc: 'Два заряда: мгновенный перенос на 7 м. Заряд копится за 9 с.',
    cd: 9,
    charges: 2,
    target: 'point',
    range: 7,
    colors: C('#a090d0', '#dcd4f4', '#5a4aa0', '#1e1640'),
    ai: { kind: 'escape', hp: 0.4 },
    cast(w, u, aim) {
      const { dx, dz, len } = aimDir(u, aim, () => facing(u));
      const L = Math.hypot(dx, dz) || 1;
      const d = Math.min(7, len || 7);
      fx(w, u.x, u.z, 1.2, 0x5a4aa0, 0.8, 0.4, 1.6);
      place(w, u, u.x + (dx / L) * d, u.z + (dz / L) * d);
      u.rot = Math.atan2(dx, dz);
      resolveCollisions(w);
      fx(w, u.x, u.z, 1.2, 0xa090d0, 0.8, 0.4, 1.6);
      return true;
    },
  },
  mirror: {
    id: 'mirror',
    name: 'Отражения',
    desc: 'Два отражения на 8 с: бьют на 40% урона Призрака, у каждого 30% его здоровья.',
    cd: 18,
    target: 'none',
    range: 0,
    colors: C('#c0b8f0', '#ece8ff', '#7068c0', '#262050'),
    ai: { kind: 'buff', range: 6 },
    cast(w, u) {
      for (const sx of [-1, 1]) {
        const s = summon(w, u, 'phantom', u.x + sx * 1.6, u.z, 8, {
          maxHp: u.maxHp * 0.3,
          dmg: u.dmg * 0.4,
          speed: u.speed,
          radius: u.radius,
          range: u.range,
          atkInt: u.atkInt,
          barH: u.barH,
        });
        fx(w, s.x, s.z, 1, 0xc0b8f0, 0.8, 0.4, 1.4);
      }
      return true;
    },
  },
  ethereal: {
    id: 'ethereal',
    name: 'Бесплотность',
    desc: 'Пассивно: 20% шанс увернуться от физического удара.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#d8d0ff', '#f4f0ff', '#8a80d0', '#302860'),
    cast: () => false,
    aura: { radius: 0.1, mod: 'evade', v: 0.2 },
  },
  nightmare: {
    id: 'nightmare',
    name: 'Кошмар',
    desc: 'Герой рядом погружается в кошмар на 2,4 с (оглушение) и получает 220 урона, +30 за уровень, за это время.',
    cd: 55,
    target: 'unit',
    range: 5,
    ult: true,
    colors: C('#9070c0', '#d8c8f0', '#4a2a80', '#160830'),
    ai: { kind: 'disable', range: 5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 5);
      if (!t) return false;
      addMod(t, 'stun', 2.4, 0, u.id);
      addMod(t, 'burn', 2.4, (220 + lvl(u) * 30) / 2.4, u.id);
      fx(w, t.x, t.z, 2.2, 0x4a2a80, 0.9, 0.8, 1);
      return true;
    },
  },

  // ═══ Шаман (поддержка) ═══
  totem: {
    id: 'totem',
    name: 'Тотем исцеления',
    desc: 'Ставит тотем на 7 с: союзники в 5 м восстанавливают 30 здоровья, +5 за уровень, каждые 0,5 с.',
    cd: 16,
    target: 'point',
    range: 6,
    colors: C('#a0f0c0', '#e0fff0', '#30b070', '#0e4a2a'),
    ai: { kind: 'heal', hp: 0.75, range: 9 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 6);
      summon(w, u, 'totem', p.x, p.z, 7, { maxHp: 200, dmg: 0, speed: 0, radius: 0.5, barH: 2.4 });
      addZone(w, {
        kind: 'totem',
        x: p.x,
        z: p.z,
        r: 5,
        t: 7,
        delay: 0,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: 30 + lvl(u) * 5,
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        if (!src) return;
        for (const v of alliesIn(w, src, z.x, z.z, z.r)) heal(w, v, z.v * amp(src));
      },
    },
  },
  hexspell: {
    id: 'hexspell',
    name: 'Сглаз',
    desc: 'Превращает врага в лягушку на 2,2 с: не применяет умения, не бьёт и медленнее на 35%.',
    cd: 14,
    target: 'unit',
    range: 10,
    colors: C('#80e0a0', '#d0f8e0', '#20a050', '#084020'),
    ai: { kind: 'disable', range: 9 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 10);
      if (!t) return false;
      addMod(t, 'hex', 2.2, 0, u.id);
      fx(w, t.x, t.z, 1.2, 0x80e0a0, 1, 0.5, 1.4);
      return true;
    },
  },
  spiritlink: {
    id: 'spiritlink',
    name: 'Связь духов',
    desc: 'Пассивно: союзники в 9 м получают +3 здоровья в секунду и +8% к скорости бега.',
    cd: 0,
    target: 'none',
    range: 9,
    passive: true,
    aura: { radius: 9, mod: 'spiritAura', v: 0 },
    colors: C('#b0f0d0', '#e8fff4', '#40b080', '#104a30'),
    cast: () => false,
  },
  ancestors: {
    id: 'ancestors',
    name: 'Зов предков',
    desc: 'Союзные герои в 12 м получают щит на 220, +30 за уровень, и +25% к скорости на 4 с.',
    cd: 60,
    target: 'none',
    range: 12,
    ult: true,
    colors: C('#c0fff0', '#f0fffa', '#40d0b0', '#0e5244'),
    ai: { kind: 'defend', hp: 0.6, range: 10 },
    cast(w, u) {
      for (const v of alliesIn(w, u, u.x, u.z, 12)) {
        const m = addMod(v, 'shield', 4, 0, u.id);
        m.v = Math.max(m.v, (220 + lvl(u) * 30) * amp(u));
        m.t = 4;
        addMod(v, 'haste', 4, 0.25, u.id);
        fx(w, v.x, v.z, 1.4, 0xc0fff0, 1, 0.5, 1.4);
      }
      return true;
    },
  },

  // ═══ Бард (поддержка) ═══
  chord: {
    id: 'chord',
    name: 'Аккорд',
    desc: 'Звуковая волна вперёд на 7 м: 80 урона, +12 за уровень, и отбрасывает врагов на 2 м.',
    cd: 8,
    target: 'point',
    range: 7,
    colors: C('#ffc0e0', '#ffe6f2', '#e060a0', '#5a1a40'),
    ai: { kind: 'nuke', range: 6, creeps: 3, radius: 3 },
    cast(w, u, aim) {
      const { dx, dz } = throwDir(w, u, aim, 7);
      const x1 = u.x + dx * 7;
      const z1 = u.z + dz * 7;
      for (let k = 1; k <= 4; k++) fx(w, u.x + dx * k * 1.7, u.z + dz * k * 1.7, 1, 0xffc0e0, 0.5 + k * 0.2, 0.35, 1.4);
      for (const v of lineHit(w, u, u.x, u.z, x1, z1, 2)) {
        damage(w, v, (80 + lvl(u) * 12) * amp(u), u, 'magical');
        if (v.alive) knock(w, v, u.x, u.z, 2);
      }
      resolveCollisions(w);
      return true;
    },
  },
  ballad: {
    id: 'ballad',
    name: 'Баллада',
    desc: 'Песня на 5 с: союзные герои в 7 м бьют на 30% быстрее и бегают на 15% быстрее.',
    cd: 18,
    target: 'none',
    range: 7,
    colors: C('#ffe0a0', '#fff4d8', '#e0a030', '#5a3a08'),
    ai: { kind: 'buff', range: 7 },
    cast(w, u) {
      for (const v of alliesIn(w, u, u.x, u.z, 7)) {
        addMod(v, 'song', 5, 0, u.id);
        fx(w, v.x, v.z, 2.2, 0xffe0a0, 0.4, 0.6, 1);
      }
      return true;
    },
  },
  encore: {
    id: 'encore',
    name: 'На бис',
    desc: 'Пассивно: каждое применённое умение лечит союзных героев в 6 м на 45 здоровья, +6 за уровень.',
    cd: 0,
    target: 'none',
    range: 6,
    passive: true,
    colors: C('#ffd0f0', '#fff0fa', '#d070b0', '#4a1a3a'),
    cast: () => false,
  },
  lullaby: {
    id: 'lullaby',
    name: 'Колыбельная',
    desc: 'Враги в 7 м засыпают на 3 с; урон будит.',
    cd: 60,
    target: 'none',
    range: 7,
    castTime: 0.5,
    ult: true,
    colors: C('#d0c0ff', '#f0ecff', '#8a70e0', '#2a1a6a'),
    ai: { kind: 'aoe', range: 6 },
    cast: () => true,
    fire(w, u) {
      u.castTick = w.tick;
      fx(w, u.x, u.z, 1.4, 0xd0c0ff, 2.6, 0.9, 1.2);
      for (const v of enemiesIn(w, u, u.x, u.z, 7)) addMod(v, 'sleep', 3, 0, u.id);
    },
  },

  // ═══ Жрица света (поддержка) ═══
  smite: {
    id: 'smite',
    name: 'Кара',
    desc: 'Свет бьёт врага: 90 урона, +14 за уровень; Жрица восстанавливает половину нанесённого.',
    cd: 7,
    target: 'unit',
    range: 11,
    colors: C('#fff4b0', '#fffbe0', '#e0c040', '#5a4a08'),
    ai: { kind: 'nuke', range: 10 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 11);
      if (!t) return false;
      fx(w, t.x, t.z, 2, 0xfff4b0, 0.6, 0.4, 0.8);
      const d = damage(w, t, (90 + lvl(u) * 14) * amp(u), u, 'magical');
      heal(w, u, d * 0.5);
      return true;
    },
  },
  purify: {
    id: 'purify',
    name: 'Очищение',
    desc: 'Союзные герои в 4 м от точки избавляются от замедлений и корней и восстанавливают 90 здоровья, +14 за уровень.',
    cd: 12,
    target: 'point',
    range: 10,
    colors: C('#e0f8ff', '#f6fdff', '#80c8e8', '#204a60'),
    ai: { kind: 'heal', hp: 0.7, range: 10 },
    cast(w, u, aim) {
      const x = aim ? aim.x : u.x;
      const z = aim ? aim.z : u.z;
      fx(w, x, z, 0.3, 0xe0f8ff, 1.8, 0.5, 1.4);
      const list = alliesIn(w, u, x, z, 4);
      if (!list.length) list.push(u);
      for (const v of list) {
        dispel(v);
        heal(w, v, (90 + lvl(u) * 14) * amp(u));
      }
      return true;
    },
  },
  grace: {
    id: 'grace',
    name: 'Благодать',
    desc: 'Пассивно: союзные герои в 9 м получают +2 к броне и +2 здоровья в секунду.',
    cd: 0,
    target: 'none',
    range: 9,
    passive: true,
    aura: { radius: 9, mod: 'graceAura', v: 0 },
    colors: C('#fff0c8', '#fffaec', '#e0c070', '#5a4818'),
    cast: () => false,
  },
  dawn: {
    id: 'dawn',
    name: 'Рассвет',
    desc: 'Павшие союзные герои воскресают рядом с Жрицей с половиной здоровья; живые союзники в 12 м лечатся на 250, +30 за уровень.',
    cd: 90,
    target: 'none',
    range: 12,
    castTime: 0.8,
    ult: true,
    colors: C('#fff8d0', '#ffffff', '#f0d060', '#6a5010'),
    ai: { kind: 'revive', hp: 0.4, range: 12 },
    cast: () => true,
    fire(w, u) {
      u.castTick = w.tick;
      fx(w, u.x, u.z, 0.4, 0xfff8d0, 3, 0.9, 1.4);
      let k = 0;
      for (const v of w.units)
        if (v.kind === 'hero' && v.team === u.team && v !== u) {
          if (!v.alive) {
            reviveHero(w, v, u.x + Math.sin(k) * 2, u.z + Math.cos(k) * 2, 0.5);
            k += 2.1;
          } else if (dist(u, v) < 12) heal(w, v, (250 + lvl(u) * 30) * amp(u));
        }
      heal(w, u, (250 + lvl(u) * 30) * amp(u) * 0.5);
      resolveCollisions(w);
    },
  },

  // ═══ Берсерк (боец) ═══
  cleave: {
    id: 'cleave',
    name: 'Рассекающий удар',
    desc: 'Удар полукругом перед собой на 3,5 м: 90 урона, +14 за уровень.',
    cd: 6,
    target: 'none',
    range: 3.5,
    colors: C('#ff9a80', '#ffd4c8', '#d04a30', '#5a1408'),
    ai: { kind: 'aoe', range: 3.2, creeps: 2, radius: 3.5 },
    cast(w, u) {
      const f = facing(u);
      fx(w, u.x + f.dx * 1.6, u.z + f.dz * 1.6, 1, 0xff9a80, 1.2, 0.3, 1.8);
      aoe(
        w,
        u,
        u.x,
        u.z,
        3.5,
        90 + lvl(u) * 14,
        'physical',
        (v) => !isBuilding(v) && (v.x - u.x) * f.dx + (v.z - u.z) * f.dz > -0.5,
      );
      return true;
    },
  },
  rage: {
    id: 'rage',
    name: 'Ярость',
    desc: '6 с: +50% к скорости атаки и вампиризм 15%, но получает на 15% больше урона.',
    cd: 16,
    target: 'none',
    range: 0,
    colors: C('#ff6a5a', '#ffc0b8', '#c02a1a', '#4a0a04'),
    ai: { kind: 'buff', range: 4 },
    cast(w, u) {
      addMod(u, 'rage', 6, 0.5, u.id);
      fx(w, u.x, u.z, 1.2, 0xff6a5a, 1, 0.4, 1.6);
      return true;
    },
  },
  bloodlust: {
    id: 'bloodlust',
    name: 'Жажда битвы',
    desc: 'Пассивно: чем меньше здоровья, тем быстрее бьёт — до +60% к скорости атаки.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#e05a4a', '#f8c8c0', '#a02010', '#3a0804'),
    cast: () => false,
    aura: { radius: 0.1, mod: 'bloodlust', v: 0 },
  },
  undying: {
    id: 'undying',
    name: 'Неистовство',
    desc: '5 с не может умереть: здоровье не опускается ниже 1.',
    cd: 75,
    target: 'none',
    range: 0,
    ult: true,
    colors: C('#ff4a3a', '#ffb0a8', '#b01a0a', '#3a0402'),
    ai: { kind: 'defend', hp: 0.25, range: 8 },
    cast(w, u) {
      addMod(u, 'undying', 5, 0, u.id);
      fx(w, u.x, u.z, 1.4, 0xff4a3a, 1.6, 0.6, 1.6);
      return true;
    },
  },

  // ═══ Монах (боец) ═══
  palm: {
    id: 'palm',
    name: 'Удар ладонью',
    desc: 'Шаг к цели до 5 м и удар: 75 урона, +12 за уровень. Даёт очко серии.',
    cd: 5,
    target: 'unit',
    range: 5,
    colors: C('#ffd8a0', '#fff0d8', '#e09a30', '#5a3608'),
    ai: { kind: 'nuke', range: 5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 5);
      if (!t) return false;
      const d = dist(u, t) || 1;
      if (d > t.radius + u.radius + 1)
        place(
          w,
          u,
          t.x - ((t.x - u.x) / d) * (t.radius + u.radius + 0.3),
          t.z - ((t.z - u.z) / d) * (t.radius + u.radius + 0.3),
        );
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      fx(w, t.x, t.z, 1.2, 0xffd8a0, 0.6, 0.25, 1.8);
      damage(w, t, 75 + lvl(u) * 12, u, 'physical');
      chi(u);
      return true;
    },
  },
  spinkick: {
    id: 'spinkick',
    name: 'Удар с разворота',
    desc: 'Удар ногой вокруг себя на 3 м: 70 урона, +11 за уровень, отброс на 2 м. Даёт очко серии.',
    cd: 8,
    target: 'none',
    range: 3,
    colors: C('#ffc890', '#ffe8d0', '#d08030', '#4a2a08'),
    ai: { kind: 'aoe', range: 2.8, creeps: 3, radius: 3 },
    cast(w, u) {
      fx(w, u.x, u.z, 1, 0xffc890, 1.4, 0.3, 1.6);
      for (const v of aoe(w, u, u.x, u.z, 3, 70 + lvl(u) * 11, 'physical', (v) => !isBuilding(v)))
        if (v.alive) knock(w, v, u.x, u.z, 2);
      resolveCollisions(w);
      chi(u);
      return true;
    },
  },
  innerflow: {
    id: 'innerflow',
    name: 'Внутренний поток',
    desc: 'Пассивно: при трёх очках серии следующий удар оглушает на 1 с и наносит +100% урона.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#f0e0b0', '#fff8e6', '#c0a050', '#4a3a10'),
    cast: () => false,
    onAttack(w, u, t, dmg) {
      const m = getMod(u, 'combo');
      if (!m || m.v < 3) return dmg;
      removeMod(u, 'combo');
      fx(w, t.x, t.z, 1.4, 0xfff0c0, 1, 0.3, 2);
      if (t.kind !== 'tower' && t.kind !== 'ancient') addMod(t, 'stun', 1, 0, u.id);
      return dmg * 2;
    },
  },
  thousandfists: {
    id: 'thousandfists',
    name: 'Тысяча ударов',
    desc: 'Восемь молниеносных ударов по цели рядом за 1,2 с: 45 урона, +7 за уровень, каждый. Даёт три очка серии.',
    cd: 55,
    target: 'unit',
    range: 3,
    ult: true,
    colors: C('#ffe0b0', '#fff6e6', '#e0a040', '#5a3a08'),
    ai: { kind: 'nuke', range: 3.5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 3);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      addZone(w, {
        kind: 'thousandfists',
        x: t.x,
        z: t.z,
        r: 0,
        t: 1.2,
        delay: 0,
        period: 0.15,
        src: u.id,
        team: u.team,
        v: t.id,
      });
      chi(u, 3);
      return true;
    },
    zone: {
      pulse(w, z, src) {
        const t = unitById(w, z.v);
        if (!src?.alive || !t?.alive || dist(src, t) > 5) {
          z.t = 0;
          return;
        }
        src.atkTick = w.tick;
        fx(w, t.x + Math.sin(w.tick) * 0.5, t.z + Math.cos(w.tick) * 0.5, 1.3, 0xffe0b0, 0.4, 0.2, 1.6);
        damage(w, t, 45 + lvl(src) * 7, src, 'physical');
      },
    },
  },

  // ═══ Оборотень (боец) ═══
  howl: {
    id: 'howl',
    name: 'Вой',
    desc: 'Враги в 7 м замедлены на 35% на 3 с, союзники получают +20% к скорости.',
    cd: 14,
    target: 'none',
    range: 7,
    colors: C('#c0b0a0', '#e8e0d8', '#806a58', '#30261c'),
    ai: { kind: 'buff', range: 6 },
    cast(w, u) {
      fx(w, u.x, u.z, 1.6, 0xc0b0a0, 2, 0.6, 1.4);
      for (const v of enemiesIn(w, u, u.x, u.z, 7)) addMod(v, 'slow', 3, 0.35, u.id);
      for (const v of alliesIn(w, u, u.x, u.z, 7)) addMod(v, 'haste', 3, 0.2, u.id);
      return true;
    },
  },
  maul: {
    id: 'maul',
    name: 'Растерзать',
    desc: 'Удар когтями по цели рядом: 80 урона, +12 за уровень, и кровотечение 20 в секунду 4 с. В облике волка — вдвое сильнее.',
    cd: 8,
    target: 'unit',
    range: 3,
    colors: C('#e08070', '#f4c8c0', '#a03a2a', '#3a0e08'),
    ai: { kind: 'nuke', range: 3.5 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 3);
      if (!t) return false;
      const k = getMod(u, 'wolfform') ? 2 : 1;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      fx(w, t.x, t.z, 1.2, 0xe08070, 0.7, 0.3, 1.8);
      damage(w, t, (80 + lvl(u) * 12) * k, u, 'physical');
      if (t.alive) addMod(t, 'bleed', 4, 20 * k, u.id);
      return true;
    },
  },
  feral: {
    id: 'feral',
    name: 'Звериная живучесть',
    desc: 'Пассивно: каждый удар восстанавливает 2% максимума здоровья.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#b0a080', '#e0d8c8', '#706040', '#2a2214'),
    cast: () => false,
    onAttack(_w, u, _t, dmg) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02);
      return dmg;
    },
  },
  wolfform: {
    id: 'wolfform',
    name: 'Обращение',
    desc: 'На 14 с становится огромным волком: +35% урона, +25% скорости, +5 к броне, вампиризм 12%.',
    cd: 70,
    target: 'none',
    range: 0,
    ult: true,
    colors: C('#a08870', '#dccfc0', '#5a4430', '#1e140c'),
    ai: { kind: 'buff', range: 7 },
    cast(w, u) {
      addMod(u, 'wolfform', 14, 0, u.id);
      fx(w, u.x, u.z, 1.2, 0xa08870, 2, 0.6, 1.4);
      return true;
    },
  },

  // ═══ Паладин (боец) ═══
  hammer: {
    id: 'hammer',
    name: 'Метнуть молот',
    desc: 'Молот в цель до 10 м: 85 урона, +13 за уровень, и оглушение 1,2 с.',
    cd: 11,
    target: 'unit',
    range: 10,
    colors: C('#fff0b0', '#fffae6', '#d8b040', '#5a4408'),
    ai: { kind: 'disable', range: 9 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 10);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      launchAt(w, u, 'hammer', t, 24, 85 + lvl(u) * 13, 0xfff0b0, 0.8);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'magical');
      if (hit.alive) addMod(hit, 'stun', 1.2, 0, p.src);
      fx(w, hit.x, hit.z, 1.4, 0xfff0b0, 0.9, 0.35, 1.8);
    },
  },
  consecrate: {
    id: 'consecrate',
    name: 'Освящение',
    desc: 'Земля вокруг 5 с светится в 4 м: врагам 35 урона, +6 за уровень, каждые 0,5 с, союзникам — столько же лечения.',
    cd: 15,
    target: 'none',
    range: 4,
    colors: C('#fff6c0', '#fffcec', '#e8c860', '#6a5214'),
    ai: { kind: 'aoe', range: 3.5, creeps: 3, radius: 4 },
    cast(w, u) {
      addZone(w, {
        kind: 'consecrate',
        x: u.x,
        z: u.z,
        r: 4,
        t: 5,
        delay: 0,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: 35 + lvl(u) * 6,
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        if (!src) return;
        aoe(w, src, z.x, z.z, z.r, z.v, 'magical', (v) => !isBuilding(v));
        for (const v of alliesIn(w, src, z.x, z.z, z.r)) heal(w, v, z.v * 0.6);
      },
    },
  },
  retribution: {
    id: 'retribution',
    name: 'Воздаяние',
    desc: 'Пассивно: каждый пятый удар лечит на 60 и бьёт светом врагов в 2,5 м на 50 урона, +8 за уровень.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: C('#ffe8a0', '#fff6d8', '#d8a830', '#5a3e08'),
    cast: () => false,
    onAttack(w, u, t, dmg) {
      const h = u.hero!;
      h.stacks = (h.stacks + 1) % 5;
      if (h.stacks) return dmg;
      fx(w, t.x, t.z, 1, 0xffe8a0, 1.2, 0.35, 1.8);
      heal(w, u, 60);
      aoe(w, u, t.x, t.z, 2.5, 50 + lvl(u) * 8, 'magical', (v) => !isBuilding(v));
      return dmg;
    },
  },
  judgement: {
    id: 'judgement',
    name: 'Божественный суд',
    desc: 'Прыжок к врагу до 10 м: 200 урона, +28 за уровень, ему и 50% — врагам в 3 м; 1,5 с Паладин неуязвим.',
    cd: 60,
    target: 'unit',
    range: 10,
    ult: true,
    colors: C('#fffad0', '#ffffff', '#f0d050', '#6a5008'),
    ai: { kind: 'nuke', range: 9 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 10);
      if (!t) return false;
      const d = dist(u, t) || 1;
      fx(w, u.x, u.z, 1, 0xfffad0, 1, 0.4, 1.6);
      place(
        w,
        u,
        t.x - ((t.x - u.x) / d) * (t.radius + u.radius + 0.3),
        t.z - ((t.z - u.z) / d) * (t.radius + u.radius + 0.3),
      );
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      addMod(u, 'immune', 1.5, 0, u.id);
      fx(w, t.x, t.z, 2.5, 0xfffad0, 0.6, 0.5, 0.8);
      const dmg = 200 + lvl(u) * 28;
      damage(w, t, dmg, u, 'magical');
      aoe(w, u, t.x, t.z, 3, dmg * 0.5, 'magical', (v) => v !== t && !isBuilding(v));
      resolveCollisions(w);
      return true;
    },
  },
};

/** Очко серии Монаха (до трёх) */
function chi(u: Unit, n = 1) {
  const m = getMod(u, 'combo') ?? addMod(u, 'combo', 6, 0, u.id);
  m.v = Math.min(3, m.v + n);
  m.t = 6;
}

/** Бросок 0..1 (для умений с шансом) — общий генератор мира, детерминированно */
export const chance = (w: World, p: number) => rand(w) < p;
