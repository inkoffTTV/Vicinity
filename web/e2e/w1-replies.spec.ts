import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, send } from './helpers';
import { apiUser, call, composer, msg, msgText, openChannelId, post } from './w1-helpers';

test('reply: bar with Esc, quote jumps to the original (loaded and via around=), deleted original', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Ответы');
  await joinServer(b, code, 'Ответы');
  await send(b, 'исходное от Боба');
  await expect(msgText(a, 'исходное от Боба')).toBeVisible();

  // «Ответить» показывает плашку над полем ввода; Esc её убирает
  const original = msg(a, 'исходное от Боба');
  await original.hover();
  await original.getByRole('button', { name: 'Ответить' }).click();
  await expect(a.page.locator('.reply-bar')).toContainText('Ответ пользователю Боб');
  await expect(composer(a)).toBeFocused();
  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('.reply-bar')).toHaveCount(0);

  // Ответ уходит с цитатой; у собеседника — тоже
  await original.hover();
  await original.getByRole('button', { name: 'Ответить' }).click();
  await composer(a).fill('мой ответ');
  await composer(a).press('Enter');
  await expect(a.page.locator('.reply-bar')).toHaveCount(0);
  const reply = msg(b, 'мой ответ');
  await expect(reply.locator('.reply-quote')).toContainText('Боб');
  await expect(reply.locator('.reply-quote')).toContainText('исходное от Боба');

  // Щелчок по цитате — переход к исходному с подсветкой
  await reply.locator('.reply-quote').click();
  await expect(msg(b, 'исходное от Боба').first()).toHaveClass(/flash/);

  // Исходное далеко в истории (не загружено): переход подгружает историю вокруг него
  const channelId = await openChannelId(a);
  const alice = await apiUser(request, a);
  const bob = await apiUser(request, b);
  const old = await post(request, alice, channelId, 'старое сообщение для перехода');
  for (let i = 0; i < 60; i++) await post(request, i % 2 ? alice : bob, channelId, `наполнитель ${i}`);
  await post(request, bob, channelId, 'ответ на старое', { reply_to: old });
  await expect(msgText(b, 'ответ на старое')).toBeVisible();
  await b.page.reload();
  await expect(msgText(b, 'ответ на старое')).toBeVisible();
  await expect(msgText(b, 'старое сообщение для перехода')).toHaveCount(0);
  await msg(b, 'ответ на старое').locator('.reply-quote').click();
  const target = b.page.locator(`.msg[data-mid="${old}"]`);
  await expect(target).toHaveClass(/flash/);
  await expect(target).toBeInViewport();

  // Окно старой истории: кнопка возврата к последним сообщениям
  const back = b.page.locator('.jump-present');
  await expect(back).toBeVisible();
  await back.getByRole('button', { name: /Перейти к последним/ }).click();
  await expect(msg(b, 'ответ на старое')).toBeInViewport();
  await expect(back).toHaveCount(0);

  // Исходное удалили — в ответе вместо цитаты пометка
  expect((await call(request, alice, 'DELETE', `/channels/${channelId}/messages/${old}`)).status).toBe(200);
  await expect(msg(b, 'ответ на старое').locator('.reply-quote.deleted')).toContainText('Исходное сообщение удалено');
  await b.page.reload();
  await expect(msg(b, 'ответ на старое').locator('.reply-quote.deleted')).toBeVisible();

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
