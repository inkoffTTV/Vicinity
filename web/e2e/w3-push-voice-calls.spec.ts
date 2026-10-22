import { expect, test } from '@playwright/test';
import { createServer as createHttpServer, IncomingMessage } from 'node:http';
import { webcrypto } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { makeFriends, openDm, pageErrors, registerUser, send, User } from './helpers';
import { apiUser, call, composer, msg, post } from './w1-helpers';

const { subtle } = webcrypto;

// ── Web Push (docs/API.md §14): сервер шифрует по RFC 8291 и подписывает VAPID; приёмник на loopback
// расшифровывает ключами «браузера» и проверяет подпись ──

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

const text = (s: string) => new TextEncoder().encode(s);

/** Расшифровка aes128gcm (RFC 8188 + RFC 8291) приватным ключом подписчика */
async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublicRaw: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  expect(rs).toBe(4096);
  const idLen = body[20];
  expect(idLen).toBe(65);
  const asPublicRaw = body.slice(21, 21 + 65);
  const cipher = body.slice(21 + 65);
  const asPublic = await subtle.importKey('raw', asPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asPublic }, uaPrivate, 256));
  const keyInfo = new Uint8Array([...text('WebPush: info'), 0, ...uaPublicRaw, ...asPublicRaw]);
  const ikm = await hkdf(auth, secret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, new Uint8Array([...text('Content-Encoding: aes128gcm'), 0]), 16);
  const nonce = await hkdf(salt, ikm, new Uint8Array([...text('Content-Encoding: nonce'), 0]), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2); // разделитель последней записи
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function verifyVapid(authorization: string, vapidPublic: string, audience: string) {
  const m = /^vapid t=([^,]+), k=([^,]+)$/.exec(authorization);
  expect(m, 'заголовок Authorization: vapid').toBeTruthy();
  expect(m![2]).toBe(vapidPublic);
  const [h, p, sig] = m![1].split('.');
  expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  expect(claims.aud).toBe(audience);
  expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  expect(claims.sub).toMatch(/^mailto:/);
  const key = await subtle.importKey('raw', fromB64url(vapidPublic), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(sig), text(`${h}.${p}`));
  expect(ok, 'подпись VAPID').toBe(true);
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
}

test('push: subscription API, encrypted and signed delivery to an offline recipient, dead endpoint removed', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  const alice = await apiUser(request, a);
  const bob = await apiUser(request, b);

  const vapid = (await call(request, bob, 'GET', '/push/vapid')).body.key as string;
  expect(fromB64url(vapid).length).toBe(65);

  // «Браузер» Боба: ключи подписки и приёмник на loopback
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublicRaw = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const received: { headers: IncomingMessage['headers']; body: Uint8Array; path: string }[] = [];
  const server = createHttpServer(async (req, res) => {
    received.push({ headers: req.headers, body: await readBody(req), path: req.url ?? '' });
    res.statusCode = req.url?.includes('dead') ? 410 : 201;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const endpoint = `${origin}/push/bob-phone`;
  const keys = { p256dh: b64url(uaPublicRaw), auth: b64url(auth) };

  // Валидация подписки
  expect((await call(request, bob, 'POST', '/push/subscribe', { endpoint: 'ftp://x', keys })).status).toBe(400);
  expect((await call(request, bob, 'POST', '/push/subscribe', { endpoint, keys: { p256dh: keys.p256dh } })).status).toBe(400);
  const sub = await call(request, bob, 'POST', '/push/subscribe', { endpoint, keys, prefs: { muted: [], servers: {} } });
  expect(sub.status).toBe(200);
  // Второй, мёртвый endpoint — сервис ответит 410, подписка должна исчезнуть
  expect((await call(request, bob, 'POST', '/push/subscribe', { endpoint: `${origin}/push/dead`, keys })).status).toBe(200);

  // Боб уходит из сети; Алиса пишет в личку
  const dm = (await call(request, alice, 'POST', '/dms', { user_id: bob.id })).body.channel_id as number;
  await b.context.close();
  await a.page.waitForTimeout(800);
  await post(request, alice, dm, 'Боб, ты где? Срочно');

  await expect.poll(() => received.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const hit = received.find((r) => r.path === '/push/bob-phone')!;
  expect(hit.headers['content-encoding']).toBe('aes128gcm');
  expect(hit.headers['ttl']).toBe('86400');
  expect(hit.headers['urgency']).toBe('high');
  await verifyVapid(String(hit.headers['authorization']), vapid, origin);
  const payload = JSON.parse(await decrypt(hit.body, ua.privateKey, uaPublicRaw, auth));
  expect(payload).toMatchObject({ t: 'msg', title: 'Алиса', body: 'Боб, ты где? Срочно', tag: `ch-${dm}`, url: `/channels/@me/${dm}` });

  // Мёртвая подписка удалена: при следующем сообщении на неё ничего не уходит
  await expect.poll(async () => received.filter((r) => r.path === '/push/dead').length).toBe(1);
  const before = received.length;
  await post(request, alice, dm, 'ещё одно');
  await expect.poll(() => received.length, { timeout: 15_000 }).toBe(before + 1);
  expect(received.slice(before).every((r) => r.path === '/push/bob-phone')).toBe(true);

  // Заглушённый канал в prefs — без push
  await call(request, bob, 'POST', '/push/subscribe', { endpoint, keys, prefs: { muted: [dm], servers: {} } });
  await post(request, alice, dm, 'тишина');
  await a.page.waitForTimeout(1500);
  expect(received.length).toBe(before + 1);

  // Отписка
  expect((await call(request, bob, 'DELETE', '/push/subscribe', { endpoint })).status).toBe(200);
  server.close();
  expect(pageErrors(a.page)).toEqual([]);
});

// ── Голосовое сообщение: запись (поддельный микрофон Chromium), волна, плеер у собеседника ──

test('voice message: record, send, play on the other side, sidebar preview', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await openDm(a, b);
  await openDm(b, a);

  // Пустое поле — вместо «Отправить» микрофон
  await expect(a.page.getByRole('button', { name: 'Отправить' })).toHaveCount(0);
  await a.page.getByRole('button', { name: 'Записать голосовое сообщение' }).click();
  const rec = a.page.locator('.composer-rec');
  await expect(rec).toBeVisible();
  await expect(rec.locator('.rec-time')).not.toHaveText('0:00', { timeout: 5000 });
  await a.page.waitForTimeout(1200);
  await rec.getByRole('button', { name: 'Отправить голосовое' }).click();
  await expect(rec).toHaveCount(0);

  const mine = a.page.locator('[data-testid="voice-message"]');
  await expect(mine).toBeVisible();
  await expect(a.page.locator('.msg.pending')).toHaveCount(0, { timeout: 15_000 });
  await expect(mine.locator('.voice-wave i')).toHaveCount(48);
  await expect(mine.locator('.voice-time')).toHaveText(/^0:0[1-9]$/);

  const theirs = b.page.locator('[data-testid="voice-message"]');
  await expect(theirs).toBeVisible();
  await theirs.getByRole('button', { name: 'Слушать голосовое сообщение' }).click();
  await expect(theirs).toHaveClass(/playing/);
  await expect(theirs.locator('.voice-wave i.done').first()).toBeVisible({ timeout: 5000 });
  await theirs.getByRole('button', { name: /Скорость/ }).click();
  await expect(theirs.getByRole('button', { name: /Скорость/ })).toHaveText('1.5×');
  // Превью в списке личек
  await expect(b.page.locator('.side-item', { hasText: 'Алиса' })).toContainText('Голосовое сообщение');

  // Текст набран — снова кнопка «Отправить»
  await composer(a).fill('а теперь текст');
  await expect(a.page.getByRole('button', { name: 'Отправить' })).toBeVisible();
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

// ── История звонков в личке: отклонённый, затем принятый и завершённый, кнопка «Перезвонить» ──

test('calls: declined and completed calls become call notes with a callback button', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await openDm(a, b);
  await openDm(b, a);
  const banner = (u: User) => u.page.locator('.call-banner');
  const callWindow = (u: User) => u.page.locator('.call-window');

  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(banner(b)).toContainText('Алиса');
  await banner(b).getByRole('button', { name: 'Отклонить' }).click();
  await expect(callWindow(a)).toHaveCount(0);
  const noteA = a.page.locator('[data-testid="call-note"]');
  const noteB = b.page.locator('[data-testid="call-note"]');
  await expect(noteA).toContainText('Звонок отклонён');
  await expect(noteB).toContainText('Вы отклонили звонок');

  // Перезвонить из записи — звонит Боб Алисе; Алиса принимает, кладут трубку — запись с длительностью
  await noteB.getByRole('button', { name: /Перезвонить/ }).click();
  await expect(banner(a)).toContainText('Боб');
  await banner(a).getByRole('button', { name: 'Принять' }).click();
  await expect(a.page.locator('[data-call-phase="active"]')).toBeVisible({ timeout: 20_000 });
  await a.page.waitForTimeout(1500);
  await callWindow(a).getByRole('button', { name: 'Завершить звонок' }).first().click();
  await expect(callWindow(a)).toHaveCount(0);
  await expect(noteA.last()).toContainText('Входящий звонок');
  await expect(noteB.last()).toContainText('Исходящий звонок');
  await expect(noteB.last()).toContainText(/0:0\d/);
  // Превью в списке личек
  await expect(a.page.locator('.side-item', { hasText: 'Боб' })).toContainText('Звонок');
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

// ── Поиск: FTS5 — по началу слова и без учёта регистра ──

test('search: prefix and case-insensitive matches via FTS5', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await makeFriends(a, b);
  await openDm(a, b);
  await send(a, 'Переправа выходит в пятницу');
  await send(a, 'а тут ничего похожего');
  const alice = await apiUser(request, a);
  const r = await call(request, alice, 'GET', '/search?q=' + encodeURIComponent('перепр пятн'));
  expect(r.status).toBe(200);
  expect(r.body.results.map((m: { text: string }) => m.text)).toEqual(['Переправа выходит в пятницу']);
  const none = await call(request, alice, 'GET', '/search?q=' + encodeURIComponent('перепр суббот'));
  expect(none.body.results).toEqual([]);
  // Служебные символы запроса не ломают поиск
  const odd = await call(request, alice, 'GET', '/search?q=' + encodeURIComponent('пятн* ("x") OR'));
  expect(odd.status).toBe(200);
  expect(msg(a, 'ничего похожего')).toBeTruthy();
});
