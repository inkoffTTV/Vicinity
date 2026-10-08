import { expect, test } from '@playwright/test';
import { pageErrors, registerUser, send } from './helpers';
import { composer, dmBothSides, msg, msgText } from './w1-helpers';

test('emoji picker: search in Russian and English, insert at the caret, recently used; reactions from the full picker show who reacted', async ({
  browser,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await dmBothSides(a, b);

  // Вставка туда, где курсор
  await composer(a).fill('Привет мир');
  await composer(a).press('End');
  for (let i = 0; i < 4; i++) await composer(a).press('ArrowLeft');
  const button = a.page.getByRole('button', { name: 'Эмодзи' });
  await button.click();
  const panel = a.page.locator('.emoji-panel');
  await expect(panel).toBeVisible();
  const search = panel.getByRole('textbox', { name: 'Найти эмодзи' });
  await expect(search).toBeFocused();
  await search.fill('огонь');
  await expect(panel.locator('.emoji-cell').first()).toHaveText('🔥');
  await panel.locator('.emoji-cell[data-emoji="🔥"]').click();
  await expect(composer(a)).toHaveValue('Привет🔥 мир');
  // Палитра поля ввода остаётся открытой — можно выбрать ещё
  await search.fill('heart');
  await panel.locator('.emoji-cell[data-emoji="❤️"]').click();
  await expect(composer(a)).toHaveValue('Привет🔥❤️ мир');
  await search.fill('несуществующее');
  await expect(panel.locator('.emoji-panel-empty')).toHaveText('Ничего не найдено');
  await a.page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // Недавние — первыми, в порядке использования; переживают перезагрузку
  await a.page.reload();
  await a.page.getByRole('button', { name: 'Эмодзи' }).click();
  const recent = a.page.locator('.emoji-panel section[data-section="recent"] .emoji-cell');
  await expect(recent.nth(0)).toHaveAttribute('data-emoji', '❤️');
  await expect(recent.nth(1)).toHaveAttribute('data-emoji', '🔥');
  await a.page.keyboard.press('Escape');
  await composer(a).fill('');
  await send(a, 'сообщение для реакций');

  // Реакция из полной палитры
  const target = msg(b, 'сообщение для реакций');
  await target.hover();
  await target.getByRole('button', { name: 'Реакция' }).click();
  await target.getByRole('menuitem', { name: 'Другие эмодзи' }).click();
  await b.page.locator('.emoji-panel input').fill('праздник');
  await b.page.locator('.emoji-panel .emoji-cell[data-emoji="🎉"]').click();
  await expect(b.page.locator('.emoji-panel')).toHaveCount(0);
  const reaction = msg(a, 'сообщение для реакций').locator('.reaction', { hasText: '🎉' });
  await expect(reaction).toContainText('1');

  // Вторая реакция тем же эмодзи; подсказка — кто поставил
  await reaction.click();
  await expect(reaction).toContainText('2');
  await reaction.hover();
  const tip = msg(a, 'сообщение для реакций').locator('.reaction-tip');
  await expect(tip).toContainText('Боб');
  await expect(tip).toContainText('Алиса');
  await expect(msgText(a, 'сообщение для реакций')).toBeVisible();

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
