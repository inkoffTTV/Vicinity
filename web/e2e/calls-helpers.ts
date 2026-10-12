import { expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { User } from './helpers';

// Общее для e2e звонков и видео в голосовых каналах (calls-*.spec.ts)

export const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
export const API = `http://localhost:${port}/api/v1`;
export const SHOTS = process.env.VICINITY_SHOTS_DIR ?? '';

/** Подписка пользователя прямо в базе e2e-сервера (start-backend.mjs пишет, где она лежит) */
export async function setTier(username: string, tier: number) {
  // node:sqlite подгружаем только здесь: при импорте он печатает предупреждение «experimental»
  const { DatabaseSync } = await import('node:sqlite');
  const dir = readFileSync(join(tmpdir(), `vicinity-e2e-${port}.dir`), 'utf8').trim();
  const db = new DatabaseSync(join(dir, 'vicinity.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const r = db.prepare('UPDATE users SET subscription_tier = ? WHERE username = ?').run(tier, username);
    expect(Number(r.changes)).toBe(1);
  } finally {
    db.close();
  }
}

/** Записывать параметры getDisplayMedia (и заодно дать Chromium показать «экран») */
export async function spyDisplayMedia(u: User) {
  await u.context.addInitScript(() => {
    const w = window as unknown as { __displayCalls: unknown[] };
    w.__displayCalls = [];
    const md = navigator.mediaDevices;
    if (!md?.getDisplayMedia) return;
    const orig = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = (opts?: DisplayMediaStreamOptions) => {
      w.__displayCalls.push(JSON.parse(JSON.stringify(opts ?? {})));
      return orig(opts);
    };
  });
}

export const displayCalls = (p: Page) =>
  p.evaluate(() => (window as unknown as { __displayCalls: any[] }).__displayCalls ?? []);

export const sounds = (p: Page) =>
  p.evaluate(() =>
    ((window as unknown as { __vicinitySounds?: { name: string }[] }).__vicinitySounds ?? []).map((s) => s.name),
  );

/** Сколько раз прозвучал звук */
export const soundCount = async (p: Page, name: string) => (await sounds(p)).filter((n) => n === name).length;

export const tone = (p: Page) => p.evaluate(() => (window as unknown as { __vicinityTone: string | null }).__vicinityTone);

export const videoWidth = (p: Page, selector: string) =>
  p.locator(selector).first().evaluate((v: HTMLVideoElement) => v.videoWidth);

export async function shot(p: Page, name: string) {
  if (!SHOTS) return;
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Сырой WebSocket клиента: копит JSON-события */
export class RawWs {
  readonly events: any[] = [];
  private constructor(private ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
    };
  }
  static async open(token: string): Promise<RawWs> {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    const r = new RawWs(ws);
    await r.roundTrip();
    return r;
  }
  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }
  /** ping → pong: всё отправленное до него сервер уже обработал */
  async roundTrip() {
    const n = this.events.filter((e) => e.type === 'pong').length;
    this.send({ type: 'ping' });
    await expect.poll(() => this.events.filter((e) => e.type === 'pong').length, { timeout: 10_000 }).toBe(n + 1);
  }
  async next(pred: (e: any) => boolean): Promise<any> {
    await expect.poll(() => this.events.some(pred), { timeout: 10_000 }).toBe(true);
    return this.events.find(pred);
  }
  close() {
    this.ws.close();
  }
}

// Предложение десктопа (libdatachannel, CallEngine::setupPeer) — docs/CALLS.md §3.4; как в b-desktop.spec.ts
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');
const transport = ['c=IN IP4 0.0.0.0', 'a=setup:actpass', 'a=ice-ufrag:vcnt', 'a=ice-pwd:vicinitydesktoppassword1'];
const h264 = [
  'a=rtcp-mux',
  'a=rtpmap:96 H264/90000',
  'a=rtcp-fb:96 nack',
  'a=rtcp-fb:96 nack pli',
  'a=rtcp-fb:96 goog-remb',
  'a=fmtp:96 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1',
];
export const DESKTOP_OFFER =
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

export const hasH264 = (page: Page) =>
  page.evaluate(() => (RTCRtpReceiver.getCapabilities('video')?.codecs ?? []).some((c) => /h264/i.test(c.mimeType)));
