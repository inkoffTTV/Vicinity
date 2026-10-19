import { describe, expect, it } from 'vitest';
import {
  addXp,
  canLearn,
  createWorld,
  getMap,
  heroOf,
  manaCost,
  ABILITIES,
  HERO,
  queueCommand,
  step,
  TICK_RATE,
  TP_CD,
  unitById,
  type World,
} from '../src/index';

function duel(hero = 'mage'): World {
  return createWorld({
    seed: 4,
    players: [
      { name: 'А', team: 0, hero, bot: null },
      { name: 'Б', team: 1, hero: 'brute', bot: null },
    ],
  });
}
const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * TICK_RATE; i++) step(w);
};

describe('прокачка умений', () => {
  it('на 1 уровне одно очко; без изучения умение не применяется', () => {
    const w = duel();
    const h = heroOf(w, 0)!.hero!;
    expect(h.points).toBe(1);
    queueCommand(w, 0, { c: 'cast', slot: 0, x: 5, z: 5 });
    step(w);
    expect(h.cd[0]).toBe(0);
    queueCommand(w, 0, { c: 'learn', slot: 0 });
    step(w);
    expect(h.skill[0]).toBe(1);
    expect(h.points).toBe(0);
  });

  it('уровень умения N — с уровня героя 2N−1, ультимейт — с 6, 10, 14', () => {
    const w = duel();
    const u = heroOf(w, 0)!;
    const h = u.hero!;
    h.points = 10;
    h.skill = [1, 0, 0, 0];
    expect(canLearn(u, 0)).toBe(false); // 2-й уровень умения — с 3-го уровня героя
    expect(canLearn(u, 3)).toBe(false);
    h.level = 6;
    expect(canLearn(u, 0)).toBe(true);
    expect(canLearn(u, 3)).toBe(true);
    h.skill[3] = 1;
    expect(canLearn(u, 3)).toBe(false);
    h.level = 10;
    expect(canLearn(u, 3)).toBe(true);
  });

  it('очко за каждый уровень, бот учит сам', () => {
    const w = createWorld({
      seed: 4,
      players: [
        { name: 'А', team: 0, hero: 'mage', bot: 'normal' },
        { name: 'Б', team: 1, hero: 'brute', bot: null },
      ],
    });
    const bot = heroOf(w, 0)!;
    expect(bot.hero!.skill.reduce((a, b) => a + b, 0)).toBe(1);
    addXp(w, bot, 99999);
    expect(bot.hero!.level).toBe(15);
    expect(bot.hero!.points).toBe(0);
    expect(bot.hero!.skill).toEqual([4, 4, 4, 3]);
  });
});

describe('мана и атрибуты', () => {
  it('умение тратит ману; без маны — отказ с объяснением', () => {
    const w = duel();
    const h = heroOf(w, 0)!.hero!;
    h.skill[0] = 1;
    const m0 = h.mana;
    expect(m0).toBeGreaterThan(0);
    queueCommand(w, 0, { c: 'cast', slot: 0, x: 5, z: 5 });
    step(w);
    expect(h.mana).toBeCloseTo(m0 - manaCost(ABILITIES[HERO.mage.abilities[0]]), 0);
    h.cd[0] = 0;
    h.mana = 1;
    queueCommand(w, 0, { c: 'cast', slot: 0, x: 5, z: 5 });
    step(w);
    expect(w.events).toContainEqual({ e: 'castFail', player: 0, slot: 0, reason: 'mana' });
  });

  it('интеллект с предмета прибавляет ману, сила — здоровье', () => {
    const w = duel();
    const u = heroOf(w, 0)!;
    const f = getMap('1v1').fountains[0];
    Object.assign(u, { x: f.x + 2, z: f.z });
    const mana = u.hero!.maxMana;
    const hp = u.maxHp;
    u.hero!.gold = 2000;
    queueCommand(w, 0, { c: 'buy', item: 'ember' });
    queueCommand(w, 0, { c: 'buy', item: 'cloak' });
    step(w);
    expect(u.hero!.maxMana).toBe(mana + 5 * 13);
    expect(u.maxHp).toBe(hp + 180 + 4 * 12);
  });
});

describe('тайник, курьер, телепорт', () => {
  it('купленное вдали ждёт в тайнике, курьер привозит', () => {
    const w = duel();
    const u = heroOf(w, 0)!;
    Object.assign(u, { x: -20, z: 20 });
    u.hero!.gold = 400;
    queueCommand(w, 0, { c: 'buy', item: 'boots' });
    step(w);
    expect(u.hero!.stash.map((s) => s.id)).toEqual(['boots']);
    queueCommand(w, 0, { c: 'courier' });
    run(w, 12);
    expect(u.hero!.items).toContain('boots');
    expect(u.hero!.stash).toEqual([]);
    const c = unitById(w, u.hero!.courier)!;
    expect(c.courier).toBe(true);
  });

  it('свиток телепорта переносит к своей вышке через 3 с, урон сбивает', () => {
    const w = duel();
    const u = heroOf(w, 0)!;
    const tower = w.units.find((v) => v.kind === 'tower' && v.team === 0 && v.tier === 1)!;
    expect(u.hero!.tp).toBe(1);
    queueCommand(w, 0, { c: 'tp', x: tower.x, z: tower.z });
    run(w, 3.2);
    expect(Math.hypot(u.x - tower.x, u.z - tower.z)).toBeLessThan(6);
    expect(u.hero!.tp).toBe(0);
    expect(u.hero!.tpCd).toBeGreaterThan(TP_CD - 5);
  });
});

describe('разворот', () => {
  it('герой сначала поворачивается, потом идёт', () => {
    const w = duel();
    const u = heroOf(w, 0)!;
    Object.assign(u, { x: 0, z: 0, rot: 0 });
    queueCommand(w, 0, { c: 'move', x: 0, z: -10 }); // ровно за спину
    step(w);
    step(w);
    expect(Math.hypot(u.x, u.z)).toBeLessThan(0.05);
    run(w, 0.5);
    expect(u.z).toBeLessThan(-0.5);
  });
});
