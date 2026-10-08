import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGroup, pageErrors, pngBuffer, registerHere } from './helpers';

// Заголовки, которые отдаёт nginx веб-контейнера (deploy/nginx.conf)
const nginxConf = readFileSync(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8');
const header = (name: string) => nginxConf.match(new RegExp(`add_header ${name} "([^"]+)" always;`))?.[1];

test('nginx config: backend resolved per request, gzip, security headers', () => {
  expect(nginxConf).toMatch(/resolver 127\.0\.0\.11 valid=10s ipv6=off;/);
  const proxied = [...nginxConf.matchAll(/proxy_pass (\S+);/g)].map((m) => m[1]);
  expect(proxied.length).toBeGreaterThanOrEqual(3);
  expect(new Set(proxied)).toEqual(new Set(['$backend']));
  expect(nginxConf).toMatch(/location = \/ws \{[^}]*proxy_set_header Upgrade \$http_upgrade;[^}]*access_log off;/);
  expect(nginxConf).toMatch(/gzip on;/);
  expect(nginxConf).toMatch(/set_real_ip_from 172\.16\.0\.0\/12;\s+real_ip_header X-Forwarded-For;/);
  expect(header('X-Content-Type-Options')).toBe('nosniff');
  expect(header('Referrer-Policy')).toBeTruthy();
  expect(header('Permissions-Policy')).toMatch(/microphone=\(self\).*camera=\(self\).*display-capture=\(self\)/);
  expect(header('Content-Security-Policy')).toMatch(/frame-ancestors 'none'/);
});

test('the app works under the Content-Security-Policy that nginx sends', async ({ browser }) => {
  const csp = header('Content-Security-Policy')!;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await context.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await page.goto('/');
  const username = await registerHere(page, 'Политика');
  const user = { page, context, username, displayName: 'Политика' };

  // Сообщение с картинкой: превью из blob:, затем /uploads; аватар с инлайн-цветом; лайтбокс
  await createGroup(user, 'Проверка CSP');
  await page.locator('.composer input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() });
  await expect(page.locator('.upload-preview img')).toBeVisible();
  await page.locator('.composer textarea').fill('Картинка под CSP');
  await page.locator('.composer textarea').press('Enter');
  const img = page.locator('.msg', { hasText: 'Картинка под CSP' }).locator('.attachment img');
  await expect(img).toHaveAttribute('src', /^\/uploads\//);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);
  await img.click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTitle('Настройки').click();
  await page.locator('.settings-avatar input[type=file]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: pngBuffer(64, 64) });
  await expect(page.locator('.toast', { hasText: 'Аватар обновлён' })).toBeVisible();
  await expect(page.locator('.settings-avatar img')).toHaveAttribute('src', /^\/uploads\//);

  expect(await page.evaluate(() => (window as any).__csp)).toEqual([]);
  expect(pageErrors(page)).toEqual([]);
  await context.close();
});
