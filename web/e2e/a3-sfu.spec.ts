import { expect, test } from '@playwright/test';
import { apiRegister, call } from './w1-helpers';

// Голос через SFU (docs/VOICE-SFU.md): GET /rtc/sfu выдаёт токен LiveKit только в свой голосовой канал.
// e2e-бэкенд «настроен» на адрес, где SFU нет (start-backend.mjs): токены есть, а клиент идёт по /ws.

function jwtPayload(token: string): Record<string, unknown> {
  const [header, payload, sig] = token.split('.');
  expect(header && payload && sig).toBeTruthy();
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  expect(JSON.parse(Buffer.from(header.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))).toEqual({ alg: 'HS256', typ: 'JWT' });
  return JSON.parse(json);
}

test('sfu token: own voice channel only, group voice rooms allowed, text channels and strangers refused', async ({ request }) => {
  const a = await apiRegister(request, 'Алиса');
  const b = await apiRegister(request, 'Боб');
  const srv = (await call(request, a, 'POST', '/servers', { name: 'Голос' })).body;
  const voice = (await call(request, a, 'POST', `/servers/${srv.server_id}/channels`, { name: 'общий', is_voice: 1 })).body.channel_id as number;
  const text = (await call(request, a, 'POST', `/servers/${srv.server_id}/channels`, { name: 'чат', is_voice: 0 })).body.channel_id as number;

  const r = await call(request, a, 'GET', `/rtc/sfu?channel_id=${voice}`);
  expect(r.status).toBe(200);
  // Адрес из start-backend.mjs; при ручном прогоне с живым LiveKit — из VICINITY_E2E_SFU_URL
  expect(r.body).toMatchObject({ url: process.env.VICINITY_E2E_SFU_URL ?? 'ws://127.0.0.1:1', room: `voice-${voice}`, identity: `u${a.id}` });
  const p = jwtPayload(r.body.token);
  expect(p).toMatchObject({ iss: 'e2ekey', sub: `u${a.id}`, name: 'Алиса', video: { roomJoin: true, room: `voice-${voice}`, canPublish: true, canSubscribe: true, canPublishData: false } });
  const now = Math.floor(Date.now() / 1000);
  expect(Number(p.exp)).toBeGreaterThan(now + 3600);
  expect(Number(p.exp)).toBeLessThan(now + 3 * 3600);

  // Текстовый канал — не голос; не участник сервера — нет доступа; нет такого канала — 404
  expect((await call(request, a, 'GET', `/rtc/sfu?channel_id=${text}`)).status).toBe(400);
  expect((await call(request, b, 'GET', `/rtc/sfu?channel_id=${voice}`)).status).toBe(403);
  expect((await call(request, a, 'GET', '/rtc/sfu?channel_id=999999')).status).toBe(404);
  expect((await call(request, a, 'GET', '/rtc/sfu')).status).toBe(400);

  // Беседа — голосовая комната: токен есть у участника, у постороннего нет
  const group = (await call(request, a, 'POST', '/channels', { type: 'group', name: 'Компания' })).body.channel_id as number;
  expect((await call(request, a, 'GET', `/rtc/sfu?channel_id=${group}`)).body.room).toBe(`voice-${group}`);
  expect((await call(request, b, 'GET', `/rtc/sfu?channel_id=${group}`)).status).toBe(403);
});
