import { expect, test } from '@playwright/test';
import { createGroup, createServer, makeFriends, openDm, pageErrors, registerHere, registerUser, send } from './helpers';
import { openServerSettings } from './w2-helpers';

// Адреса экранов: /channels/@me, /channels/@me/<id>, /channels/<server>/<channel>, /invite/<код>.

const path = (url: string) => new URL(url).pathname;

test('addresses follow the open screen; reload restores it; back and forward work', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  const page = a.page;
  await expect(page).toHaveURL(/\/channels\/@me$/);

  await openDm(a, b);
  await send(a, 'привет из лички');
  const dmPath = path(page.url());
  expect(dmPath).toMatch(/^\/channels\/@me\/\d+$/);

  await createGroup(a, 'Адресная беседа');
  const groupPath = path(page.url());
  expect(groupPath).toMatch(/^\/channels\/@me\/\d+$/);
  expect(groupPath).not.toBe(dmPath);

  await createServer(a, 'Адресный сервер');
  await expect(page).toHaveURL(/\/channels\/\d+\/\d+$/);
  const serverPath = path(page.url());

  // Прямая ссылка в новой вкладке того же браузера — сразу нужный экран
  const tab = await a.context.newPage();
  await tab.goto(dmPath);
  await expect(tab.locator('.msg-text', { hasText: 'привет из лички' })).toBeVisible();
  await expect(tab.locator('.chat-title', { hasText: 'Боб' })).toBeVisible();
  await tab.close();

  // Перезагрузка — тот же канал сервера
  await page.reload();
  await expect(page.locator('.side-head', { hasText: 'Адресный сервер' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${serverPath}$`));

  // Назад: беседа, «Друзья» (оттуда её создавали), личка; вперёд — снова «Друзья» и беседа
  await page.goBack();
  await expect(page.locator('.chat-title', { hasText: 'Адресная беседа' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${groupPath}$`));
  await page.goBack();
  await expect(page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.chat-title', { hasText: 'Боб' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${dmPath}$`));
  await page.goForward();
  await page.goForward();
  await expect(page.locator('.chat-title', { hasText: 'Адресная беседа' })).toBeVisible();

  // Недоступный адрес (чужой сервер) — последний открытый экран, адрес исправляется
  await page.goto('/channels/999999/1');
  await expect(page.locator('.chat-title', { hasText: 'Адресная беседа' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${groupPath}$`));

  // Выход — адрес прежнего пользователя не остаётся
  await page.getByTitle('Настройки').click();
  await page.locator('.modal').getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByText('С возвращением!')).toBeVisible();
  expect(path(page.url())).toBe('/');

  expect(pageErrors(page)).toEqual([]);
});

test('invite link: sign up from the link, see the prompt, join; a member is offered to open the server', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const code = await createServer(a, 'Клуб по ссылке');
  await openServerSettings(a, 'Пригласить людей');
  const link = await a.page.locator('.invite-link input').inputValue();
  expect(link).toMatch(new RegExp(`/invite/${code}$`));
  await a.page.keyboard.press('Escape');

  // Новый человек открывает ссылку: экран входа напоминает о приглашении
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.locator('.invite-hint')).toContainText(code);
  await registerHere(page, 'Гость');
  const card = page.locator('.invite-card');
  await expect(card).toContainText('Вас пригласили на сервер');
  await expect(card).toContainText(code);
  expect(path(page.url())).toBe('/channels/@me');

  // «Не сейчас» закрывает, «назад» к ссылке снова предлагает
  await card.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(card).toHaveCount(0);
  await page.goto(link);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(page.locator('.side-head', { hasText: 'Клуб по ссылке' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Вы вступили на сервер «Клуб по ссылке»' })).toBeVisible();
  await expect(page).toHaveURL(/\/channels\/\d+\/\d+$/);
  await expect(a.page.locator('.members .member', { hasText: 'Гость' })).toBeVisible();

  // Участник открывает ссылку ещё раз — предложение открыть сервер
  await page.goto(link);
  await expect(card).toContainText('Вы уже участник сервера');
  await expect(card).toContainText('Клуб по ссылке');
  await card.getByRole('button', { name: 'Открыть сервер' }).click();
  await expect(page.locator('.side-head', { hasText: 'Клуб по ссылке' })).toBeVisible();

  // Устаревший код
  await page.goto('/invite/ZZZZZZ');
  await card.getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(card.locator('.form-error')).toContainText('недействительно');

  expect(pageErrors(page)).toEqual([]);
  await context.close();
});
