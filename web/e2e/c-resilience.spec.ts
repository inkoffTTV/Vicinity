import { expect, Page, test } from '@playwright/test';
import {
  controlSocket,
  createGroup,
  createServer,
  loginAs,
  openDm,
  pageErrors,
  registerHere,
  registerUser,
  send,
  tokenOf,
  User,
} from './helpers';

const msgText = (u: User, text: string) => u.page.locator('.msg-text', { hasText: text });

/** Личка a ↔ b, открытая у обоих. */
async function openDmBothSides(a: User, b: User) {
  await openDm(a, b);
  await send(a, 'начало переписки');
  await b.page.locator('.side-item', { hasText: a.displayName }).click();
  await expect(msgText(b, 'начало переписки')).toBeVisible();
}

/** Добавить пользователя в открытую беседу через диалог «Добавить участника». */
async function addToGroup(owner: User, who: User) {
  await owner.page.getByRole('button', { name: 'Добавить участника' }).click();
  await owner.page.locator('.modal input').fill(who.username);
  await owner.page.locator(`.modal .user-row:has-text("@${who.username}")`).getByRole('button', { name: 'Добавить' }).click();
  await expect(owner.page.locator('.toast', { hasText: 'добавлен' })).toBeVisible();
}

test('reconnect catch-up: messages, groups and friend requests missed while offline show up', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);
  const sock = await controlSocket(a);
  await expect(a.page.locator('.chat-title', { hasText: 'Боб' })).toBeVisible();

  // Соединение «зависло»: всё, что происходит дальше, до Алисы не доходит
  sock.stall();
  await send(b, 'пока тебя не было');
  await createGroup(b, 'Сбор');
  await addToGroup(b, a);
  await b.page.locator('.rail-item.home').click();
  await b.page.locator('.tabs button', { hasText: 'Добавить в друзья' }).click();
  await b.page.locator('.add-friend input').fill(a.username);
  await b.page.locator(`.user-row:has-text("@${a.username}")`).getByRole('button', { name: 'В друзья' }).click();
  await expect(b.page.locator('.toast', { hasText: 'Заявка отправлена' })).toBeVisible();
  await expect(msgText(a, 'пока тебя не было')).toHaveCount(0);

  // Обрыв → переподключение → догоняем пропущенное
  await sock.drop();
  await expect.poll(() => sock.connections()).toBe(2);
  await expect(msgText(a, 'пока тебя не было')).toHaveCount(1);
  await expect(a.page.locator('.side-item', { hasText: 'Сбор' })).toBeVisible();
  await expect(a.page.locator('.side-item', { hasText: 'Друзья' }).locator('.badge')).toHaveText('1');
  await expect(a.page.locator('.user-panel')).toContainText('В сети');

  // Живые события снова доходят
  await b.page.locator('.side-item', { hasText: 'Алиса' }).click();
  await send(b, 'снова на связи');
  await expect(msgText(a, 'снова на связи')).toHaveCount(1);
  expect(pageErrors(a.page)).toEqual([]);
});

test('keepalive: a silent socket is detected by the missing pong and replaced', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);
  const sock = await controlSocket(a);

  sock.stall();
  await send(b, 'в полуоткрытое соединение');
  // Сеть «вернулась» — клиент сразу проверяет соединение ping-ом, pong не приходит
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => sock.connections(), { timeout: 20_000 }).toBe(2);
  await expect(msgText(a, 'в полуоткрытое соединение')).toHaveCount(1);
  await expect(a.page.locator('.user-panel')).toContainText('В сети');
  expect(pageErrors(a.page)).toEqual([]);
});

test('boot keeps the session while the server is unreachable and recovers', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const token = await tokenOf(a);

  // nginx отдаёт 502, пока бэкенд перезапускается
  await a.page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
  await a.page.reload();
  await expect(a.page.getByText('Нет связи с сервером')).toBeVisible();
  expect(await tokenOf(a)).toBe(token);
  await a.page.unroute('**/api/v1/auth/me');
  await a.page.getByRole('button', { name: 'Повторить сейчас' }).click();
  await expect(a.page.locator('.user-panel')).toContainText('В сети');

  // Сети нет вовсе — то же самое, вход восстанавливается сам
  await a.page.route('**/api/v1/auth/me', (route) => route.abort('internetdisconnected'));
  await a.page.reload();
  await expect(a.page.getByText('Нет связи с сервером')).toBeVisible();
  await a.page.unroute('**/api/v1/auth/me');
  await expect(a.page.locator('.user-panel')).toContainText('В сети', { timeout: 15_000 });
  expect(await tokenOf(a)).toBe(token);
  expect(pageErrors(a.page)).toEqual([]);
});

/** В интерфейсе нет ничего от прежнего пользователя. */
async function expectClean(page: Page) {
  await expect(page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();
  await expect(page.locator('.side-item', { hasText: 'Боб' })).toHaveCount(0);
  await expect(page.locator('.side-item', { hasText: 'Тайная беседа' })).toHaveCount(0);
  await expect(page.locator('.rail-item[title="Секретный сервер"]')).toHaveCount(0);
  await expect(page.locator('.badge')).toHaveCount(0);
  await expect(page.locator('.msg')).toHaveCount(0);
  await expect(page.locator('.friend-row')).toHaveCount(0);
  await expect(page).toHaveTitle('Vicinity');
}

test('expired session and logout leave nothing for the next user of the tab', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await createServer(a, 'Секретный сервер');
  await createGroup(a, 'Тайная беседа');
  await openDm(b, a);
  await send(b, 'личное для Алисы');
  await expect(a.page.locator('.side-item', { hasText: 'Боб' }).locator('.badge')).toBeVisible();
  await expect(a.page).toHaveTitle('(1) Vicinity');

  // Сессию отозвали на сервере — следующий запрос получает 401
  const r = await request.post('/api/v1/auth/logout', { headers: { Authorization: `Bearer ${await tokenOf(a)}` } });
  expect(r.ok()).toBe(true);
  await a.page.locator('.side-item', { hasText: 'Боб' }).click();
  await expect(a.page.getByText('С возвращением!')).toBeVisible();
  await expect(a.page.locator('.toast', { hasText: 'Сессия истекла' })).toBeVisible();
  expect(await a.page.evaluate(() => localStorage.getItem('vicinity.token'))).toBeNull();

  // В той же вкладке регистрируется другой человек
  await registerHere(a.page, 'Вера');
  await expectClean(a.page);

  // Обычный выход и вход прежним пользователем — его данные на месте, чужих нет
  await a.page.getByTitle('Настройки').click();
  await a.page.locator('.modal').getByRole('button', { name: 'Выйти' }).click();
  await expect(a.page.getByText('С возвращением!')).toBeVisible();
  expect(await a.page.evaluate(() => localStorage.getItem('vicinity.view'))).toBeNull();
  await loginAs(a.page, a.username);
  await expect(a.page.locator('.rail-item[title="Секретный сервер"]')).toBeVisible();
  await expect(a.page.locator('.side-item', { hasText: 'Боб' })).toBeVisible();
  await expect(a.page.locator('.user-panel')).toContainText('Алиса');

  await a.page.getByTitle('Настройки').click();
  await a.page.locator('.modal').getByRole('button', { name: 'Выйти' }).click();
  await registerHere(a.page, 'Глеб');
  await expectClean(a.page);
  await expect(a.page.locator('.user-panel')).toContainText('Глеб');
  expect(pageErrors(a.page)).toEqual([]);
});

/** Подменить видимость вкладки (headless-браузер всегда «видим»). */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test('unread counter of the open channel clears when the tab becomes visible', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);

  await setHidden(a.page, true);
  await send(b, 'пока вкладка скрыта');
  await expect(msgText(a, 'пока вкладка скрыта')).toBeVisible();
  const dm = a.page.locator('.side-item', { hasText: 'Боб' });
  await expect(dm.locator('.badge')).toHaveText('1');
  await expect(a.page).toHaveTitle('(1) Vicinity');

  await setHidden(a.page, false);
  await expect(dm.locator('.badge')).toHaveCount(0);
  await expect(a.page).toHaveTitle('Vicinity');
  expect(pageErrors(a.page)).toEqual([]);
});
