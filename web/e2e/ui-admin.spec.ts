import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { settingsTab } from './w2-helpers';
import { registerNamed } from './ui-helpers';

// «Написать администратору»: личка с пользователем inkoff (логин задаётся VITE_ADMIN_USERNAME при сборке).

const ADMIN = process.env.VITE_ADMIN_USERNAME || 'inkoff';

test('"write to the admin" opens the DM with inkoff; hidden for the admin himself; clear error without the account', async ({
  browser,
}) => {
  const guest = await registerUser(browser, 'Гость');
  const page = guest.page;
  const adminItem = page.locator('.side-item.admin-item');

  // Кнопка на виду — в домашней панели под «Друзья»
  await page.locator('.rail-item.home').click();
  await expect(adminItem).toBeVisible();
  await expect(adminItem).toHaveText('Написать администратору');
  await expect(adminItem.locator('svg')).toBeVisible();

  // Аккаунта администратора ещё нет — понятная ошибка, никуда не переходим
  await adminItem.click();
  await expect(page.locator('.toast.error', { hasText: `Аккаунт администратора @${ADMIN} не найден` })).toBeVisible();
  await expect(page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();

  // Администратор зарегистрировался — у него самого кнопки нет нигде
  const admin = await registerNamed(browser, ADMIN, 'Администратор');
  await admin.page.locator('.rail-item.home').click();
  await expect(admin.page.locator('.side-item', { hasText: 'Друзья' })).toBeVisible();
  await expect(admin.page.locator('.side-item.admin-item')).toHaveCount(0);
  await admin.page.locator('.user-panel-me').click();
  await expect(admin.page.locator('.dropdown.up')).toBeVisible();
  await expect(admin.page.locator('.dropdown.up button', { hasText: 'Написать администратору' })).toHaveCount(0);
  await admin.page.locator('.user-panel-me').click();
  await admin.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(admin, 'Аккаунт').click();
  await expect(admin.page.locator('.settings-main-body')).toContainText('Пароль и безопасность');
  await expect(admin.page.locator('.settings-main-body').getByRole('button', { name: 'Написать администратору' })).toHaveCount(0);
  await admin.page.keyboard.press('Escape');

  // Гость: кнопка в боковой панели открывает личку с администратором
  await adminItem.click();
  await expect(page.locator('.chat-title', { hasText: 'Администратор' })).toBeVisible();
  await expect(page).toHaveURL(/\/channels\/@me\/\d+$/);
  const dmUrl = page.url();
  await page.locator('.composer textarea').fill('Здравствуйте! Вопрос по серверу');
  await page.locator('.composer textarea').press('Enter');
  await expect(admin.page.locator('.side-item', { hasText: 'Гость' })).toBeVisible();

  // Из настроек (Аккаунт) — та же личка, окно настроек закрывается
  await page.locator('.rail-item.home').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(guest, 'Аккаунт').click();
  await page.locator('.settings-main-body').getByRole('button', { name: 'Написать администратору' }).click();
  await expect(page.locator('.modal.settings-modal')).toHaveCount(0);
  await expect(page).toHaveURL(dmUrl);

  // Из меню панели пользователя — тоже
  await page.locator('.rail-item.home').click();
  await page.locator('.user-panel-me').click();
  await page.locator('.dropdown.up button', { hasText: 'Написать администратору' }).click();
  await expect(page).toHaveURL(dmUrl);
  await expect(page.locator('.chat-title', { hasText: 'Администратор' })).toBeVisible();

  expect(pageErrors(page)).toEqual([]);
  expect(pageErrors(admin.page)).toEqual([]);
  await guest.context.close();
  await admin.context.close();
});
