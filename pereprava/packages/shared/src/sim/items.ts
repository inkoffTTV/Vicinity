// Активные предметы. Предмет с active: true занимает слот с горячей клавишей (1–6).
import { ITEM } from '../data/items';
import type { Unit } from '../types';
import { addMod, dispel } from './modifiers';
import { INVENTORY } from './shop';
import { clamp, fx, mapOf, recalc, resolveCollisions, type World } from './world';

export interface ItemUse {
  (w: World, u: Unit, aim: { x: number; z: number } | null): boolean;
}

/** Перенос к прицелу (Камень странника, Поступь ветра) */
function blink(w: World, u: Unit, aim: { x: number; z: number } | null, range: number): boolean {
  let dx = aim ? aim.x - u.x : Math.sin(u.rot);
  let dz = aim ? aim.z - u.z : Math.cos(u.rot);
  const L = Math.hypot(dx, dz) || 1;
  const d = aim ? Math.min(range, L) : range;
  dx /= L;
  dz /= L;
  fx(w, u.x, u.z, 1.2, 0xb89aff, 0.7, 0.35, 1.8);
  const lim = mapOf(w).limit - 1;
  u.x = clamp(u.x + dx * d, -lim, lim);
  u.z = clamp(u.z + dz * d, -lim, lim);
  u.rot = Math.atan2(dx, dz);
  u.hero!.order = null;
  resolveCollisions(w);
  fx(w, u.x, u.z, 1.2, 0xd8c6ff, 0.6, 0.4, 2);
  return true;
}

/** Снять замедления и корни, 3 с на 40% меньше урона (Оплот, Цитадель) */
function bastion(w: World, u: Unit): boolean {
  dispel(u);
  addMod(u, 'resist', 3, 0.4, u.id);
  fx(w, u.x, u.z, 1.4, 0x7fc8ff, 1.1, 0.5, 1.6);
  return true;
}

export const ITEM_USE: Record<string, ItemUse> = {
  salve(w, u) {
    addMod(u, 'regen', 10, 20, u.id);
    fx(w, u.x, u.z, 1, 0x9be38a, 0.6, 0.5, 1.4);
    return true;
  },
  potion(w, u) {
    addMod(u, 'potion', 6);
    fx(w, u.x, u.z, 1, 0xff7a8a, 0.7, 0.5, 1.6);
    return true;
  },
  stone: (w, u, aim) => blink(w, u, aim, 9),
  windwalker: (w, u, aim) => blink(w, u, aim, 12),
  recall(w, u) {
    addMod(u, 'recall', 3, w.tick, u.id);
    fx(w, u.x, u.z, 0.4, 0xf1c453, 1.2, 0.8, 1.2);
    return true;
  },
  bulwark: bastion,
  citadel: bastion,
};

export function useItem(w: World, u: Unit, slot: number, aim: { x: number; z: number } | null): boolean {
  const h = u.hero;
  const id = h?.items[slot];
  // Из рюкзака предметы не применяются
  if (!h || !id || !u.alive || slot >= INVENTORY || h.itemCd[slot] > 0) return false;
  const it = ITEM[id];
  const fn = ITEM_USE[id];
  if (!it?.active || !fn) return false;
  if (!fn(w, u, aim)) return false;
  if (it.consumable) {
    h.items[slot] = null;
    recalc(u);
  } else h.itemCd[slot] = it.cooldown ?? 0;
  return true;
}
