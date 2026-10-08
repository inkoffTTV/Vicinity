import { expect, test } from '@playwright/test';
import { createGroup, makeFriends, openDm, pageErrors, registerUser, User } from './helpers';

// Звонки 1:1 между браузерами (сигналинг и SDP как у десктопа — docs/CALLS.md §3–§5).
// Состояние звонка видно в DOM: data-call-phase и data-call-connection (RTCPeerConnection.connectionState).

const callWindow = (u: User) => u.page.locator('.call-window');
const banner = (u: User) => u.page.locator('.call-banner');
const inCall = (u: User) => u.page.locator('[data-call-phase="active"][data-call-connection="connected"]');
const idle = async (u: User) => {
  await expect(callWindow(u)).toHaveCount(0);
  await expect(u.page.locator('.call-pill')).toHaveCount(0);
  await expect(banner(u)).toHaveCount(0);
};

/** Сколько живых дорожек у звука собеседника */
const remoteAudioTracks = (u: User) =>
  u.page
    .locator('audio.call-remote-audio')
    .evaluate(
      (el: HTMLAudioElement) =>
        (el.srcObject as MediaStream | null)?.getAudioTracks().filter((t) => t.readyState === 'live').length ?? 0,
    );

async function call(from: User, to: User) {
  await from.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(callWindow(from)).toHaveAttribute('data-call-phase', /outgoing|connecting/);
  await expect(banner(to)).toContainText(from.displayName);
}

test('call: accept, both connected with audio, camera and screen reach the other side, hang up', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await openDm(a, b);

  await call(a, b);
  await expect(callWindow(a)).toContainText('Вызов…');
  await banner(b).getByRole('button', { name: 'Принять' }).click();
  await expect(banner(b)).toHaveCount(0);
  await expect(inCall(a)).toBeVisible({ timeout: 20_000 });
  await expect(inCall(b)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => remoteAudioTracks(a)).toBe(1);
  await expect.poll(() => remoteAudioTracks(b)).toBe(1);
  await expect(callWindow(a).locator('.call-status')).toHaveText(/^\d\d:\d\d$/);

  // Камера Боба включается без пересогласования (replaceTrack + ctrl) и видна Алисе
  await callWindow(b).getByRole('button', { name: 'Включить камеру' }).click();
  await expect(callWindow(b).locator('video.call-video.self')).toBeVisible();
  const remoteCamera = callWindow(a).locator('video.remote-camera');
  await expect(remoteCamera).toBeVisible();
  await expect.poll(() => remoteCamera.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  // Выключил — у Алисы снова аватар (по сообщению ctrl {"video":false})
  await callWindow(b).getByRole('button', { name: 'Выключить камеру' }).click();
  await expect(remoteCamera).toHaveCount(0);
  await expect(callWindow(b).locator('video.call-video.self')).toHaveCount(0);

  // Показ экрана — своя линия, вместе с камерой: у Алисы экран крупно, камера Боба рядом
  await callWindow(b).getByRole('button', { name: 'Включить камеру' }).click();
  await callWindow(b).getByRole('button', { name: 'Показать экран' }).click();
  await expect(callWindow(b)).toContainText('Вы показываете экран');
  const remoteScreen = callWindow(a).locator('video.remote-screen');
  await expect(remoteScreen).toBeVisible();
  await expect.poll(() => remoteScreen.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await expect(callWindow(a).locator('video.call-video.side.remote-camera')).toBeVisible();
  await callWindow(b).getByRole('button', { name: 'Остановить показ экрана' }).click();
  await expect(remoteScreen).toHaveCount(0);
  await expect(callWindow(a).locator('video.call-video.main.remote-camera')).toBeVisible();
  await callWindow(b).getByRole('button', { name: 'Выключить камеру' }).click();
  await expect(callWindow(a).locator('video.remote-camera')).toHaveCount(0);

  // Микрофон: выключается в звонке
  await callWindow(a).getByRole('button', { name: 'Выключить микрофон' }).click();
  await expect(callWindow(a).getByRole('button', { name: 'Включить микрофон' })).toBeVisible();

  // Свернуть в «таблетку» и обратно — звонок продолжается
  await callWindow(a).getByRole('button', { name: 'Свернуть звонок' }).click();
  await expect(callWindow(a)).toHaveCount(0);
  const pill = a.page.locator('.call-pill[data-call-phase="active"]');
  await expect(pill).toContainText('Боб');
  await expect(a.page.locator('.composer textarea')).toBeVisible();
  await pill.getByRole('button', { name: 'Развернуть звонок' }).click();
  await expect(inCall(a)).toBeVisible();

  await callWindow(a).getByRole('button', { name: 'Завершить звонок' }).click();
  await idle(a);
  await idle(b);
  await expect(b.page.locator('.toast', { hasText: 'Звонок завершён' })).toBeVisible();

  // Звонок из профиля друга; теперь трубку кладёт Боб
  await b.page.locator('.rail-item.home').click();
  await b.page.locator('.tabs button', { hasText: 'Все' }).click();
  await b.page.locator('.friend-row', { hasText: 'Алиса' }).locator('.friend-main').click();
  await b.page.locator('.profile-card').getByRole('button', { name: 'Позвонить' }).click();
  await expect(b.page.locator('.profile-card')).toHaveCount(0);
  await expect(banner(a)).toContainText('Боб');
  await banner(a).getByRole('button', { name: 'Принять' }).click();
  await expect(inCall(b)).toBeVisible({ timeout: 20_000 });
  await callWindow(b).getByRole('button', { name: 'Завершить звонок' }).click();
  await idle(a);
  await idle(b);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('call: declined, and a third caller hears busy while it rings', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Ваня');
  await openDm(a, b);
  await openDm(c, b);

  await call(a, b);
  // Боб уже занят входящим — Ване «занято»
  await c.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(c.page.locator('.toast.error', { hasText: 'Боб сейчас занят(а)' })).toBeVisible();
  await idle(c);
  await expect(banner(b)).toContainText('Алиса');

  await banner(b).getByRole('button', { name: 'Отклонить' }).click();
  await idle(b);
  await expect(a.page.locator('.toast', { hasText: 'Боб отклонил(а) звонок' })).toBeVisible();
  await idle(a);

  // Звонящий передумал до ответа — у Боба звонок пропадает
  await call(a, b);
  await callWindow(a).getByRole('button', { name: 'Завершить звонок' }).click();
  await idle(a);
  await idle(b);
  await expect(b.page.locator('.toast', { hasText: 'Пропущенный звонок от Алиса' })).toBeVisible();

  for (const u of [a, b, c]) {
    expect(pageErrors(u.page)).toEqual([]);
    await u.context.close();
  }
});

test('call: the callee is offline — the caller is told right away and stays in voice', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDm(a, b);
  await b.context.close();
  // Алиса сидит в голосовой комнате беседы: неудавшийся звонок её оттуда не выкидывает
  await createGroup(a, 'Комната');
  await a.page.getByRole('button', { name: 'Голосовая комната' }).click();
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  await a.page.locator('.side-item', { hasText: 'Боб' }).click();

  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(a.page.locator('.toast.error', { hasText: 'Боб сейчас не в сети' })).toBeVisible();
  await idle(a);
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');
  expect(pageErrors(a.page)).toEqual([]);
  await a.context.close();
});
