import { expect, test } from '@playwright/test';
import { acceptInvite, createGroup, createServer, inviteToGroup, makeFriends, pageErrors, registerUser, send } from './helpers';
import { confirmDialog } from './w2-helpers';

// Приглашения (docs/API.md §7.1): в беседу и на сервер попадают, только приняв приглашение;
// беседу можно покинуть и удалить из меню в списке; ссылки на Vicinity открываются внутри клиента.

test('invites: decline keeps you out, server invite opens the server, invitee list updates live', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);

  // Беседа: отказ — беседы у Боба нет, Алисе приходит ответ
  await createGroup(a, 'Секретная');
  await inviteToGroup(a, b);
  await b.page.locator('.rail-item.home').click();
  const inv = b.page.locator('.invite-item', { hasText: 'Секретная' });
  await expect(inv).toContainText('Беседа');
  await expect(inv).toContainText('Алиса');
  await expect(b.page.locator('.rail-item.home .badge')).toHaveText('1');
  await inv.getByRole('button', { name: 'Отклонить' }).click();
  await expect(inv).toHaveCount(0);
  await expect(b.page.locator('.side-item', { hasText: 'Секретная' })).toHaveCount(0);
  await expect(a.page.locator('.toast', { hasText: 'отклонил(а) приглашение' })).toBeVisible();

  // Сервер: приглашение из шапки канала; «Принять» открывает сервер
  await createServer(a, 'Клуб');
  await a.page.locator('.chat-head').getByRole('button', { name: 'Добавить участника' }).click();
  const row = a.page.locator(`.modal .user-row:has-text("@${b.username}")`);
  await row.getByRole('button', { name: 'Пригласить' }).click();
  await expect(row).toContainText('Отправлено');
  await a.page.keyboard.press('Escape');
  await expect(b.page.locator('.rail-item[aria-label="Клуб"], .rail-item[title="Клуб"]')).toHaveCount(0);
  await acceptInvite(b, 'Клуб');
  await expect(b.page.locator('.side-head', { hasText: 'Клуб' })).toBeVisible();

  for (const u of [a, b]) expect(pageErrors(u.page)).toEqual([]);
});

test('group context menu: leave, and delete for the owner', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await createGroup(a, 'Меню');
  await inviteToGroup(a, b, 'Меню');

  // Не владелец: в меню только «Покинуть»
  await b.page.locator('.side-item', { hasText: 'Меню' }).click({ button: 'right' });
  await expect(b.page.locator('.popover.menu').getByRole('menuitem', { name: 'Удалить беседу' })).toHaveCount(0);
  await b.page.locator('.popover.menu').getByRole('menuitem', { name: 'Покинуть беседу' }).click();
  await confirmDialog(b, 'Покинуть');
  await expect(b.page.locator('.side-item', { hasText: 'Меню' })).toHaveCount(0);
  await expect(b.page.locator('.toast', { hasText: 'Вы покинули беседу' })).toBeVisible();

  // Владелец удаляет из меню
  await a.page.locator('.side-item', { hasText: 'Меню' }).click({ button: 'right' });
  await a.page.locator('.popover.menu').getByRole('menuitem', { name: 'Удалить беседу' }).click();
  await confirmDialog(a, 'Удалить');
  await expect(a.page.locator('.side-item', { hasText: 'Меню' })).toHaveCount(0);

  for (const u of [a, b]) expect(pageErrors(u.page)).toEqual([]);
});

test('links to Vicinity open inside the client: invite link in a message and the app deep-link event', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  const code = await createServer(a, 'Ссылочный');
  await createGroup(a, 'Ссылки');
  await inviteToGroup(a, b, 'Ссылки');

  // Ссылка-приглашение в сообщении: клик открывает карточку здесь же, без новой вкладки
  await a.page.locator('.side-item', { hasText: 'Ссылки' }).click();
  await send(a, `заходи ${new URL(a.page.url()).origin}/invite/${code}`);
  await b.page.locator('.side-item', { hasText: 'Ссылки' }).click();
  const popups: unknown[] = [];
  b.page.context().on('page', (p) => popups.push(p));
  await b.page.locator('.msg-text a', { hasText: `/invite/${code}` }).click();
  await expect(b.page.locator('.invite-card')).toBeVisible();
  expect(popups).toEqual([]);
  await expect(b.page).toHaveURL(new RegExp(`/invite/${code}$`));
  await b.page.locator('.invite-card').getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(b.page.locator('.side-head', { hasText: 'Ссылочный' })).toBeVisible();

  // Приложение открыли по ссылке снаружи — событие vicinity-open переводит на экран
  await b.page.evaluate(() => window.dispatchEvent(new CustomEvent('vicinity-open', { detail: '/channels/@me' })));
  await expect(b.page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();

  for (const u of [a, b]) expect(pageErrors(u.page)).toEqual([]);
});
