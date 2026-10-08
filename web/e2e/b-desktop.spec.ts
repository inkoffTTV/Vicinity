import { APIRequestContext, Browser, expect, Page, test } from '@playwright/test';
import { createServer, pageErrors, registerUser, tokenOf, uniqueName, User } from './helpers';

// Совместимость браузера с десктоп-клиентом (docs/CALLS.md). «Десктоп» здесь — сырой WebSocket,
// который говорит ровно то, что говорит десктоп: его SDP, его кандидаты с «a=», голос v1 без заголовка.

const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const API = `http://localhost:${port}/api/v1`;

interface Account {
  id: number;
  token: string;
}

async function registerDesktop(request: APIRequestContext, name: string): Promise<Account> {
  const r = await request.post(`${API}/auth/register`, {
    data: { username: uniqueName('desk'), password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token };
}

async function browserAccount(request: APIRequestContext, u: User): Promise<Account> {
  const token = await tokenOf(u);
  const me = await (await request.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return { id: me.user_id, token };
}

const post = (request: APIRequestContext, a: Account, path: string, data: unknown) =>
  request.post(`${API}${path}`, { headers: { Authorization: `Bearer ${a.token}` }, data });

/** WebSocket «десктопа»: копит JSON-события по порядку и бинарные кадры. */
class Desktop {
  readonly events: any[] = [];
  readonly frames: Uint8Array[] = [];

  private constructor(private ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
      else this.frames.push(new Uint8Array(e.data as ArrayBuffer));
    };
  }

  static async open(a: Account): Promise<Desktop> {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${a.token}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    const d = new Desktop(ws);
    d.send({ type: 'ping' });
    await d.next((e) => e.type === 'pong');
    return d;
  }

  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }

  sendFrame(pcm: Uint8Array) {
    this.ws.send(pcm);
  }

  async next(pred: (e: any) => boolean): Promise<any> {
    await expect.poll(() => this.events.some(pred), { timeout: 15_000 }).toBe(true);
    return this.events.find(pred);
  }

  close() {
    this.ws.close();
  }
}

// Предложение десктопа (libdatachannel 0.22.5, CallEngine::setupPeer) — docs/CALLS.md §3.4
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 16).toString(16).toUpperCase().padStart(2, '0')).join(
  ':',
);
const transport = ['c=IN IP4 0.0.0.0', 'a=setup:actpass', 'a=ice-ufrag:vcnt', 'a=ice-pwd:vicinitydesktoppassword1'];
const h264 = [
  'a=rtcp-mux',
  'a=rtpmap:96 H264/90000',
  'a=rtcp-fb:96 nack',
  'a=rtcp-fb:96 nack pli',
  'a=rtcp-fb:96 goog-remb',
  'a=fmtp:96 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1',
];
const DESKTOP_OFFER =
  [
    'v=0',
    'o=rtc 3000004399 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE audio video screen 0',
    'a=group:LS audio video screen',
    'a=msid-semantic:WMS *',
    'a=ice-options:ice2,trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`,
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    ...transport,
    'a=mid:audio',
    'a=sendrecv',
    'a=ssrc:42 cname:vicinity-audio',
    'a=rtcp-mux',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;maxaveragebitrate=96000;stereo=1;sprop-stereo=1;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    ...transport,
    'a=mid:video',
    'a=sendrecv',
    'a=ssrc:43 cname:vicinity-video',
    ...h264,
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    ...transport,
    'a=mid:screen',
    'a=sendrecv',
    'a=ssrc:44 cname:vicinity-screen',
    ...h264,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    ...transport,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ].join('\r\n') + '\r\n';

/** m-секции SDP: первая строка (m=...) и остальные строки секции */
function sections(sdp: string): { m: string; lines: string[] }[] {
  return sdp
    .split(/\r?\n(?=m=)/)
    .slice(1)
    .map((s) => {
      const lines = s.split(/\r?\n/).filter(Boolean);
      return { m: lines[0], lines };
    });
}

const hasH264 = (page: Page) =>
  page.evaluate(() => (RTCRtpReceiver.getCapabilities('video')?.codecs ?? []).some((c) => /h264/i.test(c.mimeType)));

/**
 * Ответ старого десктопа на браузерное предложение (docs/CALLS.md §4.1): mid браузера (0, 1, 2) не совпадают
 * с его дорожками, поэтому все медиалинии отклонены (порт 0), в BUNDLE остаётся только канал данных.
 */
async function oldDesktopAnswer(browser: Browser, offer: string): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  const answer = await page.evaluate(async (sdp) => {
    const pc = new RTCPeerConnection();
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    return pc.localDescription!.sdp;
  }, offer);
  await ctx.close();
  const dataMid = sections(answer)
    .find((s) => s.m.startsWith('m=application'))!
    .lines.find((l) => l.startsWith('a=mid:'))!
    .slice(6);
  return answer
    .replace(/^m=(audio|video) 9 /gm, 'm=$1 0 ')
    .replace(/^a=group:BUNDLE .*$/m, `a=group:BUNDLE ${dataMid}`);
}

test('desktop calls the browser: answer shape, ICE order, hang-up from the desktop', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const alice = await browserAccount(request, a);
  const desk = await registerDesktop(request, 'Десктоп');
  expect((await post(request, desk, '/dms', { user_id: alice.id })).status()).toBe(201);
  const d = await Desktop.open(desk);

  d.send({ type: 'call_invite', to: alice.id, sdp: DESKTOP_OFFER, sdpType: 'offer', name: 'Десктоп' });
  // Кандидат до ответа — с префиксом «a=», как шлёт десктоп; браузер должен его придержать
  d.send({
    type: 'rtc_ice',
    to: alice.id,
    candidate: 'a=candidate:1 1 UDP 2122317823 192.0.2.10 36972 typ host',
    mid: 'audio',
  });
  const banner = a.page.locator('.call-banner');
  await expect(banner).toContainText('Десктоп');
  await banner.getByRole('button', { name: 'Принять' }).click();

  const accept = await d.next((e) => e.type === 'call_accept');
  expect(accept).toMatchObject({ from: alice.id, sdpType: 'answer' });
  // Десктоп отбрасывает кандидатов, пришедших раньше ответа
  const firstIce = d.events.findIndex((e) => e.type === 'rtc_ice');
  expect(firstIce === -1 || firstIce > d.events.indexOf(accept)).toBe(true);

  const [audio, video, screen, data] = sections(accept.sdp);
  expect(audio.m).toMatch(/^m=audio [1-9]\d* /);
  expect(audio.lines).toEqual(expect.arrayContaining(['a=mid:audio', 'a=sendrecv', 'a=rtpmap:111 opus/48000/2']));
  expect(audio.lines.some((l) => l.startsWith('a=ssrc:'))).toBe(true);
  expect(video.lines).toContain('a=mid:video');
  expect(screen.lines).toContain('a=mid:screen');
  expect(data.lines).toContain('a=mid:0');
  const callWindow = a.page.locator('.call-window');
  if (await hasH264(a.page)) {
    // Видео отвечено на отправку: камеру потом можно включить через replaceTrack
    for (const s of [video, screen]) {
      expect(s.lines).toContain('a=sendrecv');
      expect(s.lines.some((l) => l.startsWith('a=ssrc:'))).toBe(true);
    }
    await expect(callWindow.getByRole('button', { name: 'Включить камеру' })).toBeVisible();
  } else {
    // Сборка без H264: видео отклонено, звук работает, кнопки камеры нет
    expect(video.m).toMatch(/^m=video 0 /);
    expect(screen.m).toMatch(/^m=video 0 /);
    await expect(callWindow).toHaveAttribute('data-call-phase', 'connecting');
    await expect(callWindow.getByRole('button', { name: 'Включить камеру' })).toHaveCount(0);
  }

  // Свои кандидаты браузер шлёт после ответа, без «a=», с mid линии BUNDLE
  const ice = await d.next((e) => e.type === 'rtc_ice');
  expect(ice.candidate).toMatch(/^candidate:/);
  expect(ice.mid).toBe('audio');

  d.send({ type: 'call_end', to: alice.id });
  await expect(callWindow).toHaveCount(0);
  await expect(a.page.locator('.toast', { hasText: 'Десктоп завершил(а) звонок' })).toBeVisible();

  expect(pageErrors(a.page)).toEqual([]);
  d.close();
  await a.context.close();
});

test('browser calls the desktop: offer layout; an old desktop that rejects media ends the call gracefully', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const alice = await browserAccount(request, a);
  const desk = await registerDesktop(request, 'Десктоп');
  expect((await post(request, desk, '/dms', { user_id: alice.id })).status()).toBe(201);
  const d = await Desktop.open(desk);
  await a.page.reload();
  await a.page.locator('.side-item', { hasText: 'Десктоп' }).click();

  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  const invite = await d.next((e) => e.type === 'call_invite');
  expect(invite).toMatchObject({ from: alice.id, sdpType: 'offer', name: 'Алиса' });
  // Кандидаты — только после приглашения
  const firstIce = d.events.findIndex((e) => e.type === 'rtc_ice');
  expect(firstIce === -1 || firstIce > d.events.indexOf(invite)).toBe(true);
  // Порядок как у десктопа: аудио, камера, экран (все sendrecv), затем канал данных ctrl
  const offer = sections(invite.sdp);
  expect(offer.map((s) => s.m.split(' ')[0])).toEqual(['m=audio', 'm=video', 'm=video', 'm=application']);
  for (const s of offer.slice(0, 3)) expect(s.lines).toContain('a=sendrecv');
  expect(invite.sdp).toMatch(/^a=group:BUNDLE /m);

  // Старый десктоп отвечает, отклонив все медиалинии, — понятная ошибка вместо «тишины»
  d.send({ type: 'call_accept', to: alice.id, sdp: await oldDesktopAnswer(browser, invite.sdp), sdpType: 'answer' });
  await expect(a.page.locator('.toast.error', { hasText: 'старая версия Vicinity' })).toBeVisible();
  await expect(a.page.locator('.call-window')).toHaveCount(0);
  await d.next((e) => e.type === 'call_end' && e.from === alice.id);

  // Встречный звонок (glare) или занятый десктоп: call_busy — отбой с подсказкой
  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await d.next((e) => e.type === 'call_invite' && e !== invite);
  d.send({ type: 'call_busy', to: alice.id });
  await expect(a.page.locator('.toast.error', { hasText: 'Десктоп сейчас занят(а)' })).toBeVisible();
  await expect(a.page.locator('.call-window')).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  d.close();
  await a.context.close();
});

test('voice with a desktop (protocol v1): exact 640-byte frames both ways, speaking flags', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const alice = await browserAccount(request, a);
  const code = await createServer(a, 'Смешанный');
  const desk = await registerDesktop(request, 'Десктоп');
  const joined = await (await post(request, desk, '/servers/join', { code })).json();
  const chans = await (
    await request.get(`${API}/servers/${joined.server_id}/channels`, {
      headers: { Authorization: `Bearer ${desk.token}` },
    })
  ).json();
  const voiceId = chans.channels.find((c: any) => c.is_voice === 1).id;

  const d = await Desktop.open(desk);
  d.send({ type: 'voice_join', channel_id: voiceId });
  await a.page.reload();
  await expect(a.page.locator('.sidebar .voice-user', { hasText: 'Десктоп' })).toBeVisible();
  await a.page.locator('.side-item.voice', { hasText: 'Голосовой' }).click();
  await expect(a.page.locator('.voice-bar')).toContainText('Голос подключён');

  // Десктоп (v1) получает кадры браузера без заголовка — ровно 640 байт, как свои
  await expect.poll(() => d.frames.length, { timeout: 15_000 }).toBeGreaterThan(10);
  expect(new Set(d.frames.map((f) => f.length))).toEqual(new Set([640]));
  await d.next((e) => e.type === 'voice_speaking' && e.user_id === alice.id && e.speaking === true);

  // Десктоп говорит: 1 с синуса 440 Гц кадрами по 20 мс (и один короткий кадр, как бывает в ALSA)
  const received = () => a.page.evaluate(() => (window as any).__vicinityVoiceStats.framesReceived as number);
  const before = await received();
  d.send({ type: 'voice_speaking', speaking: true });
  await expect(
    a.page.locator('.sidebar .voice-user', { hasText: 'Десктоп' }).locator('.avatar.speaking'),
  ).toBeVisible();
  for (let f = 0; f < 50; f++) {
    const pcm = new DataView(new ArrayBuffer(f === 25 ? 320 : 640));
    for (let i = 0; i < pcm.byteLength / 2; i++)
      pcm.setInt16(i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * (f * 320 + i)) / 16000)), true);
    d.sendFrame(new Uint8Array(pcm.buffer));
    await new Promise((r) => setTimeout(r, 20));
  }
  await expect.poll(received).toBeGreaterThanOrEqual(before + 50);
  d.send({ type: 'voice_speaking', speaking: false });
  await expect(a.page.locator('.sidebar .voice-user', { hasText: 'Десктоп' }).locator('.avatar.speaking')).toHaveCount(
    0,
  );

  expect(pageErrors(a.page)).toEqual([]);
  d.close();
  await a.context.close();
});
