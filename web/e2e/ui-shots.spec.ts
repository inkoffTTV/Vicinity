import { expect, test } from '@playwright/test';
import { createGroup, createServer, makeFriends, openDm, registerUser, send } from './helpers';
import { settingsTab } from './w2-helpers';
import { openNav } from './ui-helpers';

// Снимки экрана для ручной проверки вёрстки: VICINITY_SHOTS_DIR=/путь npx playwright test ui-shots
const dir = process.env.VICINITY_SHOTS_DIR;

test.skip(!dir, 'VICINITY_SHOTS_DIR не задан');

for (const [name, viewport, colorScheme] of [
  ['desktop-dark', { width: 1280, height: 800 }, 'dark'],
  ['desktop-light', { width: 1280, height: 800 }, 'light'],
  ['mobile', { width: 390, height: 844 }, 'dark'],
  ['mobile-light', { width: 360, height: 640 }, 'light'],
] as const) {
  test(`screenshots: ${name}`, async ({ browser }) => {
    const mobile = viewport.width < 600;
    // Подготовка — на широком экране, снимки — в нужном размере
    const a = await registerUser(browser, 'Алиса', { colorScheme });
    const b = await registerUser(browser, 'Борис');
    const page = a.page;
    // Пауза — чтобы снимок не попал на середину анимации (выезд меню, появление окна)
    const shot = async (what: string) => {
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${dir}/${name}-${what}.png` });
    };

    await makeFriends(b, a);
    await createGroup(a, 'Поход в горы');
    await createServer(a, 'Мой сервер');
    await openDm(a, b);
    await openDm(b, a);
    await send(a, 'Привет! Как дела? 🔥');
    await send(b, 'Отлично, смотри файл');
    await b.page.locator('.composer input[type=file]').setInputFiles({ name: 'отчёт.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await b.page.locator('.composer textarea').press('Enter');
    await expect(page.locator('.file-card')).toBeVisible();
    await page.setViewportSize(viewport);
    await page.locator('.msg', { hasText: 'Как дела' }).hover();
    await shot('dm');

    if (mobile) await openNav(page);
    await shot('nav');
    await page.locator('.user-panel-me').click();
    await shot('user-menu');
    await page.locator('.user-panel-me').click();

    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await shot('settings-profile');
    await settingsTab(a, 'Аккаунт').click();
    await shot('settings-account');
    await page.locator('.settings-main-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot('settings-account-bottom');
    await settingsTab(a, 'Тема').click();
    await shot('settings-appearance');
    await settingsTab(a, 'Голос и видео').click();
    await shot('settings-voice');
    await page.keyboard.press('Escape');

    await openNav(page);
    await page.locator('.side-item', { hasText: 'Поход в горы' }).click();
    await shot('group');
    await openNav(page);
    await page.locator('.rail-item[title="Мой сервер"]').click();
    await openNav(page);
    await page.locator('.side-head').click();
    await shot('server-menu');
    await page.locator('.dropdown button', { hasText: 'Настройки сервера' }).click();
    await shot('server-settings');
    await settingsTab(a, 'Удаление сервера').click();
    await page.locator('#server-panel').getByRole('button', { name: 'Удалить сервер' }).click();
    await shot('confirm');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (mobile) await page.locator('.nav-scrim').click({ position: { x: viewport.width - 10, y: 300 } });
    await shot('server');

    await page.keyboard.press('Control+k');
    await shot('switcher');
    await page.keyboard.press('Escape');

    await a.context.close();
    await b.context.close();
  });
}
