import { expect, test } from '@playwright/test';
import { createGroup, createServer, joinServer, makeFriends, openDm, pageErrors, registerHere, registerUser, send } from './helpers';
import { addTextChannel } from './w1-helpers';

// Быстрый переход (Ctrl+K), Alt+стрелки, Esc, меню пользователя, ссылки в профиле, автостатус.

test('quick switcher: fuzzy search over chats, channels and friends; keyboard only', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const c = await registerUser(browser, 'Вероника');
  await makeFriends(a, b);
  await makeFriends(a, c);
  await openDm(a, b);
  await send(a, 'привет');
  await createGroup(a, 'Командировка');
  await createServer(a, 'Работа');
  await addTextChannel(a, 'отчёты');

  const page = a.page;
  const switcher = page.locator('.modal.switcher');
  const input = switcher.getByRole('combobox');

  // Ctrl+K открывает поверх ленты (фокус в поле), Esc закрывает
  await page.locator('.composer textarea').click();
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(switcher).toHaveCount(0);

  // Нечёткий поиск: «кмнд» — «Командировка»; Enter открывает
  await page.keyboard.press('Control+k');
  await input.fill('кмнд');
  await expect(switcher.getByRole('option').first()).toContainText('Командировка');
  await page.keyboard.press('Enter');
  await expect(switcher).toHaveCount(0);
  await expect(page.locator('.chat-title', { hasText: 'Командировка' })).toBeVisible();

  // Канал сервера — по названию, подсказка — имя сервера; стрелками выбирается следующий результат
  await page.keyboard.press('Control+k');
  await input.fill('отч');
  await expect(switcher.getByRole('option').first()).toContainText('отчёты');
  await expect(switcher.getByRole('option').first()).toContainText('Работа');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-head', { hasText: 'отчёты' })).toBeVisible();

  // Друг без лички — откроется новая личка
  await page.keyboard.press('Control+k');
  await input.fill('@верон');
  const option = switcher.getByRole('option', { name: /Вероника/ });
  await expect(option).toContainText('друг');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-title', { hasText: 'Вероника' })).toBeVisible();
  await expect(page).toHaveURL(/\/channels\/@me\/\d+$/);

  // Ничего не нашлось
  await page.keyboard.press('Control+k');
  await input.fill('qqqqzzzz');
  await expect(switcher).toContainText('Ничего не найдено');
  await page.keyboard.press('Control+k');
  await expect(switcher).toHaveCount(0);

  expect(pageErrors(page)).toEqual([]);
});

test('Alt+↑/↓ walks the channel list, Alt+Shift+↓ jumps to unread, Esc closes panels', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const code = await createServer(a, 'Навигация');
  await addTextChannel(a, 'второй');
  await addTextChannel(a, 'третий');
  await joinServer(b, code, 'Навигация');
  const page = a.page;
  const title = page.locator('.chat-head');

  await page.locator('.side-item.channel', { hasText: 'общий' }).click();
  await page.locator('.composer textarea').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(title).toContainText('второй');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(title).toContainText('третий');
  // Конец списка — остаёмся на месте; стрелка вверх в поле ввода не начинает правку
  await page.keyboard.press('Alt+ArrowDown');
  await expect(title).toContainText('третий');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(title).toContainText('второй');
  await expect(page.locator('.msg.editing')).toHaveCount(0);

  // Борис пишет в «третий» — Alt+Shift+↓ переходит туда; непрочитанного больше нет — никуда
  await b.page.locator('.side-item.channel', { hasText: 'третий' }).click();
  await send(b, 'новости в третьем');
  await expect(page.locator('.side-item.channel', { hasText: 'третий' })).toHaveClass(/unread/);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(title).toContainText('третий');
  await expect(page.locator('.msg-text', { hasText: 'новости в третьем' })).toBeVisible();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(title).toContainText('третий');

  // Esc закрывает панель поиска
  await page.getByRole('searchbox', { name: 'Поиск по сообщениям' }).fill('новости');
  await page.getByRole('searchbox', { name: 'Поиск по сообщениям' }).press('Enter');
  await expect(page.locator('.search-panel')).toBeVisible();
  await page.locator('.messages').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.search-panel')).toHaveCount(0);

  expect(pageErrors(page)).toEqual([]);
});

test('role chips, user context menu, clickable mutual servers and friends in the profile', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const c = await registerUser(browser, 'Вера');
  await makeFriends(a, c);
  await makeFriends(b, c);
  // Роли раздаёт только разработчик — подставим их в ответ со списком участников
  await a.page.route(/\/api\/v1\/servers\/\d+\/members$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    for (const m of json.members) if (m.display_name === 'Борис') m.roles = [{ name: 'Модератор', color: '#e67e22' }];
    await route.fulfill({ response, json });
  });
  const code = await createServer(a, 'Общий клуб');
  await joinServer(b, code, 'Общий клуб');
  await send(b, 'привет всем');

  // Роль — меткой в списке участников и в профиле
  const page = a.page;
  await expect(page.locator('.members .member', { hasText: 'Борис' }).locator('.role-chip')).toHaveText('Модератор');
  await page.locator('.msg-author', { hasText: 'Борис' }).click();
  await expect(page.locator('.profile-card section', { hasText: 'Роли' }).locator('.role-chip')).toHaveText('Модератор');
  await page.keyboard.press('Escape');

  // Правая кнопка на авторе сообщения: профиль, написать, в друзья, копировать id
  await page.locator('.msg-author', { hasText: 'Борис' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Действия с пользователем' });
  await expect(menu.getByRole('menuitem')).toHaveText(['👤 Профиль', '💬 Написать', '📞 Позвонить', '➕ Добавить в друзья', '📋 Копировать ID']);
  await menu.getByRole('menuitem', { name: /Добавить в друзья/ }).click();
  await expect(page.locator('.toast', { hasText: 'Заявка в друзья отправлена' })).toBeVisible();
  await b.page.locator('.rail-item.home').click();
  await expect(b.page.locator('.side-item', { hasText: 'Друзья' }).locator('.badge')).toHaveText('1');

  // Меню на участнике в списке; Esc закрывает меню
  await page.locator('.members .member', { hasText: 'Борис' }).locator('.member-main').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /Добавить в друзья/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.locator('.members .member', { hasText: 'Борис' }).locator('.member-main').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /Написать/ }).click();
  await expect(page.locator('.chat-title', { hasText: 'Борис' })).toBeVisible();

  // Профиль: общие друзья и серверы — ссылки
  await page.locator('.chat-title', { hasText: 'Борис' }).click();
  const card = page.locator('.profile-card');
  await expect(card.locator('h2')).toHaveText('Борис');
  await card.locator('.profile-link', { hasText: 'Вера' }).click();
  await expect(card.locator('h2')).toHaveText('Вера');
  await page.keyboard.press('Escape');
  await page.locator('.chat-title', { hasText: 'Борис' }).click();
  await card.locator('.profile-link', { hasText: 'Общий клуб' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.side-head', { hasText: 'Общий клуб' })).toBeVisible();

  for (const u of [a, b, c]) expect(pageErrors(u.page)).toEqual([]);
});

test('auto-idle after 10 minutes without activity, back online on activity; manual statuses are kept', async ({ browser }) => {
  const b = await registerUser(browser, 'Борис');
  // Алиса — с управляемыми часами, чтобы не ждать 10 минут
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/');
  const username = await registerHere(page, 'Алиса');
  const a = { page, context, username, displayName: 'Алиса' };
  await makeFriends(a, b);
  const dot = b.page.locator('.friend-row', { hasText: 'Алиса' }).locator('.presence-dot');
  await expect(dot).toHaveClass(/p-online/);

  await page.clock.fastForward('10:30');
  await expect(dot).toHaveClass(/p-idle/);
  await expect(page.locator('.user-panel')).toContainText('Не активен');

  await page.mouse.move(200, 300);
  await page.mouse.move(260, 320);
  await expect(dot).toHaveClass(/p-online/);
  await expect(page.locator('.user-panel')).toContainText('В сети');

  // «Не беспокоить» вручную — простой его не меняет
  await page.locator('.user-panel-me').click();
  await page.locator('.dropdown button', { hasText: 'Не беспокоить' }).click();
  await expect(dot).toHaveClass(/p-dnd/);
  await page.clock.fastForward('11:00');
  await page.mouse.move(100, 100);
  await expect(page.locator('.user-panel')).toContainText('Не беспокоить');
  await expect(dot).toHaveClass(/p-dnd/);

  expect(pageErrors(page)).toEqual([]);
  await context.close();
});
