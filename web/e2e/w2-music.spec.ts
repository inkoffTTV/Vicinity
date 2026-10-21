import { expect, test } from '@playwright/test';
import { registerUser, tokenOf } from './helpers';
import { settingsTab } from './w2-helpers';

const API = `http://localhost:${process.env.VICINITY_E2E_PORT ?? 18080}/api/v1`;

const TRACK = {
  id: 1441164816,
  title: 'Ночь',
  artist: 'Группа',
  album: 'Альбом',
  artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg',
  preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/example/preview.m4a',
  url: 'https://music.apple.com/ru/album/example/1441164816?i=1441164816',
};

// Поиск трека через сервер (ответ каталога подменён), выбор, сохранение, виджет в карточке; сервер проверяет ссылки
test('music in profile', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const page = a.page;
  await page.route('**/api/v1/music/search*', (route) => route.fulfill({ json: { tracks: [TRACK] } }));

  await page.getByTitle('Настройки').click();
  await settingsTab(a, 'Профиль').click();
  await page.getByRole('button', { name: 'Открыть редактор' }).click();
  const studio = page.locator('.profile-studio');
  await studio.getByLabel('Поиск трека').fill('ночь');
  await studio.getByRole('button', { name: 'Найти' }).click();
  await studio.getByRole('button', { name: 'Выбрать' }).click();
  await expect(studio.locator('.studio-music-current .pcard-music strong')).toHaveText('Ночь');

  await studio.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.toast', { hasText: 'Профиль сохранён' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(studio).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('.user-panel-me').click();
  await page.getByRole('button', { name: 'Мой профиль' }).click();
  const card = page.locator('.pcard');
  await expect(card.locator('.pcard-music strong')).toHaveText('Ночь');
  await expect(card.getByRole('button', { name: 'Слушать превью' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Открыть в каталоге' })).toHaveAttribute('href', TRACK.url);

  // Ссылки не из каталога сервер отклоняет
  const token = await tokenOf(a);
  const auth = { Authorization: `Bearer ${token}` };
  const bad = await page.request.post(`${API}/profile/extras`, { headers: auth, data: { music: { ...TRACK, artwork: 'https://evil.example/x.jpg' } } });
  expect(bad.status()).toBe(400);
  const ok = await page.request.post(`${API}/profile/extras`, { headers: auth, data: { music: null } });
  expect(ok.ok()).toBeTruthy();
});
