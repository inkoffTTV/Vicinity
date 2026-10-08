import { expect, test } from '@playwright/test';
import { createGroup, pageErrors, registerUser, send } from './helpers';
import { settingsTab } from './w2-helpers';

// Внешний вид: тема, акцент, компактный режим, размер шрифта, анимации — сохраняются в браузере.

test('theme, accent, compact mode, font size and reduced motion persist across reloads', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса', { colorScheme: 'dark' });
  await createGroup(a, 'Оформление');
  await send(a, 'пример текста');
  const page = a.page;
  const root = page.locator('html');
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const cssVar = (name: string) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  // Система тёмная, «как в системе» — тёмная тема без атрибута
  await expect(root).not.toHaveAttribute('data-theme');
  expect(await bodyBg()).toBe('rgb(49, 51, 56)');

  await page.getByTitle('Настройки').click();
  await settingsTab(a, 'Внешний вид').click();
  await page.getByRole('radio', { name: 'Светлая' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await bodyBg()).toBe('rgb(255, 255, 255)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e3e5e8');

  await page.getByRole('button', { name: 'Цвет #eb459e' }).click();
  expect(await cssVar('--accent')).toBe('#eb459e');
  await page.getByRole('switch', { name: /Компактный режим/ }).check();
  await expect(root).toHaveAttribute('data-compact', '');
  await page.getByRole('radio', { name: 'Крупный' }).click();
  await page.getByRole('switch', { name: /Уменьшить анимацию/ }).check();
  await expect(root).toHaveAttribute('data-reduced-motion', '');
  await page.keyboard.press('Escape');

  const text = page.locator('.msg-text', { hasText: 'пример текста' });
  await expect(text).toHaveCSS('font-size', '17px');
  await expect(page.locator('.msg-gutter .avatar').first()).toHaveCSS('width', '28px');

  // После перезагрузки всё на месте, до первой отрисовки интерфейса
  await page.reload();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await cssVar('--accent')).toBe('#eb459e');
  await expect(root).toHaveAttribute('data-compact', '');
  await expect(root).toHaveAttribute('data-font', 'l');
  await expect(text).toHaveCSS('font-size', '17px');
  // Анимации и плавные переходы выключены
  const motion = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.btn, .icon-btn')!);
    return [s.transitionProperty, s.animationName];
  });
  expect(motion).toEqual(['none', 'none']);

  // Тёмная тема явно — даже если система светлая; сброс возвращает «как в системе»
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTitle('Настройки').click();
  await settingsTab(a, 'Внешний вид').click();
  await page.getByRole('radio', { name: 'Тёмная' }).click();
  expect(await bodyBg()).toBe('rgb(49, 51, 56)');
  await page.getByRole('button', { name: 'Сбросить оформление' }).click();
  await expect(root).not.toHaveAttribute('data-theme');
  await expect(root).not.toHaveAttribute('data-compact');
  await expect(root).toHaveAttribute('data-font', 'm');
  expect(await cssVar('--accent')).toBe('#5865f2');
  expect(await bodyBg()).toBe('rgb(255, 255, 255)');

  expect(pageErrors(page)).toEqual([]);
});
