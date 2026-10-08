import { expect, Page, test } from '@playwright/test';
import { controlSocket, createGroup, createServer, joinServer, pageErrors, registerUser, User } from './helpers';

// Голосовые каналы в браузере (docs/CALLS.md §2, протокол v2 из docs/API.md §11).
// Фейковый микрофон Chromium пищит каждые полсекунды: этого хватает и для кадров, и для индикатора речи.

interface VoiceStats {
  framesSent: number;
  framesDropped: number;
  framesReceived: number;
}
const stats = (p: Page) =>
  p.evaluate(() => ({ ...(window as unknown as { __vicinityVoiceStats: VoiceStats }).__vicinityVoiceStats }));
const sent = async (u: User) => (await stats(u.page)).framesSent;
const received = async (u: User) => (await stats(u.page)).framesReceived;

/** Строка участника голосового канала в боковой панели */
const voiceUser = (u: User, name: string) => u.page.locator('.sidebar .voice-user', { hasText: name });
const voiceBar = (u: User) => u.page.locator('.voice-bar');

/** Добавить пользователя в открытую беседу через диалог «Добавить участника». */
async function addToGroup(owner: User, who: User) {
  await owner.page.getByRole('button', { name: 'Добавить участника' }).click();
  await owner.page.locator('.modal input').fill(who.username);
  await owner.page
    .locator(`.modal .user-row:has-text("@${who.username}")`)
    .getByRole('button', { name: 'Добавить' })
    .click();
  await expect(owner.page.locator('.toast', { hasText: 'добавлен' })).toBeVisible();
}

test('server voice channel: both hear each other, speaking rings, mute and leave', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Голосовой сервер');
  await joinServer(b, code, 'Голосовой сервер');
  const channel = (u: User) => u.page.locator('.side-item.voice', { hasText: 'Голосовой' });

  await channel(a).click();
  await expect(voiceBar(a)).toContainText('Голос подключён');
  await expect(voiceBar(a)).toContainText('Голосовой сервер');
  await expect(voiceUser(a, 'Алиса')).toBeVisible();
  await expect(voiceUser(b, 'Алиса')).toBeVisible();

  await channel(b).click();
  await expect(voiceBar(b)).toContainText('Голос подключён');
  await expect(voiceUser(a, 'Боб')).toBeVisible();
  await expect(voiceUser(b, 'Боб')).toBeVisible();

  // Кадры идут в обе стороны (только пока «говорит» — фейковый микрофон пищит постоянно)
  await expect.poll(() => sent(a)).toBeGreaterThan(20);
  await expect.poll(() => received(b)).toBeGreaterThan(20);
  await expect.poll(() => sent(b)).toBeGreaterThan(20);
  await expect.poll(() => received(a)).toBeGreaterThan(20);

  // Свой индикатор речи — локальный, чужой — по voice_speaking; между писками (раз в 0.5 с) гаснет.
  // Пауза короткая (~160 мс), а expect повторяет проверку раз в секунду, в такт писку, —
  // поэтому смотрим на каждом кадре отрисовки.
  const speakingIs = (u: User, name: string, on: boolean) =>
    u.page.waitForFunction(
      ([who, want]) => {
        const row = Array.from(document.querySelectorAll('.sidebar .voice-user')).find((r) =>
          r.textContent?.includes(who),
        );
        return !!row && !!row.querySelector('.avatar.speaking') === want;
      },
      [name, on] as const,
      { polling: 'raf', timeout: 10_000 },
    );
  await speakingIs(a, 'Алиса', true);
  await speakingIs(b, 'Алиса', true);
  await speakingIs(b, 'Алиса', false);
  await speakingIs(b, 'Алиса', true);
  const ring = (u: User, name: string) => voiceUser(u, name).locator('.avatar.speaking');
  await expect(voiceBar(b).locator('.avatar.speaking')).not.toHaveCount(0);

  // Микрофон выключен: кадры не уходят, индикатор погас у всех
  await voiceBar(a).getByRole('button', { name: 'Выключить микрофон' }).click();
  await expect(voiceBar(a).getByRole('button', { name: 'Включить микрофон' })).toBeVisible();
  await expect(voiceUser(a, 'Алиса').locator('.voice-user-flag')).toBeVisible();
  await expect(ring(a, 'Алиса')).toHaveCount(0);
  await expect(ring(b, 'Алиса')).toHaveCount(0);
  const muted = await sent(a);
  await a.page.waitForTimeout(1500);
  expect(await sent(a)).toBe(muted);
  await expect(ring(b, 'Алиса')).toHaveCount(0);

  // «Не слышать»: чужие кадры не воспроизводятся и не считаются
  await voiceBar(a).getByRole('button', { name: 'Выключить звук' }).click();
  const deaf = await received(a);
  await a.page.waitForTimeout(1000);
  expect(await received(a)).toBe(deaf);
  // Включить микрофон при «не слышать» — снова слышать и говорить (как в Discord)
  await voiceBar(a).getByRole('button', { name: 'Включить микрофон' }).click();
  await expect(voiceBar(a).getByRole('button', { name: 'Выключить звук' })).toBeVisible();
  await expect.poll(() => sent(a)).toBeGreaterThan(muted);
  await expect.poll(() => received(a)).toBeGreaterThan(deaf);

  // Выход: панель пропала, в списке канала остался только Боб
  await voiceBar(a).getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(voiceBar(a)).toHaveCount(0);
  await expect(voiceUser(b, 'Алиса')).toHaveCount(0);
  await expect(voiceUser(a, 'Алиса')).toHaveCount(0);
  await expect(voiceUser(a, 'Боб')).toBeVisible();

  // Закрытая вкладка выходит из канала
  await b.context.close();
  await expect(voiceUser(a, 'Боб')).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  await a.context.close();
});

test('voice re-joins after the WebSocket reconnects; settings persist', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Переподключение');
  await joinServer(b, code, 'Переподключение');
  const sock = await controlSocket(a);
  await a.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await b.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(voiceUser(b, 'Алиса')).toBeVisible();
  await expect.poll(() => received(b)).toBeGreaterThan(0);

  // Обрыв: сервер выкидывает Алису из канала, после переподключения она входит снова
  await sock.drop();
  await expect.poll(() => sock.connections()).toBe(2);
  await expect(voiceBar(a)).toContainText('Голос подключён');
  await expect(voiceUser(b, 'Алиса')).toBeVisible();
  const before = await received(b);
  await expect.poll(() => received(b)).toBeGreaterThan(before + 10);

  // Уровни запоминаются в браузере
  await voiceBar(a).getByRole('button', { name: 'Настройки звука' }).click();
  const dialog = a.page.locator('.modal', { hasText: 'Голос и звук' });
  await expect(dialog.locator('select').first()).toBeVisible();
  // Ползунки с шагом 5%: усиление 100 → 150, громкость 100 → 50
  for (let i = 0; i < 10; i++) {
    await dialog.locator('input[type=range]').first().press('ArrowRight');
    await dialog.locator('input[type=range]').nth(1).press('ArrowLeft');
  }
  await expect(dialog).toContainText('150%');
  await a.page.keyboard.press('Escape');
  const prefs = await a.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.media')!));
  expect(prefs).toMatchObject({ micGain: 1.5, volume: 0.5 });

  expect(pageErrors(a.page)).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('group voice room: start from the header, the other member joins from the room bar', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await createGroup(a, 'Созвон');
  await addToGroup(a, b);

  await a.page.getByRole('button', { name: 'Голосовая комната' }).click();
  const roomA = a.page.locator('.voice-room');
  await expect(roomA).toContainText('Вы в голосовой комнате');
  await expect(voiceBar(a)).toContainText('Созвон');

  // Боб видит комнату (voice_state приходит участникам беседы) и присоединяется
  await b.page.locator('.side-item', { hasText: 'Созвон' }).click();
  const roomB = b.page.locator('.voice-room');
  await expect(roomB).toContainText('Голосовая комната');
  await expect(roomB.locator('.voice-chip', { hasText: 'Алиса' })).toBeVisible();
  await roomB.getByRole('button', { name: 'Присоединиться' }).click();
  await expect(roomB).toContainText('Вы в голосовой комнате');
  await expect(roomA.locator('.voice-chip', { hasText: 'Боб' })).toBeVisible();
  await expect(roomB.locator('.voice-chip.speaking', { hasText: 'Алиса' })).toBeVisible();
  await expect.poll(() => received(a)).toBeGreaterThan(10);
  await expect.poll(() => received(b)).toBeGreaterThan(10);

  await roomA.getByRole('button', { name: 'Выйти' }).click();
  await expect(roomA).toContainText('Голосовая комната');
  await expect(roomB.locator('.voice-chip', { hasText: 'Алиса' })).toHaveCount(0);
  await roomB.getByRole('button', { name: 'Выйти' }).click();
  await expect(roomB).toHaveCount(0);
  await expect(roomA).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('without a secure context voice explains that HTTPS is required', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  await createServer(a, 'Без HTTPS');
  // Как на http:// по IP: браузер не даёт микрофон
  await a.context.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await a.page.reload();
  await a.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(a.page.locator('.toast.error', { hasText: 'https://' })).toBeVisible();
  await expect(voiceBar(a)).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
  await a.context.close();
});
