import { expect, test } from '@playwright/test';
import { createGroup, makeFriends, openDm, pageErrors, pngBuffer, registerUser, send, User } from './helpers';

// Список личек и бесед: превью последнего сообщения, время, свежие сверху, непрочитанное.

const item = (u: User, name: string) => u.page.locator('.side-item', { hasText: name });
const names = (u: User, section: 'dm' | 'group') =>
  u.page
    .locator('.side-scroll > div > .side-item')
    .filter({ has: u.page.locator(section === 'dm' ? '.avatar' : '.side-icon') })
    .locator('.side-name');

test('previews with "Вы:" and author prefixes, attachment icon, live re-sort and unread styling', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const c = await registerUser(browser, 'Вера');
  await makeFriends(a, b);
  await makeFriends(a, c);

  await openDm(a, b);
  await send(a, 'Привет, Борис');
  await openDm(a, c);
  await send(a, 'Привет, Вера');

  // Своё последнее — «Вы: …»; самая свежая личка сверху; время — «сейчас»
  await expect(item(a, 'Вера').locator('.side-preview')).toHaveText('Вы: Привет, Вера');
  await expect(item(a, 'Борис').locator('.side-preview')).toHaveText('Вы: Привет, Борис');
  await expect(item(a, 'Вера').locator('.side-time')).toHaveText('сейчас');
  await expect(names(a, 'dm')).toHaveText(['Вера', 'Борис']);

  // Борис отвечает — его личка поднимается наверх, жирная, с бейджем; превью без префикса
  await item(b, 'Алиса').click();
  await b.page.locator('.composer textarea').fill('И тебе **привет**');
  await b.page.locator('.composer textarea').press('Enter');
  await expect(names(a, 'dm')).toHaveText(['Борис', 'Вера']);
  await expect(item(a, 'Борис').locator('.side-preview')).toHaveText('И тебе привет');
  await expect(item(a, 'Борис')).toHaveClass(/unread/);
  await expect(item(a, 'Борис').locator('.badge')).toHaveText('1');

  // Вложение без текста — значком
  await b.page.locator('.composer input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() });
  await b.page.locator('.composer textarea').press('Enter');
  await expect(item(a, 'Борис').locator('.side-preview')).toHaveText('🖼 Изображение');

  // Правка последнего сообщения меняет превью, удаление — показывает предыдущее
  await item(a, 'Вера').click();
  const mine = a.page.locator('.msg', { hasText: 'Привет, Вера' });
  await mine.hover();
  await mine.getByTitle('Изменить').click();
  await a.page.locator('.msg.editing textarea').fill('Привет, Вера!');
  await a.page.locator('.msg.editing textarea').press('Enter');
  await expect(item(a, 'Вера').locator('.side-preview')).toHaveText('Вы: Привет, Вера!');
  await send(a, 'лишнее');
  await expect(item(a, 'Вера').locator('.side-preview')).toHaveText('Вы: лишнее');
  a.page.once('dialog', (d) => d.accept());
  const extra = a.page.locator('.msg', { hasText: 'лишнее' });
  await extra.hover();
  await extra.getByTitle('Удалить').click();
  await expect(item(a, 'Вера').locator('.side-preview')).toHaveText('Вы: Привет, Вера!');

  // Беседа: префикс автора; новое сообщение поднимает её над другими беседами
  await createGroup(a, 'Первая');
  await createGroup(a, 'Вторая');
  await expect(names(a, 'group')).toHaveText(['Вторая', 'Первая']);
  await item(a, 'Первая').click();
  await a.page.locator('.chat-head').getByRole('button', { name: 'Добавить участника' }).click();
  await a.page.locator(`.modal .user-row:has-text("@${b.username}")`).getByRole('button', { name: 'Добавить' }).click();
  await item(b, 'Первая').click();
  await send(b, 'я тут');
  await expect(names(a, 'group')).toHaveText(['Первая', 'Вторая']);
  await expect(item(a, 'Первая').locator('.side-preview')).toHaveText('Борис: я тут');

  for (const u of [a, b, c]) expect(pageErrors(u.page)).toEqual([]);
});
