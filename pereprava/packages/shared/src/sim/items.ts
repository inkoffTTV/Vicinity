// Активные предметы. Предмет с active: true занимает слот с горячей клавишей (1–6).
import { ITEM } from '../data/items';
import type { Unit } from '../types';
import { addMod, dispel } from './modifiers';
import { clamp, fx, recalc, resolveCollisions, type World } from './world';

export interface ItemUse {
  (w: World, u: Unit, aim: { x: number; z: number } | null): boolean;
}

export const ITEM_USE: Record<string, ItemUse> = {
  potion(w, u) {
    addMod(u, 'potion', 6);
    fx(w, u.x, u.z, 1, 0xff7a8a, 0.7, 0.5, 1.6);
    return true;
  },
  stone(w, u, aim) {
    let dx = aim ? aim.x - u.x : Math.sin(u.rot);
    let dz = aim ? aim.z - u.z : Math.cos(u.rot);
    const L = Math.hypot(dx, dz) || 1;
    const d = aim ? Math.min(9, L) : 9;
    dx /= L;
    dz /= L;
    fx(w, u.x, u.z, 1.2, 0xb89aff, 0.7, 0.35, 1.8);
    u.x = clamp(u.x + dx * d, -58, 58);
    u.z = clamp(u.z + dz * d, -58, 58);
    u.rot = Math.atan2(dx, dz);
    u.hero!.order = null;
    resolveCollisions(w);
    fx(w, u.x, u.z, 1.2, 0xd8c6ff, 0.6, 0.4, 2);
    return true;
  },
  recall(w, u) {
    addMod(u, 'recall', 3, w.tick, u.id);
    fx(w, u.x, u.z, 0.4, 0xf1c453, 1.2, 0.8, 1.2);
    return true;
  },
  bulwark(w, u) {
    dispel(u);
    addMod(u, 'resist', 3, 0.4, u.id);
    fx(w, u.x, u.z, 1.4, 0x7fc8ff, 1.1, 0.5, 1.6);
    return true;
  },
};

export function useItem(w: World, u: Unit, slot: number, aim: { x: number; z: number } | null): boolean {
  const h = u.hero;
  const id = h?.items[slot];
  if (!h || !id || !u.alive || h.itemCd[slot] > 0) return false;
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
