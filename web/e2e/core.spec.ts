import { expect, test } from '@playwright/test';
import { createServer, joinServer, makeFriends, pageErrors, pngBuffer, registerUser } from './helpers';

test('friends, DMs, reactions, edit, attachments, delete', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);

  // Боб пишет Алисе
  await b.page.locator(`.friend-row:has-text("Алиса")`).getByTitle('Написать').click();
  await b.page.locator('.composer textarea').fill('Привет, Алиса! https://example.com');
  await b.page.locator('.composer textarea').press('Enter');
  await expect(b.page.locator('.msg-text', { hasText: 'Привет, Алиса!' })).toBeVisible();

  // У Алисы появляется личка с бейджем непрочитанного
  const dmItem = a.page.locator('.side-item', { hasText: 'Боб' });
  await expect(dmItem.locator('.badge')).toBeVisible();
  await dmItem.click();
  await expect(a.page.locator('.msg-text', { hasText: 'Привет, Алиса!' })).toBeVisible();
  await expect(a.page.locator('.msg-text a[href="https://example.com"]')).toBeVisible();

  // Ответ доходит в реальном времени
  await a.page.locator('.composer textarea').fill('Привет, Боб');
  await a.page.locator('.composer textarea').press('Enter');
  await expect(b.page.locator('.msg-text', { hasText: 'Привет, Боб' })).toBeVisible();

  // Реакция
  const bobMsg = a.page.locator('.msg', { hasText: 'Привет, Алиса!' });
  await bobMsg.hover();
  await bobMsg.getByTitle('Реакция').click();
  await a.page.locator('.emoji-picker button', { hasText: '🔥' }).click();
  await expect(b.page.locator('.reaction', { hasText: '🔥' })).toBeVisible();

  // Редактирование последнего своего сообщения по ↑
  await a.page.locator('.composer textarea').focus();
  await a.page.keyboard.press('ArrowUp');
  await a.page.locator('.edit-box textarea').fill('Привет, Боб (исправлено)');
  await a.page.keyboard.press('Enter');
  await expect(b.page.locator('.msg-text', { hasText: 'исправлено' })).toBeVisible();

  // Картинка-вложение
  await a.page.locator('.composer input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() });
  await expect(a.page.locator('.upload-preview img')).toBeVisible();
  await a.page.locator('.composer textarea').fill('Картинка');
  await a.page.locator('.composer textarea').press('Enter');
  const img = b.page.locator('.attachment img').last();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);

  // Удаление
  a.page.on('dialog', (d) => d.accept());
  const pic = a.page.locator('.msg', { hasText: 'Картинка' });
  await pic.hover();
  await pic.getByTitle('Удалить').click();
  await expect(b.page.locator('.msg-text', { hasText: 'Картинка' })).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('servers: create, join by code, messages, presence, profile, reload, logout', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');

  const code = await createServer(a, 'Тестовый сервер');
  await joinServer(b, code, 'Тестовый сервер');
  await expect(b.page.locator('.members .member', { hasText: 'Алиса' })).toBeVisible();

  await b.page.locator('.composer textarea').fill('Всем привет на сервере');
  await b.page.locator('.composer textarea').press('Enter');
  await expect(a.page.locator('.msg-text', { hasText: 'Всем привет на сервере' })).toBeVisible();

  // Статус «Не беспокоить» виден другим
  await b.page.locator('.user-panel-me').click();
  await b.page.locator('.dropdown button', { hasText: 'Не беспокоить' }).click();
  await expect(a.page.locator('.members .member', { hasText: 'Боб' }).locator('.p-dnd')).toBeVisible();

  // Профиль
  await a.page.locator('.members .member', { hasText: 'Боб' }).locator('.member-main').click();
  await expect(a.page.locator('.profile-card h2', { hasText: 'Боб' })).toBeVisible();
  await a.page.keyboard.press('Escape');

  // Настройки: био + аватар
  await b.page.getByTitle('Настройки').click();
  await b.page.locator('label:has-text("О себе") textarea').fill('Тестовое био');
  await b.page.locator('.settings-avatar input[type=file]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: pngBuffer(64, 64) });
  await expect(b.page.locator('.toast', { hasText: 'Аватар обновлён' })).toBeVisible();
  await b.page.locator('.modal').getByRole('button', { name: 'Сохранить' }).click();
  await expect(b.page.locator('.toast', { hasText: 'Профиль сохранён' })).toBeVisible();

  // Перезагрузка сохраняет сессию и экран
  await a.page.reload();
  await expect(a.page.locator('.side-head', { hasText: 'Тестовый сервер' })).toBeVisible();

  // Выход
  await a.page.getByTitle('Настройки').click();
  await a.page.locator('.modal').getByRole('button', { name: 'Выйти' }).click();
  await expect(a.page.getByText('С возвращением!')).toBeVisible();
});

test('mobile layout has no horizontal overflow and menu opens', async ({ browser }) => {
  const m = await registerUser(browser, 'Карл', { viewport: { width: 390, height: 800 }, colorScheme: 'light' });
  await expect(m.page.locator('.menu-btn')).toBeVisible();
  expect(await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await m.page.locator('.menu-btn').click();
  await expect(m.page.locator('.app.nav-open')).toBeVisible();
});
