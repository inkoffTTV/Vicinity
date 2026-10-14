import { Browser, expect, test } from '@playwright/test';
import { createServer, pageErrors, uniqueName } from './helpers';

// Приложения для телефонов: ссылка на APK в браузере Android, инструкция «На экран „Домой“» на iPhone,
// и мост приложения для Android (web/src/lib/android.ts ↔ android/…/MainActivity.java).

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONE = { width: 390, height: 844 };

async function phonePage(browser: Browser, userAgent: string, bridge = false) {
  // Мост проверяем на планшетной ширине: на ней видны панель серверов и голосовые каналы
  const viewport = bridge ? { width: 1024, height: 768 } : PHONE;
  const context = await browser.newContext({ viewport, userAgent, isMobile: !bridge, hasTouch: true, colorScheme: 'dark' });
  if (bridge) {
    // Поддельный мост приложения: записывает вызовы, разрешение на уведомления выдаёт асинхронно
    await context.addInitScript(() => {
      const calls: unknown[][] = [];
      let permission = 'default';
      (window as any).__androidCalls = calls;
      (window as any).VicinityAndroid = {
        version: () => '1.0.0',
        notificationPermission: () => permission,
        requestNotificationPermission: () => {
          calls.push(['requestNotificationPermission']);
          setTimeout(() => {
            permission = 'granted';
            (window as any).__vicinityNotifyPermission(permission);
          }, 50);
        },
        notify: (title: string, body: string, tag: string) => calls.push(['notify', title, body, tag]),
        closeNotification: (tag: string) => calls.push(['closeNotification', tag]),
        setInCall: (active: boolean) => calls.push(['setInCall', active]),
        retry: () => calls.push(['retry']),
      };
    });
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await page.goto('/');
  return { context, page };
}

test('Android browser: APK download link on the login screen', async ({ browser }) => {
  const { context, page } = await phonePage(browser, ANDROID_UA);
  const link = page.locator('a.auth-download', { hasText: 'Скачать для Android' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/download/Vicinity.apk');
  await expect(page.locator('.auth-download', { hasText: 'Windows' })).toHaveCount(0);
  await expect(page.locator('.auth-download', { hasText: 'iPhone' })).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
  await context.close();
});

test('iPhone: "add to Home Screen" guide', async ({ browser }) => {
  const { context, page } = await phonePage(browser, IPHONE_UA);
  await expect(page.locator('.auth-download', { hasText: 'Android' })).toHaveCount(0);
  await page.locator('.auth-download', { hasText: 'Установить на iPhone' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vicinity на iPhone' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ios-steps li')).toHaveCount(4);
  await expect(dialog).toContainText('На экран „Домой“');
  await expect(dialog.locator('.ios-steps svg.ico')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Понятно' }).click();
  await expect(dialog).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
  await context.close();
});

test('Android app bridge: notifications through the app, call keeps the app alive', async ({ browser }) => {
  const { context, page } = await phonePage(browser, `${ANDROID_UA} VicinityAndroid/1.0.0`, true);
  // Внутри приложения не предлагаем скачать само приложение
  await expect(page.locator('.auth-download')).toHaveCount(0);

  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
  await page.locator('input[autocomplete=username]').fill(uniqueName('droid'));
  await page.locator('label:has-text("Отображаемое имя") input').fill('Дроид');
  await page.locator('input[type=password]').fill('password123');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('.user-panel')).toContainText('В сети');

  // Браузерный Notification подменён мостом: разрешение, показ и нажатие
  const result = await page.evaluate(async () => {
    const before = Notification.permission;
    const asked = await Notification.requestPermission();
    let clicked = 0;
    const n = new Notification('Борис', { body: 'привет', tag: 'ch-7' });
    n.onclick = () => clicked++;
    window.dispatchEvent(new CustomEvent('vicinity-notification-click', { detail: 'ch-7' }));
    n.close();
    return { before, asked, after: Notification.permission, clicked };
  });
  expect(result).toEqual({ before: 'default', asked: 'granted', after: 'granted', clicked: 1 });

  // Голосовой канал: приложение держит службу «Идёт звонок», пока вы в канале
  await createServer({ page, context, username: '', displayName: 'Дроид' }, 'Мобильный');
  await page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(page.locator('.voice-bar')).toContainText('Голос подключён');
  await page.locator('.voice-bar').getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(page.locator('.voice-bar')).toHaveCount(0);

  const calls = await page.evaluate(() => (window as any).__androidCalls as unknown[][]);
  expect(calls).toEqual([
    ['requestNotificationPermission'],
    ['notify', 'Борис', 'привет', 'ch-7'],
    ['closeNotification', 'ch-7'],
    ['setInCall', true],
    ['setInCall', false],
  ]);
  expect(pageErrors(page)).toEqual([]);
  await context.close();
});
