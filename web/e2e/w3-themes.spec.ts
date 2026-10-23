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

// Редактор оформления: стиль кнопок и размер шрифта во вкладке «Тема», темы сообщества (docs/API.md §18)

test('appearance: button style and font size apply to <html> and sync to the server', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'Внешний вид').click();
  const html = a.page.locator('html');
  await expect(html).toHaveAttribute('data-buttons', 'soft');
  await a.page.getByRole('radio', { name: 'Круглые' }).click();
  await expect(html).toHaveAttribute('data-buttons', 'round');
  // Кнопка стала круглой
  const radius = await a.page.locator('.settings .btn').first().evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseInt(radius)).toBeGreaterThan(100);
  await a.page.getByRole('radio', { name: 'Крупный' }).click();
  await expect(html).toHaveAttribute('data-font', 'l');
  const alice = await apiUser(request, a);
  await expect.poll(async () => (await call(request, alice, 'GET', '/settings/appearance')).body.settings.button_style).toBe('round');
  expect((await call(request, alice, 'PATCH', '/settings/appearance', { button_style: 'oval' })).status).toBe(400);
  expect(pageErrors(a.page)).toEqual([]);
});

test('community themes: Ultra publishes, Standard applies and likes, free user only previews, author deletes', async ({ browser, request }) => {
  const author = await apiRegister(request, 'Автор');
  await setTier(author.username, 3);
  const free = await apiRegister(request, 'Бесплатный');

  // Без Ultra публиковать нельзя; с Ultra — можно, с проверкой полей
  expect((await call(request, free, 'POST', '/themes/community', { name: 'Моя', colors: ['#112233', '#445566'], angle: 135, base: 'dark' })).status).toBe(403);
  expect((await call(request, author, 'POST', '/themes/community', { name: 'М', colors: ['#112233', '#445566'] })).status).toBe(400);
  expect((await call(request, author, 'POST', '/themes/community', { name: 'Плохая', colors: ['red', '#445566'] })).status).toBe(400);
  const created = await call(request, author, 'POST', '/themes/community', { name: ' Глубина ', colors: ['#10233A', '#2a1548', '#0e3a38'], angle: 160, base: 'dark' });
  expect(created.status).toBe(200);
  expect(created.body).toMatchObject({ name: 'Глубина', colors: ['#10233a', '#2a1548', '#0e3a38'], angle: 160, base: 'dark', likes: 0, liked: false, mine: true });
  const id = created.body.id as number;

  // Бесплатный: видит, но применить не может (403), только предпросмотр в интерфейсе
  const list = await call(request, free, 'GET', '/themes/community');
  expect(list.body.themes.map((t: { id: number }) => t.id)).toContain(id);
  expect(list.body.can_publish).toBe(false);
  const denied = await call(request, free, 'PATCH', '/settings/appearance', { custom_theme: { from: id } });
  expect(denied.status).toBe(403);
  expect(denied.body.required_tier).toBe(2);

  // Standard применяет через интерфейс: сохраняется custom_theme с from, градиент на <html>
  const b = await registerUser(browser, 'Боб');
  await setTier(b.username, 2);
  await b.page.reload();
  await expect(b.page.locator('.user-panel')).toContainText('В сети');
  await b.page.getByTitle('Настройки').click();
  await settingsTab(b, 'Внешний вид').click();
  const card = b.page.locator('.community-theme', { hasText: 'Глубина' });
  await expect(card).toContainText('Автор');
  await card.getByRole('button', { name: 'Тема «Глубина»' }).click();
  await expect(card).toHaveClass(/active/);
  await expect(b.page.locator('html')).toHaveAttribute('data-gradient', '');
  const bob = await apiUser(request, b);
  await expect.poll(async () => (await call(request, bob, 'GET', '/settings/appearance')).body.settings.custom_theme).toMatchObject({ from: id, colors: ['#10233a', '#2a1548', '#0e3a38'] });
  // Сердечко
  await card.getByRole('button', { name: 'Нравится' }).click();
  await expect(card.locator('.like-btn')).toContainText('1');
  await expect(card.getByRole('button', { name: 'Убрать сердечко' })).toBeVisible();
  expect((await call(request, free, 'GET', '/themes/community')).body.themes.find((t: { id: number }) => t.id === id).likes).toBe(1);
  // Подделать чужую тему нельзя: несуществующий id — 404
  expect((await call(request, bob, 'PATCH', '/settings/appearance', { custom_theme: { from: 999999 } })).status).toBe(404);

  // Удалить может только автор; после удаления тема у Боба остаётся его сохранёнными цветами
  expect((await call(request, bob, 'DELETE', `/themes/community/${id}`)).status).toBe(403);
  expect((await call(request, author, 'DELETE', `/themes/community/${id}`)).status).toBe(200);
  expect((await call(request, free, 'GET', '/themes/community')).body.themes.map((t: { id: number }) => t.id)).not.toContain(id);
  expect(pageErrors(b.page)).toEqual([]);
});
