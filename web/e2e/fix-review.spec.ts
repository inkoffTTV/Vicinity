import { APIRequestContext, expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { connect, Socket as TcpSocket } from 'node:net';
import { uniqueName } from './helpers';

// Исправления по ревью бэкенда: отозванная сессия не держит WebSocket, лимиты WS-сообщений и голоса,
// цвет профиля #AARRGGBB, `attachment` только для картинок, имя файла при скачивании.
// REST и WS напрямую, без браузера.
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const ORIGIN = `http://localhost:${port}`;
const API = `${ORIGIN}/api/v1`;
const WS_URL = `ws://localhost:${port}/ws`;

interface Account {
  id: number;
  token: string;
  username: string;
}

async function register(request: APIRequestContext, name: string): Promise<Account> {
  const username = uniqueName('fix');
  const r = await request.post(`${API}/auth/register`, {
    data: { username, password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token, username };
}

async function api(request: APIRequestContext, token: string, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const text = await r.text();
  return { status: r.status(), body: text ? JSON.parse(text) : null };
}

async function makeFriends(request: APIRequestContext, a: Account, b: Account) {
  expect((await api(request, a.token, 'POST', '/friends/request', { user_id: b.id })).status).toBe(201);
  expect((await api(request, b.token, 'POST', '/friends/respond', { user_id: a.id, accept: true })).status).toBe(200);
}

/** Сервер владельца (+ вступившие по коду): id, голосовые каналы. */
async function createServer(request: APIRequestContext, owner: Account, members: Account[] = []) {
  const s = await api(request, owner.token, 'POST', '/servers', { name: 'Ревью' });
  expect(s.status).toBe(201);
  for (const m of members) expect((await api(request, m.token, 'POST', '/servers/join', { code: s.body.invite_code })).status).toBe(200);
  const ch = await api(request, owner.token, 'GET', `/servers/${s.body.server_id}/channels`);
  const voices = ch.body.channels.filter((c: any) => c.is_voice === 1).map((c: any) => c.id as number);
  expect(voices.length).toBeGreaterThan(0);
  return { id: s.body.server_id as number, voices };
}

/** WS-клиент на глобальном WebSocket Node 22: копит события и бинарные кадры. */
class Ws {
  readonly events: any[] = [];
  readonly frames: Uint8Array[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
      else this.frames.push(new Uint8Array(e.data as ArrayBuffer));
      this.waiters.splice(0).forEach((w) => w());
    };
  }

  static async open(token: string): Promise<Ws> {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    const s = new Ws(ws);
    await s.sync();
    return s;
  }

  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }

  sendRaw(data: Uint8Array) {
    this.ws.send(data);
  }

  async next(pred: (e: any) => boolean, timeout = 5000): Promise<any> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const i = this.events.findIndex(pred);
      if (i >= 0) return this.events.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('WS event not received');
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  /** ping → pong: всё, что сервер отправил этому подключению раньше, уже получено. */
  async sync() {
    this.send({ type: 'ping' });
    await this.next((e) => e.type === 'pong');
  }

  count(pred: (e: any) => boolean) {
    return this.events.filter(pred).length;
  }

  close() {
    this.ws.close();
  }
}

/**
 * «Злой» клиент на голом TCP: рукопожатие WebSocket, свои кадры с маской, а на Close сервера не отвечает
 * и свою сторону не закрывает (allowHalfOpen) — как клиент, который игнорирует закрытие сессии.
 */
class RawWs {
  readonly texts: any[] = [];
  closeFrames = 0;
  /** TCP-соединение закрыто целиком (сервер его оборвал) */
  readonly closed: Promise<void>;
  private buf = Buffer.alloc(0);
  private upgraded = false;

  private constructor(private sock: TcpSocket) {
    this.closed = new Promise((resolve) => sock.on('close', () => resolve()));
    sock.on('error', () => undefined); // EPIPE/ECONNRESET после обрыва — ожидаемо
    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.parse();
    });
  }

  static async open(token: string): Promise<RawWs> {
    const sock = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('error', reject);
    });
    const raw = new RawWs(sock);
    sock.write(
      `GET /ws?token=${token} HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await expect.poll(() => raw.upgraded).toBe(true);
    raw.send({ type: 'ping' });
    await expect.poll(() => raw.texts.some((e) => e.type === 'pong')).toBe(true);
    return raw;
  }

  private parse() {
    if (!this.upgraded) {
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      expect(this.buf.subarray(0, end).toString()).toMatch(/^HTTP\/1\.1 101/);
      this.upgraded = true;
      this.buf = this.buf.subarray(end + 4);
    }
    for (;;) {
      if (this.buf.length < 2) return;
      const opcode = this.buf[0] & 0x0f;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      if (opcode === 1) this.texts.push(JSON.parse(payload.toString()));
      else if (opcode === 8) this.closeFrames += 1;
    }
  }

  private frame(opcode: number, payload: Buffer) {
    if (this.sock.destroyed || !this.sock.writable) return;
    const mask = randomBytes(4);
    const head =
      payload.length < 126
        ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
        : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, body]));
  }

  send(obj: unknown) {
    this.frame(1, Buffer.from(JSON.stringify(obj)));
  }

  sendBinary(data: Buffer) {
    this.frame(2, data);
  }

  destroy() {
    this.sock.destroy();
  }
}

const pcm = (bytes: number, fill = 7) => new Uint8Array(bytes).fill(fill);
const voiceUsers = (e: any) => (e.users as any[]).map((u) => u.user_id);

test.describe('исправления по ревью', () => {
  test('отозванная сессия: сокет, игнорирующий Close, больше ничего не может и обрывается', async ({ request }) => {
    const victim = await register(request, 'Жертва');
    const friend = await register(request, 'Друг');
    const srv = await createServer(request, victim, [friend]);
    const voice = srv.voices[0];
    // Второй вход жертвы — «украденный» токен
    const login = await request.post(`${API}/auth/login`, { data: { username: victim.username, password: 'password123' } });
    expect(login.status()).toBe(200);
    const stolen: string = (await login.json()).token;

    const sf = await Ws.open(friend.token);
    sf.send({ type: 'voice_join', channel_id: voice, proto: 2 });
    await sf.next((e) => e.type === 'voice_state' && e.channel_id === voice && voiceUsers(e).includes(friend.id));

    const raw = await RawWs.open(stolen);
    raw.send({ type: 'voice_join', channel_id: voice });
    await sf.next((e) => e.type === 'voice_state' && e.channel_id === voice && voiceUsers(e).includes(victim.id));
    raw.sendBinary(Buffer.from(pcm(640)));
    await expect.poll(() => sf.frames.length).toBe(1);

    // Жертва выходит на всех остальных устройствах: место в голосе освобождается сразу
    expect((await api(request, victim.token, 'DELETE', '/auth/sessions/others')).body).toEqual({ status: 'ok', revoked: 1 });
    await sf.next((e) => e.type === 'voice_state' && e.channel_id === voice && !voiceUsers(e).includes(victim.id));
    sf.events.length = 0;
    sf.frames.length = 0;

    // «Злой» клиент шлёт дальше: голос, вход в канал, звонок другу, ping — ничего не проходит,
    // а соединение сервер обрывает целиком (раньше закрывалась только запись)
    const pongs = raw.texts.filter((e) => e.type === 'pong').length;
    const spam = setInterval(() => {
      raw.send({ type: 'voice_join', channel_id: voice });
      raw.sendBinary(Buffer.from(pcm(640)));
      raw.send({ type: 'call_invite', to: friend.id, sdp: 'v=0', sdpType: 'offer' });
      raw.send({ type: 'ping' });
    }, 50);
    try {
      await Promise.race([
        raw.closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error('server kept the revoked socket open')), 8000)),
      ]);
    } finally {
      clearInterval(spam);
      raw.destroy();
    }
    expect(raw.closeFrames).toBeGreaterThanOrEqual(1);
    expect(raw.texts.filter((e) => e.type === 'pong').length).toBe(pongs);
    await sf.sync();
    expect(sf.frames.length).toBe(0);
    expect(sf.count((e) => e.type === 'voice_state' && voiceUsers(e).includes(victim.id))).toBe(0);
    expect(sf.count((e) => e.type === 'call_invite')).toBe(0);
    // Повторно с этим токеном не пустят
    const again = new WebSocket(`${WS_URL}?token=${stolen}`);
    await new Promise<void>((resolve) => {
      again.onerror = () => resolve();
      again.onclose = () => resolve();
    });
    sf.close();
  });

  test('лимиты WS: set_presence, voice_query, voice_join, сигналинг звонков', async ({ request }) => {
    const a = await register(request, 'Спамер');
    const b = await register(request, 'Получатель');
    await makeFriends(request, a, b);
    const sa = await Ws.open(a.token);
    const sb = await Ws.open(b.token);

    // set_presence: каждое рассылается всем контактам — не больше 10 подряд
    for (let i = 0; i < 30; i++) sa.send({ type: 'set_presence', presence: i % 2 ? 'idle' : 'dnd' });
    await sa.sync();
    await sb.sync();
    const presence = sb.count((e) => e.type === 'presence' && e.user_id === a.id && e.presence !== 'online');
    expect(presence).toBeGreaterThanOrEqual(5);
    expect(presence).toBeLessThanOrEqual(11);

    // voice_query: ответ — по voice_state на каждый голосовой канал; не больше 30 запросов подряд
    const srv = await createServer(request, a, [b]);
    for (let i = 0; i < 50; i++) sa.send({ type: 'voice_query', server_id: srv.id });
    await sa.sync();
    const answered = sa.count((e) => e.type === 'voice_state' && e.channel_id === srv.voices[0]);
    expect(answered).toBeGreaterThanOrEqual(20);
    expect(answered).toBeLessThanOrEqual(31);

    // voice_join: каждый рассылает voice_state всему серверу — не больше 20 подряд
    sb.events.length = 0;
    for (let i = 0; i < 40; i++) sa.send({ type: 'voice_join', channel_id: srv.voices[0] });
    await sa.sync();
    await sb.sync();
    const joins = sb.count((e) => e.type === 'voice_state' && e.channel_id === srv.voices[0]);
    expect(joins).toBeGreaterThanOrEqual(10);
    expect(joins).toBeLessThanOrEqual(21);

    // Сигналинг: адресату — только известные поля, from/name ставит сервер; слишком длинное не пересылается
    sb.events.length = 0;
    sa.send({ type: 'rtc_ice', to: b.id, candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', mid: '0', from: 1, name: 'Подделка', junk: 'x'.repeat(5000), extra: { a: 1 } });
    const ice = await sb.next((e) => e.type === 'rtc_ice');
    expect(ice).toEqual({ type: 'rtc_ice', to: b.id, from: a.id, candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', mid: '0' });
    sa.send({ type: 'rtc_offer', to: b.id, sdp: 'v=0\r\n' + 'a=x\r\n'.repeat(8000), sdpType: 'offer' });
    sa.send({ type: 'rtc_ice', to: b.id, candidate: 'c'.repeat(2000), mid: '0' });
    // Поток сигналинга: 100 подряд, дальше — 5 в секунду
    for (let i = 0; i < 150; i++) sa.send({ type: 'rtc_ice', to: b.id, candidate: `candidate:${i}`, mid: '0' });
    await sa.sync();
    await sb.sync();
    expect(sb.count((e) => e.type === 'rtc_offer')).toBe(0);
    expect(sb.count((e) => e.type === 'rtc_ice' && String(e.candidate).startsWith('cc'))).toBe(0);
    const relayed = sb.count((e) => e.type === 'rtc_ice');
    expect(relayed).toBeGreaterThanOrEqual(90);
    expect(relayed).toBeLessThanOrEqual(102);
    sa.close();
    sb.close();
  });

  test('голос: только PCM чётной длины до 640 байт и не быстрее полутора реальных потоков', async ({ request }) => {
    const a = await register(request, 'Говорящий');
    const b = await register(request, 'Слушатель');
    const srv = await createServer(request, a, [b]);
    const voice = srv.voices[0];
    const sa = await Ws.open(a.token);
    const sb = await Ws.open(b.token);
    sb.send({ type: 'voice_join', channel_id: voice, proto: 2 });
    await sb.next((e) => e.type === 'voice_state' && voiceUsers(e).includes(b.id));
    sa.send({ type: 'voice_join', channel_id: voice });
    await sb.next((e) => e.type === 'voice_state' && voiceUsers(e).includes(a.id));

    // Не голос: нечётная длина, больше 640 байт
    for (const n of [641, 642, 1280, 8192, 1]) sa.sendRaw(pcm(n));
    // Короткий кадр Linux-десктопа (320 байт) — проходит, с префиксом id отправителя
    sa.sendRaw(pcm(320, 3));
    await expect.poll(() => sb.frames.length).toBe(1);
    expect(sb.frames[0].length).toBe(8 + 320);
    sb.frames.length = 0;

    // Залп из 300 кадров по 640 байт: до 64 КБ подряд (100 кадров), дальше 48 КБ/с
    for (let i = 0; i < 300; i++) sa.sendRaw(pcm(640));
    await sa.sync();
    await sb.sync();
    expect(sb.frames.length).toBeGreaterThanOrEqual(90);
    expect(sb.frames.length).toBeLessThanOrEqual(130);
    expect(sb.frames.every((f) => f.length === 8 + 640)).toBe(true);

    // Через секунду лимит восполняется — обычный поток снова проходит
    sb.frames.length = 0;
    await expect
      .poll(async () => {
        sa.sendRaw(pcm(640));
        await sa.sync();
        await sb.sync();
        return sb.frames.length;
      })
      .toBeGreaterThan(0);
    sa.close();
    sb.close();
  });

  test('цвет профиля #AARRGGBB от десктопа сохраняется как #RRGGBB, профиль не отклоняется', async ({ request }) => {
    const u = await register(request, 'Десктопный');
    const r = await api(request, u.token, 'POST', '/profile/customize', {
      display_name: 'Десктопный', bio: 'о себе', pronouns: '', presence: 'online', profile_json: '{}', accent_color: '#805865f2',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accent_color: '#5865f2', bio: 'о себе' });
    expect((await api(request, u.token, 'GET', '/auth/me')).body.accent_color).toBe('#5865f2');
    const acc = await api(request, u.token, 'POST', '/profile/accent', { color: '#FF112233' });
    expect(acc).toEqual({ status: 200, body: { status: 'success', color: '#112233' } });
    expect((await api(request, u.token, 'POST', '/profile/accent', { color: '#12ab34' })).body.color).toBe('#12ab34');
    expect((await api(request, u.token, 'POST', '/profile/accent', { color: '' })).status).toBe(200);
    for (const bad of ['#GG5865f2', '#5865f2ff0', '5865f2', '#12345', 'red'])
      expect((await api(request, u.token, 'POST', '/profile/customize', { accent_color: bad })).status).toBe(400);
  });

  test('файлы: attachment только для картинок (старые десктопы), имя файла при скачивании', async ({ request }) => {
    const a = await register(request, 'Отправитель');
    const b = await register(request, 'Адресат');
    const dm = (await api(request, a.token, 'POST', '/dms', { user_id: b.id })).body.channel_id as number;
    const name = "Смета 100% (финал) Q'3 #2.txt";
    const up = await request.post(`${API}/channels/${dm}/attachments`, {
      headers: { Authorization: `Bearer ${a.token}` },
      multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from('итого: 100') } },
    });
    expect(up.status()).toBe(201);
    const url: string = (await up.json()).url;
    expect(url).toMatch(/^\/uploads\/files\/[0-9a-f]{32}\.txt$/);

    // Скачивание: Content-Disposition один, с исходным именем в UTF-8 и ASCII-заменой без кавычек внутри
    const file = await request.get(`${ORIGIN}${url}`);
    expect(file.status()).toBe(200);
    const cd = file.headersArray().filter((h) => h.name.toLowerCase() === 'content-disposition');
    expect(cd).toHaveLength(1);
    const m = cd[0].value.match(/^attachment; filename="([^"]*)"; filename\*=UTF-8''([A-Za-z0-9!#$&+\-.^_`|~%]+)$/);
    expect(m).not.toBeNull();
    expect(decodeURIComponent(m![2])).toBe(name);
    expect(m![1]).toBe("_____ 100% (_____) Q'3 #2.txt");

    // Сообщение без attachment_name (как у старого клиента) — имя берётся из загрузки
    const sb = await Ws.open(b.token);
    const sent = await api(request, a.token, 'POST', `/channels/${dm}/messages`, { text: 'смета во вложении', attachment: url });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ attachment_url: url, attachment_name: name, attachment_type: 'file' });
    const ev = await sb.next((e) => e.type === 'new_message' && e.id === sent.body.id);
    expect(ev).toMatchObject({ attachment: '', attachment_url: url, attachment_name: name, attachment_type: 'file' });
    for (const list of [
      (await api(request, b.token, 'GET', `/channels/${dm}/messages?limit=1`)).body.messages,
      (await api(request, b.token, 'GET', `/search?q=${encodeURIComponent('смета во')}&channel_id=${dm}`)).body.results,
    ])
      expect(list[0]).toMatchObject({ attachment: '', attachment_url: url, attachment_type: 'file' });
    sb.close();
  });
});
