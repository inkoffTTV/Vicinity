import { describe, expect, it } from 'vitest';
import {
  createWorld,
  dLane,
  findPath,
  getMap,
  laneProgress,
  MAP_IDS,
  navClear,
  polyLength,
  step,
  TICK_RATE,
  type MapId,
  type PlayerSetup,
  type World,
} from '../src/index';

const SIZE: Record<MapId, number> = { '1v1': 1, '2v2': 2, '3v3': 3 };

function botsSetup(id: MapId, seed = 7): { seed: number; players: PlayerSetup[]; jungle: boolean } {
  const heroes = ['mage', 'brute', 'ranger', 'keeper', 'shade', 'mage'];
  const players: PlayerSetup[] = [];
  for (const team of [0, 1] as const)
    for (let k = 0; k < SIZE[id]; k++)
      players.push({ name: `Бот ${team}${k}`, team, hero: heroes[(team * 3 + k) % heroes.length], bot: 'normal' });
  return { seed, players, jungle: true };
}

describe('карты', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id);
    describe(id, () => {
      it('число линий и вышек: по две вышки на линию у каждой команды', () => {
        expect(m.lanes.length).toBe(SIZE[id]);
        for (const team of [0, 1])
          for (let l = 0; l < m.lanes.length; l++) {
            const ts = m.towers.filter((t) => t.team === team && t.lane === l);
            expect(ts.map((t) => t.tier).sort()).toEqual([1, 2]);
          }
      });

      it('вышки стоят на своих линиях, кристаллы — на концах линий', () => {
        for (const t of m.towers) expect(dLane(m, t.x, t.z)).toBeLessThan(4);
        for (const a of m.ancients) expect(dLane(m, a.x, a.z)).toBeLessThan(6);
      });

      it('внешняя вышка дальше от своей базы, чем внутренняя', () => {
        for (const team of [0, 1])
          for (let l = 0; l < m.lanes.length; l++) {
            const ts = m.towers.filter((t) => t.team === team && t.lane === l);
            const p = (tier: number) => {
              const t = ts.find((x) => x.tier === tier)!;
              return laneProgress(m, l, team, t.x, t.z);
            };
            expect(p(1)).toBeGreaterThan(p(2));
          }
      });

      it('лагеря леса не на линиях, в пределах карты; у каждой стороны поровну', () => {
        for (const c of m.camps) {
          expect(dLane(m, c.x, c.z)).toBeGreaterThan(6);
          expect(Math.abs(c.x)).toBeLessThan(m.limit);
          expect(Math.abs(c.z)).toBeLessThan(m.limit);
        }
        expect(m.camps.filter((c) => c.side === 0).length).toBe(m.camps.filter((c) => c.side === 1).length);
      });

      it('карта симметрична: у второй команды всё отражено', () => {
        expect(m.ancients[1].x).toBeCloseTo(-m.ancients[0].x, 5);
        expect(m.ancients[1].z).toBeCloseTo(-m.ancients[0].z, 5);
        const lens = m.lanes.map((l) => polyLength(l.points));
        for (const len of lens) expect(len).toBeGreaterThan(60);
      });

      it('крипы идут по каждой линии и доходят до середины', () => {
        const w = createWorld(botsSetup(id));
        // Самая дальняя точка, куда за 40 с дошёл хоть один крип каждой команды на каждой линии
        const best = m.lanes.map(() => [0, 0]);
        for (let t = 0; t < TICK_RATE * 40; t++) {
          step(w);
          if (t % 10) continue;
          for (const u of w.units)
            if (u.kind === 'creep' && u.alive) {
              const l = u.lane ?? 0;
              expect(dLane(m, u.x, u.z)).toBeLessThan(8);
              best[l][u.team] = Math.max(best[l][u.team], laneProgress(m, l, u.team, u.x, u.z));
            }
        }
        for (let l = 0; l < m.lanes.length; l++)
          for (const team of [0, 1]) expect(best[l][team]).toBeGreaterThan(polyLength(m.lanes[l].points) * 0.4);
      });

      it('поиск пути: из леса и с другой базы — до своего фонтана в обход деревьев', () => {
        const f = m.fountains[0];
        const goal = { x: f.x + (m.ancients[0].x - f.x) * 0.5, z: f.z + (m.ancients[0].z - f.z) * 0.5 };
        for (const s of [...m.camps, m.fountains[1], ...m.runeSpots]) {
          const path = findPath(m, s.x, s.z, goal.x, goal.z);
          expect(path.length).toBeGreaterThan(0);
          const last = path[path.length - 1];
          expect(Math.hypot(last.x - goal.x, last.z - goal.z)).toBeLessThan(0.01);
          // Каждый отрезок, кроме первого (старт может стоять вплотную к дереву), свободен
          for (let i = 1; i < path.length; i++)
            expect(navClear(m, path[i - 1].x, path[i - 1].z, path[i].x, path[i].z)).toBe(true);
        }
        // Одинаковые входы — одинаковый путь
        const a = findPath(m, m.camps[0].x, m.camps[0].z, goal.x, goal.z);
        expect(findPath(m, m.camps[0].x, m.camps[0].z, goal.x, goal.z)).toEqual(a);
      });

      it('детерминизм: одинаковое зерно — одинаковый мир', () => {
        const run = (): World => {
          const w = createWorld(botsSetup(id, 99));
          for (let t = 0; t < TICK_RATE * 90; t++) step(w);
          return w;
        };
        const strip = (w: World) => JSON.stringify({ ...w, events: [] });
        expect(strip(run())).toBe(strip(run()));
      });
    });
  }
});
