import { expect, test } from '@playwright/test';
import { makeFriends, openDm, pageErrors, registerUser, tokenOf, uniqueName, User } from './helpers';
import {
  API,
  DESKTOP_OFFER,
  displayCalls,
  hasH264,
  RawWs,
  setTier,
  shot,
  soundCount,
  sounds,
  spyDisplayMedia,
  tone,
  videoWidth,
} from './calls-helpers';

// Звонок 1:1: выбор источника крупно, полный экран, качество экрана по подписке, звуки.

const win = (u: User) => u.page.locator('.call-window');
const stage = (u: User) => win(u).locator('.call-stage');
const banner = (u: User) => u.page.locator('.call-banner');
const inCall = (u: User) => u.page.locator('[data-call-phase="active"][data-call-connection="connected"]');

test('1:1 call: source swap, fullscreen, tier screen quality, sounds', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  // У Алисы Ultra — экран до 1440p60, у Боба подписки нет — 1080p30
  await setTier(a.username, 3);
  await spyDisplayMedia(a);
  await spyDisplayMedia(b);
  await a.page.reload();
  await b.page.reload();
  await expect(a.page.locator('.user-panel')).toContainText('В сети');
  await openDm(a, b);

  // Исходящий: гудки, пока не ответили
  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(banner(b)).toContainText('Алиса');
  await expect.poll(() => tone(a.page)).toBe('outgoing');
  await expect.poll(() => tone(b.page)).toBe('incoming');
  await shot(b.page, 'call-incoming-desktop');
  await banner(b).getByRole('button', { name: 'Принять' }).click();
  await expect(inCall(a)).toBeVisible({ timeout: 20_000 });
  await expect(inCall(b)).toBeVisible({ timeout: 20_000 });
  expect(await tone(a.page)).toBeNull();
  expect(await tone(b.page)).toBeNull();
  await expect.poll(() => soundCount(a.page, 'join')).toBe(1);
  await expect.poll(() => soundCount(b.page, 'join')).toBe(1);
  // Без видео — аватар крупно
  await expect(stage(a)).toHaveAttribute('data-main', 'peer');

  // Боб: камера и экран (без подписки — 1080p30)
  await expect(win(b).locator('.quality-badge')).toHaveText('1080p30');
  await win(b).getByRole('button', { name: 'Качество показа экрана' }).click();
  await expect(b.page.locator('.screen-quality-menu .upgrade-hint')).toContainText('Ultra');
  await b.page.keyboard.press('Escape');
  // Первую секунду разговора начальные флаги собеседника не озвучиваются
  await b.page.waitForTimeout(1500);
  await win(b).getByRole('button', { name: 'Включить камеру' }).click();
  await expect.poll(() => soundCount(a.page, 'streamStart')).toBe(1);
  await expect(stage(a)).toHaveAttribute('data-main', 'remote-camera');
  await win(b).getByRole('button', { name: 'Показать экран' }).click();
  await expect(win(b)).toContainText('Вы показываете экран · 1080p30');
  const bCall = (await displayCalls(b.page)).at(-1);
  expect(bCall.video).toMatchObject({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } });

  // У Алисы экран Боба крупно (экран важнее камеры), камера — миниатюрой
  await expect(stage(a)).toHaveAttribute('data-main', 'remote-screen');
  await expect.poll(() => soundCount(a.page, 'streamStart')).toBe(2);
  await expect.poll(() => videoWidth(a.page, '.call-window video.call-video.main.remote-screen')).toBeGreaterThan(0);
  // Ползунок громкости экрана собеседника в подписи крупного кадра
  await win(a).locator('.call-main-label .stream-volume input[type=range]').fill('0.5');
  await expect
    .poll(() => a.page.evaluate(() => document.querySelector<HTMLVideoElement>('.call-window video.call-video.main.remote-screen')!.volume))
    .toBeCloseTo(0.5, 1);
  const camThumb = win(a).getByRole('button', { name: 'Показать крупно: Камера: Боб' });
  await expect(camThumb.locator('video.remote-camera')).toBeVisible();
  await shot(a.page, 'call-screen-desktop');

  // Выбор источника: камеру крупно, экран — в миниатюры
  await camThumb.click();
  await expect(stage(a)).toHaveAttribute('data-main', 'remote-camera');
  await expect.poll(() => videoWidth(a.page, '.call-window video.call-video.main.remote-camera')).toBeGreaterThan(0);
  await expect(win(a).getByRole('button', { name: 'Показать крупно: Экран: Боб' })).toBeVisible();
  await win(a).getByRole('button', { name: 'Показать крупно: Экран: Боб' }).click();
  await expect(stage(a)).toHaveAttribute('data-main', 'remote-screen');

  // Полный экран — настоящий (Fullscreen API) на области видео
  await win(a).getByRole('button', { name: 'Во весь экран' }).first().click();
  await expect
    .poll(() => a.page.evaluate(() => document.fullscreenElement?.classList.contains('call-stage') ?? false))
    .toBe(true);
  await expect(stage(a)).toHaveClass(/full/);
  await shot(a.page, 'call-fullscreen-desktop');
  await stage(a).getByRole('button', { name: 'Выйти из полноэкранного режима' }).click();
  await expect.poll(() => a.page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  // Микрофон — звуки
  await win(a).getByRole('button', { name: 'Выключить микрофон' }).click();
  await win(a).getByRole('button', { name: 'Включить микрофон' }).click();
  expect(await soundCount(a.page, 'mute')).toBe(1);
  expect(await soundCount(a.page, 'unmute')).toBe(1);

  // Алиса показывает экран: Ultra и «Плавность» — 1440p60 с потолком 10 Мбит/с
  await expect(win(a).locator('.quality-badge')).toHaveText('1440p60');
  await win(a).getByRole('button', { name: 'Показать экран' }).click();
  await expect(win(a)).toContainText('Вы показываете экран · 1440p60');
  const aCall = (await displayCalls(a.page)).at(-1);
  expect(aCall.video).toMatchObject({
    width: { ideal: 2560, max: 2560 },
    height: { ideal: 1440, max: 1440 },
    frameRate: { ideal: 60, max: 60 },
  });
  await expect
    .poll(() => a.page.evaluate(() => (window as any).__vicinityMedia.screen?.params?.encodings?.[0] ?? null))
    .toMatchObject({ maxBitrate: 10_000_000, maxFramerate: 60 });
  // Своё превью — миниатюрой
  await expect(win(a).getByRole('button', { name: 'Показать крупно: Ваш экран' })).toBeVisible();
  await expect(stage(b)).toHaveAttribute('data-main', 'remote-screen');
  await expect.poll(() => soundCount(b.page, 'streamStart')).toBe(1);
  await win(a).getByRole('button', { name: 'Остановить показ экрана' }).click();
  await expect.poll(() => soundCount(b.page, 'streamStop')).toBe(1);

  // «Чёткость» на Ultra — 1440p30
  await win(a).getByRole('button', { name: 'Качество показа экрана' }).click();
  await a.page.locator('.screen-quality-menu').getByRole('radio', { name: /Чёткость/ }).click();
  await a.page.keyboard.press('Escape');
  await expect(win(a).locator('.quality-badge')).toHaveText('1440p30');
  await win(a).getByRole('button', { name: 'Показать экран' }).click();
  await expect(win(a)).toContainText('· 1440p30');
  expect((await displayCalls(a.page)).at(-1).video.frameRate.max).toBe(30);
  await win(a).getByRole('button', { name: 'Остановить показ экрана' }).click();

  // Мобильный портрет: всё помещается, кнопки доступны
  await a.page.setViewportSize({ width: 390, height: 844 });
  await expect(win(a).getByRole('button', { name: 'Завершить звонок' })).toBeInViewport();
  await shot(a.page, 'call-mobile');
  await a.page.setViewportSize({ width: 1280, height: 800 });

  // Боб выключает экран — у Алисы снова камера крупно; конец звонка — сигнал у обоих
  await win(b).getByRole('button', { name: 'Остановить показ экрана' }).click();
  await expect(stage(a)).toHaveAttribute('data-main', 'remote-camera');
  await expect.poll(() => soundCount(a.page, 'streamStop')).toBeGreaterThanOrEqual(1);
  await win(a).getByRole('button', { name: 'Завершить звонок' }).click();
  await expect(win(a)).toHaveCount(0);
  await expect(win(b)).toHaveCount(0);
  await expect.poll(() => soundCount(a.page, 'callEnd')).toBe(1);
  await expect.poll(() => soundCount(b.page, 'callEnd')).toBe(1);

  // Отклонённый звонок: у звонящего гудки прекращаются и звучит отбой
  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await banner(b).getByRole('button', { name: 'Отклонить' }).click();
  await expect(win(a)).toHaveCount(0);
  await expect.poll(() => soundCount(a.page, 'callEnd')).toBe(2);
  expect(await tone(a.page)).toBeNull();

  expect((await sounds(a.page)).length).toBeGreaterThan(5);
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('desktop peer: screen share is capped at 1080p30 even on Ultra', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  await setTier(a.username, 3);
  await spyDisplayMedia(a);
  await a.page.reload();
  await expect(a.page.locator('.user-panel')).toContainText('В сети');
  test.skip(!(await hasH264(a.page)), 'Сборка Chromium без H264: у десктопа нет видео');
  const token = await tokenOf(a);
  const me = await (await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const reg = await request.post(`${API}/auth/register`, {
    data: { username: uniqueName('desk'), password: 'password123', display_name: 'Десктоп' },
  });
  const desk = await reg.json();
  await request.post(`${API}/dms`, { headers: { Authorization: `Bearer ${desk.token}` }, data: { user_id: me.user_id, username: a.username } });
  const d = await RawWs.open(desk.token);
  d.send({ type: 'call_invite', to: me.user_id, sdp: DESKTOP_OFFER, sdpType: 'offer', name: 'Десктоп' });
  await banner(a).getByRole('button', { name: 'Принять' }).click();
  await d.next((e) => e.type === 'call_accept');
  await expect(win(a).locator('.quality-badge')).toHaveText('1080p30');
  await win(a).getByRole('button', { name: 'Показать экран' }).click();
  await expect(win(a)).toContainText('Вы показываете экран · 1080p30');
  expect((await displayCalls(a.page)).at(-1).video).toMatchObject({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } });
  await win(a).getByRole('button', { name: 'Качество показа экрана' }).click();
  await expect(a.page.locator('.screen-quality-menu')).toContainText('десктоп-клиент');
  await a.page.keyboard.press('Escape');
  d.send({ type: 'call_end', to: me.user_id });
  await expect(win(a)).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
  d.close();
  await a.context.close();
});
