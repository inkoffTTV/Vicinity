import { expect, test } from '@playwright/test';
import { createGroup, makeFriends, pageErrors, registerUser, send, User } from './helpers';
import { confirmDialog } from './w2-helpers';

// Беседы: панель участников — пригласить, переименовать, покинуть, удалить; всё видно вживую.

const panel = (u: User) => u.page.locator('.group-panel');
const members = (u: User) => panel(u).locator('.member');

/** Пригласить друга в открытую беседу из панели */
async function invite(owner: User, friend: User) {
  await panel(owner).getByRole('button', { name: 'Пригласить в беседу' }).click();
  await owner.page.locator(`.modal .user-row:has-text("@${friend.username}")`).getByRole('button', { name: 'Добавить' }).click();
}

test('group panel: invite, rename by a member, leave with ownership handover, delete by the owner', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Вера');
  await makeFriends(a, b);
  await makeFriends(a, c);
  await createGroup(a, 'Поход');

  // Панель открыта рядом с лентой; владелец отмечен короной
  await expect(panel(a)).toBeVisible();
  await expect(members(a)).toHaveCount(1);
  await expect(members(a).first()).toContainText('👑');
  await expect(panel(a).getByRole('button', { name: 'Удалить беседу' })).toBeVisible();

  // Пригласить: у приглашённого беседа появляется, у владельца растёт состав
  await invite(a, b);
  await expect(b.page.locator('.side-item', { hasText: 'Поход' })).toBeVisible();
  await expect(members(a)).toHaveCount(2);
  await b.page.locator('.side-item', { hasText: 'Поход' }).click();
  await expect(members(b)).toHaveCount(2);
  // Не владелец беседу не удаляет
  await expect(panel(b).getByRole('button', { name: 'Удалить беседу' })).toHaveCount(0);

  // Переименовать может любой участник
  await panel(b).getByRole('button', { name: 'Переименовать беседу' }).click();
  await b.page.locator('.modal input').fill('Поход в горы');
  await b.page.locator('.modal').getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.page.locator('.chat-title', { hasText: 'Поход в горы' })).toBeVisible();
  await expect(a.page.locator('.side-item', { hasText: 'Поход в горы' })).toBeVisible();
  await expect(panel(a)).toContainText('Поход в горы');

  // Новый участник появляется у всех
  await invite(a, c);
  await expect(members(b)).toHaveCount(3);

  // Владелец уходит — владельцем становится самый давний участник (Боб), у него появляется «Удалить»
  await panel(a).getByRole('button', { name: 'Покинуть беседу' }).click();
  await expect(a.page.locator('.modal').last()).toContainText('Владельцем беседы');
  await confirmDialog(a, 'Покинуть');
  await expect(a.page.locator('.side-item', { hasText: 'Поход в горы' })).toHaveCount(0);
  await expect(a.page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();
  await expect(a.page.locator('.toast', { hasText: 'Вы покинули беседу' })).toBeVisible();
  await expect(a.page.locator('.toast', { hasText: 'больше недоступна' })).toHaveCount(0);
  await expect(members(b)).toHaveCount(2);
  await expect(members(b).filter({ hasText: 'Боб' })).toContainText('👑');
  await expect(panel(b).getByRole('button', { name: 'Удалить беседу' })).toBeVisible();

  // Новый владелец удаляет беседу — у Веры она пропадает
  await c.page.locator('.side-item', { hasText: 'Поход в горы' }).click();
  await expect(members(c)).toHaveCount(2);
  await panel(b).getByRole('button', { name: 'Удалить беседу' }).click();
  await confirmDialog(b, 'Удалить');
  await expect(b.page.locator('.side-item', { hasText: 'Поход в горы' })).toHaveCount(0);
  await expect(c.page.locator('.side-item', { hasText: 'Поход в горы' })).toHaveCount(0);
  await expect(c.page.locator('.toast', { hasText: 'больше недоступна' })).toBeVisible();

  for (const u of [a, b, c]) expect(pageErrors(u.page)).toEqual([]);
});

test('the members button toggles the group panel', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  await createGroup(a, 'Заметки');
  await send(a, 'для себя');
  const toggle = a.page.locator('.chat-head').getByRole('button', { name: 'Участники' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(panel(a)).toHaveCount(0);
  await toggle.click();
  await expect(panel(a)).toBeVisible();
  expect(pageErrors(a.page)).toEqual([]);
});
