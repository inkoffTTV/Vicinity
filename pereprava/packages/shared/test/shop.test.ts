import { describe, expect, it } from 'vitest';
import {
  ALL_SLOTS,
  buyItem,
  canAfford,
  createWorld,
  getMap,
  heroOf,
  HEROES,
  INVENTORY,
  ITEM,
  ITEM_INTO,
  itemContains,
  itemCostFor,
  ITEMS,
  nextPart,
  queueCommand,
  recipeCost,
  SECTIONS,
  step,
  TICK_RATE,
  type Unit,
  type World,
} from '../src/index';

function shopWorld(): { w: World; h: Unit } {
  const w = createWorld({
    seed: 3,
    players: [
      { name: 'А', team: 0, hero: 'mage', bot: null },
      { name: 'Б', team: 1, hero: 'brute', bot: null },
    ],
  });
  const h = heroOf(w, 0)!;
  const f = getMap('1v1').fountains[0];
  Object.assign(h, { x: f.x + 2, z: f.z - 2 });
  return { w, h };
}
const run = (w: World, sec: number) => {
  for (let i = 0; i < sec * TICK_RATE; i++) step(w);
};

describe('каталог', () => {
  it('25–30 предметов, три уровня, все разделы заняты', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(25);
    expect(ITEMS.length).toBeLessThanOrEqual(30);
    for (const t of [1, 2, 3]) expect(ITEMS.some((i) => i.tier === t)).toBe(true);
    for (const s of SECTIONS) expect(ITEMS.some((i) => i.section === s.id)).toBe(true);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('рецепты: 2–3 части, уровень частей ниже, доплата за рецепт больше нуля', () => {
    for (const it of ITEMS) {
      if (!it.parts) {
        expect(it.tier).toBe(1);
        continue;
      }
      expect(it.parts.length).toBeGreaterThanOrEqual(2);
      expect(it.parts.length).toBeLessThanOrEqual(3);
      for (const p of it.parts) {
        expect(ITEM[p]).toBeDefined();
        expect(ITEM[p].tier).toBeLessThan(it.tier);
        expect(ITEM_INTO[p]).toContain(it.id);
      }
      expect(recipeCost(it.id)).toBeGreaterThan(0);
    }
  });

  it('сборки героев состоят из предметов каталога', () => {
    for (const h of HEROES) for (const id of h.build) expect(ITEM[id]).toBeDefined();
  });
});

describe('цена с учётом инвентаря', () => {
  it('части засчитываются на любой глубине, промежуточный предмет — целиком', () => {
    // Клинок бури = Боевой клинок + Кровавый серп(Клык + Нож)
    const items = ['warblade', 'fang', null, null, null, null, null, null, 'blade'];
    const { cost, consume } = itemCostFor(items, 'stormblade');
    expect(cost).toBe(ITEM.stormblade.price - ITEM.warblade.price - ITEM.fang.price - ITEM.blade.price);
    expect(consume).toEqual([0, 1, 8]);
    // Без частей — полная цена
    expect(itemCostFor(Array(ALL_SLOTS).fill(null), 'stormblade').cost).toBe(ITEM.stormblade.price);
  });

  it('следующая часть к цели: сам предмет, если хватает, иначе недостающая часть', () => {
    const empty = Array(ALL_SLOTS).fill(null);
    expect(nextPart(empty, 99999, 'stormblade')).toMatchObject({ id: 'stormblade', ok: true });
    // Денег мало — первая недостающая часть вглубь дерева, которую можно купить
    const n = nextPart(empty, 460, 'stormblade')!;
    expect(n.ok).toBe(true);
    expect(itemContains('stormblade', n.id)).toBe(true);
    expect(ITEM[n.id].price).toBeLessThanOrEqual(460);
    // Посох и перчатки уже есть — следующим собирается Боевой клинок (доплата за рецепт)
    const have = ['staff', 'gloves', null, null, null, null, null, null, null];
    expect(nextPart(have, recipeCost('warblade'), 'stormblade')).toMatchObject({ id: 'warblade', ok: true });
    // Денег нет совсем — что-то показать, но ok = false
    expect(nextPart(empty, 0, 'stormblade')!.ok).toBe(false);
    // «Одни на героя» уже есть — цели нет
    expect(nextPart(['boots', ...Array(8).fill(null)], 9999, 'boots')).toBeNull();
  });
});

describe('покупка, рюкзак, продажа', () => {
  it('основные слоты заполнены — покупка ложится в рюкзак и не даёт прибавок', () => {
    const { w, h } = shopWorld();
    h.hero!.items = ['ring', 'ring', 'ring', 'ring', 'ring', 'ring', null, null, null];
    h.hero!.gold = 1000;
    const hp = h.maxHp;
    expect(buyItem(w, h, 'cloak')).toBe(true);
    expect(h.hero!.items.indexOf('cloak')).toBeGreaterThanOrEqual(INVENTORY);
    expect(h.maxHp).toBe(hp);
    // Переложили в основной слот — прибавка появилась
    const slot = h.hero!.items.indexOf('cloak');
    queueCommand(w, 0, { c: 'swap', a: slot, b: 0 });
    step(w);
    expect(h.hero!.items[0]).toBe('cloak');
    expect(h.maxHp).toBe(hp + 180 + 4 * 12);
  });

  it('все 9 слотов заняты — купить нельзя, если покупка не освобождает место', () => {
    const items = Array(ALL_SLOTS).fill('ring');
    expect(canAfford(items, 9999, 'cloak')).toBe(false);
    // Рецепт забирает части — место есть
    const withParts = ['cloak', 'mail', ...Array(7).fill('ring')];
    expect(canAfford(withParts, 9999, 'bulwark')).toBe(true);
  });

  it('из рюкзака предмет не применяется', () => {
    const { w, h } = shopWorld();
    h.hero!.items = [null, null, null, null, null, null, 'potion', null, null];
    queueCommand(w, 0, { c: 'use', slot: 6 });
    step(w);
    expect(h.hero!.items[6]).toBe('potion');
  });

  it('продажа: полная цена в первые 10 с, потом половина', () => {
    const { w, h } = shopWorld();
    h.hero!.gold = 400;
    queueCommand(w, 0, { c: 'buy', item: 'boots' });
    step(w);
    expect(h.hero!.gold).toBeLessThan(1); // остаток — пассивный доход за тик
    run(w, 5);
    const g = h.hero!.gold;
    queueCommand(w, 0, { c: 'sell', slot: 0 });
    step(w);
    expect(Math.round(h.hero!.gold - g)).toBe(ITEM.boots.price);
    // Купили снова и ждали дольше 10 с
    h.hero!.gold = 400;
    queueCommand(w, 0, { c: 'buy', item: 'boots' });
    step(w);
    run(w, 11);
    const g2 = h.hero!.gold;
    queueCommand(w, 0, { c: 'sell', slot: 0 });
    step(w);
    expect(Math.round(h.hero!.gold - g2)).toBe(Math.floor(ITEM.boots.price / 2));
  });

  it('собрал из старых частей и сразу продал — полной цены нет', () => {
    const { w, h } = shopWorld();
    h.hero!.items = ['staff', 'gloves', null, null, null, null, null, null, null];
    h.hero!.gold = recipeCost('warblade');
    expect(buyItem(w, h, 'warblade')).toBe(true);
    const g = h.hero!.gold;
    queueCommand(w, 0, { c: 'sell', slot: h.hero!.items.indexOf('warblade') });
    step(w);
    // Вернули доплату за рецепт и половину цены частей — меньше полной цены клинка
    const back = Math.round(h.hero!.gold - g);
    expect(back).toBe(recipeCost('warblade') + Math.floor(ITEM.staff.price / 2) + Math.floor(ITEM.gloves.price / 2));
    expect(back).toBeLessThan(ITEM.warblade.price);
  });

  it('бот закупается по рекомендациям своего героя', () => {
    const w = createWorld({
      seed: 9,
      players: [
        { name: 'А', team: 0, hero: 'ranger', bot: 'normal' },
        { name: 'Б', team: 1, hero: 'brute', bot: 'normal' },
      ],
    });
    run(w, 60 * 12);
    for (const p of w.players) {
      const u = heroOf(w, p.slot)!;
      const owned = u.hero!.items.filter(Boolean) as string[];
      expect(owned.length).toBeGreaterThan(0);
      // Всё купленное — из сборки героя или её частей
      const build = HEROES.find((x) => x.id === p.heroDef)!.build;
      for (const id of owned) expect(build.some((b) => itemContains(b, id) || itemContains(id, b))).toBe(true);
    }
  });
});
