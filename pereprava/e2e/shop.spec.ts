import { expect, test, type Page } from '@playwright/test';

// Лавка: разделы и поиск, карточка с рецептом, покупка, цель и быстрая покупка, продажа, рюкзак.

interface Dbg {
  state: string;
  world: {
    units: { id: number; x: number; z: number; hero?: { gold: number; items: (string | null)[] } }[];
    players: { unit: number }[];
  };
  start(): void;
  step(n: number): void;
}
declare global {
  interface Window {
    __g: Dbg;
  }
}

async function atFountain(page: Page, gold: number) {
  await page.addInitScript(() =>
    localStorage.setItem('pereprava:settings', JSON.stringify({ quality: 'low', shadows: false, mode: '1v1' })),
  );
  await page.goto('/#debug');
  await page.waitForFunction(() => !!window.__g, null, { timeout: 30_000 });
  await page.evaluate(() => window.__g.start());
  await page.waitForFunction(() => window.__g.state === 'play', null, { timeout: 30_000 });
  await page.evaluate((g) => {
    const w = window.__g.world;
    const me = w.units.find((u) => u.id === w.players[0].unit)!;
    Object.assign(me, { x: -51, z: 51 });
    me.hero!.gold = g;
    window.__g.step(2);
  }, gold);
}

const items = (page: Page) =>
  page.evaluate(() => {
    const w = window.__g.world;
    return w.units.find((u) => u.id === w.players[0].unit)!.hero!.items;
  });
/** Сделать шаг симуляции — приказы игрока применяются на тике */
const tick = (page: Page) => page.evaluate(() => window.__g.step(2));

test('лавка: поиск, карточка, покупка, цель и быстрая покупка, продажа, рюкзак', async ({ page }) => {
  await atFountain(page, 900);
  await page.getByRole('button', { name: 'Лавка' }).click();
  const shop = page.getByRole('dialog', { name: 'Лавка' });
  await expect(shop).toBeVisible();
  await expect(page.locator('#shopNote')).toHaveClass(/ok/);
  // Поиск по названию
  await page.locator('#shopSearch').fill('клин');
  await expect(page.locator('.sitem')).toHaveCount(2); // Боевой клинок, Клинок бури
  await page.locator('#shopSearch').fill('');
  // Раздел «Атака», карточка Боевого клинка: рецепт из двух частей
  await page.locator('#shopTabs button[data-tab="attack"]').click();
  await page.locator('.sitem[data-id="warblade"]').click();
  await expect(page.locator('#shopCard h3')).toHaveText('Боевой клинок');
  await expect(page.locator('#shopCard .chip[data-open]')).toHaveCount(3); // 2 части + «входит в»
  // Делаем целью — у лавки появляется кнопка быстрой покупки
  await page.locator('#shopCard .tgtb').click();
  // Кнопка быстрой покупки — и у лавки на поле, и внутри лавки (на телефоне лавка закрывает поле)
  await expect(page.locator('#shopQuick')).toBeVisible();
  const quick = page.locator('#shopQuick');
  // Быстрая покупка дважды: первые две части
  await quick.click();
  await tick(page);
  await quick.click();
  await tick(page);
  const two = (await items(page)).filter(Boolean);
  expect(two.sort()).toEqual(['gloves', 'staff']);
  // На рецепт (450) не хватает — кнопка не активна; добавили золота — третьим собирается клинок
  await expect(quick).not.toHaveClass(/ok/);
  await page.evaluate(() => {
    const w = window.__g.world;
    w.units.find((u) => u.id === w.players[0].unit)!.hero!.gold += 450;
    window.__g.step(2);
  });
  await expect(quick).toHaveClass(/ok/);
  await quick.click();
  await tick(page);
  expect((await items(page)).filter(Boolean)).toEqual(['warblade']);
  await expect(quick).toBeHidden(); // цель собрана
  await expect(page.locator('#quickBuy')).toBeHidden();
  // Продажа: выбрать слот, «Продать за …» (в первые 10 с — полная цена уплаченного)
  await page.locator('#shopInv [data-slot="0"]').click();
  await expect(page.locator('#shopInvAct .sell')).toContainText('Продать за');
  // В рюкзак и обратно
  await page.locator('#shopInvAct .mv').click();
  await tick(page);
  expect((await items(page))[6]).toBe('warblade');
  await page.locator('#shopInvAct .mv').click();
  await tick(page);
  expect((await items(page))[0]).toBe('warblade');
  // Выделение переехало вместе с предметом — сразу продаём
  await page.locator('#shopInvAct .sell').click();
  await tick(page);
  expect((await items(page)).filter(Boolean)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(shop).toBeHidden();
});
