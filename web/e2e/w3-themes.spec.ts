import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageErrors, registerUser } from './helpers';
import { apiRegister, apiUser, call } from './w1-helpers';
import { settingsTab } from './w2-helpers';

const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);

/** Выдать подписку прямо в базе e2e-сервера (оплаты нет — уровень ставит админ) */
async function setTier(username: string, tier: number) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = readFileSync(join(tmpdir(), `vicinity-e2e-${port}.dir`), 'utf8').trim();
  const db = new DatabaseSync(join(dir, 'vicinity.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE users SET subscription_tier = ? WHERE username = ?').run(tier, username);
  } finally {
    db.close();
  }
}

// 1×1 PNG для фона
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Внешний вид по ориентиру: вкладки Вид / Шрифт / Мастерская (docs/API.md §0.6, §18)

test('appearance: radius, scale, font and glass apply to <html> and sync to the server', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'Внешний вид').click();
  const html = a.page.locator('html');
  await expect(html).toHaveAttribute('data-radius', 'medium');
  await a.page.getByRole('radio', { name: 'Большое' }).click();
  await expect(html).toHaveAttribute('data-radius', 'large');
  const radius = await a.page.locator('.settings .btn').first().evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseInt(radius)).toBeGreaterThanOrEqual(12);
  await a.page.getByRole('radio', { name: '110%' }).click();
  await expect(html).toHaveAttribute('data-scaled', '');
  await a.page.getByRole('radio', { name: 'Не в фокусе' }).click();
  await expect(html).toHaveAttribute('data-eco-mode', 'unfocused');

  // Шрифт
  await a.page.getByRole('tab', { name: 'Шрифт' }).click();
  await a.page.getByRole('radio', { name: 'Comfortaa' }).click();
  expect(await a.page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Comfortaa');
  await a.page.getByRole('radio', { name: '18' }).click();
  expect(await a.page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('18px');
  await a.page.getByRole('radio', { name: '600' }).click();
  expect(await a.page.evaluate(() => getComputedStyle(document.body).fontWeight)).toBe('600');

  const alice = await apiUser(request, a);
  await expect
    .poll(async () => (await call(request, alice, 'GET', '/settings/appearance')).body.settings)
    .toMatchObject({ radius: 'large', scale: 110, eco: 'unfocused', font_family: 'comfortaa', font_px: 18, font_weight: 600 });
  expect((await call(request, alice, 'PATCH', '/settings/appearance', { radius: 'oval' })).status).toBe(400);
  expect((await call(request, alice, 'PATCH', '/settings/appearance', { scale: 101 })).status).toBe(400);
  expect((await call(request, alice, 'PATCH', '/settings/appearance', { background: { image: 'https://evil/x.png' } })).status).toBe(400);
  expect(pageErrors(a.page)).toEqual([]);
});

test('workshop: Ultra publishes a theme, Standard installs it, free user previews; background upload, publish, install, delete', async ({
  browser,
  request,
}) => {
  const author = await apiRegister(request, 'Автор');
  await setTier(author.username, 3);
  const free = await apiRegister(request, 'Бесплатный');

  // Тема: без Ultra нельзя; с Ultra — с проверкой полей
  expect((await call(request, free, 'POST', '/themes/community', { name: 'Моя', colors: ['#112233', '#445566'], angle: 135, base: 'dark' })).status).toBe(403);
  expect((await call(request, author, 'POST', '/themes/community', { name: 'М', colors: ['#112233', '#445566'] })).status).toBe(400);
  const created = await call(request, author, 'POST', '/themes/community', { name: ' Глубина ', colors: ['#10233A', '#2a1548', '#0e3a38'], angle: 160, base: 'dark' });
  expect(created.status).toBe(200);
  expect(created.body).toMatchObject({ name: 'Глубина', kind: 'theme', colors: ['#10233a', '#2a1548', '#0e3a38'], likes: 0, installs: 0, mine: true });
  const id = created.body.id as number;

  // Фон: загрузка картинки (Standard+) и публикация
  const up = await request.post(`/api/v1/themes/community/upload`, {
    headers: { Authorization: `Bearer ${author.token}` },
    multipart: { file: { name: 'bg.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(up.ok()).toBe(true);
  const image = (await up.json()).file_url as string;
  expect(image).toMatch(/^\/uploads\/backgrounds\//);
  expect((await call(request, free, 'POST', '/themes/community', { name: 'Ночь', kind: 'background', image, colors: [] })).status).toBe(403);
  expect((await call(request, author, 'POST', '/themes/community', { name: 'Ночь', kind: 'background', colors: [] })).status).toBe(400);
  const bg = await call(request, author, 'POST', '/themes/community', { name: 'Ночь', kind: 'background', image, colors: [] });
  expect(bg.status).toBe(200);
  expect(bg.body).toMatchObject({ kind: 'background', image });
  const bgId = bg.body.id as number;

  // Бесплатный: тему применить нельзя (403), фон — можно (считается установка)
  expect((await call(request, free, 'PATCH', '/settings/appearance', { custom_theme: { from: id } })).status).toBe(403);
  expect((await call(request, author, 'PATCH', '/settings/appearance', { custom_theme: { from: bgId } })).status).toBe(400);
  const applied = await call(request, free, 'PATCH', '/settings/appearance', { background: { from: bgId } });
  expect(applied.status).toBe(200);
  expect(applied.body.settings.background).toEqual({ image, from: bgId });
  const list = (await call(request, free, 'GET', '/themes/community?kind=background')).body;
  expect(list.themes.find((t: { id: number }) => t.id === bgId).installs).toBe(1);
  expect(list.themes.some((t: { id: number }) => t.id === id)).toBe(false);

  // Standard в интерфейсе: Мастерская, установка темы и фона, сердечко
  const b = await registerUser(browser, 'Боб');
  await setTier(b.username, 2);
  await b.page.reload();
  await expect(b.page.locator('.user-panel')).toContainText('В сети');
  await b.page.getByTitle('Настройки').click();
  await settingsTab(b, 'Внешний вид').click();
  await b.page.getByRole('tab', { name: 'Мастерская' }).click();
  const card = b.page.locator('.ws-card', { hasText: 'Глубина' });
  await expect(card).toContainText('@Автор');
  await card.getByRole('button', { name: 'Установить' }).click();
  await expect(card.getByRole('button', { name: 'Установлено ✓' })).toBeVisible();
  await expect(b.page.locator('html')).toHaveAttribute('data-gradient', '');
  await expect(b.page.locator('html')).toHaveAttribute('data-glass', '');
  const bob = await apiUser(request, b);
  await expect.poll(async () => (await call(request, bob, 'GET', '/settings/appearance')).body.settings.custom_theme).toMatchObject({ from: id });
  const bgCard = b.page.locator('.ws-card', { hasText: 'Ночь' });
  await bgCard.getByRole('button', { name: 'Установить' }).click();
  await expect(b.page.locator('html')).toHaveAttribute('data-bg', '');
  await expect(b.page.locator('.app-bg')).toBeVisible();
  await card.getByRole('button', { name: 'Нравится' }).click();
  await expect(card.locator('.like-btn')).toContainText('1');
  // Поиск
  await b.page.getByRole('searchbox', { name: 'Поиск в мастерской' }).fill('ноч');
  await expect(b.page.locator('.ws-card')).toHaveCount(1);

  // Удалить может только автор
  expect((await call(request, bob, 'DELETE', `/themes/community/${id}`)).status).toBe(403);
  expect((await call(request, author, 'DELETE', `/themes/community/${id}`)).status).toBe(200);
  expect((await call(request, author, 'DELETE', `/themes/community/${bgId}`)).status).toBe(200);
  expect((await call(request, free, 'GET', '/themes/community')).body.themes).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
