import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, send } from './helpers';
import { apiUser, call, dmBothSides, msg, msgText, openChannelId } from './w1-helpers';

test('pins in a DM: pin and unpin from both sides, live updates, panel jumps to the message', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const dm = await dmBothSides(a, b);
  await send(b, 'важное сообщение');
  await send(a, 'просто болтовня');
  await expect(msgText(a, 'важное сообщение')).toBeVisible();

  // Пустой список
  await b.page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  const panel = b.page.locator('.pins-panel');
  await expect(panel).toContainText('В этом канале пока ничего не закреплено');
  await b.page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Алиса закрепляет — метка у обоих сразу
  const important = msg(a, 'важное сообщение');
  await important.hover();
  await important.getByRole('button', { name: 'Закрепить' }).click();
  await expect(important.locator('.msg-pin-flag')).toBeVisible();
  await expect(msg(b, 'важное сообщение').locator('.msg-pin-flag')).toBeVisible();

  // Панель у Боба: сообщение и переход к нему
  await b.page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  const item = panel.locator('.pin-item', { hasText: 'важное сообщение' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Перейти' }).click();
  await expect(panel).toHaveCount(0);
  await expect(msg(b, 'важное сообщение')).toHaveClass(/flash/);

  // Боб открепляет из панели — у Алисы метка пропадает
  await b.page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  await panel.getByRole('button', { name: /Открепить/ }).click();
  await expect(panel).toContainText('В этом канале пока ничего не закреплено');
  await expect(important.locator('.msg-pin-flag')).toHaveCount(0);
  await b.page.keyboard.press('Escape');

  // Удалённое закреплённое сообщение пропадает из закрепов (сервер сам открепляет)
  await important.hover();
  await important.getByRole('button', { name: 'Закрепить' }).click();
  await expect(msg(b, 'важное сообщение').locator('.msg-pin-flag')).toBeVisible();
  const bob = await apiUser(request, b);
  const pins = await call(request, bob, 'GET', `/channels/${dm}/pins`);
  expect(pins.body.pins.map((p: { text: string }) => p.text)).toEqual(['важное сообщение']);
  expect((await call(request, bob, 'DELETE', `/channels/${dm}/messages/${pins.body.pins[0].id}`)).status).toBe(200);
  await a.page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  await expect(a.page.locator('.pins-panel')).toContainText('В этом канале пока ничего не закреплено');

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('pins on a server: only the owner pins and unpins, members see the list', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Закрепы');
  await joinServer(b, code, 'Закрепы');
  await send(b, 'правила сервера');
  await expect(msgText(a, 'правила сервера')).toBeVisible();
  expect(await openChannelId(a)).toBe(await openChannelId(b));

  // Участник не может закреплять
  const own = msg(b, 'правила сервера');
  await own.hover();
  await expect(own.getByRole('button', { name: 'Ответить' })).toBeVisible();
  await expect(own.getByRole('button', { name: 'Закрепить' })).toHaveCount(0);

  // Владелец закрепляет; участник видит в панели, но без кнопки «Открепить»
  const forOwner = msg(a, 'правила сервера');
  await forOwner.hover();
  await forOwner.getByRole('button', { name: 'Закрепить' }).click();
  await expect(own.locator('.msg-pin-flag')).toBeVisible();
  await b.page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  const item = b.page.locator('.pins-panel .pin-item', { hasText: 'правила сервера' });
  await expect(item).toBeVisible();
  await expect(item.getByRole('button', { name: /Открепить/ })).toHaveCount(0);
  await expect(b.page.locator('.pins-panel')).toContainText('Боб');
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
