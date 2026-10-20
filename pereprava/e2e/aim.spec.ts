import { expect, test, type Page } from '@playwright/test';

// Наведение мышью, прицел умений, атака с передвижением и прицел пальцем от кнопки умения.
// Матч запускается напрямую (__g.start), мир двигаем вручную (__g.step), чтобы всё было предсказуемо.

interface V {
  x: number;
  y: number;
  z: number;
  snap: { id: number; k: string; tm: number };
}
interface Dbg {
  state: string;
  app: {
    view: {
      units: Map<number, V>;
      myUnit: number;
      aim: unknown;
      toScreen(x: number, y: number, z: number): { x: number; y: number } | null;
    };
    snap: { me: { cd: number[] } };
  };
  world: {
    units: {
      id: number;
      kind: string;
      team: number;
      x: number;
      z: number;
      alive: boolean;
      hero?: { order: { type: string } | null };
    }[];
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

async function startMatch(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('pereprava:settings', JSON.stringify({ quality: 'low', shadows: false, mode: '1v1' })),
  );
  await page.goto('/#debug');
  await page.waitForFunction(() => !!window.__g, null, { timeout: 30_000 });
  await page.evaluate(() => window.__g.start());
  await page.waitForFunction(() => window.__g.state === 'play', null, { timeout: 30_000 });
  // Вражеского крипа ставим рядом со своим героем
  await page.evaluate(() => {
    const g = window.__g;
    g.step(30 * 3);
    const w = g.world;
    const me = w.units.find((u) => u.id === w.players[0].unit)!;
    // Умения изучены (на 1 уровне только одно — для проверки открываем три)
    (me as unknown as { hero: { skill: number[] } }).hero.skill = [1, 1, 1, 0];
    const c = w.units.find((u) => u.kind === 'creep' && !(u as { owner?: number }).owner && u.team === 1 && u.alive)!;
    Object.assign(c, { x: me.x + 4, z: me.z - 4 });
    // Крип стоит на месте (оглушён), вражеский герой далеко — под курсором только он
    (c as unknown as { mods: { id: string; t: number; v: number; src: number }[] }).mods.push({
      id: 'stun',
      t: 120,
      v: 0,
      src: 0,
    });
    const foe = w.units.find((u) => u.id === w.players[1].unit)!;
    Object.assign(foe, { x: -me.x, z: -me.z });
    (window as unknown as { __tid: number }).__tid = c.id;
    g.step(2);
  });
  await page.waitForTimeout(300);
}

/** Экранная точка вражеского крипа и свободной земли рядом с героем */
const points = (page: Page) =>
  page.evaluate(() => {
    const v = window.__g.app.view;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const creep = v.units.get((window as unknown as { __tid: number }).__tid)!;
    const me = v.units.get(v.myUnit)!;
    const c = v.toScreen(creep.x, creep.y + 0.8, creep.z)!;
    const ground = v.toScreen(me.x - 5, me.y, me.z + 5)!;
    return {
      creep: { x: canvas.left + c.x, y: canvas.top + c.y },
      ground: { x: canvas.left + ground.x, y: canvas.top + ground.y },
    };
  });

test('мышь: подсветка цели, прицел умения, отмена, A + клик', async ({ page, isMobile }) => {
  test.skip(isMobile, 'на телефоне мыши нет');
  await startMatch(page);
  const p = await points(page);
  // Наведение на врага: плашка сверху и курсор «атака»
  await page.mouse.move(p.creep.x, p.creep.y);
  await expect(page.locator('#hoverPlate')).toBeVisible();
  await expect(page.locator('#hoverPlate b')).toHaveText(/Мечник|Лучник/);
  await expect(page.locator('#game')).toHaveClass(/cur-attack/);
  // Q — режим прицела, Esc — отмена
  await page.keyboard.press('q');
  await expect(page.locator('#game')).toHaveClass(/cur-aim/);
  expect(await page.evaluate(() => !!window.__g.app.view.aim)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game')).not.toHaveClass(/cur-aim/);
  expect(await page.evaluate(() => window.__g.app.view.aim)).toBeNull();
  // Q и клик — умение применено (пошла перезарядка)
  await page.keyboard.press('q');
  await page.mouse.click(p.creep.x, p.creep.y);
  await page.evaluate(() => window.__g.step(3));
  await expect.poll(() => page.evaluate(() => window.__g.app.snap.me.cd[0])).toBeGreaterThan(0);
  // A + клик по земле — атака с передвижением
  await page.mouse.move(p.ground.x, p.ground.y);
  await page.keyboard.press('a');
  await expect(page.locator('#game')).toHaveClass(/cur-attack/);
  await page.mouse.click(p.ground.x, p.ground.y);
  await page.evaluate(() => window.__g.step(1));
  const order = await page.evaluate(() => {
    const w = window.__g.world;
    return w.units.find((u) => u.id === w.players[0].unit)!.hero!.order?.type ?? null;
  });
  expect(['amove', 'attack']).toContain(order);
});

test('палец: прицел перетаскиванием от кнопки, возврат на кнопку — отмена', async ({ page }) => {
  await startMatch(page);
  const btn = page.locator('#skQ');
  const box = (await btn.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const ev = (type: string, x: number, y: number) =>
    btn.dispatchEvent(type, {
      pointerType: 'touch',
      pointerId: 7,
      isPrimary: true,
      clientX: x,
      clientY: y,
      bubbles: true,
    });
  // Повёл и вернул на кнопку — отмена, перезарядки нет
  await ev('pointerdown', cx, cy);
  await ev('pointermove', cx - 60, cy - 80);
  expect(await page.evaluate(() => !!window.__g.app.view.aim)).toBe(true);
  await ev('pointermove', cx, cy);
  await ev('pointerup', cx, cy);
  await page.evaluate(() => window.__g.step(3));
  expect(await page.evaluate(() => window.__g.app.view.aim)).toBeNull();
  expect(await page.evaluate(() => window.__g.app.snap.me.cd[0])).toBe(0);
  // Повёл и отпустил — применено
  await ev('pointerdown', cx, cy);
  await ev('pointermove', cx - 70, cy - 90);
  await ev('pointerup', cx - 70, cy - 90);
  await page.evaluate(() => window.__g.step(3));
  await expect.poll(() => page.evaluate(() => window.__g.app.snap.me.cd[0])).toBeGreaterThan(0);
});
