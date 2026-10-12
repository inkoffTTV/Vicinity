import { expect, test } from '@playwright/test';
import { createGroup, createServer, makeFriends, openDm, pageErrors, registerUser, send } from './helpers';
import { msg } from './w1-helpers';
import { settingsTab } from './w2-helpers';
import { expectNoEmojiControls } from './ui-helpers';

// Кнопки управления нарисованы SVG-значками (lucide), а не эмодзи: эмодзи остаются только
// содержимым — реакции, палитра, текст сообщений.

test('no emoji glyphs on control buttons, menus, headers and badges', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const page = a.page;
  await makeFriends(b, a);

  // Друзья: шапка, строка друга с кнопками «Написать» / «Удалить из друзей»
  await page.locator('.rail-item.home').click();
  await page.locator('.tabs button', { hasText: 'Все' }).click();
  await expect(page.locator('.friend-row', { hasText: 'Борис' })).toBeVisible();
  await expect(page.locator('.friend-row', { hasText: 'Борис' }).getByRole('button', { name: 'Написать' }).locator('svg')).toBeVisible();
  await expectNoEmojiControls(page, 'друзья');

  // Личка: шапка, поле ввода, сообщение с файлом, панель действий над сообщением
  await openDm(a, b);
  await send(a, 'сообщение для проверки значков');
  await page.locator('.composer input[type=file]').setInputFiles({ name: 'план.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.file-card', { hasText: 'план.pdf' }).locator('.file-icon svg')).toBeVisible();
  await msg(a, 'сообщение для проверки значков').hover();
  for (const name of ['Реакция', 'Изменить', 'Ответить', 'Копировать текст', 'Удалить'])
    await expect(msg(a, 'сообщение для проверки значков').getByRole('button', { name, exact: true }).locator('svg')).toBeVisible();
  await expectNoEmojiControls(page, 'личка');

  // Быстрые реакции — эмодзи (содержимое), кнопка «Другие эмодзи» — значок
  await msg(a, 'сообщение для проверки значков').getByRole('button', { name: 'Реакция' }).click();
  await expect(page.locator('.emoji-picker button', { hasText: '🔥' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Другие эмодзи' }).locator('svg')).toBeVisible();
  await expectNoEmojiControls(page, 'быстрые реакции');
  await page.locator('.emoji-picker button', { hasText: '🔥' }).click();
  await expect(msg(a, 'сообщение для проверки значков').locator('.reaction', { hasText: '🔥' })).toBeVisible();

  // Палитра эмодзи из поля ввода: разделы — значками, сетка — эмодзи
  await page.getByRole('button', { name: 'Эмодзи', exact: true }).click();
  await expect(page.locator('.emoji-panel')).toBeVisible();
  await expect(page.locator('.emoji-panel-tabs button').first().locator('svg')).toBeVisible();
  await expectNoEmojiControls(page, 'палитра');
  await page.keyboard.press('Escape');
  await expect(page.locator('.emoji-panel')).toHaveCount(0);

  // Уведомления канала и закреплённые
  await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Уведомления' })).toBeVisible();
  await expectNoEmojiControls(page, 'меню уведомлений');
  await page.getByRole('menuitemcheckbox', { name: 'Заглушить канал' }).click();
  await expect(page.locator('.chat-head .muted-bell svg')).toBeVisible();
  await page.getByRole('button', { name: 'Закреплённые сообщения' }).click();
  await expect(page.locator('.pins-panel')).toBeVisible();
  await expectNoEmojiControls(page, 'закреплённые');
  await page.keyboard.press('Escape');

  // Меню пользователя (правая кнопка) и профиль
  await page.locator('.msg-author', { hasText: 'Алиса' }).first().click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Действия с пользователем' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Профиль' }).locator('svg')).toBeVisible();
  await expectNoEmojiControls(page, 'меню пользователя');
  await page.keyboard.press('Escape');
  await page.locator('.chat-title').click();
  await expect(page.locator('.profile-view')).toBeVisible();
  await expectNoEmojiControls(page, 'профиль');
  await page.getByRole('button', { name: 'Закрыть' }).click();

  // Панель пользователя внизу слева
  await page.locator('.user-panel-me').click();
  await expect(page.locator('.dropdown.up')).toBeVisible();
  await expectNoEmojiControls(page, 'меню статуса');
  await page.locator('.user-panel-me').click();

  // Беседа: панель участников с короной владельца
  await createGroup(a, 'Значки');
  await expect(page.locator('.group-panel .owner-crown svg')).toBeVisible();
  await expectNoEmojiControls(page, 'беседа');

  // Сервер: меню сервера, каналы, участники, настройки сервера по разделам
  await createServer(a, 'Иконки');
  await page.locator('.side-head').click();
  await expect(page.locator('.dropdown')).toBeVisible();
  await expectNoEmojiControls(page, 'меню сервера');
  await page.locator('.dropdown button', { hasText: 'Настройки сервера' }).click();
  for (const tab of ['Обзор', 'Приглашения', 'Участники', 'Баны', 'Удаление сервера']) {
    await settingsTab(a, tab).click();
    await expectNoEmojiControls(page, `настройки сервера: ${tab}`);
  }
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.locator('.side-icon svg').first()).toBeVisible();
  await expectNoEmojiControls(page, 'сервер');

  // Настройки по разделам
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  for (const tab of ['Профиль', 'Аккаунт', 'Тема', 'Специальные возможности', 'Подписка', 'Уведомления', 'Голос и видео']) {
    await settingsTab(a, tab).click();
    await expect(settingsTab(a, tab).locator('svg')).toBeVisible();
    await expectNoEmojiControls(page, `настройки: ${tab}`);
  }
  await page.keyboard.press('Escape');

  // Быстрый переход
  await page.keyboard.press('Control+k');
  await expect(page.locator('.switcher')).toBeVisible();
  await expectNoEmojiControls(page, 'быстрый переход');
  await page.keyboard.press('Escape');

  expect(pageErrors(page)).toEqual([]);
  await a.context.close();
  await b.context.close();
});
