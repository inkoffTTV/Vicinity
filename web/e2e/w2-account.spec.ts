import { Browser, expect, Page, test } from '@playwright/test';
import { pageErrors, registerUser, User } from './helpers';
import { settingsTab } from './w2-helpers';

// Аккаунт и безопасность: смена пароля (другие сеансы выходят), список сеансов и их завершение.

/** Тот же пользователь в новом браузере (другое устройство) */
async function loginElsewhere(browser: Browser, username: string, password = 'password123'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  return page;
}

async function openAccount(u: User) {
  await u.page.getByTitle('Настройки').click();
  await settingsTab(u, 'Аккаунт').click();
}

const loggedOut = (page: Page) => expect(page.getByText('С возвращением!')).toBeVisible({ timeout: 30_000 });

test('change password: validation, wrong old password, other sessions are logged out', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const other = await loginElsewhere(browser, a.username);
  await openAccount(a);

  const form = a.page.locator('form', { hasText: 'Смена пароля' });
  const oldPw = form.locator('label:has-text("Текущий пароль") input');
  const newPw = form.locator('label:has-text("Новый пароль") input').first();
  const repeat = form.locator('label:has-text("Повторите") input');
  const submit = form.getByRole('button', { name: 'Сменить пароль' });

  // Подсказка о надёжности
  await newPw.fill('abc');
  await expect(form.locator('.pw-strength')).toContainText('не меньше 8 символов');
  await newPw.fill('Длинный-пароль-2026');
  await expect(form.locator('.pw-strength')).toContainText('Надёжный');

  // Несовпадение и неверный текущий пароль — ошибки в форме, ничего не меняется
  await oldPw.fill('password123');
  await repeat.fill('другой');
  await submit.click();
  await expect(form.locator('.form-error')).toHaveText('Пароли не совпадают');
  await oldPw.fill('неверный-пароль');
  await repeat.fill('Длинный-пароль-2026');
  await submit.click();
  await expect(form.locator('.form-error')).toHaveText('Неверный текущий пароль');
  await expect(a.page.locator('.user-panel')).toContainText('В сети');

  // Успех: другое устройство выходит, текущий сеанс жив, войти можно только с новым паролем
  await oldPw.fill('password123');
  await submit.click();
  await expect(a.page.locator('.toast', { hasText: 'Пароль изменён' })).toContainText('других устройствах: 1');
  await expect(oldPw).toHaveValue('');
  await loggedOut(other);
  await expect(a.page.locator('.session')).toHaveCount(1);
  await a.page.keyboard.press('Escape');
  await a.page.reload();
  await expect(a.page.locator('.user-panel')).toContainText('В сети');

  await other.locator('input[autocomplete=username]').fill(a.username);
  await other.locator('input[type=password]').fill('password123');
  await other.getByRole('button', { name: 'Войти' }).click();
  await expect(other.locator('.form-error')).toBeVisible();
  await other.locator('input[type=password]').fill('Длинный-пароль-2026');
  await other.getByRole('button', { name: 'Войти' }).click();
  await expect(other.locator('.user-panel')).toContainText('В сети');

  expect(pageErrors(a.page)).toEqual([]);
});

test('sessions: list with the current device, end one, log out everywhere else; copy login and id', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const second = await loginElsewhere(browser, a.username);
  const third = await loginElsewhere(browser, a.username);
  await openAccount(a);

  const sessions = a.page.locator('.session');
  await expect(sessions).toHaveCount(3);
  await expect(sessions.filter({ hasText: 'Это устройство' })).toHaveCount(1);
  await expect(sessions.filter({ hasText: 'Это устройство' }).getByRole('button')).toHaveCount(0);

  // Завершить один сеанс — это устройство выходит (свой сеанс самый новый, сеансы — новые первыми)
  await sessions.filter({ hasNotText: 'Это устройство' }).first().getByRole('button', { name: 'Завершить' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Сеанс завершён' })).toBeVisible();
  await expect(sessions).toHaveCount(2);
  const stillIn = async (p: Page) => {
    await p.reload();
    return p.locator('.user-panel').or(p.getByText('С возвращением!')).first().evaluate((el) => el.classList.contains('user-panel'));
  };
  const alive = [await stillIn(second), await stillIn(third)];
  expect(alive.filter(Boolean)).toHaveLength(1);

  // Выйти на других устройствах — остался только текущий сеанс
  await a.page.getByRole('button', { name: 'Выйти на других устройствах' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Выполнен выход на других устройствах' })).toBeVisible();
  await expect(sessions).toHaveCount(1);
  await expect(a.page.getByRole('button', { name: 'Выйти на других устройствах' })).toBeDisabled();
  for (const p of [second, third]) {
    await p.reload();
    await loggedOut(p);
  }

  // Копирование логина и id
  await a.page.getByRole('button', { name: 'Копировать @логин' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Логин скопирован' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Копировать ID' }).click();
  await expect(a.page.locator('.toast', { hasText: 'ID скопирован' })).toBeVisible();
  await expect(a.page.locator('.account-card')).toContainText(`@${a.username}`);

  expect(pageErrors(a.page)).toEqual([]);
});
