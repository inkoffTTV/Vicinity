import { expect, test } from '@playwright/test';
import { registerUser, tokenOf } from './helpers';
import { settingsTab } from './w2-helpers';

// Значок из набора и логотип подключения: студия → сохранение → панель пользователя и карточка профиля
test('profile badge and connection icon', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const page = a.page;

  await page.getByTitle('Настройки').click();
  await settingsTab(a, 'Профиль').click();
  await page.getByRole('button', { name: 'Открыть редактор' }).click();
  const modal = page.locator('.profile-studio');
  await modal.getByRole('radio', { name: 'Геймер' }).click();
  await expect(modal.getByRole('radio', { name: 'Геймер' })).toHaveAttribute('aria-checked', 'true');

  await modal.getByLabel('Сервис').selectOption('steam');
  await modal.getByPlaceholder('Ник или имя').fill('alice_plays');
  await modal.locator('.studio-conn-add').getByRole('button', { name: 'Добавить' }).click();
  await expect(modal.locator('.studio-conns li', { hasText: 'alice_plays' })).toBeVisible();

  await modal.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.toast', { hasText: 'Профиль сохранён' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  // Панель пользователя снизу: значок рядом с именем
  await expect(page.locator('.user-panel-me .badge-pick[aria-label="Значок: Геймер"]')).toBeVisible();

  // Своя карточка: значок и плитка Steam с логотипом (svg), а не буквами
  await page.locator('.user-panel-me').click();
  await page.getByRole('button', { name: 'Мой профиль' }).click();
  const card = page.locator('.pcard');
  await expect(card.locator('.badge-pick', { hasText: 'Геймер' })).toBeVisible();
  await expect(card.locator('.pcard-conns li', { hasText: 'alice_plays' }).locator('.conn-tile svg')).toBeVisible();
  if (process.env.VICINITY_SHOTS_DIR) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${process.env.VICINITY_SHOTS_DIR}/badge-card.png` });
  }

  // Сервер отклоняет значок не из набора
  const token = await tokenOf(a);
  const res = await page.request.post(`http://localhost:${process.env.VICINITY_E2E_PORT ?? 18080}/api/v1/profile/extras`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { badge_pick: 'crown' },
  });
  expect(res.status()).toBe(400);
});
