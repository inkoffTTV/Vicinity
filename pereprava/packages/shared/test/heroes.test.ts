import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  createWorld,
  heroOf,
  HEROES,
  ITEM,
  queueCommand,
  ROLES,
  spawnWave,
  step,
  TICK_RATE,
  type Unit,
  type World,
} from '../src/index';

const finite = (w: World) =>
  w.units.every(
    (u) => Number.isFinite(u.x) && Number.isFinite(u.z) && Number.isFinite(u.hp) && Number.isFinite(u.maxHp),
  );

describe('состав героев', () => {
  it('24 героя, по четыре на каждую роль, у каждого 3 умения + ультимейт', () => {
    expect(HEROES.length).toBe(24);
    for (const r of ROLES) expect(HEROES.filter((h) => h.roleId === r.id).length).toBe(4);
    for (const h of HEROES) {
      expect(h.abilities.length).toBe(4);
      for (const id of h.abilities) expect(ABILITIES[id], `${h.id}: ${id}`).toBeDefined();
      expect(ABILITIES[h.abilities[3]].ult).toBe(true);
      for (const id of h.abilities.slice(0, 3)) expect(ABILITIES[id].ult).toBeFalsy();
      for (const id of h.build) expect(ITEM[id]).toBeDefined();
    }
  });

  it('умения не повторяются между героями', () => {
    const all = HEROES.flatMap((h) => h.abilities);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('каждое умение каждого героя', () => {
  for (const h of HEROES)
    it(`${h.name}: умения применяются и не ломают мир`, () => {
      const w = createWorld({
        seed: 11,
        players: [
          { name: 'А', team: 0, hero: h.id, bot: null },
          { name: 'Б', team: 1, hero: 'brute', bot: null },
        ],
      });
      // Крипы рядом — для умений, которым нужна цель-крип (Обжора)
      spawnWave(w);
      w.nextWave = 1e9;
      const me = heroOf(w, 0)!;
      const foe = heroOf(w, 1)!;
      me.hero!.level = 6;
      me.hero!.gold = 0;
      for (let t = 0; t < TICK_RATE; t++) step(w);
      const setup = () => {
        Object.assign(me, { x: 0, z: 0, alive: true, hp: me.maxHp, mods: [] });
        Object.assign(foe, { x: 2.4, z: 0, alive: true, hp: foe.maxHp, mods: [] });
        const c = w.units.find((u) => u.kind === 'creep' && u.team === 1 && u.alive) as Unit | undefined;
        if (c) Object.assign(c, { x: -2, z: 1.5 });
        me.hero!.order = null;
        me.hero!.casting = null;
      };
      for (let slot = 0; slot < 4; slot++) {
        const a = ABILITIES[h.abilities[slot]];
        setup();
        me.hero!.cd[slot] = 0;
        if (a.passive) {
          // Пассивка: просто бьём рядом стоящего врага пару секунд
          queueCommand(w, 0, { c: 'attack', id: foe.id });
          for (let t = 0; t < TICK_RATE * 2; t++) step(w);
          expect(finite(w), `${a.id}: мир цел`).toBe(true);
          continue;
        }
        const target = a.id === 'devour' ? w.units.find((u) => u.kind === 'creep' && u.team === 1 && u.alive)! : foe;
        queueCommand(w, 0, { c: 'cast', slot, x: target.x, z: target.z, id: target.id });
        let cast = false;
        for (let t = 0; t < TICK_RATE * 2.5; t++) {
          step(w);
          if (w.events.some((e) => e.e === 'cast' && e.ability === a.id)) cast = true;
        }
        expect(cast, `${a.id}: применилось`).toBe(true);
        expect(finite(w), `${a.id}: мир цел`).toBe(true);
      }
    });
});
