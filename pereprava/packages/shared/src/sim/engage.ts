// Как крипы и нейтралы подходят к цели и бьют её.
// Ближники встают по кругу вокруг цели на свободные «слоты», дальники держат свою дистанцию.
// Стоящий в бою юнит «врос» (planted): его почти не толкают, и он не дёргается от мелких сдвигов.
// По пути юниты обходят стоящих юнитов и здания (простой steering: шаг вбок от первого препятствия).
import type { Unit } from '../types';
import { DT, dist, reach, speedOf, tryAttack, type World } from './world';

/** На каком расстоянии от центра цели стоят ближники */
export const slotRadius = (u: Unit, t: Unit) => t.radius + u.radius + 0.3;

/** Сколько ближников этого размера помещается по кругу */
export function slotCount(u: Unit, t: Unit): number {
  return Math.max(4, Math.floor((2 * Math.PI * slotRadius(u, t)) / (2 * u.radius * 1.15)));
}

export function slotPos(u: Unit, t: Unit, i: number): { x: number; z: number } {
  const n = slotCount(u, t);
  const a = (i / n) * Math.PI * 2;
  const r = slotRadius(u, t);
  return { x: t.x + Math.sin(a) * r, z: t.z + Math.cos(a) * r };
}

const isBuilding = (v: Unit) => v.kind === 'tower' || v.kind === 'ancient';

/** Свободный слот вокруг t, ближайший к u по углу; -1 — мест нет */
export function freeSlot(w: World, u: Unit, t: Unit): number {
  const n = slotCount(u, t);
  const taken = new Uint8Array(n);
  for (const v of w.units) {
    if (v === u || v === t || !v.alive) continue;
    if (v.slotT === t.id && v.slot !== undefined && v.slot >= 0 && v.slot < n && v.target === t.id) {
      taken[v.slot] = 1;
      continue;
    }
    // Место занято тем, кто там уже стоит (свой или чужой), или зданием
    if (!(v.planted || isBuilding(v))) continue;
    const rr = isBuilding(v) ? v.radius + u.radius : (u.radius + v.radius) * 0.9;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      const p = slotPos(u, t, i);
      if (Math.hypot(p.x - v.x, p.z - v.z) < rr) taken[i] = 1;
    }
  }
  const a0 = Math.atan2(u.x - t.x, u.z - t.z);
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (taken[i]) continue;
    let da = Math.abs((i / n) * Math.PI * 2 - a0) % (Math.PI * 2);
    if (da > Math.PI) da = Math.PI * 2 - da;
    if (da < bd - 1e-9) {
      bd = da;
      best = i;
    }
  }
  return best;
}

/** Шаг к точке с обходом стоящих юнитов и зданий. true — дошёл (ближе stop) */
export function steerToward(w: World, u: Unit, tx: number, tz: number, stop = 0): boolean {
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop + 0.05) return true;
  let fx = dx / d;
  let fz = dz / d;
  // Первое препятствие на пути в пределах «взгляда»
  const look = 1.2 + u.radius * 2;
  let side = 0;
  let bestAlong = Infinity;
  for (const v of w.units) {
    if (v === u || !v.alive || v.id === u.target) continue;
    if (!(v.planted || isBuilding(v))) continue;
    const rx = v.x - u.x;
    const rz = v.z - u.z;
    const along = rx * fx + rz * fz;
    if (along <= 0 || along > Math.min(look + v.radius, d) || along >= bestAlong) continue;
    const lat = -rx * fz + rz * fx;
    if (Math.abs(lat) >= (u.radius + v.radius) * 0.9) continue;
    bestAlong = along;
    // Обходим с той стороны, где просвет шире; ровно по оси — всегда влево (детерминированно)
    side = lat > 0 ? -1 : 1;
  }
  if (side) {
    const px = -fz * side;
    const pz = fx * side;
    const nx = fx + px * 1.1;
    const nz = fz + pz * 1.1;
    const l = Math.hypot(nx, nz);
    fx = nx / l;
    fz = nz / l;
  }
  const s = Math.min(speedOf(u) * DT, d - stop);
  if (s <= 0) return false;
  u.x += fx * s;
  u.z += fz * s;
  u.rot = Math.atan2(fx, fz);
  u.moving = true;
  u.planted = false;
  return false;
}

/** Ближник: занять слот вокруг цели и бить; если мест нет — ждать во втором ряду */
function meleeEngage(w: World, u: Unit, t: Unit) {
  if (u.slotT !== t.id || u.slot === undefined) {
    u.slotT = t.id;
    u.slot = freeSlot(w, u, t);
  }
  const inReach = dist(u, t) <= reach(u, t);
  if (u.slot < 0) {
    // Все места заняты: бьём, если и так достаём; иначе подходим ко второму ряду и ждём там,
    // не пихая стоящих (место перепроверяется раз в полсекунды — см. updateCreep)
    if (inReach) {
      u.planted = true;
      tryAttack(w, u, t);
    } else if (u.planted || dist(u, t) <= slotRadius(u, t) + u.radius * 2 + 1.2) u.planted = true;
    else steerToward(w, u, t.x, t.z, slotRadius(u, t) + u.radius * 2);
    return;
  }
  const p = slotPos(u, t, u.slot);
  const ds = Math.hypot(p.x - u.x, p.z - u.z);
  // Уже стоит и бьёт — небольшие сдвиги (толчки, цель шагнула) не сбивают
  if (ds <= (u.planted ? 0.8 : 0.3) && inReach) {
    u.planted = true;
    tryAttack(w, u, t);
    return;
  }
  u.planted = false;
  const R = slotRadius(u, t);
  const dt = dist(u, t);
  const au = Math.atan2(u.x - t.x, u.z - t.z);
  const as = (u.slot / slotCount(u, t)) * Math.PI * 2;
  let da = as - au;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  if (dt < R + 3 && Math.abs(da) > 0.35) {
    // Место на другой стороне: обходим по внешнему кругу, не проталкиваясь сквозь стоящих
    const a = au + Math.sign(da) * Math.min(Math.abs(da), 0.6);
    const ro = R + u.radius * 2 + 0.1;
    steerToward(w, u, t.x + Math.sin(a) * ro, t.z + Math.cos(a) * ro);
  } else steerToward(w, u, p.x, p.z);
}

/** Дальник: подойти на дистанцию выстрела (с запасом) и стоять */
function rangedEngage(w: World, u: Unit, t: Unit) {
  const r = reach(u, t);
  const d = dist(u, t);
  if (d > r + (u.planted ? 0.4 : 0)) {
    u.planted = false;
    steerToward(w, u, t.x, t.z, r - 0.4);
  } else {
    u.planted = true;
    tryAttack(w, u, t);
  }
}

/** Подойти к цели и бить её — общая часть для крипов и нейтралов */
export function engage(w: World, u: Unit, t: Unit) {
  // Раз в полсекунды: ждущий смотрит, не освободилось ли место, а идущий — нет ли места ближе
  if (!u.ranged && u.slotT === t.id && (u.slot === -1 || !u.planted) && w.tick % 15 === u.id % 15) {
    u.slot = freeSlot(w, u, t);
    if (u.slot >= 0) u.planted = false;
  }
  if (u.ranged) rangedEngage(w, u, t);
  else meleeEngage(w, u, t);
}

/** Цель потеряна — освободить слот */
export function disengage(u: Unit) {
  u.slotT = 0;
  u.slot = undefined;
  u.planted = false;
}
