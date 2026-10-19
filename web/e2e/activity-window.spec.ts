import { expect, Frame, Page, test } from '@playwright/test';
import { createServer, pageErrors, registerUser, User } from './helpers';
import { openNav } from './ui-helpers';

// Окно игры «Активностей» (web/src/components/Activities.tsx): в окне / на весь экран / свёрнуто.
// Свёрнутая игра не перезагружается (тот же iframe и тот же документ), звонок при этом работает.

const layer = (p: Page) => p.locator('.act-layer');
const gameFrame = (p: Page): Frame => p.frames().find((f) => f.url().includes('/activities/'))!;

async function openActivity(u: User) {
  await createServer(u, 'Игровой сервер');
  await openNav(u.page);
  await u.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(u.page.locator('.voice-bar')).toContainText('Голос подключён');
  await u.page.locator('.stage-btn[aria-label="Активности"]').click();
  await u.page.locator('.act-card', { hasText: 'Хук-дуэль' }).click();
  await expect(layer(u.page)).toBeVisible();
  await expect.poll(() => !!gameFrame(u.page)).toBe(true);
  // Метка внутри документа игры: если фрейм перезагрузится, она пропадёт
  await expect.poll(() => gameFrame(u.page).evaluate(() => document.readyState)).toBe('complete');
  await gameFrame(u.page).evaluate(() => ((window as unknown as { __keep: number }).__keep = 42));
}

const keep = (p: Page) => gameFrame(p).evaluate(() => (window as unknown as { __keep?: number }).__keep ?? 0);

test('activity window: minimize keeps the game alive, call works, restore, fullscreen and back', async ({ browser }) => {
  const a = await registerUser(browser, 'Игрок');
  await openActivity(a);
  await expect(layer(a.page)).toHaveAttribute('data-view', 'window');

  // Свернуть: окно спрятано, плашка видна, нажатия проходят в приложение
  await a.page.getByRole('button', { name: 'Свернуть игру' }).click();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'min');
  const pill = a.page.locator('.act-mini');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Хук-дуэль');
  await expect(pill).toContainText('идёт игра');
  await a.page.locator('.stage-btn[aria-label="Выключить звук"]').click();
  await expect(a.page.locator('.stage-btn[aria-label="Включить звук"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await keep(a.page)).toBe(42);

  // Развернуть: окно в прежнем состоянии, игра та же (не перезагружена), фокус в игре
  await pill.click();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'window');
  await expect(pill).toHaveCount(0);
  expect(await keep(a.page)).toBe(42);
  await expect.poll(() => a.page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

  // На весь экран и обратно (кнопкой и двойным кликом по заголовку)
  await a.page.getByRole('button', { name: 'На весь экран' }).click();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'full');
  await a.page.getByRole('button', { name: 'В окно' }).click();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'window');
  await a.page.locator('.act-head strong').dblclick();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'full');
  expect(await keep(a.page)).toBe(42);

  // Выбор запоминается на устройстве
  expect(await a.page.evaluate(() => localStorage.getItem('vicinity.activity.view'))).toBe('full');

  await a.page.getByRole('button', { name: 'Выйти из игры' }).click();
  await expect(layer(a.page)).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});

test('activity window on a phone opens maximized right away', async ({ browser }) => {
  const a = await registerUser(browser, 'Телефон', { viewport: { width: 390, height: 844 } });
  await openActivity(a);
  await expect(layer(a.page)).toHaveAttribute('data-view', 'full');
  await a.page.getByRole('button', { name: 'Свернуть игру' }).click();
  await expect(a.page.locator('.act-mini')).toBeVisible();
  await a.page.locator('.act-mini').click();
  await expect(layer(a.page)).toHaveAttribute('data-view', 'full');
  expect(await keep(a.page)).toBe(42);
  expect(pageErrors(a.page)).toEqual([]);
});
