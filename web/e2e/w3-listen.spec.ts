import { expect, test, Page } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, User } from './helpers';

// «Слушать вместе» в голосовом канале (docs/CALLS.md §2.7): общая очередь превью, пауза и
// переключение у одного видны у всех, новый участник догоняет текущее состояние.

const TRACK = {
  id: 7,
  title: 'Тестовая песня',
  artist: 'Группа e2e',
  album: 'Альбом',
  artwork: '',
  preview: '/e2e/preview.wav',
  url: 'https://music.apple.com/ru/album/example',
};

/** Секунда тишины в WAV: превью, которое браузер действительно играет */
function wav(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

async function mockMusic(page: Page) {
  await page.route('**/api/v1/music/search*', (route) => route.fulfill({ json: { tracks: [TRACK] } }));
  await page.route('**/e2e/preview.wav', (route) => route.fulfill({ body: wav(), contentType: 'audio/wav' }));
}

const player = (u: User) => u.page.evaluate(() => (window as unknown as { __vicinityListen: { src: string; paused: boolean } }).__vicinityListen);
const stage = (u: User) => u.page.locator('.voice-stage');
const panel = (u: User) => stage(u).locator('.listen-panel');

test('listen together: queue, pause and skip are shared, late joiner catches up, empty channel forgets the queue', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Ваня');
  for (const u of [a, b, c]) await mockMusic(u.page);
  const code = await createServer(a, 'Меломаны');
  await joinServer(b, code, 'Меломаны');
  await joinServer(c, code, 'Меломаны');
  const channel = (u: User) => u.page.locator('.side-item.voice', { hasText: 'Голосовой' });

  await channel(a).click();
  await expect(stage(a)).toBeVisible();
  await channel(b).click();
  await expect(stage(b)).toBeVisible();

  // Алиса открывает панель, ищет и добавляет трек — у Боба панель появляется сама
  await stage(a).getByRole('button', { name: 'Слушать вместе' }).click();
  await expect(panel(a)).toContainText('Очередь пуста');
  await panel(a).getByRole('searchbox', { name: 'Найти трек' }).fill('тест');
  await panel(a).getByRole('button', { name: 'Найти' }).click();
  await panel(a).getByRole('button', { name: 'Добавить' }).click();
  await expect(panel(a).getByTestId('listen-now')).toContainText('Тестовая песня');
  await expect(panel(b).getByTestId('listen-now')).toContainText('Тестовая песня');
  await expect(panel(b)).toContainText('добавил(а) Алиса');
  await expect(stage(b).locator('.stage-btn-badge')).toHaveText('1');
  // Оба действительно играют один файл
  await expect.poll(async () => (await player(a)).src).toContain('/e2e/preview.wav');
  await expect.poll(async () => (await player(b)).paused).toBe(false);

  // Второй трек — в очередь; Боб ставит паузу — у Алисы пауза и плеер остановлен
  await panel(a).getByRole('searchbox', { name: 'Найти трек' }).fill('ещё');
  await panel(a).getByRole('button', { name: 'Найти' }).click();
  await panel(a).getByRole('button', { name: 'Добавить' }).click();
  await expect(panel(a).locator('.listen-queue li')).toHaveCount(1);
  await panel(b).getByRole('button', { name: 'Пауза' }).click();
  await expect(panel(a).getByRole('button', { name: 'Играть' })).toBeVisible();
  await expect.poll(async () => (await player(a)).paused).toBe(true);

  // Ваня заходит позже — сразу видит очередь на паузе
  await channel(c).click();
  await expect(panel(c).getByTestId('listen-now')).toContainText('Тестовая песня');
  await expect(panel(c).getByRole('button', { name: 'Играть' })).toBeVisible();
  await expect(panel(c).locator('.listen-queue li')).toHaveCount(1);

  // Ваня переключает дальше — очередь укоротилась у всех; второй «дальше» — пусто
  await panel(c).getByRole('button', { name: 'Следующий трек' }).click();
  await expect(panel(a).locator('.listen-queue li')).toHaveCount(0);
  await expect(panel(b).getByTestId('listen-now')).toBeVisible();
  await panel(a).getByRole('button', { name: 'Следующий трек' }).click();
  await expect(panel(a)).toContainText('Очередь пуста');
  await expect(panel(b)).toHaveCount(0); // у Боба панель не открывали — пустая очередь её прячет

  // Все вышли — очередь забыта: новый вход начинает с чистого листа
  await panel(a).getByRole('searchbox', { name: 'Найти трек' }).fill('снова');
  await panel(a).getByRole('button', { name: 'Найти' }).click();
  await panel(a).getByRole('button', { name: 'Добавить' }).click();
  await expect(panel(c).getByTestId('listen-now')).toBeVisible();
  for (const u of [a, b, c]) await u.page.locator('.voice-bar').getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await channel(a).click();
  await expect(stage(a)).toBeVisible();
  await expect(stage(a).locator('.stage-btn-badge')).toHaveCount(0);
  await expect(panel(a)).toHaveCount(0);
  for (const u of [a, b, c]) expect(pageErrors(u.page)).toEqual([]);
});
