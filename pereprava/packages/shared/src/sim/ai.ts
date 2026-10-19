// ИИ героя-бота. Поведение прототипа 0.3 (Громила): фарм крипов последним ударом, охота на ослабшего
// героя, под вражескую вышку без своих крипов не лезет, отходит к фонтану и там закупается.
// Способности бот применяет по подсказкам ai из описания способности — так ИИ один на всех героев.
import { difficulty } from '../data/difficulty';
import { HERO } from '../data/heroes';
import { laneAhead, laneProgress, lanePoints, type P2 } from '../map';
import type { Player, Team, Unit } from '../types';
import { abilityAt, castAbility, canCast } from './abilities';
import { hasFlag } from './modifiers';
import { ancientOf, buyItem, dist, mapOf, towerOf, unitById, type World } from './world';

/** Вражеская вышка рядом с точкой */
function towerThreat(w: World, x: number, z: number, team: Team): boolean {
  return w.units.some(
    (tw) => tw.kind === 'tower' && tw.alive && tw.team !== team && Math.hypot(x - tw.x, z - tw.z) < tw.range + 2,
  );
}

/** Можно ли боту стоять в точке: под вражеской вышкой — только со своими крипами, к фонтану врага — нельзя */
function safeFor(w: World, b: Unit, x: number, z: number): boolean {
  const team = b.team as Team;
  for (const tw of w.units)
    if (tw.kind === 'tower' && tw.alive && tw.team !== team && Math.hypot(x - tw.x, z - tw.z) < tw.range + 2)
      if (!w.units.some((v) => v.alive && v.kind === 'creep' && v.team === team && dist(v, tw) < tw.range))
        return false;
  const ef = mapOf(w).fountains[1 - team];
  return Math.hypot(x - ef.x, z - ef.z) >= 13;
}

/** Точка за своей передней волной (или у своей вышки) */
function frontPos(w: World, b: Unit, lane: number): P2 {
  const team = b.team as Team;
  const m = mapOf(w);
  const pts = lanePoints(m, lane, team);
  const along = (x: number, z: number, ahead: number) => laneAhead(m, lane, team, x, z, ahead);
  let best: Unit | null = null;
  let bs = -1e9;
  for (const v of w.units)
    if (v.alive && v.kind === 'creep' && v.team === team && (v.lane ?? 0) === lane) {
      const s = laneProgress(m, lane, team, v.x, v.z);
      if (s > bs) {
        bs = s;
        best = v;
      }
    }
  const home = (): P2 => {
    const tw = towerOf(w, team, lane);
    return tw?.alive ? along(tw.x, tw.z, 3) : along(pts[0].x, pts[0].z, 8);
  };
  // За передним крипом — с его боковым смещением, а не строго на оси линии (там своя вышка)
  let p: P2;
  if (best) {
    const a = along(best.x, best.z, 0);
    const c = along(best.x, best.z, 1);
    const l = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    p = { x: best.x - ((c.x - a.x) / l) * 3.5, z: best.z - ((c.z - a.z) / l) * 3.5 };
  } else p = home();
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
  for (const v of w.units)
    if (v.alive && v.kind === 'creep' && v.team !== b.team && Math.hypot(v.x - x, v.z - z) < r) n++;
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
            if (
              v.alive &&
              v.kind === 'creep' &&
              v.team !== b.team &&
              dist(b, v) < (ai.range ?? 12) * 0.8 &&
              enemyCreepsNear(w, b, v.x, v.z, ai.radius ?? 3) >= ai.creeps &&
              safeFor(w, b, v.x, v.z)
            )
              return castAbility(w, b, slot, { x: v.x, z: v.z, id: v.id });
        }
        break;
      }
      case 'defend':
        if (foe && hpP < (ai.hp ?? 0.5) && df < (ai.range ?? 8)) return castAbility(w, b, slot, null);
        break;
      case 'buff':
        if (foe && !retreating && df < (ai.range ?? 4))
          return castAbility(w, b, slot, foe ? { x: foe.x, z: foe.z, id: foe.id } : null);
        break;
      case 'heal': {
        let best: Unit | null = null;
        for (const v of w.units)
          if (
            v.kind === 'hero' &&
            v.alive &&
            v.team === b.team &&
            dist(b, v) < (ai.range ?? 10) &&
            v.hp / v.maxHp < (ai.hp ?? 0.6) &&
            (!best || v.hp / v.maxHp < best.hp / best.maxHp)
          )
            best = v;
        if (best) return castAbility(w, b, slot, { x: best.x, z: best.z, id: best.id });
        break;
      }
      case 'finish':
        if (foe && df < (ai.range ?? 3.5) && foe.hp / foe.maxHp < (ai.hp ?? 0.4))
          return castAbility(w, b, slot, { x: foe.x, z: foe.z, id: foe.id });
        break;
      case 'escape':
        if (retreating && foe && df < 9 && hpP < (ai.hp ?? 0.4)) {
          const sp = mapOf(w).spawns[b.team as Team];
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
  // Куда отступать: к фонтану, но со стороны базы — там лечит и там лавка
  const fo = mapOf(w).fountains[team];
  const an0 = ancientOf(w, team);
  const fl = an0 ? Math.hypot(an0.x - fo.x, an0.z - fo.z) || 1 : 1;
  const sp = an0 ? { x: fo.x + ((an0.x - fo.x) / fl) * 4, z: fo.z + ((an0.z - fo.z) / fl) * 4 } : fo;
  // Ближайший живой вражеский герой
  let foe: Unit | null = null;
  for (const v of w.units)
    if (
      v.kind === 'hero' &&
      v.alive &&
      v.team !== team &&
      !hasFlag(v, 'invisible') &&
      (!foe || dist(b, v) < dist(b, foe))
    )
      foe = v;

  if (p.ai.mode === 'retreat') {
    if (Math.hypot(b.x - fo.x, b.z - fo.z) < 7.5) {
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

  // Своё здание под ударом — идём защищать
  const threatened = w.units.find(
    (s) =>
      (s.kind === 'tower' || s.kind === 'ancient') &&
      s.alive &&
      !s.invuln &&
      s.team === team &&
      w.units.some(
        (v) =>
          v.alive && v.team !== team && v.team !== 2 && (v.kind === 'creep' || v.kind === 'hero') && dist(v, s) < 13,
      ),
  );
  if (threatened && dist(b, threatened) > 16) {
    h.order = { type: 'move', x: threatened.x, z: threatened.z, st: 0, best: Infinity };
    return;
  }

  let tgt: Unit | null = null;
  for (const v of w.units) {
    if (v.kind !== 'hero' || !v.alive || v.team === team || hasFlag(v, 'invisible')) continue;
    const d = dist(b, v);
    const hp2 = v.hp / v.maxHp;
    if (
      d < 10 &&
      !towerThreat(w, v.x, v.z, team) &&
      !towerThreat(w, b.x, b.z, team) &&
      safeFor(w, b, v.x, v.z) &&
      (hp2 < hpP + D.aggr || d < 4)
    )
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
    // Вражеская вышка на своей линии; если там уже пусто — ближайшая живая
    let tw = towerOf(w, 1 - team, p.ai.lane);
    if (!tw?.alive) {
      const alive = w.units.filter((u) => u.kind === 'tower' && u.team !== team && u.alive && !u.invuln);
      alive.sort((a, c) => dist(b, a) - dist(b, c));
      tw = alive[0] ?? tw;
    }
    const an = ancientOf(w, 1 - team);
    const twT = tw && unitById(w, tw.target);
    const creepsAtTower =
      !!tw &&
      w.units.filter((c) => c.alive && c.kind === 'creep' && c.team === team && dist(c, tw) < tw.range + 1).length >= 2;
    if (
      tw?.alive &&
      !tw.invuln &&
      ((twT && twT.team === team && twT.kind === 'creep') || creepsAtTower) &&
      dist(b, tw) < 18
    )
      tgt = tw;
    else if (
      tw &&
      !tw.alive &&
      an &&
      !an.invuln &&
      dist(b, an) < 20 &&
      w.units.some((c) => c.alive && c.kind === 'creep' && c.team === team && dist(c, an) < 14)
    )
      tgt = an;
  }
  // Руна рядом и безопасно — забрать
  if (!tgt && w.rune && Math.hypot(w.rune.x - b.x, w.rune.z - b.z) < 22 && safeFor(w, b, w.rune.x, w.rune.z)) {
    h.order = { type: 'move', x: w.rune.x, z: w.rune.z, st: 0, best: Infinity };
    return;
  }
  // На линии делать нечего — лагерь на своей стороне реки (если на нашей половине нет вражеских крипов)
  const laneSafe = !w.units.some(
    (v) => v.alive && v.kind === 'creep' && v.team !== team && (team === 0 ? v.x - v.z < 0 : v.x - v.z > 0),
  );
  if (!tgt && hpP > 0.6 && h.level >= 3 && laneSafe) {
    let bd = 26;
    for (const v of w.units)
      if (
        v.alive &&
        v.kind === 'neutral' &&
        v.camp !== undefined &&
        mapOf(w).camps[v.camp].side === team &&
        dist(b, v) < bd
      ) {
        bd = dist(b, v);
        tgt = v;
      }
  }
  if (tgt) {
    const o = h.order;
    if (!(o?.type === 'attack' && o.id === tgt.id)) h.order = { type: 'attack', id: tgt.id, auto: false };
    return;
  }
  const fp = frontPos(w, b, p.ai.lane);
  if (Math.hypot(fp.x - b.x, fp.z - b.z) > 1.5) h.order = { type: 'move', x: fp.x, z: fp.z, st: 0, best: Infinity };
  else h.order = null;
}
