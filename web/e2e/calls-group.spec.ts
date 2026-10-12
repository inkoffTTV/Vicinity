import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser, tokenOf, uniqueName, User } from './helpers';
import { API, displayCalls, RawWs, setTier, shot, soundCount, spyDisplayMedia, videoWidth } from './calls-helpers';

// Видео в голосовом канале сервера: экран голосового канала, LIVE, просмотр трансляции, камеры, звуки.

const stage = (u: User) => u.page.locator('.voice-stage');
const tile = (u: User, name: string) => stage(u).locator(`.stage-tile[aria-label="${name}"]`);
const sideUser = (u: User, name: string) => u.page.locator('.sidebar .voice-user', { hasText: name });
const channel = (u: User) => u.page.locator('.side-item.voice', { hasText: 'Голосовой' });

test('group voice: stage tiles, screen share with LIVE, watching, cameras, sounds', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Ваня');
  await setTier(c.username, 2); // Standard — 1440p30
  await spyDisplayMedia(c);
  await c.page.reload();
  await expect(c.page.locator('.user-panel')).toContainText('В сети');
  const code = await createServer(a, 'Стримы');
  await joinServer(b, code, 'Стримы');
  await joinServer(c, code, 'Стримы');

  // Вход: экран канала открывается, свой звук входа, у остальных — «кто-то зашёл»
  await channel(a).click();
  await expect(stage(a)).toBeVisible();
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  await expect.poll(() => soundCount(a.page, 'join')).toBe(1);
  await channel(b).click();
  await expect(tile(a, 'Боб')).toBeVisible();
  await expect.poll(() => soundCount(a.page, 'userJoin')).toBe(1);
  await channel(c).click();
  await expect(stage(a).locator('.stage-tile')).toHaveCount(3);
  await expect.poll(() => soundCount(a.page, 'userJoin')).toBe(2);
  await expect(stage(c).locator('.quality-badge')).toHaveText('1440p30');

  // Ваня показывает экран: качество по подписке, у всех — LIVE и звук
  await stage(c).getByRole('button', { name: 'Показать экран' }).click();
  await expect(stage(c).locator('.quality-badge.live')).toHaveText('1440p30');
  expect((await displayCalls(c.page)).at(-1).video).toMatchObject({
    width: { max: 2560 },
    height: { max: 1440 },
    frameRate: { max: 30 },
  });
  for (const u of [a, b]) {
    await expect(tile(u, 'Ваня').locator('.stage-live')).toBeVisible();
    await expect(sideUser(u, 'Ваня').locator('.live-badge')).toBeVisible();
  }
  await expect.poll(() => soundCount(a.page, 'streamStart')).toBe(1);
  await expect(stage(a).locator('.stage-head .live-badge')).toContainText('LIVE 1');

  // Алиса и Боб смотрят: видео приходит (videoWidth > 0), у Вани — двое зрителей
  await tile(a, 'Ваня').getByRole('button', { name: 'Смотреть' }).click();
  const streamA = stage(a).locator('.stage-stream video');
  await expect(streamA).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => videoWidth(a.page, '.stage-stream video')).toBeGreaterThan(0);
  await tile(b, 'Ваня').getByRole('button', { name: 'Смотреть' }).click();
  await expect.poll(() => videoWidth(b.page, '.stage-stream video'), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(stage(c).locator('.stage-viewers')).toContainText('зрителей: 2 из 8');
  await expect(tile(a, 'Ваня').getByRole('button', { name: 'Скрыть' })).toBeVisible();

  // Полный экран трансляции
  await stage(a).locator('.stage-stream').hover();
  await stage(a).locator('.stage-stream').getByRole('button', { name: 'Во весь экран' }).click();
  await expect
    .poll(() => a.page.evaluate(() => document.fullscreenElement?.classList.contains('stage-stream') ?? false))
    .toBe(true);
  await a.page.evaluate(() => document.exitFullscreen());

  // Камера Боба: на открытом экране канала показывается сама, в плитке
  await stage(b).getByRole('button', { name: 'Включить камеру' }).click();
  await expect(sideUser(a, 'Боб').locator('.voice-user-cam')).toBeVisible();
  await expect.poll(() => videoWidth(a.page, '.stage-tile[aria-label="Боб"] video'), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(tile(b, 'Боб').locator('video.mirror')).toBeVisible(); // своё превью
  await shot(a.page, 'group-stage-desktop');
  await shot(c.page, 'group-stage-streamer-desktop');
  await a.page.setViewportSize({ width: 390, height: 844 });
  await expect(stage(a).getByRole('button', { name: 'Отключиться от голосового канала' })).toBeInViewport();
  await shot(a.page, 'group-stage-mobile');
  await a.page.setViewportSize({ width: 1280, height: 800 });

  // Предел зрителей: ещё 7 «зрителей» через WebSocket — девятый получает отказ «full»
  const cId = (await (await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${await tokenOf(c)}` } })).json())
    .user_id;
  const servers = await (await request.get(`${API}/servers`, { headers: { Authorization: `Bearer ${await tokenOf(a)}` } })).json();
  const server = (servers.servers ?? servers).find((s: any) => s.name === 'Стримы');
  const chans = (
    await (await request.get(`${API}/servers/${server.id}/channels`, { headers: { Authorization: `Bearer ${await tokenOf(a)}` } })).json()
  ).channels;
  const voiceId = chans.find((x: any) => x.is_voice === 1 || x.is_voice === true).id;
  const extra: RawWs[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await request.post(`${API}/auth/register`, {
      data: { username: uniqueName('viewer'), password: 'password123', display_name: `Зритель ${i}` },
    });
    const token = (await r.json()).token;
    await request.post(`${API}/servers/join`, { headers: { Authorization: `Bearer ${token}` }, data: { code } });
    const w = await RawWs.open(token);
    w.send({ type: 'voice_join', channel_id: voiceId, proto: 2 });
    await w.next((e) => e.type === 'voice_state' && e.users.length === 3 + i + 1);
    extra.push(w);
  }
  // По одному: сообщения разных подключений сервер может переставить местами
  for (const w of extra.slice(0, 6)) {
    w.send({ type: 'voice_rtc', to: cId, kind: 'screen', action: 'watch' });
    await w.next((e) => e.type === 'voice_rtc' && e.action === 'offer' && e.kind === 'screen' && e.from === cId);
  }
  extra[6].send({ type: 'voice_rtc', to: cId, kind: 'screen', action: 'watch' });
  const ninth = await extra[6].next((e) => e.type === 'voice_rtc' && e.from === cId);
  expect(ninth).toMatchObject({ action: 'stop', reason: 'full' });
  await expect(c.page.locator('.toast', { hasText: 'максимум зрителей' })).toBeVisible();
  for (const w of extra) w.close();
  await expect(stage(a).locator('.stage-tile')).toHaveCount(3);

  // Ваня прекращает показ: у зрителей трансляция закрывается, LIVE пропадает, звук «стоп»
  await stage(c).getByRole('button', { name: 'Остановить показ экрана' }).click();
  await expect(stage(a).locator('.stage-stream')).toHaveCount(0);
  await expect(stage(b).locator('.stage-stream')).toHaveCount(0);
  await expect(sideUser(a, 'Ваня').locator('.live-badge')).toHaveCount(0);
  await expect.poll(() => soundCount(a.page, 'streamStop')).toBeGreaterThanOrEqual(1);

  // Микрофон и звук — звуки переключателей
  await stage(a).getByRole('button', { name: 'Выключить микрофон' }).click();
  await stage(a).getByRole('button', { name: 'Выключить звук' }).click();
  await stage(a).getByRole('button', { name: 'Включить звук' }).click();
  await stage(a).getByRole('button', { name: 'Включить микрофон' }).click();
  for (const s of ['mute', 'deafen', 'undeafen', 'unmute']) expect(await soundCount(a.page, s)).toBe(1);

  // Боб уходит — «кто-то вышел»; Алиса уходит — экран канала закрывается, свой звук выхода
  await stage(b).getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(tile(a, 'Боб')).toHaveCount(0);
  await expect.poll(() => soundCount(a.page, 'userLeave')).toBeGreaterThanOrEqual(1);
  await expect(stage(b)).toHaveCount(0);
  await stage(a).getByRole('button', { name: 'Вернуться к чату' }).click();
  await expect(stage(a)).toHaveCount(0);
  await a.page.locator('.voice-bar').getByRole('button', { name: 'Открыть голосовой канал' }).click();
  await expect(stage(a)).toBeVisible();
  await stage(a).getByRole('button', { name: 'Отключиться от голосового канала' }).click();
  await expect(stage(a)).toHaveCount(0);
  await expect.poll(() => soundCount(a.page, 'leave')).toBe(1);

  for (const u of [a, b, c]) {
    expect(pageErrors(u.page)).toEqual([]);
    await u.context.close();
  }
});
