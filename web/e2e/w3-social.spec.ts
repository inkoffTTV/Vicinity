import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFriends, openDm, pageErrors, registerUser, send } from './helpers';
import { apiRegister, apiUser, call, msg } from './w1-helpers';
import { settingsTab } from './w2-helpers';

const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);

/** Сделать пользователя администратором прямо в базе e2e-сервера */
async function makeDeveloper(username: string) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = readFileSync(join(tmpdir(), `vicinity-e2e-${port}.dir`), 'utf8').trim();
  const db = new DatabaseSync(join(dir, 'vicinity.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE users SET developer = 1 WHERE username = ?').run(username);
  } finally {
    db.close();
  }
}

// ── Приватность (docs/API.md §15) ──

test('privacy: status hidden from strangers, DM only from friends, friend requests off', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const alice = await apiUser(request, a);
  const stranger = await apiRegister(request, 'Чужой');

  // Статус только друзьям: друг Боб видит «в сети», чужой — «не в сети»
  await makeFriends(a, b);
  expect((await call(request, alice, 'PATCH', '/settings/privacy', { status: 'friends' })).body.status).toBe('friends');
  const bob = await apiUser(request, b);
  const seenByBob = await call(request, bob, 'GET', `/users/${alice.id}/profile`);
  expect(seenByBob.body.presence).toBe('online');
  const seenByStranger = await call(request, stranger, 'GET', `/users/${alice.id}/profile?username=${a.username}`);
  expect([200, 404]).toContain(seenByStranger.status);
  if (seenByStranger.status === 200) expect(seenByStranger.body.presence).toBe('offline');

  // Личка только от друзей: чужой не может открыть, Боб может
  await call(request, alice, 'PATCH', '/settings/privacy', { dm: 'friends' });
  const dmStranger = await call(request, stranger, 'POST', '/dms', { user_id: alice.id, username: a.username });
  expect(dmStranger.status).toBe(403);
  expect(dmStranger.body.error ?? dmStranger.body.message ?? JSON.stringify(dmStranger.body)).toContain('только от друзей');
  expect((await call(request, bob, 'POST', '/dms', { user_id: alice.id })).status).toBeLessThan(300);

  // Заявки никому
  await call(request, alice, 'PATCH', '/settings/privacy', { friend_requests: 'nobody' });
  const req = await call(request, stranger, 'POST', '/friends/request', { user_id: alice.id, username: a.username });
  expect(req.status).toBe(403);
  // Некорректное значение — 400
  expect((await call(request, alice, 'PATCH', '/settings/privacy', { dm: 'nobody' })).status).toBe(400);

  // Экран настроек показывает сохранённое
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'Приватность').click();
  await expect(a.page.getByLabel(/Кто может написать мне в личку/)).toHaveValue('friends');
  await a.page.getByLabel(/Кто может отправить заявку/).selectOption('everyone');
  await expect.poll(async () => (await call(request, alice, 'GET', '/settings/privacy')).body.friend_requests).toBe('everyone');
  expect(pageErrors(a.page)).toEqual([]);
});

// ── Уровень, награды, титул (§16) ──

test('activity: messages give xp, first message earns a title, equipped title and emblem appear in profile and messages', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await openDm(a, b);
  await openDm(b, a);
  await send(a, 'первое сообщение');
  await expect(a.page.locator('.toast', { hasText: 'Новый титул: Новичок' })).toBeVisible();
  const alice = await apiUser(request, a);
  const me = (await call(request, alice, 'GET', '/activity/me')).body;
  expect(me.activity.msgs).toBe(1);
  expect(me.activity.xp).toBe(2);
  expect(me.activity.level).toBe(1);
  expect(me.activity.streak).toBe(1);
  expect(me.activity.awards.map((x: { id: string }) => x.id)).toEqual(['novice']);
  expect(me.catalog.length).toBeGreaterThan(10);

  // Надеть незаработанное нельзя
  expect((await call(request, alice, 'POST', '/activity/equip', { title: 'legend', emblem: '' })).status).toBe(400);
  // Эмблему за уровень 5 выдаём, подняв опыт в базе через сам сервер нельзя — проверяем через титул
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'Уровень и награды').click();
  await expect(a.page.getByTestId('level')).toContainText('1');
  const tile = a.page.getByRole('button', { name: /Новичок/ });
  await expect(tile).toBeEnabled();
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.locator('.award-tile', { has: a.page.locator('.award-name', { hasText: /^Легенда$/ }) })).toBeDisabled();
  // Таблица друзей: двое
  await expect(a.page.locator('.lvl-board li')).toHaveCount(2);
  await a.page.keyboard.press('Escape');

  // Титул в карточке у Боба и в его профиле Алисы
  await b.page.locator('.msg-author', { hasText: 'Алиса' }).first().click();
  await expect(b.page.locator('.pcard-title')).toHaveText('Новичок');
  await b.page.getByRole('tab', { name: 'Активность' }).click();
  await expect(b.page.locator('.pact')).toContainText('Уровень 1');
  await expect(b.page.locator('.award-chip', { hasText: 'Новичок' })).toBeVisible();
  await b.page.keyboard.press('Escape');

  // Скрытая статистика: уровень виден, счётчики — нет
  await call(request, alice, 'PATCH', '/settings/privacy', { stats: 'nobody' });
  const bob = await apiUser(request, b);
  const seen = (await call(request, bob, 'GET', `/users/${alice.id}/profile`)).body;
  expect(seen.activity.hidden).toBe(true);
  expect(seen.activity.level).toBe(1);
  expect(seen.activity.msgs).toBeUndefined();
  expect(msg(a, 'первое сообщение')).toBeTruthy();
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

// ── Подарочные коды (§17) ──

test('gift codes: admin creates, user redeems by link, tier and expiry change, code is single-use', async ({ browser, request }) => {
  const admin = await registerUser(browser, 'Админ');
  await makeDeveloper(admin.username);
  const a = await registerUser(browser, 'Алиса');
  const adm = await apiUser(request, admin);
  const alice = await apiUser(request, a);

  expect((await call(request, alice, 'POST', '/admin/gifts', { tier: 2, days: 30, count: 1 })).status).toBe(403);
  const created = await call(request, adm, 'POST', '/admin/gifts', { tier: 2, days: 30, count: 2, note: 'тест' });
  expect(created.status).toBe(200);
  const [code, second] = created.body.codes.map((c: { code: string }) => c.code);
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // Что внутри — видно до активации
  const info = (await call(request, alice, 'GET', `/gifts/${code}`)).body;
  expect(info).toMatchObject({ tier: 2, name: 'Standard', days: 30, redeemed: false });

  // По ссылке /gift/КОД открывается карточка; активация меняет подписку
  await a.page.goto(`/gift/${code}`);
  const card = a.page.locator('.gift-card');
  await expect(card).toContainText('Standard');
  await expect(card).toContainText('30 дн.');
  await card.getByRole('button', { name: 'Активировать' }).click();
  await expect(card).toContainText('Подписка Standard активна до');
  await expect.poll(async () => (await call(request, alice, 'GET', '/subscription')).body.tier).toBe(2);
  const sub = (await call(request, alice, 'GET', '/subscription')).body;
  expect(sub.until).toMatch(/^\d{4}-\d{2}-\d{2}/);

  // Повторно тот же код — 409; второй код того же уровня продлевает срок
  expect((await call(request, alice, 'POST', '/gifts/redeem', { code })).status).toBe(409);
  const again = await call(request, alice, 'POST', '/gifts/redeem', { code: second.toLowerCase() });
  expect(again.status).toBe(200);
  expect(again.body.until > sub.until).toBe(true);
  // Неверный формат — 400, несуществующий — 404
  expect((await call(request, alice, 'POST', '/gifts/redeem', { code: 'abc' })).status).toBe(400);
  expect((await call(request, alice, 'POST', '/gifts/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ' })).status).toBe(404);

  // Админ видит, кто активировал
  const list = (await call(request, adm, 'GET', '/admin/gifts')).body.gifts;
  expect(list.find((g: { code: string }) => g.code === code).redeemed_by_name).toBe(a.username);

  // В настройках подписки — срок и поле кода
  await a.page.keyboard.press('Escape');
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'О подписке').click();
  await expect(a.page.locator('.settings')).toContainText('Standard до');
  await expect(a.page.getByRole('textbox', { name: 'Подарочный код' })).toBeVisible();
  expect(pageErrors(a.page)).toEqual([]);
});
