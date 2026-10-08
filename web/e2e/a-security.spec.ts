import { APIRequestContext, expect, test } from '@playwright/test';
import { pngBuffer, uniqueName } from './helpers';

// Безопасность и инфраструктура бэкенда: REST и WS напрямую, без браузера.
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const API = `http://localhost:${port}/api/v1`;
const WS_URL = `ws://localhost:${port}/ws`;

interface Account {
  id: number;
  token: string;
  username: string;
  name: string;
}

async function register(request: APIRequestContext, name: string): Promise<Account> {
  const username = uniqueName('sec');
  const r = await request.post(`${API}/auth/register`, {
    data: { username, password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token, username, name };
}

const auth = (a: Account) => ({ Authorization: `Bearer ${a.token}` });

async function api(request: APIRequestContext, a: Account, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const r = await request.fetch(`${API}${path}`, { method, headers: auth(a), data });
  const text = await r.text();
  return { status: r.status(), body: text ? JSON.parse(text) : null };
}

async function startDm(request: APIRequestContext, a: Account, b: Account): Promise<number> {
  const r = await api(request, a, 'POST', '/dms', { user_id: b.id });
  expect(r.status).toBe(201);
  return r.body.channel_id;
}

async function makeFriends(request: APIRequestContext, a: Account, b: Account) {
  expect((await api(request, a, 'POST', '/friends/request', { user_id: b.id })).status).toBe(201);
  expect((await api(request, b, 'POST', '/friends/respond', { user_id: a.id, accept: true })).status).toBe(200);
}

/** Сервер владельца: id, код приглашения, текстовый и голосовой каналы. */
async function createServer(request: APIRequestContext, owner: Account) {
  const s = await api(request, owner, 'POST', '/servers', { name: 'Секретный сервер' });
  expect(s.status).toBe(201);
  const ch = await api(request, owner, 'GET', `/servers/${s.body.server_id}/channels`);
  expect(ch.status).toBe(200);
  const text = ch.body.channels.find((c: any) => c.is_voice === 0).id as number;
  const voice = ch.body.channels.find((c: any) => c.is_voice === 1).id as number;
  return { id: s.body.server_id as number, code: s.body.invite_code as string, text, voice };
}

/** WS-клиент на глобальном WebSocket Node 22: копит события, ждёт нужное. */
class Socket {
  readonly events: any[] = [];
  readonly frames: Uint8Array[] = [];
  /** Сервер закрыл подключение */
  readonly closed: Promise<void>;
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    this.closed = new Promise((resolve) => ws.addEventListener('close', () => resolve()));
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
      else this.frames.push(new Uint8Array(e.data as ArrayBuffer));
      this.waiters.splice(0).forEach((w) => w());
    };
  }

  /** Подключиться и дождаться pong — значит, сервер уже зарегистрировал подключение. */
  static async open(a: Account): Promise<Socket> {
    const ws = new WebSocket(`${WS_URL}?token=${a.token}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    const s = new Socket(ws);
    s.send({ type: 'ping' });
    await s.next((e) => e.type === 'pong');
    return s;
  }

  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }

  sendRaw(data: string | Uint8Array) {
    this.ws.send(data);
  }

  /** Первое событие (после уже полученных) с pred; по умолчанию ждём 5 с. */
  async next(pred: (e: any) => boolean, timeout = 5000): Promise<any> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const i = this.events.findIndex(pred);
      if (i >= 0) return this.events.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('WS event not received');
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => { clearTimeout(t); r(); });
      });
    }
  }

  /** Убедиться, что такого события нет: ping/pong гарантирует, что всё отправленное раньше уже дошло. */
  async none(pred: (e: any) => boolean) {
    await new Promise((r) => setTimeout(r, 300));
    this.send({ type: 'ping' });
    await this.next((e) => e.type === 'pong');
    expect(this.events.filter(pred)).toEqual([]);
  }

  async frame(timeout = 5000): Promise<Uint8Array> {
    const deadline = Date.now() + timeout;
    while (this.frames.length === 0) {
      if (Date.now() > deadline) throw new Error('binary frame not received');
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.frames.shift()!;
  }

  close() {
    this.ws.close();
  }
}

test.describe.serial('backend security', () => {
  let a: Account, b: Account, c: Account, d: Account;

  test.beforeAll(async ({ request }) => {
    a = await register(request, 'Алиса');
    b = await register(request, 'Боб');
    c = await register(request, 'Чужой');
    d = await register(request, 'Дина');
  });

  test('outsider cannot read, post, react or upload in a DM or a server channel', async ({ request }) => {
    const dm = await startDm(request, a, b);
    const sent = await api(request, a, 'POST', `/channels/${dm}/messages`, { text: 'секрет', nonce: 'n-1' });
    expect(sent.status).toBe(201);
    expect(sent.body.nonce).toBe('n-1');
    const mid = sent.body.id;

    // Участник видит сообщение; в REST есть channel_id
    const own = await api(request, b, 'GET', `/channels/${dm}/messages`);
    expect(own.status).toBe(200);
    expect(own.body.messages[0]).toMatchObject({ id: mid, channel_id: dm, text: 'секрет' });

    // Посторонний — 403 на всё
    expect((await api(request, c, 'GET', `/channels/${dm}/messages`)).status).toBe(403);
    expect((await api(request, c, 'POST', `/channels/${dm}/messages`, { text: 'спам' })).status).toBe(403);
    expect((await api(request, c, 'POST', `/channels/${dm}/messages/${mid}/react`, { emoji: '🔥' })).status).toBe(403);
    expect((await api(request, c, 'POST', `/channels/${dm}/messages/${mid}/edit`, { text: 'x' })).status).toBe(403);
    expect((await api(request, c, 'DELETE', `/channels/${dm}/messages/${mid}`)).status).toBe(403);
    const upload = await request.post(`${API}/channels/${dm}/attachments`, {
      headers: auth(c),
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: pngBuffer() } },
    });
    expect(upload.status()).toBe(403);
    // Несуществующий канал — 404
    expect((await api(request, c, 'GET', '/channels/999999999/messages')).status).toBe(404);

    // Серверный канал: посторонний не видит ни список каналов, ни сообщения
    const srv = await createServer(request, a);
    expect((await api(request, c, 'GET', `/servers/${srv.id}/channels`)).status).toBe(403);
    expect((await api(request, c, 'GET', `/channels/${srv.text}/messages`)).status).toBe(403);
    expect((await api(request, c, 'POST', `/channels/${srv.text}/messages`, { text: 'спам' })).status).toBe(403);

    // История — по id, новые первыми
    await api(request, a, 'POST', `/channels/${srv.text}/messages`, { text: 'раз' });
    await api(request, a, 'POST', `/channels/${srv.text}/messages`, { text: 'два' });
    const hist = await api(request, a, 'GET', `/channels/${srv.text}/messages`);
    expect(hist.body.messages.map((m: any) => m.text)).toEqual(['два', 'раз']);
  });

  test('attachments get random names and only uploads are served', async ({ request }) => {
    const dm = await startDm(request, a, d);
    const up = await request.post(`${API}/channels/${dm}/attachments`, {
      headers: auth(a),
      multipart: { file: { name: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() } },
    });
    expect(up.status()).toBe(201);
    const url = (await up.json()).url as string;
    expect(url).toMatch(/^\/uploads\/attachments\/[0-9a-f]{32}\.png$/);
    expect((await request.get(`http://localhost:${port}${url}`)).status()).toBe(200);
    // Рабочий каталог сервера (config.json, база) по HTTP не раздаётся
    expect((await request.get(`http://localhost:${port}/config.json`)).status()).toBe(404);
    expect((await request.get(`http://localhost:${port}/uploads/../config.json`)).status()).not.toBe(200);
    // Вложение — только свой загруженный файл
    const bad = await api(request, a, 'POST', `/channels/${dm}/messages`, { text: '', attachment: '/uploads/../config.json' });
    expect(bad.status).toBe(400);
  });

  test('DM channels cannot be created directly or extended', async ({ request }) => {
    expect((await api(request, c, 'POST', '/channels', { type: 'dm', name: 'x' })).status).toBe(400);
    const dm = await startDm(request, a, b);
    expect((await api(request, a, 'POST', `/channels/${dm}/members`, { user_id: c.id })).status).toBe(400);
    // Повторный startDm — та же личка
    expect(await startDm(request, b, a)).toBe(dm);
  });

  test('server join by id needs an invite; kick revokes access and voice', async ({ request }) => {
    const srv = await createServer(request, a);
    expect((await api(request, c, 'POST', `/servers/${srv.id}/join`)).status).toBe(403);

    const sa = await Socket.open(a);
    const sb = await Socket.open(b);
    expect((await api(request, b, 'POST', '/servers/join', { code: srv.code })).status).toBe(200);
    await sa.next((e) => e.type === 'server_member_joined' && e.server_id === srv.id && e.user_id === b.id);
    expect((await api(request, b, 'POST', `/servers/${srv.id}/join`)).status).toBe(200);

    // Голосовой канал: только участники сервера; текстовый канал для голоса не годится
    sb.send({ type: 'voice_join', channel_id: srv.text });
    sb.send({ type: 'voice_join', channel_id: srv.voice });
    const joined = await sa.next((e) => e.type === 'voice_state' && e.channel_id === srv.voice && e.users.length === 1);
    expect(joined.users[0].user_id).toBe(b.id);
    expect(sa.events.filter((e) => e.type === 'voice_state' && e.channel_id === srv.text)).toEqual([]);

    // Посторонний не может ни войти в голос, ни узнать, кто в нём
    const sc = await Socket.open(c);
    sc.send({ type: 'voice_join', channel_id: srv.voice });
    sc.send({ type: 'voice_query', server_id: srv.id });
    await sc.none((e) => e.type === 'voice_state');

    // Кик: доступ и голос пропадают
    expect((await api(request, a, 'DELETE', `/servers/${srv.id}/members/${b.id}`)).status).toBe(200);
    await sa.next((e) => e.type === 'voice_state' && e.channel_id === srv.voice && e.users.length === 0);
    await sa.next((e) => e.type === 'server_member_left' && e.user_id === b.id);
    await sb.next((e) => e.type === 'server_removed' && e.server_id === srv.id);
    expect((await api(request, b, 'GET', `/channels/${srv.text}/messages`)).status).toBe(403);
    expect((await api(request, b, 'POST', `/channels/${srv.text}/messages`, { text: 'я вернулся' })).status).toBe(403);
    // Новый канал — событие участникам
    expect((await api(request, a, 'POST', `/servers/${srv.id}/channels`, { name: 'новости', is_voice: 0 })).status).toBe(201);
    await sa.next((e) => e.type === 'server_channels_changed' && e.server_id === srv.id);
    await sb.none((e) => e.type === 'server_channels_changed');

    for (const s of [sa, sb, sc]) s.close();
  });

  test('malformed WS frames do not crash the server', async ({ request }) => {
    const s = await Socket.open(c);
    for (const frame of [
      'not json',
      '[]',
      '"str"',
      '{"type":5}',
      '{"type":"voice_join","channel_id":"abc"}',
      '{"type":"voice_join","channel_id":1e300}',
      '{"type":"voice_speaking","speaking":"yes"}',
      '{"type":"voice_query","server_id":[1]}',
      '{"type":"set_presence","presence":{}}',
      '{"type":"call_invite","to":1e30}',
      '{"type":"call_invite","to":"7"}',
    ]) s.sendRaw(frame);
    s.sendRaw(new Uint8Array(100_000));
    s.send({ type: 'ping' });
    await s.next((e) => e.type === 'pong');
    s.close();
    expect((await api(request, c, 'GET', '/auth/me')).status).toBe(200);
  });

  test('every WS connection of a user receives events; closing one keeps the rest', async ({ request }) => {
    const dm = await startDm(request, d, b);
    const b1 = await Socket.open(b);
    const b2 = await Socket.open(b);
    await api(request, d, 'POST', `/channels/${dm}/messages`, { text: 'обоим', nonce: 'abc' });
    for (const s of [b1, b2]) {
      const ev = await s.next((e) => e.type === 'new_message' && e.channel_id === dm);
      expect(ev).toMatchObject({ text: 'обоим', nonce: 'abc', author_id: d.id });
    }
    b1.close();
    await api(request, d, 'POST', `/channels/${dm}/messages`, { text: 'второму' });
    await b2.next((e) => e.type === 'new_message' && e.text === 'второму');
    b2.close();
  });

  test('voice frames: only the voice connection sends, v2 receivers get the sender id', async ({ request }) => {
    const dm = await startDm(request, a, d);
    const sa = await Socket.open(a);
    const sd = await Socket.open(d);
    const sdOther = await Socket.open(d);
    sa.send({ type: 'voice_join', channel_id: dm, proto: 2 });
    await sa.next((e) => e.type === 'voice_state' && e.users.length === 1);
    sd.send({ type: 'voice_join', channel_id: dm });
    await sa.next((e) => e.type === 'voice_state' && e.users.length === 2);

    const pcm = new Uint8Array(640).fill(7);
    sd.sendRaw(pcm);
    const got = await sa.frame();
    expect(got.length).toBe(648);
    expect(Number(new DataView(got.buffer, got.byteOffset).getBigInt64(0, true))).toBe(d.id);
    expect(got.slice(8)).toEqual(pcm);

    sa.sendRaw(pcm);
    expect((await sd.frame()).length).toBe(640);   // v1 — без префикса
    // Подключение без голоса не вещает и не получает кадры
    sdOther.sendRaw(pcm);
    await sa.none(() => false);
    expect(sa.frames.length).toBe(0);
    expect(sdOther.frames.length).toBe(0);

    // Закрытие голосового подключения — выход из канала; второе подключение остаётся
    sd.close();
    await sa.next((e) => e.type === 'voice_state' && e.users.length === 1);
    for (const s of [sa, sdOther]) s.close();
  });

  test('call signalling is relayed only between friends or DM partners', async ({ request }) => {
    await makeFriends(request, c, d);
    const sa = await Socket.open(a);
    const sc = await Socket.open(c);
    const sd = await Socket.open(d);
    // a и c не друзья и без лички — не пересылается
    sa.send({ type: 'call_invite', to: c.id, sdp: 'x', sdpType: 'offer', name: 'Мама' });
    await sc.none((e) => e.type === 'call_invite');
    // c и d друзья — пересылается; from и имя ставит сервер
    sc.send({ type: 'call_invite', to: d.id, sdp: 'offer-sdp', sdpType: 'offer', name: 'Мама', from: 1 });
    const inv = await sd.next((e) => e.type === 'call_invite');
    expect(inv).toMatchObject({ from: c.id, name: c.name, sdp: 'offer-sdp' });
    sd.close();
    await new Promise((r) => setTimeout(r, 300));
    // Адресат не в сети — звонящему call_unavailable
    sc.send({ type: 'call_invite', to: d.id, sdp: 'offer-sdp', sdpType: 'offer' });
    await sc.next((e) => e.type === 'call_unavailable' && e.user_id === d.id);
    for (const s of [sa, sc]) s.close();
  });

  test('profile changes are validated and broadcast as user_updated', async ({ request }) => {
    const sc = await Socket.open(c);
    const long = 'Ж'.repeat(40);
    const r = await api(request, d, 'POST', '/profile/customize', {
      display_name: long, bio: 'о'.repeat(150), accent_color: '#12ab34', pronouns: 'она', presence: 'online', profile_json: '',
    });
    expect(r.status).toBe(200);
    expect(r.body.display_name).toBe('Ж'.repeat(32));
    const ev = await sc.next((e) => e.type === 'user_updated' && e.user_id === d.id);
    expect(ev).toMatchObject({ display_name: 'Ж'.repeat(32), accent_color: '#12ab34' });
    expect((await api(request, d, 'POST', '/profile/customize', { accent_color: 'red' })).status).toBe(400);
    expect((await api(request, d, 'POST', '/profile/customize', { bio: 'о'.repeat(191) })).status).toBe(400);
    expect((await api(request, d, 'POST', '/profile/update', { display_name: '   ' })).status).toBe(400);
    sc.close();
  });

  test('roles of other users can be managed only by developers', async ({ request }) => {
    const srv = await createServer(request, a);
    expect((await api(request, a, 'POST', `/servers/${srv.id}/members`, { user_id: c.id })).status).toBe(200);
    // Владелец сервера не трогает глобальные роли других (роли id=1 может и не быть — важен только 403)
    expect((await api(request, a, 'POST', '/roles/1/assign', { user_id: c.id })).status).toBe(403);
    expect((await api(request, a, 'DELETE', `/roles/1/assign?user_id=${c.id}`)).status).toBe(403);
  });

  test('logout closes the WebSocket of that session only', async ({ request }) => {
    const login = await request.post(`${API}/auth/login`, { data: { username: d.username, password: 'password123' } });
    expect(login.status()).toBe(200);
    const second: Account = { ...d, token: (await login.json()).token };
    const keep = await Socket.open(d);
    const gone = await Socket.open(second);
    expect((await api(request, second, 'POST', '/auth/logout')).status).toBe(200);
    await gone.closed;
    keep.send({ type: 'ping' });
    await keep.next((e) => e.type === 'pong');
    expect((await api(request, second, 'GET', '/auth/me')).status).toBe(401);
    keep.close();
  });

  test('ICE servers come from the backend', async ({ request }) => {
    const r = await api(request, a, 'GET', '/rtc/ice');
    expect(r.status).toBe(200);
    expect(r.body.ice_servers[0].urls).toContain('stun:stun.l.google.com:19302');
    expect(r.body.ice_servers.some((s: any) => 'credential' in s)).toBe(false);   // секрет TURN не задан
  });

  test('per-user rate limit answers 429', async ({ request }) => {
    const spammer = await register(request, 'Спамер');
    const dm = await startDm(request, spammer, a);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push((await api(request, spammer, 'POST', `/channels/${dm}/messages`, { text: `м${i}` })).status);
    expect(codes.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(codes).toContain(429);
  });
});
