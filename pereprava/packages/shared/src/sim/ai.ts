// ИИ героя-бота. Поведение прототипа 0.3 (Громила): фарм крипов последним ударом, охота на ослабшего
// героя, под вражескую вышку без своих крипов не лезет, отходит к фонтану и там закупается.
// Способности бот применяет по подсказкам ai из описания способности — так ИИ один на всех героев.
import { difficulty } from '../data/difficulty';
import { HERO } from '../data/heroes';
import { FOUNTAINS, laneDir, SPAWNS, type P2 } from '../map';
import type { Player, Team, Unit } from '../types';
import { abilityAt, castAbility, canCast } from './abilities';
import { ancientOf, buyItem, dist, towerOf, unitById, type World } from './world';

/** Вражеская вышка рядом с точкой */
function towerThreat(w: World, x: number, z: number, team: Team): boolean {
  const tw = towerOf(w, 1 - team);
  return !!tw && tw.alive && Math.hypot(x - tw.x, z - tw.z) < tw.range + 2;
}

/** Можно ли боту стоять в точке: под вражеской вышкой — только со своими крипами, к фонтану врага — нельзя */
function safeFor(w: World, b: Unit, x: number, z: number): boolean {
  const team = b.team as Team;
  const tw = towerOf(w, 1 - team);
  if (tw?.alive && Math.hypot(x - tw.x, z - tw.z) < tw.range + 2) {
    if (!w.units.some((v) => v.alive && v.kind === 'creep' && v.team === team && dist(v, tw) < tw.range)) return false;
  }
  const ef = FOUNTAINS[1 - team];
  return Math.hypot(x - ef.x, z - ef.z) >= 13;
}

/** Точка за своей передней волной (или у своей вышки) */
function frontPos(w: World, b: Unit): P2 {
  const team = b.team as Team;
  const d = laneDir(team);
  let best: Unit | null = null;
  let bs = -1e9;
  for (const v of w.units)
    if (v.alive && v.kind === 'creep' && v.team === team) {
      const s = v.x * d.x + v.z * d.z;
      if (s > bs) {
        bs = s;
        best = v;
      }
    }
  const home = (): P2 => {
    const tw = towerOf(w, team);
    const an = ancientOf(w, team)!;
    return tw?.alive ? { x: tw.x + d.x * 3, z: tw.z + d.z * 3 } : { x: an.x + d.x * 8, z: an.z + d.z * 8 };
  };
  let p = best ? { x: best.x - d.x * 3.5, z: best.z - d.z * 3.5 } : home();
  if (!safeFor(w, b, p.x, p.z)) p = home();
  return p;
}

function botShop(w: World, b: Unit, p: Player) {
  const plan = HERO[b.hero!.def].build;
  while (p.ai.buyIdx < plan.length && b.hero!.items.some((x) => !x)) {
    if (!buyItem(w, b, plan[p.ai.buyIdx], true)) break;
    p.ai.buyIdx++;
  }
}

function enemyCreepsNear(w: World, b: Unit, x: number, z: number, r: number): number {
  let n = 0;
  for (const v of w.units) if (v.alive && v.kind === 'creep' && v.team !== b.team && Math.hypot(v.x - x, v.z - z) < r) n++;
  return n;
}

/** Попробовать способности по их подсказкам. true — что-то применили */
function useAbilities(w: World, b: Unit, foe: Unit | null, hpP: number, retreating: boolean): boolean {
  const h = b.hero!;
  for (let slot = 0; slot < 4; slot++) {
    const a = abilityAt(b, slot);
    if (!a?.ai || !canCast(b, slot)) continue;
    const ai = a.ai;
    const df = foe ? dist(b, foe) : 1e9;
    switch (ai.kind) {
      case 'aoe': {
        const nearH = !!foe && df < (ai.range ?? 3.4);
        if (!retreating && (nearH || enemyCreepsNear(w, b, b.x, b.z, ai.radius ?? 3.6) >= (ai.creeps ?? 3)))
          return castAbility(w, b, slot, null);
        break;
      }
      case 'nuke':
      case 'disable': {
        if (foe && df < (ai.range ?? 12) && (!retreating || ai.kind === 'disable'))
          return castAbility(w, b, slot, { x: foe.x, z: foe.z, id: foe.id });
        if (ai.kind === 'nuke' && !retreating && ai.creeps) {
          for (const v of w.units)
            if (v.alive && v.kind === 'creep' && v.team !== b.team && dist(b, v) < (ai.range ?? 12) * 0.8 &&
              enemyCreepsNear(w, b, v.x, v.z, ai.radius ?? 3) >= ai.creeps && safeFor(w, b, v.x, v.z))
              return castAbility(w, b, slot, { x: v.x, z: v.z, id: v.id });
        }
        break;
      }
      case 'defend':
        if (foe && hpP < (ai.hp ?? 0.5) && df < (ai.range ?? 8)) return castAbility(w, b, slot, null);
        break;
      case 'buff':
        if (foe && !retreating && df < (ai.range ?? 4)) return castAbility(w, b, slot, foe ? { x: foe.x, z: foe.z, id: foe.id } : null);
        break;
      case 'escape':
        if (retreating && foe && df < 9 && hpP < (ai.hp ?? 0.4)) {
          const sp = SPAWNS[b.team as Team];
          return castAbility(w, b, slot, { x: sp.x, z: sp.z, id: 0 });
        }
        break;
    }
  }
  void h;
  return false;
}

export function botThink(w: World, b: Unit, p: Player) {
  const h = b.hero!;
  const D = difficulty(p.bot);
  const team = b.team as Team;
  const hpP = b.hp / b.maxHp;
  const sp = SPAWNS[team];
  // Ближайший живой вражеский герой
  let foe: Unit | null = null;
  for (const v of w.units)
    if (v.kind === 'hero' && v.alive && v.team !== team && (!foe || dist(b, v) < dist(b, foe))) foe = v;

  if (p.ai.mode === 'retreat') {
    if (Math.hypot(b.x - sp.x, b.z - sp.z) < 4) {
      botShop(w, b, p);
      if (hpP > 0.92) p.ai.mode = 'lane';
      else {
        h.order = null;
        return;
      }
    } else {
      if (useAbilities(w, b, foe, hpP, true)) return;
      h.order = { type: 'move', x: sp.x, z: sp.z, st: 0, best: Infinity };
      return;
    }
  }
  if (hpP < D.retreat) {
    p.ai.mode = 'retreat';
    h.order = { type: 'move', x: sp.x, z: sp.z, st: 0, best: Infinity };
    return;
  }
  if (useAbilities(w, b, foe, hpP, false)) return;

  let tgt: Unit | null = null;
  for (const v of w.units) {
    if (v.kind !== 'hero' || !v.alive || v.team === team) continue;
    const d = dist(b, v);
    const hp2 = v.hp / v.maxHp;
    if (d < 10 && !towerThreat(w, v.x, v.z, team) && !towerThreat(w, b.x, b.z, team) && safeFor(w, b, v.x, v.z) && (hp2 < hpP + D.aggr || d < 4))
      if (!tgt || d < dist(b, tgt)) tgt = v;
  }
  if (!tgt) {
    let bv = 1e9;
    for (const v of w.units) {
      if (!v.alive || v.kind !== 'creep' || v.team === team) continue;
      const d = dist(b, v);
      if (d > 11 || !safeFor(w, b, v.x, v.z)) continue;
      const s = v.hp + d * 4;
      if (s < bv) {
        bv = s;
        tgt = v;
      }
    }
  }
  if (!tgt) {
    const tw = towerOf(w, 1 - team);
    const an = ancientOf(w, 1 - team);
    const twT = tw && unitById(w, tw.target);
    if (tw?.alive && twT && twT.team === team && twT.kind === 'creep' && dist(b, tw) < 18) tgt = tw;
    else if (tw && !tw.alive && an && !an.invuln && dist(b, an) < 20) tgt = an;
  }
  if (tgt) {
    const o = h.order;
    if (!(o?.type === 'attack' && o.id === tgt.id)) h.order = { type: 'attack', id: tgt.id, auto: false };
    return;
  }
  const fp = frontPos(w, b);
  if (Math.hypot(fp.x - b.x, fp.z - b.z) > 1.5) h.order = { type: 'move', x: fp.x, z: fp.z, st: 0, best: Infinity };
  else h.order = null;
}
