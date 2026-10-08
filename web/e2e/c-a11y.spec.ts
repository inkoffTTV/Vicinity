import { expect, Page, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, send, User } from './helpers';

const msgText = (u: User, text: string) => u.page.locator('.msg-text', { hasText: text });

/** Прозрачность панели действий сообщения (0 — скрыта). */
const actionsOpacity = (msg: ReturnType<Page['locator']>) =>
  msg.locator('.msg-actions').evaluate((el) => getComputedStyle(el).opacity);

test('message actions and kick are reachable from the keyboard', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Клавиатурный');
  await joinServer(b, code, 'Клавиатурный');
  await send(b, 'сообщение Боба');
  await expect(msgText(a, 'сообщение Боба')).toBeVisible();
  await send(a, 'сообщение Алисы');
  await a.page.mouse.move(1, 1);

  // Чужое сообщение: Tab с имени автора ведёт к кнопке реакции, панель становится видимой
  const bobMsg = a.page.locator('.msg', { hasText: 'сообщение Боба' });
  expect(await actionsOpacity(bobMsg)).toBe('0');
  await bobMsg.locator('.msg-author').focus();
  await a.page.keyboard.press('Tab');
  await expect(bobMsg.getByRole('button', { name: 'Реакция' })).toBeFocused();
  expect(await actionsOpacity(bobMsg)).toBe('1');

  // Палитра открывается Enter, закрывается Esc
  await a.page.keyboard.press('Enter');
  await expect(bobMsg.locator('.emoji-picker')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(bobMsg.locator('.emoji-picker')).toHaveCount(0);
  await a.page.keyboard.press('Enter');
  await a.page.keyboard.press('Tab');
  await a.page.keyboard.press('Enter');
  await expect(bobMsg.locator('.reaction.mine')).toBeVisible();
  await expect(b.page.locator('.msg', { hasText: 'сообщение Боба' }).locator('.reaction')).toBeVisible();

  // Своё сообщение: реакция → изменить → правка с клавиатуры
  const own = a.page.locator('.msg', { hasText: 'сообщение Алисы' });
  await own.locator('.msg-author').focus();
  await a.page.keyboard.press('Tab');
  await a.page.keyboard.press('Tab');
  await expect(own.getByRole('button', { name: 'Изменить' })).toBeFocused();
  await a.page.keyboard.press('Enter');
  await expect(own.locator('.edit-box textarea')).toBeFocused();
  await a.page.keyboard.press('End');
  await a.page.keyboard.type(' (правка)');
  await a.page.keyboard.press('Enter');
  await expect(b.page.locator('.msg-text', { hasText: 'сообщение Алисы (правка)' })).toBeVisible();

  // Удаление участника владельцем: кнопка достижима Tab и видна в фокусе
  const member = a.page.locator('.members .member', { hasText: 'Боб' });
  await expect(member).toBeVisible();
  const kick = member.getByRole('button', { name: /Удалить .* с сервера/ });
  expect(await kick.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await member.locator('.member-main').focus();
  await a.page.keyboard.press('Tab');
  await expect(kick).toBeFocused();
  expect(await kick.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  a.page.once('dialog', (d) => d.accept());
  await a.page.keyboard.press('Enter');
  await expect(member).toHaveCount(0);
  await expect(b.page.locator('.toast', { hasText: 'Вас удалили с сервера' })).toBeVisible();
  await expect(b.page.locator('.side-head', { hasText: 'Клавиатурный' })).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('touch screens: inputs use 16px so iOS Safari does not zoom in', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/');
  for (const input of await page.locator('input').all()) await expect(input).toHaveCSS('font-size', '16px');
  await context.close();
});
