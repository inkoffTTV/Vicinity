import { APIRequestContext, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pageErrors, pngBuffer, registerUser } from './helpers';
import { apiUser, ApiUser, dmBothSides, post } from './w1-helpers';

const SHOTS = process.env.VICINITY_SHOTS_DIR;

async function upload(request: APIRequestContext, who: ApiUser, channelId: number, name: string) {
  const r = await request.post(`/api/v1/channels/${channelId}/attachments`, {
    headers: { Authorization: `Bearer ${who.token}` },
    multipart: { file: { name, mimeType: 'image/png', buffer: pngBuffer(160, 100) } },
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { url: string; name: string };
}

// Меню картинки: правая кнопка в ленте и в лайтбоксе, сохранить, копировать, альбом
test('image context menu: save, copy link, album, lightbox', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await a.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const channelId = await dmBothSides(a, b);
  const bob = await apiUser(request, b);

  // Имена латиницей: без UTF-8 локали (LANG пуст) Chromium заменяет кириллическое имя скачивания на «download»
  // Две картинки подряд — альбом; после текста — одиночная
  const first = await upload(request, bob, channelId, 'photo-1.png');
  const second = await upload(request, bob, channelId, 'photo-2.png');
  const third = await upload(request, bob, channelId, 'single.png');
  await post(request, bob, channelId, 'альбом', { attachment: first.url, attachment_name: 'photo-1.png' });
  await post(request, bob, channelId, '', { attachment: second.url, attachment_name: 'photo-2.png' });
  await post(request, bob, channelId, 'между картинками');
  await post(request, bob, channelId, '', { attachment: third.url, attachment_name: 'single.png' });
  // Имя с чужим расширением («.hta») — сервер ставит настоящее расширение картинки
  const fourth = await upload(request, bob, channelId, 'party.png');
  await post(request, bob, channelId, 'и ещё одна');
  const disguised = await post(request, bob, channelId, '', { attachment: fourth.url, attachment_name: 'party.jpg.hta' });
  const hist = await request.get(`/api/v1/channels/${channelId}/messages?limit=1`, { headers: { Authorization: `Bearer ${bob.token}` } });
  const stored = (await hist.json()).messages.find((m: { id: number }) => m.id === disguised);
  expect(stored.attachment_name).toBe('party.jpg.png');

  const img = (src: string) => a.page.locator(`.messages .attachment img[src="${src}"]`);
  await expect(img(third.url)).toBeVisible();
  const menu = a.page.getByRole('menu', { name: 'Действия с изображением' });
  const item = (name: string | RegExp) => menu.getByRole('menuitem', { name, exact: typeof name === 'string' });

  // Правая кнопка — меню со всеми пунктами, у альбома из двух — «Сохранить все»
  await img(first.url).click({ button: 'right' });
  await expect(menu).toBeVisible();
  for (const name of ['Открыть', 'Сохранить', 'Копировать изображение', 'Копировать ссылку', 'Открыть оригинал в браузере'])
    await expect(item(name)).toBeVisible();
  await expect(item('Сохранить все из альбома (2)')).toBeVisible();
  // Esc закрывает
  await a.page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Ссылка — абсолютный адрес
  await img(first.url).click({ button: 'right' });
  await item('Копировать ссылку').click();
  await expect(menu).toBeHidden();
  await expect(a.page.locator('.toast', { hasText: 'Ссылка скопирована' })).toBeVisible();
  const origin = new URL(a.page.url()).origin;
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(origin + first.url);

  // Сохранить — скачивание с исходным именем
  await img(second.url).click({ button: 'right' });
  const download = a.page.waitForEvent('download');
  await item('Сохранить').click();
  expect((await download).suggestedFilename()).toBe('photo-2.png');

  // Копировать изображение — PNG в буфере обмена
  await img(second.url).click({ button: 'right' });
  await item('Копировать изображение').click();
  await expect(a.page.locator('.toast', { hasText: 'Изображение скопировано' })).toBeVisible();
  const types = await a.page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain('image/png');

  // Альбом — два файла по очереди
  await img(second.url).click({ button: 'right' });
  const names: string[] = [];
  a.page.on('download', (d) => names.push(d.suggestedFilename()));
  await item('Сохранить все из альбома (2)').click();
  await expect(a.page.locator('.toast', { hasText: 'Сохранено изображений: 2' })).toBeVisible();
  await expect.poll(() => names.slice().sort()).toEqual(['photo-1.png', 'photo-2.png']);

  // Сохраняется под настоящим расширением
  await img(fourth.url).scrollIntoViewIfNeeded();
  await img(fourth.url).click({ button: 'right' });
  const saved = a.page.waitForEvent('download');
  await item('Сохранить').click();
  expect((await saved).suggestedFilename()).toBe('party.jpg.png');

  // Одиночная картинка после текста — без пункта альбома
  await img(third.url).click({ button: 'right' });
  await expect(item('Сохранить')).toBeVisible();
  await expect(item(/Сохранить все из альбома/)).toHaveCount(0);
  // «Открыть» — лайтбокс
  await item('Открыть').click();
  const lightbox = a.page.locator('img.lightbox');
  await expect(lightbox).toBeVisible();

  // То же меню в лайтбоксе, поверх окна, без «Открыть»
  await lightbox.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(item('Копировать ссылку')).toBeVisible();
  await expect(item('Открыть')).toHaveCount(0);
  await item('Копировать ссылку').click();
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(origin + third.url);
  await expect(lightbox).toBeVisible();
  // Esc сначала закрывает меню, потом лайтбокс
  await lightbox.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(lightbox).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // Лайтбокс картинки из альбома — пункт альбома и там
  await img(first.url).click();
  await expect(lightbox).toBeVisible();
  await lightbox.click({ button: 'right' });
  await expect(item('Сохранить все из альбома (2)')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await a.page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // Телефон: долгое нажатие открывает меню, лайтбокс при этом не открывается; меню влезает в 390px
  await a.page.setViewportSize({ width: 390, height: 844 });
  const target = img(second.url);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  await target.evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: el, clientX: r.left + 20, clientY: r.top + 20 });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    await new Promise((res) => setTimeout(res, 650));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    // Отпускание пальца — «клик», который меню проглатывает
    (el.closest('button') as HTMLElement).click();
  });
  await expect(menu).toBeVisible();
  await expect(lightbox).toBeHidden();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await a.page.screenshot({ path: `${SHOTS}/image-menu-390.png` });
  }
  await a.page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
