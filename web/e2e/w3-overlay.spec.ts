import { expect, test } from '@playwright/test';
import { createServer, makeFriends, openDm, pageErrors, registerUser, send } from './helpers';

// Оверлей для игр (/overlay): отдельная страница того же аккаунта показывает участников голоса
// с индикатором речи, входящий звонок и свежие сообщения; интерфейс приложения не рисуется.

test('overlay page: voice participants, incoming call and a fresh message, nothing clickable', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await createServer(a, 'Игровой');

  const ov = await a.context.newPage();
  await ov.goto('/overlay');
  // Пусто, пока ничего не происходит, и ничего от основного интерфейса
  await expect(ov.locator('.ov')).toBeVisible();
  await expect(ov.locator('.nav, .sidebar, .user-panel')).toHaveCount(0);
  expect(await ov.evaluate(() => document.documentElement.hasAttribute('data-overlay'))).toBe(true);
  expect(await ov.evaluate(() => getComputedStyle(document.body).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  // Алиса входит в голос в основном окне — оверлей видит её в списке; поддельный микрофон пищит → «говорит»
  await a.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  const users = ov.locator('.ov-voice .ov-user');
  await expect(users).toHaveCount(1);
  await expect(users.first()).toContainText('Алиса');
  // Поддельный микрофон пищит с паузами — ловим индикатор речи на каждом кадре, а не раз в секунду
  await ov.waitForFunction(() => !!document.querySelector('.ov-user.speaking'), null, { timeout: 15_000 });

  // Сообщение от Боба в личку — плашка в оверлее
  await openDm(b, a);
  await send(b, 'Заходи в игру!');
  await expect(ov.locator('.ov-note')).toContainText('Заходи в игру!');
  await expect(ov.locator('.ov-note')).toContainText('Боб');

  // Звонок от Боба — карточка входящего звонка
  await b.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(ov.locator('.ov-call')).toContainText('Боб');
  await expect(ov.locator('.ov-call')).toContainText('Входящий звонок');
  await a.page.locator('.call-banner').getByRole('button', { name: 'Отклонить' }).click();
  await expect(ov.locator('.ov-call')).toHaveCount(0);

  // Вышла из голоса — список исчез
  await a.page.locator('.voice-bar').getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(ov.locator('.ov-voice')).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});
