// Способности героев. Общий скелет — перезарядка, цель, дальность, замах; начинка — функция cast
// (и fire для способностей с замахом, onProjectileEnd для снарядов). Числа растут с уровнем героя,
// очков навыков нет — как в прототипе: на телефоне проще.
import type { Casting, Projectile, Unit, Zone } from '../types';
import { HERO } from '../data/heroes';
import { addMod, hasFlag, removeMod } from './modifiers';
import {
  addZone,
  clamp,
  damage,
  dist,
  DT,
  emit,
  fx,
  heal,
  launch,
  nearestEnemy,
  resolveCollisions,
  ULT_LEVEL,
  unitById,
  type World,
} from './world';

export interface Aim {
  x: number;
  z: number;
  id: number;
}

/** Подсказка ИИ: как и когда бот применяет способность */
export interface AiHint {
  /** nuke — урон в героя; aoe — по площади вокруг себя; escape — отход; defend — защита; buff — усиление в драке */
  kind: 'nuke' | 'aoe' | 'escape' | 'defend' | 'buff' | 'disable' | 'heal' | 'finish';
  /** Дистанция до героя-цели */
  range?: number;
  /** Сколько вражеских крипов рядом оправдывают применение по крипам */
  creeps?: number;
  /** Радиус подсчёта крипов */
  radius?: number;
  /** Порог здоровья (доля) для escape/defend */
  hp?: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  /** Описание с числами для 1-го уровня; {lvl} не используем — числа растут, пишем прирост */
  desc: string;
  cd: number;
  target: 'none' | 'point' | 'unit';
  range: number;
  /** Замах, с: способность срабатывает после него (можно сбить стаёном) */
  castTime?: number;
  ult?: boolean;
  /** Цвета кнопки: обод, светлый, основной, тёмный */
  colors: [string, string, string, string];
  ai?: AiHint;
  /** Применить. false — некуда/не на кого (перезарядка не тратится) */
  cast(w: World, u: Unit, aim: Aim | null): boolean;
  /** Сработать после замаха */
  fire?(w: World, u: Unit, c: Casting): void;
  /** Снаряд долетел или в кого-то попал */
  onProjectileEnd?(w: World, p: Projectile, hit: Unit | null): void;
  /** Пробивающий снаряд задел цель */
  onProjectileHit?(w: World, p: Projectile, hit: Unit): void;
  /** Пассивная: не применяется кнопкой */
  passive?: boolean;
  /** Пассивная реакция на собственную атаку: вернуть итоговый урон */
  onAttack?(w: World, u: Unit, target: Unit, dmg: number): number;
  /** Аура: союзникам рядом каждый тик обновляется модификатор */
  aura?: { radius: number; mod: string; v: number };
  /** Поведение области на земле (ABILITIES[zone.kind].zone) */
  zone?: {
    start?(w: World, z: Zone, src: Unit | null): void;
    pulse?(w: World, z: Zone, src: Unit | null): void;
    end?(w: World, z: Zone, src: Unit | null): void;
  };
}

const lvl = (u: Unit) => u.hero!.level - 1;
const amp = (u: Unit) => u.hero!.spellAmp;

/** Направление каста: к точке прицела, иначе запасной вариант */
function aimDir(u: Unit, aim: Aim | null, fallback: () => { dx: number; dz: number }) {
  if (aim) {
    const dx = aim.x - u.x;
    const dz = aim.z - u.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.3) return { dx, dz, len };
  }
  const f = fallback();
  return { ...f, len: 0 };
}
const facing = (u: Unit) => ({ dx: Math.sin(u.rot), dz: Math.cos(u.rot) });

/** Урон по площади всем врагам (кроме неуязвимых), filter — дополнительное условие */
export function aoe(
  w: World,
  u: Unit,
  x: number,
  z: number,
  r: number,
  amt: number,
  type: 'physical' | 'magical' | 'pure',
  filter?: (v: Unit) => boolean,
): Unit[] {
  const hit: Unit[] = [];
  for (const v of w.units)
    if (
      v.alive &&
      v.team !== u.team &&
      !v.invuln &&
      Math.hypot(v.x - x, v.z - z) < r + v.radius &&
      (!filter || filter(v))
    )
      hit.push(v);
  for (const v of hit) damage(w, v, amt, u, type);
  return hit;
}

/** Точка каста: прицел или запасная (ближайший враг, иначе на 6 м вперёд) */
function aimPoint(w: World, u: Unit, aim: Aim | null, range: number): { x: number; z: number } {
  let x: number;
  let z: number;
  if (aim) {
    x = aim.x;
    z = aim.z;
  } else {
    const t = nearestEnemy(w, u, range, (v) => v.kind === 'hero') ?? nearestEnemy(w, u, range);
    if (t) {
      x = t.x;
      z = t.z;
    } else {
      x = u.x + Math.sin(u.rot) * 6;
      z = u.z + Math.cos(u.rot) * 6;
    }
  }
  const dx = x - u.x;
  const dz = z - u.z;
  const d = Math.hypot(dx, dz);
  if (d > range) {
    x = u.x + (dx / d) * range;
    z = u.z + (dz / d) * range;
  }
  u.rot = Math.atan2(x - u.x, z - u.z) || u.rot;
  return { x: clamp(x, -58, 58), z: clamp(z, -58, 58) };
}

/** Цель-юнит: выбранная, иначе ближайший вражеский герой, иначе любой враг в радиусе */
function aimUnit(w: World, u: Unit, aim: Aim | null, range: number): Unit | null {
  const chosen = aim?.id ? unitById(w, aim.id) : undefined;
  if (chosen?.alive && chosen.team !== u.team && !chosen.invuln && dist(u, chosen) <= range + chosen.radius + 1)
    return chosen;
  return nearestEnemy(w, u, range, (v) => v.kind === 'hero') ?? nearestEnemy(w, u, range);
}

/** Самонаводящийся снаряд способности */
function launchAt(w: World, u: Unit, kind: string, t: Unit, speed: number, dmg: number, color: number, size = 0.7) {
  w.projs.push({
    id: w.nextId++,
    kind,
    x: u.x,
    z: u.z,
    y0: 1.8,
    dx: 0,
    dz: 0,
    speed,
    dist: 0,
    max: 1e9,
    target: t.id,
    src: u.id,
    team: u.team,
    dmg,
    color,
    size,
  });
}

export const ABILITIES: Record<string, AbilityDef> = {
  // ── Маг ──
  fireball: {
    id: 'fireball',
    name: 'Огненный шар',
    desc: 'Снаряд взрывается по площади: 110 урона, +15 за уровень.',
    cd: 5,
    target: 'point',
    range: 24,
    colors: ['#ffb35c', '#ffcf7a', '#ff7a1f', '#a83a0c'],
    ai: { kind: 'nuke', range: 20, creeps: 3, radius: 3.2 },
    cast(w, u, aim) {
      let { dx, dz } = aimDir(u, aim, () => {
        const t = nearestEnemy(w, u, 22);
        return t ? { dx: t.x - u.x, dz: t.z - u.z } : facing(u);
      });
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      launch(w, u, 'fireball', dx, dz, 28, 24, 0, 0xffa13d);
      u.rot = Math.atan2(dx, dz);
      return true;
    },
    onProjectileEnd(w, p) {
      const u = unitById(w, p.src);
      fx(w, p.x, p.z, 1.8, 0xff7a1f, 1.1, 0.4, 2.4);
      fx(w, p.x, p.z, 1.8, 0xffd27a, 0.6, 0.25, 2);
      if (!u?.hero) return;
      aoe(w, u, p.x, p.z, 3.2, (110 + lvl(u) * 15) * amp(u), 'magical');
    },
  },
  blink: {
    id: 'blink',
    name: 'Скачок',
    desc: 'Телепорт на 10 м в сторону прицела или прочь от врагов.',
    cd: 10,
    target: 'point',
    range: 10,
    colors: ['#c7a6ff', '#d9c6ff', '#8a5cf0', '#4a2a9a'],
    ai: { kind: 'escape', hp: 0.35 },
    cast(w, u, aim) {
      const { dx, dz, len } = aimDir(u, aim, () => {
        const o = u.hero!.order;
        if (o?.type === 'move') return { dx: o.x - u.x, dz: o.z - u.z };
        let cx = 0;
        let cz = 0;
        let n = 0;
        for (const v of w.units)
          if (v.alive && v.team !== u.team && v.team !== 2 && dist(v, u) < 9) {
            cx += v.x;
            cz += v.z;
            n++;
          }
        if (n) return { dx: u.x - cx / n, dz: u.z - cz / n };
        return facing(u);
      });
      const L = Math.hypot(dx, dz) || 1;
      const d = Math.min(10, len || 10);
      fx(w, u.x, u.z, 1.2, 0x9d7bff, 0.8, 0.4, 1.8);
      u.x = clamp(u.x + (dx / L) * d, -58, 58);
      u.z = clamp(u.z + (dz / L) * d, -58, 58);
      u.rot = Math.atan2(dx, dz);
      u.hero!.order = null;
      resolveCollisions(w);
      fx(w, u.x, u.z, 1.2, 0xc7a6ff, 0.6, 0.45, 2.2);
      return true;
    },
  },
  shield: {
    id: 'shield',
    name: 'Щит',
    desc: 'Поглощает 150 урона, +25 за уровень, 4 с.',
    cd: 14,
    target: 'none',
    range: 0,
    colors: ['#9eeaff', '#d2f6ff', '#39b6e0', '#16607e'],
    ai: { kind: 'defend', hp: 0.6, range: 7 },
    cast(w, u) {
      addMod(u, 'shield', 4, 0, u.id);
      const m = u.mods.find((x) => x.id === 'shield')!;
      m.v = 150 + 25 * lvl(u);
      m.t = 4;
      fx(w, u.x, u.z, 1.4, 0x8ee6ff, 0.8, 0.35, 1.5);
      return true;
    },
  },
  // ── Громила ──
  slam: {
    id: 'slam',
    name: 'Удар по земле',
    desc: 'Замах 0,6 с, потом 90 урона по площади, +14 за уровень.',
    cd: 8,
    target: 'none',
    range: 3.6,
    castTime: 0.6,
    colors: ['#ff8a6a', '#ffb39a', '#c9402c', '#6e1d12'],
    ai: { kind: 'aoe', range: 3.4, creeps: 3, radius: 3.6 },
    cast() {
      return true;
    },
    fire(w, u) {
      u.castTick = w.tick;
      fx(w, u.x, u.z, 0.4, 0xb08a5a, 1.4, 0.45, 2.4);
      aoe(w, u, u.x, u.z, 3.6, 90 + lvl(u) * 14, 'physical', (v) => v.kind !== 'tower');
    },
  },
  meteor: {
    id: 'meteor',
    name: 'Метеор',
    desc: 'Через 1 с падает в точку: 220 урона, +30 за уровень, оглушение 1 с, потом земля горит 3 с.',
    cd: 55,
    target: 'point',
    range: 16,
    ult: true,
    colors: ['#ffcf5c', '#fff0a8', '#ff8a1f', '#8a2a06'],
    ai: { kind: 'nuke', range: 15 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 16);
      addZone(w, {
        kind: 'meteor',
        x: p.x,
        z: p.z,
        r: 4.5,
        t: 3,
        delay: 1,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: (220 + lvl(u) * 30) * amp(u),
      });
      return true;
    },
    zone: {
      start(w, z, src) {
        fx(w, z.x, z.z, 1, 0xff7a1f, 2.4, 0.6, 2.6);
        fx(w, z.x, z.z, 1.5, 0xffd27a, 1.4, 0.4, 2.2);
        if (!src) return;
        for (const v of aoe(w, src, z.x, z.z, z.r, z.v, 'magical')) if (v.alive) addMod(v, 'stun', 1, 0, src.id);
      },
      pulse(w, z, src) {
        if (src) aoe(w, src, z.x, z.z, z.r - 0.5, z.v * 0.09, 'magical');
        fx(w, z.x, z.z, 0.3, 0xff6a1f, 1.2, 0.5, 1.4);
      },
    },
  },
  // ── Громила ──
  charge: {
    id: 'charge',
    name: 'Рывок',
    desc: 'Бросок на 8 м: враги на пути получают 70 урона, +10 за уровень, и замедляются на 2 с.',
    cd: 12,
    target: 'point',
    range: 8,
    colors: ['#ffc07a', '#ffdcae', '#d9772c', '#6e3412'],
    ai: { kind: 'disable', range: 8 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 8);
      const x0 = u.x;
      const z0 = u.z;
      const dx = p.x - x0;
      const dz = p.z - z0;
      const L = Math.hypot(dx, dz) || 1;
      const hit: Unit[] = [];
      for (const v of w.units) {
        if (!v.alive || v.team === u.team || v.invuln || v.kind === 'tower' || v.kind === 'ancient') continue;
        // Расстояние от врага до отрезка рывка
        const t = clamp(((v.x - x0) * dx + (v.z - z0) * dz) / (L * L), 0, 1);
        if (Math.hypot(x0 + dx * t - v.x, z0 + dz * t - v.z) < 1.6 + v.radius) hit.push(v);
      }
      for (let k = 0; k <= 4; k++) fx(w, x0 + (dx * k) / 4, z0 + (dz * k) / 4, 0.4, 0xb08a5a, 0.7, 0.4, 1.8);
      u.x = p.x;
      u.z = p.z;
      u.hero!.order = null;
      resolveCollisions(w);
      for (const v of hit) {
        damage(w, v, 70 + lvl(u) * 10, u, 'physical');
        if (v.alive) addMod(v, 'slow', 2, 0.35, u.id);
      }
      return true;
    },
  },
  stoneskin: {
    id: 'stoneskin',
    name: 'Каменная кожа',
    desc: '+8 к броне на 6 с: физический урон по Громиле меньше примерно на треть.',
    cd: 18,
    target: 'none',
    range: 0,
    colors: ['#c9c2b0', '#e8e2d2', '#8f8774', '#4a4436'],
    ai: { kind: 'defend', hp: 0.7, range: 6 },
    cast(w, u) {
      addMod(u, 'armorUp', 6, 8, u.id);
      fx(w, u.x, u.z, 1.4, 0xc9c2b0, 1, 0.5, 1.4);
      return true;
    },
  },
  quake: {
    id: 'quake',
    name: 'Землетрясение',
    desc: 'Замах 0,8 с, потом 180 урона, +25 за уровень, и оглушение 1,6 с всем врагам в радиусе 5,5 м.',
    cd: 60,
    target: 'none',
    range: 5.5,
    castTime: 0.8,
    ult: true,
    colors: ['#ff6a4a', '#ffb39a', '#b0301c', '#4e120a'],
    ai: { kind: 'aoe', range: 4.5 },
    cast() {
      return true;
    },
    fire(w, u) {
      u.castTick = w.tick;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        fx(w, u.x + Math.cos(a) * 3, u.z + Math.sin(a) * 3, 0.3, 0x9a7a52, 1.3, 0.6, 2);
      }
      for (const v of aoe(w, u, u.x, u.z, 5.5, 180 + lvl(u) * 25, 'magical', (v) => v.kind !== 'tower'))
        if (v.alive) addMod(v, 'stun', 1.6, 0, u.id);
    },
  },
  // ── Следопытка ──
  pierce: {
    id: 'pierce',
    name: 'Пронзающая стрела',
    desc: 'Стрела летит насквозь на 20 м: 100 урона, +16 за уровень, каждому и замедление на 2 с.',
    cd: 7,
    target: 'point',
    range: 20,
    colors: ['#b6f08a', '#e0ffc4', '#5fb33a', '#24541a'],
    ai: { kind: 'nuke', range: 17 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 20);
      let dx = p.x - u.x;
      let dz = p.z - u.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const pr = launch(w, u, 'pierce', dx, dz, 34, 20, 100 + lvl(u) * 16, 0xd7ffb0, 0.6);
      pr.pierce = true;
      return true;
    },
    onProjectileHit(w, p, v) {
      const u = unitById(w, p.src);
      damage(w, v, p.dmg, u ?? null, 'physical');
      if (v.alive) addMod(v, 'slow', 2, 0.25, p.src);
      fx(w, v.x, v.z, 1.2, 0xb6f08a, 0.4, 0.3, 1.8);
    },
  },
  sprint: {
    id: 'sprint',
    name: 'Быстрый шаг',
    desc: '4 с: скорость бега +35%, скорость атаки +40%.',
    cd: 14,
    target: 'none',
    range: 0,
    colors: ['#9ef0d8', '#d6fff2', '#2fb894', '#0f5444'],
    ai: { kind: 'buff', range: 7 },
    cast(w, u) {
      addMod(u, 'haste', 4, 0.35, u.id);
      addMod(u, 'frenzy', 4, 0.4, u.id);
      fx(w, u.x, u.z, 0.6, 0x9ef0d8, 0.8, 0.4, 1.8);
      return true;
    },
  },
  sharpeye: {
    id: 'sharpeye',
    name: 'Меткий глаз',
    desc: 'Пассивно: каждый 4-й выстрел наносит 180% урона.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: ['#f1e38a', '#fff6c2', '#c9a92a', '#5a4a0a'],
    cast: () => false,
    onAttack(w, u, t, dmg) {
      const h = u.hero!;
      h.stacks = (h.stacks + 1) % 4;
      if (h.stacks !== 0) return dmg;
      fx(w, t.x, t.z, 1.6, 0xf1e38a, 0.5, 0.3, 2);
      return dmg * 1.8;
    },
  },
  volley: {
    id: 'volley',
    name: 'Град стрел',
    desc: '3 с стрелы сыплются на круг 5 м: 35 урона, +6 за уровень, каждые 0,5 с и замедление.',
    cd: 50,
    target: 'point',
    range: 14,
    ult: true,
    colors: ['#d7ff9a', '#f0ffd2', '#8bc43a', '#3a5a10'],
    ai: { kind: 'nuke', range: 13 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 14);
      addZone(w, {
        kind: 'volley',
        x: p.x,
        z: p.z,
        r: 5,
        t: 3,
        delay: 0.25,
        period: 0.5,
        src: u.id,
        team: u.team,
        v: 35 + lvl(u) * 6,
      });
      return true;
    },
    zone: {
      pulse(w, z, src) {
        for (let k = 0; k < 3; k++)
          fx(
            w,
            z.x + Math.sin(w.tick + k * 2.1) * z.r * 0.6,
            z.z + Math.cos(w.tick * 1.3 + k) * z.r * 0.6,
            0.4,
            0xd7ffb0,
            0.35,
            0.3,
            1.5,
          );
        if (!src) return;
        for (const v of aoe(w, src, z.x, z.z, z.r, z.v, 'physical', (v) => v.kind !== 'tower' && v.kind !== 'ancient'))
          if (v.alive) addMod(v, 'slow', 0.6, 0.3, src.id);
      },
    },
  },
  // ── Хранительница ──
  mend: {
    id: 'mend',
    name: 'Целебный свет',
    desc: 'Лечит себя и союзников в радиусе 5 м от точки на 110 здоровья, +18 за уровень.',
    cd: 9,
    target: 'point',
    range: 10,
    colors: ['#a8ffb8', '#e4ffe9', '#3ccf6a', '#14592c'],
    ai: { kind: 'heal', hp: 0.65, range: 10 },
    cast(w, u, aim) {
      const x = aim ? aim.x : u.x;
      const z = aim ? aim.z : u.z;
      const amt = (110 + lvl(u) * 18) * amp(u);
      fx(w, x, z, 0.3, 0xa8ffb8, 2, 0.5, 1.6);
      for (const v of w.units)
        if (v.alive && v.team === u.team && v.kind === 'hero' && Math.hypot(v.x - x, v.z - z) < 5 + v.radius)
          heal(w, v, amt);
      if (Math.hypot(u.x - x, u.z - z) >= 5 + u.radius) heal(w, u, amt * 0.5);
      return true;
    },
  },
  bind: {
    id: 'bind',
    name: 'Оковы',
    desc: 'Снаряд сковывает первого врага на 1,6 с и наносит 60 урона, +10 за уровень.',
    cd: 11,
    target: 'point',
    range: 16,
    colors: ['#c6b8ff', '#ebe4ff', '#7a5ce0', '#30226e'],
    ai: { kind: 'disable', range: 14 },
    cast(w, u, aim) {
      const p = aimPoint(w, u, aim, 16);
      let dx = p.x - u.x;
      let dz = p.z - u.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      launch(w, u, 'bind', dx, dz, 26, 16, (60 + lvl(u) * 10) * amp(u), 0xc6b8ff, 0.6);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'magical');
      if (hit.alive) addMod(hit, 'root', 1.6, 0, p.src);
      fx(w, hit.x, hit.z, 0.5, 0xc6b8ff, 0.9, 0.5, 1.2);
    },
  },
  keeper: {
    id: 'keeper',
    name: 'Аура стойкости',
    desc: 'Пассивно: союзники в радиусе 9 м получают +3 к броне и +3 здоровья в секунду.',
    cd: 0,
    target: 'none',
    range: 9,
    passive: true,
    aura: { radius: 9, mod: 'keeperAura', v: 0 },
    colors: ['#ffe4a0', '#fff4d6', '#d4a63a', '#5e4410'],
    cast: () => false,
  },
  dome: {
    id: 'dome',
    name: 'Купол',
    desc: 'Купол на 4 с: союзники внутри получают на 45% меньше урона.',
    cd: 60,
    target: 'point',
    range: 10,
    ult: true,
    colors: ['#fff2b8', '#fffbe6', '#f1c453', '#7a5a10'],
    ai: { kind: 'defend', hp: 0.6, range: 9 },
    cast(w, u, aim) {
      const x = aim ? aim.x : u.x;
      const z = aim ? aim.z : u.z;
      addZone(w, { kind: 'dome', x, z, r: 5, t: 4, delay: 0, period: 0, src: u.id, team: u.team, v: 0.45 });
      fx(w, x, z, 1, 0xfff2b8, 2.2, 0.6, 1.3);
      return true;
    },
    zone: {
      pulse(w, z) {
        for (const v of w.units)
          if (v.alive && v.team === z.team && Math.hypot(v.x - z.x, v.z - z.z) < z.r + v.radius)
            addMod(v, 'resist', DT * 2, z.v, z.src);
      },
    },
  },
  // ── Тень ──
  dagger: {
    id: 'dagger',
    name: 'Метательный кинжал',
    desc: 'Кинжал в цель до 10 м: 80 урона, +14 за уровень, замедление 40% на 2 с.',
    cd: 8,
    target: 'unit',
    range: 10,
    colors: ['#c0c6d8', '#eef0f6', '#6b7390', '#262a3a'],
    ai: { kind: 'nuke', range: 10 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 10);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      removeMod(u, 'invisible');
      launchAt(w, u, 'dagger', t, 30, 80 + lvl(u) * 14, 0xd8dce8, 0.5);
      return true;
    },
    onProjectileEnd(w, p, hit) {
      if (!hit) return;
      damage(w, hit, p.dmg, unitById(w, p.src) ?? null, 'physical');
      if (hit.alive) addMod(hit, 'slow', 2, 0.4, p.src);
    },
  },
  veil: {
    id: 'veil',
    name: 'Покров тени',
    desc: '5 с невидимости и +20% к скорости. Первый удар из невидимости: +60 урона, +10 за уровень.',
    cd: 16,
    target: 'none',
    range: 0,
    colors: ['#9a8cc8', '#d6cff0', '#4a3c80', '#1a1236'],
    ai: { kind: 'escape', hp: 0.4 },
    cast(w, u) {
      fx(w, u.x, u.z, 1, 0x4a3c80, 1.1, 0.5, 1.4);
      addMod(u, 'invisible', 5, 60 + lvl(u) * 10, u.id);
      addMod(u, 'haste', 5, 0.2, u.id);
      // Враги теряют цель
      for (const v of w.units) if (v.target === u.id) v.target = 0;
      return true;
    },
  },
  thirst: {
    id: 'thirst',
    name: 'Жажда крови',
    desc: 'Пассивно: удары лечат на 15% нанесённого урона, при здоровье ниже половины — на 30%.',
    cd: 0,
    target: 'none',
    range: 0,
    passive: true,
    colors: ['#ff8a9a', '#ffd0d8', '#c02a44', '#4e0a18'],
    cast: () => false,
    onAttack(_w, u, _t, dmg) {
      const k = u.hp < u.maxHp / 2 ? 0.3 : 0.15;
      u.hp = Math.min(u.maxHp, u.hp + dmg * k);
      return dmg;
    },
  },
  execute: {
    id: 'execute',
    name: 'Казнь',
    desc: 'Удар по цели рядом: 150 урона, +20 за уровень, плюс половина её недостающего здоровья. Чистый урон.',
    cd: 45,
    target: 'unit',
    range: 3,
    ult: true,
    colors: ['#ff5a6a', '#ffb0b8', '#a0102a', '#3a0410'],
    ai: { kind: 'finish', range: 3.5, hp: 0.45 },
    cast(w, u, aim) {
      const t = aimUnit(w, u, aim, 3);
      if (!t) return false;
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      removeMod(u, 'invisible');
      fx(w, t.x, t.z, 1.4, 0xff5a6a, 1.1, 0.45, 2);
      damage(w, t, 150 + lvl(u) * 20 + (t.maxHp - t.hp) * 0.5, u, 'pure');
      return true;
    },
  },
};

/** Способность в слоте героя (Q W E R) */
export function abilityAt(u: Unit, slot: number): AbilityDef | undefined {
  const id = HERO[u.hero!.def]?.abilities[slot];
  return id ? ABILITIES[id] : undefined;
}

export function canCast(u: Unit, slot: number): boolean {
  const h = u.hero;
  const a = h && abilityAt(u, slot);
  if (!a || a.passive || !u.alive || h.casting || h.cd[slot] > 0) return false;
  if (a.ult && h.level < ULT_LEVEL) return false;
  return !hasFlag(u, 'stun') && !hasFlag(u, 'silence');
}

/** Насколько дальше дальности умения герой сам подойдёт к цели, чтобы применить его */
const APPROACH = 12;

/** Почему умение не сработало — показываем только живому игроку */
function castFail(w: World, u: Unit, slot: number, reason: 'target' | 'cd' | 'stun' | 'silence' | 'level'): false {
  const h = u.hero!;
  if (!w.players[h.player]?.bot) emit(w, { e: 'castFail', player: h.player, slot, reason });
  return false;
}

export function castAbility(w: World, u: Unit, slot: number, aim: Aim | null): boolean {
  const h = u.hero;
  const a = h && abilityAt(u, slot);
  if (!h || !a || a.passive || !u.alive) return false;
  if (a.ult && h.level < ULT_LEVEL) return castFail(w, u, slot, 'level');
  if (h.cd[slot] > 0) return castFail(w, u, slot, 'cd');
  if (hasFlag(u, 'stun')) return castFail(w, u, slot, 'stun');
  if (hasFlag(u, 'silence')) return castFail(w, u, slot, 'silence');
  // Идёт замах другого умения — запоминаем нажатие, сработает следом
  if (h.casting) {
    h.queued = { slot, aim: aim ? { x: aim.x, z: aim.z, id: aim.id ?? 0 } : null };
    return true;
  }
  // Умение в цель: выбранная цель или ближайший враг дальше дальности, но недалеко — подходим и применяем
  if (a.target === 'unit') {
    const chosen = aim?.id ? unitById(w, aim.id) : undefined;
    if (
      chosen?.alive &&
      chosen.team !== u.team &&
      !chosen.invuln &&
      dist(u, chosen) > a.range + chosen.radius + 1 &&
      dist(u, chosen) <= a.range + APPROACH
    ) {
      h.order = { type: 'cast', slot, id: chosen.id };
      return true;
    }
  }
  if (a.target === 'unit' && !aimUnit(w, u, aim, a.range)) {
    const t = aimUnit(w, u, aim, a.range + APPROACH);
    if (!t) return castFail(w, u, slot, 'target');
    h.order = { type: 'cast', slot, id: t.id };
    return true;
  }
  if (!canCast(u, slot)) return false;
  if (a.castTime) {
    // Замах: способность сработает позже; движение и атака на это время останавливаются
    if (!a.cast(w, u, aim)) return castFail(w, u, slot, 'target');
    h.casting = {
      ability: a.id,
      t: a.castTime,
      total: a.castTime,
      x: aim?.x ?? u.x,
      z: aim?.z ?? u.z,
      id: aim?.id ?? 0,
    };
    h.order = null;
    h.cd[slot] = a.cd * (1 - h.cdr);
    emit(w, { e: 'cast', id: u.id, ability: a.id, x: h.casting.x, z: h.casting.z });
    return true;
  }
  if (!a.cast(w, u, aim)) return castFail(w, u, slot, 'target');
  h.cd[slot] = a.cd * (1 - h.cdr);
  u.castTick = w.tick;
  if (a.id !== 'veil') removeMod(u, 'invisible');
  emit(w, { e: 'cast', id: u.id, ability: a.id, x: aim?.x ?? u.x, z: aim?.z ?? u.z });
  return true;
}

export function fireCasting(w: World, u: Unit) {
  const c = u.hero!.casting!;
  u.hero!.casting = null;
  ABILITIES[c.ability]?.fire?.(w, u, c);
}
