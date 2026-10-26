import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, User } from './helpers';

// Голос через живой SFU (docs/VOICE-SFU.md). В CI LiveKit не поднимается — тест идёт только вручную:
//   VICINITY_E2E_SFU=1 npx playwright test e2e/b-sfu-live.spec.ts
// при бэкенде, у которого /rtc/sfu указывает на работающий LiveKit.

test.skip(!process.env.VICINITY_E2E_SFU, 'нужен живой LiveKit (VICINITY_E2E_SFU=1)');

interface Stats {
  sfu: boolean;
  sfuPacketsSent: number;
  sfuBytesReceived: number;
  sfuPeers: number;
}
const stats = (u: User) => u.page.evaluate(() => ({ ...(window as unknown as { __vicinityVoiceStats: Stats }).__vicinityVoiceStats }));
const voiceUser = (u: User, name: string) => u.page.locator('.sidebar .voice-user', { hasText: name });
const voiceBar = (u: User) => u.page.locator('.voice-bar');
const ring = (u: User, name: string) => voiceUser(u, name).locator('.avatar.speaking');

test('sfu: both publish and receive Opus, speaking rings, mute stops sending, deafen stops receiving, leave', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'SFU сервер');
  await joinServer(b, code, 'SFU сервер');
  const channel = (u: User) => u.page.locator('.side-item.voice', { hasText: 'Голосовой' });

  await channel(a).click();
  await expect(voiceBar(a)).toContainText('Голос подключён');
  await expect.poll(async () => (await stats(a)).sfu).toBe(true);
  await channel(b).click();
  await expect(voiceBar(b)).toContainText('Голос подключён');
  await expect.poll(async () => (await stats(b)).sfu).toBe(true);
  await expect(voiceUser(a, 'Боб')).toBeVisible();
  await expect(voiceUser(b, 'Алиса')).toBeVisible();

  // Звук идёт в обе стороны через комнату (поддельный микрофон Chromium пищит постоянно)
  await expect.poll(async () => (await stats(a)).sfuPeers).toBe(1);
  await expect.poll(async () => (await stats(a)).sfuPacketsSent, { timeout: 20_000 }).toBeGreaterThan(50);
  await expect.poll(async () => (await stats(b)).sfuBytesReceived, { timeout: 20_000 }).toBeGreaterThan(5_000);
  await expect.poll(async () => (await stats(b)).sfuPacketsSent, { timeout: 20_000 }).toBeGreaterThan(50);
  await expect.poll(async () => (await stats(a)).sfuBytesReceived, { timeout: 20_000 }).toBeGreaterThan(5_000);

  // Индикатор речи — по оценке SFU у себя и по voice_speaking у собеседника
  await expect(ring(a, 'Алиса')).not.toHaveCount(0, { timeout: 15_000 });
  await expect(ring(b, 'Алиса')).not.toHaveCount(0, { timeout: 15_000 });

  // Микрофон выключен: пакеты не уходят (DTX шлёт редкие кадры тишины — считаем «почти»), кольцо погасло
  await voiceBar(a).getByRole('button', { name: 'Выключить микрофон' }).click();
  await expect(voiceUser(a, 'Алиса').locator('.voice-user-flag')).toBeVisible();
  await expect(ring(b, 'Алиса')).toHaveCount(0, { timeout: 10_000 });
  await a.page.waitForTimeout(1500);
  const muted = (await stats(a)).sfuPacketsSent;
  await a.page.waitForTimeout(2000);
  expect((await stats(a)).sfuPacketsSent - muted).toBeLessThan(15);

  // «Не слышать»: чужие дорожки отписаны — байты не приходят
  await voiceBar(a).getByRole('button', { name: 'Выключить звук' }).click();
  await a.page.waitForTimeout(1500);
  const deaf = (await stats(a)).sfuBytesReceived;
  await a.page.waitForTimeout(2000);
  expect((await stats(a)).sfuBytesReceived - deaf).toBeLessThan(2_000);
  // Включить микрофон при «не слышать» — снова слышать и говорить
  await voiceBar(a).getByRole('button', { name: 'Включить микрофон' }).click();
  await expect.poll(async () => (await stats(a)).sfuPacketsSent, { timeout: 15_000 }).toBeGreaterThan(muted + 50);
  await expect.poll(async () => (await stats(a)).sfuBytesReceived, { timeout: 15_000 }).toBeGreaterThan(deaf + 5_000);

  // Выход: панель пропала, у Боба комната опустела
  await voiceBar(a).getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(voiceBar(a)).toHaveCount(0);
  await expect(voiceUser(b, 'Алиса')).toHaveCount(0);
  await expect.poll(async () => (await stats(b)).sfuPeers).toBe(0);

  for (const u of [a, b]) expect(pageErrors(u.page)).toEqual([]);
});
