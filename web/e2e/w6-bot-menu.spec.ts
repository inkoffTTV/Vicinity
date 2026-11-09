import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { apiUser } from './w1-helpers';
import { bot, createBot, dmWith, shot, waitUpdate } from './w6-helpers';

// Интерактивное меню бота (SPEC2 §1): нажатие → бот правит то же сообщение (editMessageText / editMessageReplyMarkup) →
// кнопки меняются без перезагрузки, ожидание снимается правкой даже без answerCallbackQuery, фокус остаётся в меню.
test('bot menu: submenu and back via message edits, waiting cleared by the edit, keyboard focus kept', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const a = await registerUser(browser, 'Алиса');
  const errors = pageErrors(a.page);
  const alice = await apiUser(request, a);
  const menuBot = await createBot(request, alice, 'Меню');
  const ch = await dmWith(request, alice, menuBot);

  const main = { inline_keyboard: [[{ text: 'Настройки', callback_data: 'settings' }], [{ text: 'Помощь', callback_data: 'help' }]] };
  const settings = {
    inline_keyboard: [
      [{ text: 'Звук', callback_data: 'sound' }, { text: 'Тема', callback_data: 'theme' }],
      [{ text: 'Язык', callback_data: 'lang' }],
      [{ text: '« Назад', callback_data: 'back' }],
    ],
  };
  const sent = await bot(request, menuBot.token, 'sendMessage', { chat_id: ch, text: 'Главное меню', reply_markup: main });

  await a.page.goto(`/channels/@me/${ch}`);
  // Одно и то же сообщение на всём пути: текст меняется, data-mid — нет
  const message = a.page.locator(`.msg[data-mid="${sent.message_id}"]`);
  const kb = message.locator('.bot-keyboard');
  await expect(message.locator('.msg-text')).toHaveText('Главное меню');
  await expect(kb.locator('.bot-kb-btn')).toHaveCount(2);
  // Метка на window: перезагрузка страницы её бы стёрла
  await a.page.evaluate(() => ((window as any).__noReload = true));
  const focusInMenu = () => a.page.evaluate(() => !!document.activeElement?.closest('.bot-keyboard') && document.activeElement?.classList.contains('bot-kb-btn'));

  // ── Меню → «Настройки» с клавиатуры; бот только правит сообщение и не отвечает на нажатие ──
  await kb.getByRole('button', { name: 'Настройки' }).focus();
  await a.page.keyboard.press('Enter');
  await expect(kb.getByRole('button', { name: 'Настройки' })).toHaveAttribute('aria-busy', 'true');
  const q1 = await waitUpdate(request, menuBot.token, (u) => u.callback_query?.data === 'settings');
  expect(q1.callback_query.message.message_id).toBe(sent.message_id);
  await bot(request, menuBot.token, 'editMessageText', { chat_id: ch, message_id: sent.message_id, text: 'Настройки', reply_markup: settings });

  const edited = message;
  await expect(message.locator('.msg-text')).toContainText('Настройки');
  await expect(edited.locator('.bot-kb-btn')).toHaveText(['Звук', 'Тема', 'Язык', '« Назад']);
  // Ожидание снято правкой, хотя answerCallbackQuery не было (таймаут ответа — 10 с, проверяем сразу)
  await expect(edited.locator('.bot-kb-btn[aria-busy="true"], .bot-kb-btn.waiting')).toHaveCount(0, { timeout: 2000 });
  expect(await focusInMenu()).toBe(true);
  // Короткий текст не сужает меню: ряд из двух кнопок остаётся рядом, как задал бот (и на телефоне)
  const sameRow = async () => {
    const [x, y] = await Promise.all(['Звук', 'Тема'].map((t) => edited.getByRole('button', { name: t }).boundingBox()));
    return Math.abs(x!.y - y!.y) < 2;
  };
  expect(await sameRow()).toBe(true);
  await shot(a.page, 'menu-desktop');
  await a.page.setViewportSize({ width: 390, height: 844 });
  expect(await sameRow()).toBe(true);
  await shot(a.page, 'menu-390');
  await a.page.setViewportSize({ width: 1280, height: 800 });

  // ── «« Назад» (кнопки в 4-й строке больше не будет) → бот возвращает главное меню и отвечает уже после правки ──
  await edited.getByRole('button', { name: '« Назад' }).focus();
  await a.page.keyboard.press('Enter');
  const q2 = await waitUpdate(request, menuBot.token, (u) => u.callback_query?.data === 'back');
  await bot(request, menuBot.token, 'editMessageText', { chat_id: ch, message_id: sent.message_id, text: 'Главное меню', reply_markup: main });
  await expect(kb.locator('.bot-kb-btn')).toHaveText(['Настройки', 'Помощь']);
  await expect(kb.locator('.bot-kb-btn.waiting')).toHaveCount(0, { timeout: 2000 });
  // Кнопка, на которой был фокус, исчезла — фокус остался в меню, а не ушёл в body
  expect(await focusInMenu()).toBe(true);
  // Ответ на нажатие пришёл после правки — тост всё равно показан
  await bot(request, menuBot.token, 'answerCallbackQuery', { callback_query_id: q2.callback_query.id, text: 'Вернулись в меню' });
  await expect(a.page.locator('.toast', { hasText: 'Вернулись в меню' })).toBeVisible();

  // ── «Помощь» → только editMessageReplyMarkup: текст прежний, кнопки другие, ожидание снято ──
  await kb.getByRole('button', { name: 'Помощь' }).click();
  await waitUpdate(request, menuBot.token, (u) => u.callback_query?.data === 'help');
  await bot(request, menuBot.token, 'editMessageReplyMarkup', {
    chat_id: ch,
    message_id: sent.message_id,
    reply_markup: { inline_keyboard: [[{ text: '« Назад', callback_data: 'back' }]] },
  });
  await expect(kb.locator('.bot-kb-btn')).toHaveText(['« Назад']);
  await expect(kb.locator('.bot-kb-btn.waiting')).toHaveCount(0, { timeout: 2000 });
  await expect(message.locator('.msg-text')).toContainText('Главное меню');

  // ── «Обновить»: бот правит сообщение и присылает ту же кнопку (тот же callback_data), не отвечая на нажатие.
  // Ключ ожидания у кнопки прежний — снять его может только правка (таймаут ответа — 10 с, проверяем за 2 с) ──
  const refreshKb = { inline_keyboard: [[{ text: 'Обновить', callback_data: 'refresh' }], [{ text: '« Назад', callback_data: 'back' }]] };
  await bot(request, menuBot.token, 'editMessageReplyMarkup', { chat_id: ch, message_id: sent.message_id, reply_markup: refreshKb });
  const refresh = kb.getByRole('button', { name: 'Обновить' });
  for (const n of [1, 2]) {
    await refresh.focus();
    await a.page.keyboard.press('Enter');
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    await waitUpdate(request, menuBot.token, (u) => u.callback_query?.data === 'refresh');
    await bot(request, menuBot.token, 'editMessageText', { chat_id: ch, message_id: sent.message_id, text: `Обновлено: ${n}`, reply_markup: refreshKb });
    await expect(message.locator('.msg-text')).toContainText(`Обновлено: ${n}`);
    await expect(refresh).not.toHaveAttribute('aria-busy', 'true', { timeout: 2000 });
    await expect(kb.locator('.bot-kb-btn.waiting')).toHaveCount(0);
    expect(await focusInMenu()).toBe(true);
  }

  // ── Бот удалил сообщение, пока кнопка ждала ответа — ожидание не висит (кнопки нет вовсе) ──
  await kb.getByRole('button', { name: '« Назад' }).click();
  await waitUpdate(request, menuBot.token, (u) => u.callback_query?.data === 'back');
  await bot(request, menuBot.token, 'deleteMessage', { chat_id: ch, message_id: sent.message_id });
  await expect(message).toHaveCount(0);

  expect(await a.page.evaluate(() => (window as any).__noReload)).toBe(true);
  expect(errors).toEqual([]);
});
