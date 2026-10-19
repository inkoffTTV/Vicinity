// Общие помощники умений: уровень и усиление, направление и точка прицела, цель, снаряды, площадь.
import { HERO } from '../data/heroes';
import type { Unit } from '../types';
import { clamp, damage, dist, mapOf, nearestEnemy, unitById, type World } from './world';

export interface Aim {
  x: number;
  z: number;
  id: number;
}

/** Рост чисел умения от его уровня: обычное 1–4 → 0, 3, 6, 9; ультимейт 1–3 → 0, 4,5, 9
 *  (те же числа, что раньше давал уровень героя 1–10) */
export function lvl(u: Unit, id: string): number {
  const h = u.hero;
  if (!h) return 0;
  const slot = HERO[h.def]?.abilities.indexOf(id) ?? -1;
  const L = slot >= 0 ? h.skill[slot] : 1;
  return Math.max(0, L - 1) * (slot === 3 ? 4.5 : 3);
}
export const amp = (u: Unit) => u.hero!.spellAmp;

/** Направление каста: к точке прицела, иначе запасной вариант */
export function aimDir(u: Unit, aim: Aim | null, fallback: () => { dx: number; dz: number }) {
  if (aim) {
    const dx = aim.x - u.x;
    const dz = aim.z - u.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.3) return { dx, dz, len };
  }
  const f = fallback();
  return { ...f, len: 0 };
}
export const facing = (u: Unit) => ({ dx: Math.sin(u.rot), dz: Math.cos(u.rot) });

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
export function aimPoint(w: World, u: Unit, aim: Aim | null, range: number): { x: number; z: number } {
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
  const L = mapOf(w).limit - 1;
  return { x: clamp(x, -L, L), z: clamp(z, -L, L) };
}

/** Цель-юнит: выбранная, иначе ближайший вражеский герой, иначе любой враг в радиусе */
export function aimUnit(w: World, u: Unit, aim: Aim | null, range: number): Unit | null {
  const chosen = aim?.id ? unitById(w, aim.id) : undefined;
  if (chosen?.alive && chosen.team !== u.team && !chosen.invuln && dist(u, chosen) <= range + chosen.radius + 1)
    return chosen;
  return nearestEnemy(w, u, range, (v) => v.kind === 'hero') ?? nearestEnemy(w, u, range);
}

/** Самонаводящийся снаряд способности */
export function launchAt(
  w: World,
  u: Unit,
  kind: string,
  t: Unit,
  speed: number,
  dmg: number,
  color: number,
  size = 0.7,
) {
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
