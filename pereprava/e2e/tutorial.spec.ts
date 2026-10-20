import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __g: {
      state: string;
      tutorial(): void;
      step(n: number): void;
      world: { units: { id: number; x: number; z: number; hero?: { skill: number[] } }[]; players: { unit: number }[] };
    };
  }
}

test('обучение: подсказки идут по шагам, можно пропустить', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('pereprava:settings', JSON.stringify({ quality: 'low', shadows: false })),
  );
  await page.goto('/#debug');
  await page.waitForFunction(() => !!window.__g, null, { timeout: 30_000 });
  await page.getByRole('button', { name: /Обучение/ }).click();
  await page.waitForFunction(() => window.__g.state === 'play', null, { timeout: 30_000 });
  await expect(page.locator('#coach')).toBeVisible();
  await expect(page.locator('#coachStep')).toHaveText('Шаг 1 из 6');
  // Первый кадр запоминает, где герой стоял
  await page.waitForTimeout(500);
  // Герой отошёл — следующий шаг
  await page.evaluate(() => {
    const w = window.__g.world;
    const me = w.units.find((u) => u.id === w.players[0].unit)!;
    me.x += 10;
    window.__g.step(2);
  });
  await expect(page.locator('#coachStep')).toHaveText('Шаг 2 из 6');
  // Изучили умение — третий шаг
  await page.evaluate(() => {
    const w = window.__g.world;
    w.units.find((u) => u.id === w.players[0].unit)!.hero!.skill[0] = 1;
    window.__g.step(2);
  });
  await expect(page.locator('#coachStep')).toHaveText('Шаг 3 из 6');
  await page.locator('#coachSkip').click();
  await expect(page.locator('#coach')).toBeHidden();
});
