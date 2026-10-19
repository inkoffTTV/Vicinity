// Способности героев. Общий скелет — перезарядка, цель, дальность, замах; начинка — функция cast
// (и fire для способностей с замахом, onProjectileEnd для снарядов). Числа растут с уровнем героя,
// очков навыков нет — как в прототипе: на телефоне проще.
import type { Casting, Projectile, Unit } from '../types';
import { HERO } from '../data/heroes';
import { addMod } from './modifiers';
import { hasFlag } from './modifiers';
import {
  clamp,
  damage,
  dist,
  emit,
  fx,
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
  kind: 'nuke' | 'aoe' | 'escape' | 'defend' | 'buff' | 'disable';
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
export function aoe(w: World, u: Unit, x: number, z: number, r: number, amt: number, type: 'physical' | 'magical' | 'pure', filter?: (v: Unit) => boolean): Unit[] {
  const hit: Unit[] = [];
  for (const v of w.units)
    if (v.alive && v.team !== u.team && !v.invuln && Math.hypot(v.x - x, v.z - z) < r + v.radius && (!filter || filter(v))) hit.push(v);
  for (const v of hit) damage(w, v, amt, u, type);
  return hit;
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
};

/** Способность в слоте героя (Q W E R) */
export function abilityAt(u: Unit, slot: number): AbilityDef | undefined {
  const id = HERO[u.hero!.def]?.abilities[slot];
  return id ? ABILITIES[id] : undefined;
}

export function canCast(u: Unit, slot: number): boolean {
  const h = u.hero;
  const a = h && abilityAt(u, slot);
  if (!a || !u.alive || h.casting || h.cd[slot] > 0) return false;
  if (a.ult && h.level < ULT_LEVEL) return false;
  return !hasFlag(u, 'stun') && !hasFlag(u, 'silence');
}

export function castAbility(w: World, u: Unit, slot: number, aim: Aim | null): boolean {
  if (!canCast(u, slot)) return false;
  const a = abilityAt(u, slot)!;
  const h = u.hero!;
  if (a.castTime) {
    // Замах: способность сработает позже; движение и атака на это время останавливаются
    if (!a.cast(w, u, aim)) return false;
    h.casting = { ability: a.id, t: a.castTime, total: a.castTime, x: aim?.x ?? u.x, z: aim?.z ?? u.z, id: aim?.id ?? 0 };
    h.order = null;
    h.cd[slot] = a.cd;
    emit(w, { e: 'cast', id: u.id, ability: a.id, x: h.casting.x, z: h.casting.z });
    return true;
  }
  if (!a.cast(w, u, aim)) return false;
  h.cd[slot] = a.cd;
  u.castTick = w.tick;
  emit(w, { e: 'cast', id: u.id, ability: a.id, x: aim?.x ?? u.x, z: aim?.z ?? u.z });
  return true;
}

export function fireCasting(w: World, u: Unit) {
  const c = u.hero!.casting!;
  u.hero!.casting = null;
  ABILITIES[c.ability]?.fire?.(w, u, c);
}
