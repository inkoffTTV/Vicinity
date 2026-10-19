// Активные предметы. Предмет с active: true занимает слот с горячей клавишей (1–6).
import { ITEM } from '../data/items';
import type { Unit } from '../types';
import { addMod } from './modifiers';
import { fx, recalc, type World } from './world';

export interface ItemUse {
  (w: World, u: Unit, aim: { x: number; z: number } | null): boolean;
}

export const ITEM_USE: Record<string, ItemUse> = {
  potion(w, u) {
    addMod(u, 'potion', 6);
    fx(w, u.x, u.z, 1, 0xff7a8a, 0.7, 0.5, 1.6);
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
