import { expect, test } from '@playwright/test';
import { createServer, pageErrors, registerUser, User } from './helpers';
import { settingsTab } from './w2-helpers';

// RNNoise в AudioWorklet (public/worklets/voice-denoise.js): включается в настройках голоса,
// микрофон голосового канала и звонка проходит через модель, статус виден в настройках.

const stats = (u: User) =>
  u.page.evaluate(() => ({ ...(window as unknown as { __vicinityVoiceStats: { framesSent: number } }).__vicinityVoiceStats }));

test('rnnoise: toggle in voice settings, model loads on voice join, frames still flow, off again', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  await createServer(a, 'Тихий сервер');

  // Модуль отдаётся сборкой (vite plugin), а не лежит в репозитории
  const mod = await a.page.request.get('/worklets/rnnoise.js');
  expect(mod.ok()).toBe(true);
  expect((await mod.text()).length).toBeGreaterThan(100_000);

  await a.page.locator('.user-panel').getByTitle('Настройки').click();
  await settingsTab(a, 'Голос и видео').click();
  const toggle = a.page.getByRole('switch', { name: 'Нейросетевое шумоподавление (RNNoise)' });
  await expect(toggle).toHaveJSProperty('checked', false);
  await toggle.click();
  await expect(toggle).toHaveJSProperty('checked', true);
  await expect(a.page.locator('.toggle-row', { hasText: 'RNNoise' })).toContainText('модель ~5 МБ');
  await a.page.keyboard.press('Escape');
  // Поддельный микрофон Chromium пищит чистым тоном — модель почти гасит его; чтобы кадры уходили,
  // порог срабатывания — ручной и минимальный (настройка хранится в localStorage)
  await a.page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vicinity.media') ?? '{}');
    localStorage.setItem('vicinity.media', JSON.stringify({ ...raw, autoSens: false, thresholdDb: -100 }));
  });
  await a.page.reload();
  await expect(a.page.locator('.user-panel')).toContainText('В сети');

  await a.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  await a.page.locator('.user-panel').getByTitle('Настройки').click();
  await settingsTab(a, 'Голос и видео').click();
  await expect(a.page.locator('.toggle-row', { hasText: 'RNNoise' })).toContainText('Работает', { timeout: 20_000 });
  await a.page.keyboard.press('Escape');
  // Поддельный микрофон Chromium пищит — кадры после модели всё ещё уходят
  await expect.poll(async () => (await stats(a)).framesSent, { timeout: 15_000 }).toBeGreaterThan(20);

  // Выключили — микрофон открывается заново без модели
  await a.page.locator('.user-panel').getByTitle('Настройки').click();
  await settingsTab(a, 'Голос и видео').click();
  await a.page.getByRole('switch', { name: 'Нейросетевое шумоподавление (RNNoise)' }).click();
  await expect(a.page.locator('.toggle-row', { hasText: 'RNNoise' })).not.toContainText('Работает', { timeout: 10_000 });
  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  expect(pageErrors(a.page)).toEqual([]);
});
