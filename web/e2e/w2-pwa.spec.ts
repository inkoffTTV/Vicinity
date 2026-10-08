import { expect, test } from '@playwright/test';
import { pageErrors, registerHere } from './helpers';

// PWA на собранном приложении (vite preview): манифест, иконки, service worker, обновление.

/** Ширина и высота PNG из заголовка IHDR */
const pngSize = (b: Buffer) => {
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('manifest, icons and meta tags', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: 'Vicinity', display: 'standalone', start_url: '/channels/@me', scope: '/' });
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);

  const icons: { src: string; sizes: string; type: string; purpose: string }[] = m.icons;
  expect(icons.some((i) => i.type === 'image/svg+xml')).toBe(true);
  expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of icons.filter((i) => i.type === 'image/png')) {
    const r = await request.get(icon.src);
    expect(r.ok()).toBe(true);
    const [w, h] = pngSize(await r.body());
    expect(`${w}x${h}`).toBe(icon.sizes);
  }
  expect(icons.filter((i) => i.type === 'image/png').map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const [aw] = pngSize(await (await request.get(apple!)).body());
  expect(aw).toBe(180);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});

test('service worker caches the app shell, never the API, and offers updates', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await page.goto('/');
  await registerHere(page, 'Офлайн');

  // Зарегистрирован, активен, управляет страницей после перезагрузки
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(new URL(script!).pathname).toBe('/sw.js');
  await page.reload();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // В кэше — оболочка и хэшированные ассеты; ни API, ни загрузок, ни WebSocket
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(cached).toContain('/');
  expect(cached.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
  expect(cached.filter((u) => /^\/(api|uploads|ws)/.test(u))).toEqual([]);

  // Без сети приложение всё равно открывается (оболочка из кэша) и ждёт сервер
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Нет связи с сервером')).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('.user-panel')).toContainText('В сети', { timeout: 20_000 });

  // Вышла новая версия service worker — предложение обновиться, по кнопке вкладка перезагружается
  await page.evaluate(() => ((window as any).__beforeUpdate = true));
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js?next'));
  const toast = page.locator('.toast.update');
  await expect(toast).toContainText('Доступна новая версия');
  await Promise.all([page.waitForEvent('load'), toast.getByRole('button', { name: 'обновить' }).click()]);
  expect(await page.evaluate(() => (window as any).__beforeUpdate ?? false)).toBe(false);
  await expect(page.locator('.user-panel')).toContainText('В сети');
  await expect(page.locator('.toast.update')).toHaveCount(0);
  expect(new URL(await page.evaluate(async () => (await navigator.serviceWorker.ready).active!.scriptURL)).search).toBe('?next');

  expect(pageErrors(page)).toEqual([]);
  await context.close();
});
