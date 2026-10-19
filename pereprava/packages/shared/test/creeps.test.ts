import { describe, expect, it } from 'vitest';
import { createWorld, reach, slotRadius, spawnWave, step, TICK_RATE, type Unit, type World } from '../src/index';

/** Мир без героев на линии и без новых волн: только наши крипы и вражеская вышка */
function towerSiege(melee: number, ranged: number): { w: World; tower: Unit; creeps: Unit[] } {
  const w = createWorld({
    seed: 5,
    players: [
      { name: 'А', team: 0, hero: 'mage', bot: null },
      { name: 'Б', team: 1, hero: 'brute', bot: null },
    ],
  });
  for (let i = 0; i < 6; i++) spawnWave(w);
  w.nextWave = 1e9;
  const tower = w.units.find((u) => u.kind === 'tower' && u.team === 1 && u.tier === 1)!;
  // Вышка не умирает и не бьёт — смотрим только на расстановку
  Object.assign(tower, { maxHp: 1e9, hp: 1e9, dmg: 0 });
  const mine = w.units.filter((u) => u.kind === 'creep' && !u.owner && u.team === 0);
  const m = mine.filter((u) => !u.ranged).slice(0, melee);
  const r = mine.filter((u) => u.ranged).slice(0, ranged);
  for (const u of w.units) if (u.kind === 'creep' && !u.owner && !m.includes(u) && !r.includes(u)) u.alive = false;
  w.units = w.units.filter((u) => u.alive || u.kind !== 'creep');
  const creeps = [...m, ...r];
  // Толпой подходят с одной стороны — худший случай для «все в одну точку»
  creeps.forEach((u, i) =>
    Object.assign(u, { x: tower.x - 9 + (i % 4) * 0.7, z: tower.z + 9 - Math.floor(i / 4) * 0.7 }),
  );
  return { w, tower, creeps };
}

const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * TICK_RATE; i++) step(w);
};

describe('крипы у вышки', () => {
  for (const [melee, ranged, sec] of [
    [6, 2, 12],
    [12, 4, 16],
    [18, 6, 20],
  ] as const)
    it(`${melee} ближников и ${ranged} дальников ${sec} с: по кругу, не накладываются, не дрожат`, () => {
      const { w, tower, creeps } = towerSiege(melee, ranged);
      run(w, sec - 3);
      const before = creeps.map((u) => ({ x: u.x, z: u.z, t: u.target }));
      run(w, 3);
      for (const u of creeps) expect(u.alive).toBe(true);
      // Не накладываются: дистанция не меньше суммы радиусов × 0,8
      for (let i = 0; i < creeps.length; i++)
        for (let j = i + 1; j < creeps.length; j++) {
          const a = creeps[i];
          const b = creeps[j];
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual((a.radius + b.radius) * 0.8 - 1e-6);
        }
      // Сквозь здание не проходят
      for (const u of creeps)
        expect(Math.hypot(u.x - tower.x, u.z - tower.z)).toBeGreaterThanOrEqual(tower.radius + u.radius - 1e-6);
      // Все бьют вышку; ближников, кому хватило места, — по кругу на дистанции удара
      const attackers = creeps.filter((u) => u.target === tower.id);
      expect(attackers.length).toBe(creeps.length);
      const inReach = creeps.filter((u) => Math.hypot(u.x - tower.x, u.z - tower.z) <= reach(u, tower) + 0.01);
      const ring = creeps.filter((u) => !u.ranged && (u.slot ?? -1) >= 0);
      expect(ring.length).toBe(Math.min(melee, ring.length > 0 ? ring.length : 1));
      for (const u of ring) expect(inReach).toContain(u);
      for (const u of creeps.filter((c) => c.ranged)) expect(inReach).toContain(u);
      // Не дрожат и не меняют цель: за последние 3 с почти не сдвинулись
      creeps.forEach((u, i) => {
        expect(Math.hypot(u.x - before[i].x, u.z - before[i].z)).toBeLessThan(0.2);
        expect(u.target).toBe(before[i].t);
      });
      // Стоят по кругу, а не кучей: ближники с местом — на кольце вокруг вышки, каждый на своём месте
      for (const u of ring)
        expect(Math.abs(Math.hypot(u.x - tower.x, u.z - tower.z) - slotRadius(u, tower))).toBeLessThan(0.6);
      expect(new Set(ring.map((u) => u.slot)).size).toBe(ring.length);
      expect(ring.length).toBeGreaterThanOrEqual(Math.min(melee, 10));
    });
});
