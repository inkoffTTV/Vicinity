import { expect, test, type Page } from '@playwright/test';

/** Ошибки страницы и консоли за весь тест */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Нет игрового сервера — сетевой режим в smoke не проверяем
    if (m.type() === 'error' && !/WebSocket|ws:\/\//.test(m.text())) errors.push(m.text());
  });
  return errors;
}

type G = {
  state: string;
  mapId: string;
  world: { players: unknown[] } | null;
  snap: { tick: number; me: { alive: boolean } | null } | null;
};
const g = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __g: G }).__g && { state: window.__g.state, tick: window.__g.snap?.tick ?? 0 },
  );

declare global {
  interface Window {
    __g: G;
  }
}

for (const mode of ['1v1', '2v2', '3v3'] as const)
  test(`меню → матч против ботов (${mode}): игра идёт без ошибок`, async ({ page }) => {
    const errors = collectErrors(page);
    // Программный WebGL медленный — низкое качество, чтобы кадры успевали
    await page.addInitScript(
      (m) => localStorage.setItem('pereprava:settings', JSON.stringify({ quality: 'low', shadows: false, mode: m })),
      mode,
    );
    await page.goto('/#debug');
    // Разметка видна раньше, чем загрузится скрипт, — ждём, пока приложение запустится
    await page.waitForFunction(() => !!window.__g, null, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Играть' })).toBeVisible();
    await expect(page.locator('.logo')).toContainText('Переправа');
    await expect(page.getByRole('radiogroup', { name: /Карта/ }).locator(`[data-v="${mode}"]`)).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.getByRole('button', { name: 'Играть' }).click();
    await page.getByRole('button', { name: 'Принять' }).click({ timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: 'Выбор героя' })).toBeVisible();
    await page.locator('.hcard[data-hero="ranger"]').click();
    await page.getByRole('button', { name: 'В бой' }).click();

    await page.waitForFunction(() => window.__g.state === 'play', null, { timeout: 30_000 });
    const t0 = (await g(page))!.tick;
    await page.waitForTimeout(4000);
    const t1 = (await g(page))!.tick;
    expect(t1).toBeGreaterThan(t0 + 10); // симуляция идёт
    expect(await page.evaluate(() => window.__g.mapId)).toBe(mode);
    // Команды полные: по 1/2/3 героя с каждой стороны
    expect(await page.evaluate(() => window.__g.world?.players.length)).toBe(2 * +mode[0]);

    // Интерфейс матча на месте
    await expect(page.locator('#minimap')).toBeVisible();
    await expect(page.locator('#skills .sk')).toHaveCount(4);
    // Приказ идти: клик по земле
    const box = (await page.locator('canvas.view').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
    // Лавка открывается и закрывается
    await page.getByRole('button', { name: /Лавка/ }).click();
    await expect(page.getByRole('dialog', { name: 'Лавка' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Лавка' })).toBeHidden();
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });

test('меню: вкладки и настройки', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#debug');
  await page.waitForFunction(() => !!window.__g, null, { timeout: 30_000 });
  await page.getByRole('tab', { name: 'Герои' }).click();
  await expect(page.locator('#heroCards .card2')).toHaveCount(24);
  await page.getByRole('tab', { name: 'Настройки' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Время суток' })).toBeVisible();
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByLabel('Имя игрока').fill('Тестер');
  await expect(page.locator('#meName')).toHaveText('Тестер');
  await page.getByRole('button', { name: /С другом/ }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Игра с другом' })).toBeVisible();
  expect(errors).toEqual([]);
});
