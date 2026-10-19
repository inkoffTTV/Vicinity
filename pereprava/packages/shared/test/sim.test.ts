import { describe, expect, it } from 'vitest';
import {
  addMod,
  armorMult,
  BALANCE,
  MODE_PACE,
  buyItem,
  createWorld,
  damage,
  getMap,
  heroOf,
  ITEM,
  itemCostFor,
  makeSnapshot,
  queueCommand,
  step,
  towerOf,
  WAVE_INTERVAL,
  type MatchSetup,
  type Unit,
  type World,
} from '../src/index';

const FOUNTAIN0 = getMap('1v1').fountains[0];

/** Два человека без ботов — никто не вмешивается в проверку */
function world(setup: Partial<MatchSetup> = {}): World {
  return createWorld({
    seed: 7,
    players: [
      { name: 'А', team: 0, hero: 'mage', bot: null },
      { name: 'Б', team: 1, hero: 'brute', bot: null },
    ],
    ...setup,
  });
}

const hero = (w: World, slot: number) => heroOf(w, slot)!;
const put = (u: Unit, x: number, z: number) => Object.assign(u, { x, z });

describe('урон', () => {
  it('физический урон режется бронёй по формуле', () => {
    const w = world();
    const t = hero(w, 1);
    t.armor = 0;
    const hp = t.hp;
    expect(damage(w, t, 100, null)).toBeCloseTo(100);
    expect(t.hp).toBeCloseTo(hp - 100);
    t.armor = 5;
    expect(damage(w, t, 100, null)).toBeCloseTo(100 * armorMult(5));
    expect(armorMult(5)).toBeLessThan(1);
    expect(armorMult(-5)).toBeGreaterThan(1);
  });

  it('магический учитывает сопротивление магии, чистый — ничего', () => {
    const w = world();
    const t = hero(w, 1);
    t.armor = 10;
    t.magicRes = 0.25;
    expect(damage(w, t, 100, null, 'magical')).toBeCloseTo(75);
    expect(damage(w, t, 100, null, 'pure')).toBeCloseTo(100);
  });

  it('смерть при нулевом здоровье, неуязвимого не ранить', () => {
    const w = world();
    const t = hero(w, 1);
    t.invuln = true;
    expect(damage(w, t, 1e6, null, 'pure')).toBe(0);
    t.invuln = false;
    damage(w, t, 1e6, hero(w, 0), 'pure');
    expect(t.alive).toBe(false);
    expect(t.hp).toBe(0);
    expect(w.players[1].stats.deaths).toBe(1);
    expect(w.players[0].stats.kills).toBe(1);
  });

  it('здания укреплены в начале матча', () => {
    const w = world();
    const tw = towerOf(w, 1)!;
    tw.armor = 0;
    // без героя-источника защита от «прокрадывания» не действует
    expect(damage(w, tw, 100, null, 'pure')).toBeCloseTo(100 * MODE_PACE[w.mapId].bld * (1 - BALANCE.fortify));
  });
});

describe('щит', () => {
  it('поглощает урон первым и исчезает, когда кончился', () => {
    const w = world();
    const t = hero(w, 1);
    const hp = t.hp;
    const m = addMod(t, 'shield', 5);
    m.v = 100;
    expect(damage(w, t, 60, null, 'pure')).toBe(0);
    expect(t.hp).toBe(hp);
    expect(m.v).toBeCloseTo(40);
    expect(w.events.some((e) => e.e === 'hit' && e.shield && e.amt === 0)).toBe(true);
    damage(w, t, 100, null, 'pure');
    expect(t.hp).toBeCloseTo(hp - 60);
    expect(m.t).toBe(0);
  });
});

describe('вышка', () => {
  it('сначала бьёт крипов, но переключается на героя, напавшего на героя рядом', () => {
    const w = world();
    const tw = towerOf(w, 0)!;
    const ally = hero(w, 0);
    const foe = hero(w, 1);
    put(ally, tw.x + 2, tw.z);
    put(foe, tw.x + 4, tw.z + 1);
    damage(w, ally, 10, foe);
    expect(tw.target).toBe(foe.id);
    expect(tw.forced).toBeGreaterThan(0);
  });

  it('не заступается, если обидчик далеко', () => {
    const w = world();
    const tw = towerOf(w, 0)!;
    const ally = hero(w, 0);
    const foe = hero(w, 1);
    put(ally, tw.x, tw.z + 3);
    put(foe, tw.x + 30, tw.z);
    damage(w, ally, 10, foe);
    expect(tw.target).not.toBe(foe.id);
  });
});

describe('волны крипов', () => {
  it('первая волна на 1-й секунде, дальше каждые 25 с, по 4 крипа на сторону', () => {
    const w = world();
    const creeps = () => w.units.filter((u) => u.kind === 'creep');
    expect(creeps()).toHaveLength(0);
    while (w.time < 1.05) step(w);
    expect(creeps()).toHaveLength(8);
    expect(creeps().filter((c) => c.team === 0)).toHaveLength(4);
    const born = w.nextWave;
    expect(born).toBeCloseTo(1 + WAVE_INTERVAL);
    while (w.time < born + 0.05) step(w);
    expect(w.units.filter((u) => u.kind === 'creep').length).toBeGreaterThanOrEqual(12);
  });
});

describe('лавка', () => {
  it('покупка только у своего фонтана и при достатке золота', () => {
    const w = world();
    const h = hero(w, 0);
    h.hero!.gold = 500;
    put(h, 0, 0);
    expect(buyItem(w, h, 'boots')).toBe(false);
    put(h, FOUNTAIN0.x + 2, FOUNTAIN0.z);
    expect(buyItem(w, h, 'boots')).toBe(true);
    expect(h.hero!.gold).toBe(500 - ITEM.boots.price);
    expect(h.hero!.items).toContain('boots');
    expect(buyItem(w, h, 'boots')).toBe(false); // одни на героя и денег не хватит
    h.hero!.gold = 10;
    expect(buyItem(w, h, 'ring')).toBe(false);
  });

  it('составной предмет забирает части и стоит их разницу', () => {
    const w = world();
    const h = hero(w, 0);
    put(h, FOUNTAIN0.x, FOUNTAIN0.z);
    h.hero!.items = ['staff', null, 'gloves', null, null, null];
    const { cost, consume } = itemCostFor(h.hero!.items, 'warblade');
    expect(cost).toBe(ITEM.warblade.price - ITEM.staff.price - ITEM.gloves.price);
    expect(consume).toEqual([0, 2]);
    h.hero!.gold = cost;
    expect(buyItem(w, h, 'warblade')).toBe(true);
    expect(h.hero!.gold).toBe(0);
    expect(h.hero!.items.filter(Boolean)).toEqual(['warblade']);
  });

  it('предмет меняет параметры героя', () => {
    const w = world();
    const h = hero(w, 0);
    put(h, FOUNTAIN0.x, FOUNTAIN0.z);
    const hp = h.maxHp;
    h.hero!.gold = 1000;
    buyItem(w, h, 'cloak');
    expect(h.maxHp).toBe(hp + 180);
  });

  it('продажа через команду возвращает половину цены', () => {
    const w = world();
    const h = hero(w, 0);
    put(h, FOUNTAIN0.x, FOUNTAIN0.z);
    h.hero!.gold = 400;
    queueCommand(w, 0, { c: 'buy', item: 'boots' });
    step(w);
    expect(h.hero!.items[0]).toBe('boots');
    queueCommand(w, 0, { c: 'sell', slot: 0 });
    step(w);
    expect(h.hero!.items[0]).toBe(null);
    expect(h.hero!.gold).toBeGreaterThanOrEqual(ITEM.boots.price / 2);
  });
});

describe('туман войны', () => {
  it('снимок не показывает вражеского героя вне обзора', () => {
    const w = world();
    put(hero(w, 1), 40, -40);
    const s = makeSnapshot(w, 0);
    expect(s.units.some((u) => u.id === hero(w, 1).id)).toBe(false);
    expect(s.units.some((u) => u.id === hero(w, 0).id)).toBe(true);
    const all = makeSnapshot(w, 0, { all: true });
    expect(all.units.some((u) => u.id === hero(w, 1).id)).toBe(true);
  });
});

describe('детерминизм полного матча', () => {
  const setup: MatchSetup = {
    seed: 99,
    jungle: true,
    players: [
      { name: 'a', team: 0, hero: 'ranger', bot: 'normal' },
      { name: 'b', team: 0, hero: 'keeper', bot: 'hard' },
      { name: 'c', team: 1, hero: 'shade', bot: 'normal' },
      { name: 'd', team: 1, hero: 'brute', bot: 'easy' },
    ],
  };
  const run = (s: MatchSetup) => {
    const w = createWorld(s);
    for (let t = 0; t < 30 * 240; t++) step(w);
    return JSON.stringify({ ...w, events: [] });
  };

  it('2 на 2 с лесом и ботами: одинаковое зерно — одинаковый мир', () => {
    expect(run(setup)).toBe(run(setup));
  });

  it('другое зерно — другой матч', () => {
    expect(run(setup)).not.toBe(run({ ...setup, seed: 100 }));
  });
});

describe('умения всех героев', () => {
  for (const id of ['mage', 'brute', 'ranger', 'keeper', 'shade']) {
    it(`${id}: каждое умение применяется и не ломает мир`, () => {
      const w = createWorld({
        seed: 3,
        players: [
          { name: 'А', team: 0, hero: id, bot: null },
          { name: 'Б', team: 1, hero: 'brute', bot: null },
        ],
      });
      const me = hero(w, 0);
      const foe = hero(w, 1);
      me.hero!.level = 6;
      put(me, 0, 0);
      put(foe, 3, 0);
      const hp = foe.hp;
      for (let slot = 0; slot < 4; slot++) {
        me.hero!.cd[slot] = 0;
        queueCommand(w, 0, { c: 'cast', slot, x: foe.x, z: foe.z, id: foe.id });
        for (let t = 0; t < 45; t++) step(w);
      }
      expect(Number.isFinite(me.x) && Number.isFinite(foe.hp)).toBe(true);
      expect(foe.hp).toBeLessThan(hp + 1);
      expect(me.hero!.cd.some((c) => c > 0)).toBe(true);
    });
  }
});

describe('нажатие умения всегда даёт результат', () => {
  const duel = (hero: string) =>
    createWorld({
      seed: 5,
      players: [
        { name: 'А', team: 0, hero, bot: null },
        { name: 'Б', team: 1, hero: 'brute', bot: null },
      ],
    });

  it('цель чуть дальше дальности — герой подходит и применяет', () => {
    const w = duel('shade');
    const me = hero(w, 0);
    const foe = hero(w, 1);
    put(me, 0, 0);
    put(foe, 15, 0); // кинжал бьёт на 10 м
    queueCommand(w, 0, { c: 'cast', slot: 0, x: foe.x, z: foe.z, id: foe.id });
    step(w);
    expect(me.hero!.order?.type).toBe('cast');
    for (let t = 0; t < 60 && me.hero!.cd[0] === 0; t++) step(w);
    expect(me.hero!.cd[0]).toBeGreaterThan(0);
  });

  it('целей нет совсем — игрок получает объяснение', () => {
    const w = duel('shade');
    put(hero(w, 0), 0, 0);
    put(hero(w, 1), 40, -40);
    queueCommand(w, 0, { c: 'cast', slot: 0 });
    step(w);
    expect(w.events).toContainEqual({ e: 'castFail', player: 0, slot: 0, reason: 'target' });
    queueCommand(w, 0, { c: 'cast', slot: 3 });
    step(w);
    expect(w.events).toContainEqual({ e: 'castFail', player: 0, slot: 3, reason: 'level' });
  });

  it('нажатие во время замаха срабатывает следом', () => {
    const w = duel('brute');
    const me = hero(w, 0);
    put(me, 0, 0);
    queueCommand(w, 0, { c: 'cast', slot: 0 }); // удар по земле с замахом
    step(w);
    expect(me.hero!.casting).not.toBeNull();
    queueCommand(w, 0, { c: 'cast', slot: 1, x: 6, z: 0 }); // рывок во время замаха
    for (let t = 0; t < 30; t++) step(w);
    expect(me.hero!.cd[1]).toBeGreaterThan(0);
  });
});
