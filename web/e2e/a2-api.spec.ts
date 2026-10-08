import { APIRequestContext, expect, test } from '@playwright/test';
import { pngBuffer, uniqueName } from './helpers';

// Новые возможности API бэкенда (docs/API.md §2–§9): REST и WS напрямую, без браузера.
// Для каждого эндпоинта — обычный сценарий и отказ без прав.
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const ORIGIN = `http://localhost:${port}`;
const API = `${ORIGIN}/api/v1`;
const WS_URL = `ws://localhost:${port}/ws`;

interface Account {
  id: number;
  token: string;
  username: string;
  name: string;
}

async function register(request: APIRequestContext, name: string): Promise<Account> {
  const username = uniqueName('feat');
  const r = await request.post(`${API}/auth/register`, {
    data: { username, password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token, username, name };
}

async function login(request: APIRequestContext, a: Account, password = 'password123') {
  const r = await request.post(`${API}/auth/login`, { data: { username: a.username, password } });
  return { status: r.status(), token: r.ok() ? ((await r.json()).token as string) : '' };
}

const auth = (a: Account) => ({ Authorization: `Bearer ${a.token}` });

type Method = 'GET' | 'POST' | 'DELETE';

async function api(request: APIRequestContext, a: Account, method: Method, path: string, data?: unknown) {
  const r = await request.fetch(`${API}${path}`, { method, headers: auth(a), data });
  const text = await r.text();
  return { status: r.status(), body: text ? JSON.parse(text) : null };
}

async function upload(request: APIRequestContext, a: Account, path: string, name: string, mimeType: string, buffer: Buffer) {
  const r = await request.post(`${API}${path}`, { headers: auth(a), multipart: { file: { name, mimeType, buffer } } });
  const text = await r.text();
  return { status: r.status(), body: text ? JSON.parse(text) : null };
}

async function startDm(request: APIRequestContext, a: Account, b: Account): Promise<number> {
  const r = await api(request, a, 'POST', '/dms', { user_id: b.id });
  expect(r.status).toBe(201);
  return r.body.channel_id;
}

async function createGroup(request: APIRequestContext, owner: Account, name: string, members: Account[] = []) {
  const r = await api(request, owner, 'POST', '/channels', { type: 'group', name });
  expect(r.status).toBe(201);
  for (const m of members)
    expect((await api(request, owner, 'POST', `/channels/${r.body.channel_id}/members`, { user_id: m.id })).status).toBe(200);
  return r.body.channel_id as number;
}

/** Сервер владельца (+ вступившие по коду): id, код приглашения, текстовый канал. */
async function createServer(request: APIRequestContext, owner: Account, members: Account[] = []) {
  const s = await api(request, owner, 'POST', '/servers', { name: 'Сервер фич' });
  expect(s.status).toBe(201);
  for (const m of members) expect((await api(request, m, 'POST', '/servers/join', { code: s.body.invite_code })).status).toBe(200);
  const ch = await api(request, owner, 'GET', `/servers/${s.body.server_id}/channels`);
  const text = ch.body.channels.find((c: any) => c.is_voice === 0).id as number;
  return { id: s.body.server_id as number, code: s.body.invite_code as string, text };
}

/** Отправить сообщение; упёрлись в лимит (10 сообщений за 5 с на пользователя) — подождать и повторить. */
async function sendMessage(request: APIRequestContext, a: Account, channel: number, body: object) {
  for (let attempt = 0; ; attempt++) {
    const r = await api(request, a, 'POST', `/channels/${channel}/messages`, body);
    if (r.status !== 429 || attempt === 20) return r;
    await new Promise((res) => setTimeout(res, 500));
  }
}

async function post(request: APIRequestContext, a: Account, channel: number, text: string, extra: object = {}) {
  const r = await sendMessage(request, a, channel, { text, ...extra });
  expect(r.status).toBe(201);
  return r.body.id as number;
}

/** WS-клиент на глобальном WebSocket Node 22: копит события, ждёт нужное. */
class Socket {
  readonly events: any[] = [];
  /** Сервер закрыл подключение */
  readonly closed: Promise<void>;
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.addEventListener('close', () => resolve()));
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
      this.waiters.splice(0).forEach((w) => w());
    };
  }

  /** Подключиться и дождаться pong — значит, сервер уже зарегистрировал подключение. */
  static async open(token: string): Promise<Socket> {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
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
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
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

  close() {
    this.ws.close();
  }
}

test.describe.serial('backend feature API', () => {
  let a: Account, b: Account, c: Account, d: Account;

  test.beforeAll(async ({ request }) => {
    a = await register(request, 'Алиса');
    b = await register(request, 'Борис');
    c = await register(request, 'Чужак');
    d = await register(request, 'Дина');
  });

  test('history pages by id: limit, before, around', async ({ request }) => {
    const ch = await createGroup(request, a, 'История', [b]);
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push(await post(request, a, ch, `сообщение ${i}`));

    const first = await api(request, b, 'GET', `/channels/${ch}/messages?limit=3`);
    expect(first.status).toBe(200);
    expect(first.body.messages.map((m: any) => m.id)).toEqual([ids[6], ids[5], ids[4]]);
    expect(first.body.has_more).toBe(true);
    expect(first.body.messages[0]).toMatchObject({
      channel_id: ch, author_id: a.id, author_name: a.name, text: 'сообщение 6', edited: false,
      attachment: '', attachment_url: '', attachment_name: '', attachment_size: 0, attachment_type: '', reply_to: 0, reply: null, reactions: [],
    });

    const second = await api(request, b, 'GET', `/channels/${ch}/messages?limit=3&before=${ids[4]}`);
    expect(second.body.messages.map((m: any) => m.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect(second.body.has_more).toBe(true);
    const last = await api(request, b, 'GET', `/channels/${ch}/messages?limit=3&before=${ids[1]}`);
    expect(last.body.messages.map((m: any) => m.id)).toEqual([ids[0]]);
    expect(last.body.has_more).toBe(false);

    // Окно вокруг сообщения: limit/2 новее и старше, новые первыми
    const around = await api(request, b, 'GET', `/channels/${ch}/messages?limit=4&around=${ids[3]}`);
    expect(around.body.messages.map((m: any) => m.id)).toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]);
    expect(around.body).toMatchObject({ has_more: true, has_newer: true });
    const edge = await api(request, b, 'GET', `/channels/${ch}/messages?limit=10&around=${ids[6]}`);
    expect(edge.body.messages.map((m: any) => m.id)).toEqual([ids[6], ids[5], ids[4], ids[3], ids[2], ids[1]]);
    expect(edge.body).toMatchObject({ has_more: true, has_newer: false });

    // limit ограничен 1..100; мусор — значение по умолчанию
    expect((await api(request, b, 'GET', `/channels/${ch}/messages?limit=0`)).body.messages).toHaveLength(1);
    expect((await api(request, b, 'GET', `/channels/${ch}/messages?limit=abc`)).body.messages).toHaveLength(7);

    expect((await api(request, c, 'GET', `/channels/${ch}/messages?limit=3&before=${ids[4]}`)).status).toBe(403);
    expect((await api(request, c, 'GET', `/channels/${ch}/messages?around=${ids[3]}`)).status).toBe(403);
  });

  test('replies carry a preview of the original; deleted original leaves reply null', async ({ request }) => {
    const dm = await startDm(request, a, b);
    const other = await createGroup(request, a, 'Другая беседа', [b]);
    const sa = await Socket.open(a.token);
    const original = await post(request, a, dm, 'Длинный исходник '.repeat(20));
    const foreign = await post(request, a, other, 'из другой беседы');

    const sent = await sendMessage(request, b, dm, { text: 'ответ', reply_to: original, nonce: 'r-1' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'sent', nonce: 'r-1', reply_to: original });
    expect(sent.body.reply).toMatchObject({ id: original, author_id: a.id, author_name: a.name, attachment: '' });
    expect([...sent.body.reply.text]).toHaveLength(200);

    const ev = await sa.next((e) => e.type === 'new_message' && e.id === sent.body.id);
    expect(ev).toMatchObject({ channel_id: dm, reply_to: original, nonce: 'r-1', reply: { id: original } });

    // Ответ только на сообщение этого же канала
    expect((await sendMessage(request, b, dm, { text: 'x', reply_to: foreign })).status).toBe(400);
    expect((await sendMessage(request, b, dm, { text: 'x', reply_to: 999999999 })).status).toBe(400);
    expect((await api(request, c, 'POST', `/channels/${dm}/messages`, { text: 'x', reply_to: original })).status).toBe(403);

    expect((await api(request, a, 'DELETE', `/channels/${dm}/messages/${original}`)).status).toBe(200);
    const hist = await api(request, b, 'GET', `/channels/${dm}/messages?limit=5`);
    expect(hist.body.messages.find((m: any) => m.id === sent.body.id)).toMatchObject({ reply_to: original, reply: null });
    sa.close();
  });

  test('attachments: files go to /uploads/files/ as downloads, dangerous types are refused', async ({ request }) => {
    const dm = await startDm(request, a, d);
    const pdf = Buffer.from('%PDF-1.4\n% тестовый документ\n');
    const up = await upload(request, a, `/channels/${dm}/attachments`, 'Отчёт за май.pdf', 'application/pdf', pdf);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'Отчёт за май.pdf', size: pdf.length, type: 'file' });
    expect(up.body.url).toMatch(/^\/uploads\/files\/[0-9a-f]{32}\.pdf$/);
    const served = await request.get(`${ORIGIN}${up.body.url}`);
    expect(served.status()).toBe(200);
    // Скачивается под исходным именем: ASCII-замена для старых браузеров и UTF-8 по RFC 5987
    expect(served.headers()['content-disposition']).toBe(
      `attachment; filename="_____ __ ___.pdf"; filename*=UTF-8''${encodeURIComponent('Отчёт за май.pdf')}`,
    );
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await served.body())).toEqual(pdf);

    for (const [name, type] of [['zip.zip', 'application/zip'], ['notes.txt', 'text/plain'], ['song.mp3', 'audio/mpeg'], ['table.xlsx', 'application/octet-stream']]) {
      const r = await upload(request, a, `/channels/${dm}/attachments`, name, type, Buffer.from('data'));
      expect(r.status).toBe(201);
      expect((await request.get(`${ORIGIN}${r.body.url}`)).status()).toBe(200);
    }
    for (const [name, type] of [['page.html', 'text/html'], ['x.SVG', 'image/svg+xml'], ['a.js', 'text/javascript'], ['setup.exe', 'application/octet-stream'], ['run.sh', 'text/plain']])
      expect((await upload(request, a, `/channels/${dm}/attachments`, name, type, Buffer.from('<script>alert(1)</script>'))).status).toBe(415);

    // Картинки определяются по сигнатуре: webp — картинка, «png» с чужим содержимым — просто файл
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
    const img = await upload(request, a, `/channels/${dm}/attachments`, 'pic.webp', 'image/webp', webp);
    expect(img.body).toMatchObject({ type: 'image', size: webp.length });
    expect(img.body.url).toMatch(/^\/uploads\/attachments\/[0-9a-f]{32}\.webp$/);
    const png = await upload(request, a, `/channels/${dm}/attachments`, 'shot.png', 'image/png', pngBuffer());
    expect(png.body.type).toBe('image');

    // Метаданные в сообщении: имя от клиента, размер и тип — по файлу
    const sa = await Socket.open(d.token);
    const sent = await sendMessage(request, a, dm, {
      text: '', attachment: up.body.url, attachment_name: 'Отчёт за май.pdf', attachment_size: 1, attachment_type: 'image',
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ attachment_name: 'Отчёт за май.pdf', attachment_size: pdf.length, attachment_type: 'file' });
    const ev = await sa.next((e) => e.type === 'new_message' && e.id === sent.body.id);
    // Файл — в attachment_url; attachment у старых десктопов показывается картинкой, поэтому в нём только картинки
    expect(ev).toMatchObject({ attachment: '', attachment_url: up.body.url, attachment_name: 'Отчёт за май.pdf', attachment_type: 'file' });
    expect(sent.body.attachment_url).toBe(up.body.url);
    // Как старый десктоп: только attachment — тип и размер всё равно известны
    await post(request, a, dm, 'картинка', { attachment: png.body.url });
    const hist = await api(request, d, 'GET', `/channels/${dm}/messages?limit=2`);
    expect(hist.body.messages[0]).toMatchObject({ attachment: png.body.url, attachment_url: png.body.url, attachment_name: '', attachment_type: 'image' });
    expect(hist.body.messages[0].attachment_size).toBeGreaterThan(0);
    expect(hist.body.messages[1]).toMatchObject({ attachment: '', attachment_url: up.body.url, attachment_type: 'file', attachment_size: pdf.length });

    expect((await api(request, a, 'POST', `/channels/${dm}/messages`, { text: '', attachment: '/uploads/avatars/x.png' })).status).toBe(400);
    expect((await upload(request, c, `/channels/${dm}/attachments`, 'x.pdf', 'application/pdf', pdf)).status).toBe(403);
    sa.close();
  });

  test('server owner may delete any message in the server; members only their own', async ({ request }) => {
    const srv = await createServer(request, a, [b]);
    const byB = await post(request, b, srv.text, 'сообщение участника');
    const byA = await post(request, a, srv.text, 'сообщение владельца');
    expect((await api(request, b, 'DELETE', `/channels/${srv.text}/messages/${byA}`)).status).toBe(403);
    expect((await api(request, c, 'DELETE', `/channels/${srv.text}/messages/${byB}`)).status).toBe(403);
    const sb = await Socket.open(b.token);
    expect((await api(request, a, 'DELETE', `/channels/${srv.text}/messages/${byB}`)).status).toBe(200);
    await sb.next((e) => e.type === 'message_deleted' && e.id === byB);
    // В личке права владельца нет: чужое не удалить
    const dm = await startDm(request, a, b);
    const inDm = await post(request, b, dm, 'моё');
    expect((await api(request, a, 'DELETE', `/channels/${dm}/messages/${inDm}`)).status).toBe(403);
    sb.close();
  });

  test('typing is relayed to the channel except the sender, throttled and access-checked', async ({ request }) => {
    const dm = await startDm(request, a, b);
    const sa = await Socket.open(a.token);
    const sb = await Socket.open(b.token);
    const sc = await Socket.open(c.token);

    sb.send({ type: 'typing', channel_id: dm });
    const ev = await sa.next((e) => e.type === 'typing');
    expect(ev).toEqual({ type: 'typing', channel_id: dm, user_id: b.id, name: b.name });
    await sb.none((e) => e.type === 'typing');

    // Чаще раза в 2 с — не пересылается
    sb.send({ type: 'typing', channel_id: dm });
    await sa.none((e) => e.type === 'typing');
    await new Promise((r) => setTimeout(r, 2100));
    sb.send({ type: 'typing', channel_id: dm });
    await sa.next((e) => e.type === 'typing' && e.user_id === b.id);

    // Чужой канал — молча игнорируется
    sc.send({ type: 'typing', channel_id: dm });
    sc.send({ type: 'typing', channel_id: 'x' });
    await sa.none((e) => e.type === 'typing');
    for (const s of [sa, sb, sc]) s.close();
  });

  test('read state: unread with mentions, forward-only marker, read_state to the other connections', async ({ request }) => {
    const ch = await createGroup(request, a, 'Непрочитанное', [b]);
    const m1 = await post(request, a, ch, 'привет');
    const m2 = await post(request, a, ch, `Эй, @${b.username.toUpperCase()}, глянь`);
    await post(request, a, ch, `пиши на x@${b.username}`);
    await post(request, a, ch, `это @${b.username}x, а не ты`);
    await post(request, a, ch, `в конце фразы @${b.username}.`);
    const own = await post(request, b, ch, `сам себе @${b.username}`);

    const unreadOf = async (u: Account) =>
      (await api(request, u, 'GET', '/unread')).body.channels.find((x: any) => x.channel_id === ch);
    expect(await unreadOf(b)).toEqual({ channel_id: ch, unread: 5, mentions: 2, last_message_id: own });
    expect(await unreadOf(a)).toMatchObject({ unread: 1, mentions: 0 });

    const b1 = await Socket.open(b.token);
    const b2 = await Socket.open(b.token);
    const read = await api(request, b, 'POST', `/channels/${ch}/read`, { message_id: m2 });
    expect(read).toEqual({ status: 200, body: { channel_id: ch, last_read_id: m2 } });
    for (const s of [b1, b2])
      expect(await s.next((e) => e.type === 'read_state')).toEqual({ type: 'read_state', channel_id: ch, last_read_id: m2 });
    expect(await unreadOf(b)).toEqual({ channel_id: ch, unread: 3, mentions: 1, last_message_id: own });

    // Только вперёд: старое значение остаётся, события нет
    expect((await api(request, b, 'POST', `/channels/${ch}/read`, { message_id: m1 })).body.last_read_id).toBe(m2);
    await b1.none((e) => e.type === 'read_state');
    // Дальше последнего сообщения не уходит
    expect((await api(request, b, 'POST', `/channels/${ch}/read`, { message_id: 999999999 })).body.last_read_id).toBe(own);
    expect(await unreadOf(b)).toBeUndefined();

    expect((await api(request, c, 'POST', `/channels/${ch}/read`, { message_id: m2 })).status).toBe(403);
    expect((await api(request, b, 'POST', '/channels/999999999/read', { message_id: m2 })).status).toBe(404);
    expect((await api(request, b, 'POST', `/channels/${ch}/read`, { message_id: 'x' })).status).toBe(400);
    expect(await unreadOf(c)).toBeUndefined();
    for (const s of [b1, b2]) s.close();
  });

  test('search: literal % and _, scopes, access control and rate limit', async ({ request }) => {
    const group = await createGroup(request, a, 'Поиск', [b]);
    await post(request, a, group, 'скидка 100% сегодня');
    await post(request, a, group, 'поле foo_bar');
    await post(request, a, group, 'поле fooXbar');
    const dm = await startDm(request, a, b);
    await post(request, a, dm, 'метка-лички foo_bar');
    const srv = await createServer(request, a, [b]);
    await post(request, b, srv.text, 'серверный foo_bar');

    const search = (u: Account, qs: string) => api(request, u, 'GET', `/search?${qs}`);
    const texts = (r: any) => r.body.results.map((m: any) => m.text);

    expect(texts(await search(b, `q=${encodeURIComponent('0% с')}&channel_id=${group}`))).toEqual(['скидка 100% сегодня']);
    expect(texts(await search(b, `q=o_b&channel_id=${group}`))).toEqual(['поле foo_bar']);
    expect(texts(await search(b, `q=${encodeURIComponent('%%')}&channel_id=${group}`))).toEqual([]);
    expect((await search(b, 'q=x')).status).toBe(400);
    expect((await search(b, `q=${encodeURIComponent('  y ')}`)).status).toBe(400);

    // Все доступные каналы, новые первыми; у лички — имя собеседника, у сервера — его id
    const all = await search(a, 'q=foo_bar');
    expect(texts(all).slice(0, 3)).toEqual(['серверный foo_bar', 'метка-лички foo_bar', 'поле foo_bar']);
    expect(all.body.results[0]).toMatchObject({ server_id: srv.id, channel_name: 'общий', channel_id: srv.text, author_id: b.id });
    expect(all.body.results[1]).toMatchObject({ server_id: 0, channel_name: b.name, channel_id: dm });
    expect(texts(await search(a, `q=foo_bar&server_id=${srv.id}`))).toEqual(['серверный foo_bar']);

    // Чужие каналы не ищутся и не раскрываются
    expect(texts(await search(c, 'q=foo_bar'))).toEqual([]);
    expect((await search(c, `q=foo_bar&channel_id=${group}`)).status).toBe(403);
    expect((await search(c, `q=foo_bar&server_id=${srv.id}`)).status).toBe(403);
    expect((await search(c, 'q=foo_bar&channel_id=999999999')).status).toBe(404);
    expect((await search(c, 'q=foo_bar&server_id=999999999')).status).toBe(404);

    const codes: number[] = [];
    for (let i = 0; i < 35; i++) codes.push((await search(d, 'q=ничего')).status);
    expect(codes.slice(0, 25).every((s) => s === 200)).toBe(true);
    expect(codes).toContain(429);
  });

  test('pins: any member in DMs, only the owner in servers; pins_updated', async ({ request }) => {
    const dm = await startDm(request, a, b);
    const mid = await post(request, a, dm, 'закрепи меня');
    const sa = await Socket.open(a.token);

    expect((await api(request, b, 'POST', `/channels/${dm}/pins`, { message_id: mid })).status).toBe(200);
    await sa.next((e) => e.type === 'pins_updated' && e.channel_id === dm);
    const pins = await api(request, a, 'GET', `/channels/${dm}/pins`);
    expect(pins.body.pins).toHaveLength(1);
    expect(pins.body.pins[0]).toMatchObject({ id: mid, text: 'закрепи меня', pinned_by: b.id });
    expect(pins.body.pins[0].pinned_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    // Повторно — без изменений и без события
    expect((await api(request, a, 'POST', `/channels/${dm}/pins`, { message_id: mid })).status).toBe(200);
    await sa.none((e) => e.type === 'pins_updated');

    expect((await api(request, c, 'GET', `/channels/${dm}/pins`)).status).toBe(403);
    expect((await api(request, c, 'POST', `/channels/${dm}/pins`, { message_id: mid })).status).toBe(403);
    expect((await api(request, c, 'DELETE', `/channels/${dm}/pins/${mid}`)).status).toBe(403);
    expect((await api(request, a, 'POST', `/channels/${dm}/pins`, { message_id: 999999999 })).status).toBe(404);

    expect((await api(request, a, 'DELETE', `/channels/${dm}/pins/${mid}`)).status).toBe(200);
    await sa.next((e) => e.type === 'pins_updated' && e.channel_id === dm);
    expect((await api(request, b, 'GET', `/channels/${dm}/pins`)).body.pins).toEqual([]);

    // Сервер: закрепляет только владелец; удалённое сообщение пропадает из закрепов
    const srv = await createServer(request, a, [b]);
    const sm = await post(request, b, srv.text, 'важное');
    expect((await api(request, b, 'POST', `/channels/${srv.text}/pins`, { message_id: sm })).status).toBe(403);
    expect((await api(request, a, 'POST', `/channels/${srv.text}/pins`, { message_id: sm })).status).toBe(200);
    expect((await api(request, b, 'GET', `/channels/${srv.text}/pins`)).body.pins).toHaveLength(1);
    expect((await api(request, b, 'DELETE', `/channels/${srv.text}/pins/${sm}`)).status).toBe(403);
    await sa.next((e) => e.type === 'pins_updated' && e.channel_id === srv.text);
    expect((await api(request, b, 'DELETE', `/channels/${srv.text}/messages/${sm}`)).status).toBe(200);
    await sa.next((e) => e.type === 'pins_updated' && e.channel_id === srv.text);
    expect((await api(request, a, 'GET', `/channels/${srv.text}/pins`)).body.pins).toEqual([]);
    sa.close();
  });

  test('groups: last_message, owner, members, rename, leave, delete; DMs stay intact', async ({ request }) => {
    const sa = await Socket.open(a.token);
    const sb = await Socket.open(b.token);
    const ch = await createGroup(request, a, 'Команда', [b]);
    await sb.next((e) => e.type === 'channel_added' && e.channel_id === ch);
    expect((await api(request, a, 'POST', `/channels/${ch}/members`, { user_id: c.id })).status).toBe(200);
    await sb.next((e) => e.type === 'channel_member_joined' && e.channel_id === ch && e.user_id === c.id);
    await sa.next((e) => e.type === 'channel_member_joined' && e.user_id === c.id);

    const group = (list: any) => list.body.channels.find((g: any) => g.id === ch);
    expect(group(await api(request, b, 'GET', '/channels'))).toMatchObject({ name: 'Команда', owner_id: a.id, last_message: null });
    const mid = await post(request, b, ch, 'первое в беседе');
    expect(group(await api(request, a, 'GET', '/channels')).last_message).toMatchObject({
      id: mid, author_id: b.id, author_name: b.name, text: 'первое в беседе', attachment: '',
    });
    const dm = await startDm(request, a, d);
    const dmMid = await post(request, d, dm, 'последнее в личке');
    const dms = await api(request, a, 'GET', '/dms');
    expect(dms.body.dms.find((x: any) => x.channel_id === dm).last_message).toMatchObject({ id: dmMid, author_id: d.id, text: 'последнее в личке' });

    const members = await api(request, c, 'GET', `/channels/${ch}/members`);
    expect(members.body.members.map((m: any) => [m.id, m.is_owner])).toEqual([[a.id, true], [b.id, false], [c.id, false]]);
    expect(members.body.members[1]).toMatchObject({ username: b.username, display_name: b.name, presence: 'online' });
    expect((await api(request, d, 'GET', `/channels/${ch}/members`)).status).toBe(403);

    // Переименовать может любой участник
    expect((await api(request, c, 'POST', `/channels/${ch}/update`, { name: '  Отдел  ' })).body).toEqual({ channel_id: ch, name: 'Отдел' });
    expect(await sa.next((e) => e.type === 'channel_updated')).toEqual({ type: 'channel_updated', channel_id: ch, name: 'Отдел' });
    expect((await api(request, d, 'POST', `/channels/${ch}/update`, { name: 'Взлом' })).status).toBe(403);
    expect((await api(request, a, 'POST', `/channels/${ch}/update`, { name: '' })).status).toBe(400);

    // Личку нельзя ни покинуть, ни переименовать, ни удалить
    expect((await api(request, a, 'POST', `/channels/${dm}/leave`)).status).toBe(400);
    expect((await api(request, a, 'POST', `/channels/${dm}/update`, { name: 'x' })).status).toBe(400);
    expect((await api(request, a, 'DELETE', `/channels/${dm}`)).status).toBe(400);

    // Выход: остальным channel_member_left, ушедшему channel_removed; ушёл владелец — владелец следующий
    expect((await api(request, a, 'POST', `/channels/${ch}/leave`)).status).toBe(200);
    expect(await sb.next((e) => e.type === 'channel_member_left')).toEqual({
      type: 'channel_member_left', channel_id: ch, user_id: a.id, owner_id: b.id,
    });
    await sa.next((e) => e.type === 'channel_removed' && e.channel_id === ch);
    expect((await api(request, a, 'GET', `/channels/${ch}/messages`)).status).toBe(403);
    expect((await api(request, a, 'POST', `/channels/${ch}/leave`)).status).toBe(403);
    expect(group(await api(request, b, 'GET', '/channels')).owner_id).toBe(b.id);

    // Удаляет только владелец беседы; всем участникам channel_removed
    expect((await api(request, c, 'DELETE', `/channels/${ch}`)).status).toBe(403);
    const scc = await Socket.open(c.token);
    expect((await api(request, b, 'DELETE', `/channels/${ch}`)).status).toBe(200);
    await sb.next((e) => e.type === 'channel_removed' && e.channel_id === ch);
    await scc.next((e) => e.type === 'channel_removed' && e.channel_id === ch);
    expect((await api(request, b, 'GET', `/channels/${ch}/messages`)).status).toBe(404);
    expect((await api(request, b, 'DELETE', `/channels/${ch}`)).status).toBe(404);

    // Канал сервера: переименовывает и удаляет только владелец сервера
    const srv = await createServer(request, a, [b]);
    expect((await api(request, b, 'POST', `/channels/${srv.text}/update`, { name: 'флуд' })).status).toBe(403);
    expect((await api(request, a, 'POST', `/channels/${srv.text}/update`, { name: 'новости' })).status).toBe(200);
    await sb.next((e) => e.type === 'channel_updated' && e.channel_id === srv.text && e.name === 'новости');
    await sb.next((e) => e.type === 'server_channels_changed' && e.server_id === srv.id);
    expect((await api(request, b, 'GET', `/channels/${srv.text}/members`)).body.members.map((m: any) => m.id)).toContain(a.id);
    expect((await api(request, b, 'POST', `/channels/${srv.text}/leave`)).status).toBe(400);
    expect((await api(request, b, 'DELETE', `/channels/${srv.text}`)).status).toBe(403);
    expect((await api(request, a, 'DELETE', `/channels/${srv.text}`)).status).toBe(200);
    await sb.next((e) => e.type === 'server_channels_changed' && e.server_id === srv.id);
    const left = await api(request, b, 'GET', `/servers/${srv.id}/channels`);
    expect(left.body.channels.map((x: any) => x.id)).not.toContain(srv.text);
    for (const s of [sa, sb, scc]) s.close();
  });

  test('servers: rename, icon, invite, leave, bans and delete', async ({ request }) => {
    const srv = await createServer(request, a);
    const sa = await Socket.open(a.token);
    const sb = await Socket.open(b.token);
    expect((await api(request, b, 'POST', '/servers/join', { code: srv.code })).status).toBe(200);
    await sa.next((e) => e.type === 'server_member_joined' && e.server_id === srv.id && e.user_id === b.id);

    // Переименование и иконка — только владелец; участникам server_updated
    expect((await api(request, b, 'POST', `/servers/${srv.id}/update`, { name: 'Захват' })).status).toBe(403);
    expect((await api(request, a, 'POST', `/servers/${srv.id}/update`, { name: 'Переименован' })).body).toEqual({
      server_id: srv.id, name: 'Переименован', icon: '',
    });
    expect(await sb.next((e) => e.type === 'server_updated')).toEqual({ type: 'server_updated', server_id: srv.id, name: 'Переименован', icon: '' });
    expect((await upload(request, b, `/servers/${srv.id}/icon`, 'i.png', 'image/png', pngBuffer())).status).toBe(403);
    expect((await upload(request, a, `/servers/${srv.id}/icon`, 'i.pdf', 'application/pdf', Buffer.from('%PDF'))).status).toBe(415);
    const icon = await upload(request, a, `/servers/${srv.id}/icon`, 'i.png', 'image/png', pngBuffer(32, 32));
    expect(icon.status).toBe(200);
    expect(icon.body.icon).toMatch(/^\/uploads\/icons\/[0-9a-f]{32}\.png$/);
    const updated = await sb.next((e) => e.type === 'server_updated' && e.icon);
    expect(updated).toMatchObject({ server_id: srv.id, name: 'Переименован', icon: icon.body.icon });
    expect((await request.get(`${ORIGIN}${icon.body.icon}`)).status()).toBe(200);
    expect((await api(request, b, 'GET', '/servers')).body.servers.find((s: any) => s.id === srv.id).icon).toBe(icon.body.icon);
    expect((await api(request, a, 'POST', '/servers/999999999/update', { name: 'x' })).status).toBe(404);

    // Новый код приглашения: старый перестаёт работать
    expect((await api(request, b, 'POST', `/servers/${srv.id}/invite`)).status).toBe(403);
    const invite = await api(request, a, 'POST', `/servers/${srv.id}/invite`);
    expect(invite.body.invite_code).toMatch(/^[A-Z2-9]{6}$/);
    expect(invite.body.invite_code).not.toBe(srv.code);
    expect((await api(request, c, 'POST', '/servers/join', { code: srv.code })).status).toBe(404);
    expect((await api(request, c, 'POST', '/servers/join', { code: invite.body.invite_code })).status).toBe(200);

    // Выход: владельцу нельзя; ушедший получает server_member_left про себя, остальные — тоже
    expect((await api(request, a, 'POST', `/servers/${srv.id}/leave`)).status).toBe(400);
    const sc = await Socket.open(c.token);
    expect((await api(request, c, 'POST', `/servers/${srv.id}/leave`)).status).toBe(200);
    await sa.next((e) => e.type === 'server_member_left' && e.user_id === c.id);
    await sc.next((e) => e.type === 'server_member_left' && e.user_id === c.id && e.server_id === srv.id);
    expect((await api(request, c, 'GET', `/servers/${srv.id}/channels`)).status).toBe(403);
    expect((await api(request, c, 'POST', `/servers/${srv.id}/leave`)).status).toBe(403);

    // Бан: исключает, не пускает обратно ни по коду, ни через добавление участником
    expect((await api(request, b, 'POST', `/servers/${srv.id}/bans`, { user_id: a.id })).status).toBe(403);
    expect((await api(request, a, 'POST', `/servers/${srv.id}/bans`, { user_id: a.id })).status).toBe(400);
    expect((await api(request, a, 'POST', `/servers/${srv.id}/bans`, { user_id: b.id })).status).toBe(200);
    await sb.next((e) => e.type === 'server_removed' && e.server_id === srv.id);
    await sa.next((e) => e.type === 'server_member_left' && e.user_id === b.id);
    expect((await api(request, b, 'POST', '/servers/join', { code: invite.body.invite_code })).status).toBe(403);
    expect((await api(request, c, 'POST', '/servers/join', { code: invite.body.invite_code })).status).toBe(200);
    expect((await api(request, c, 'POST', `/servers/${srv.id}/members`, { user_id: b.id })).status).toBe(403);
    expect((await api(request, c, 'GET', `/servers/${srv.id}/bans`)).status).toBe(403);
    const bans = await api(request, a, 'GET', `/servers/${srv.id}/bans`);
    expect(bans.body.bans).toEqual([{ id: b.id, username: b.username, display_name: b.name, avatar_path: '' }]);
    expect((await api(request, c, 'DELETE', `/servers/${srv.id}/bans/${b.id}`)).status).toBe(403);
    expect((await api(request, a, 'DELETE', `/servers/${srv.id}/bans/${b.id}`)).status).toBe(200);
    expect((await api(request, a, 'GET', `/servers/${srv.id}/bans`)).body.bans).toEqual([]);
    expect((await api(request, b, 'POST', '/servers/join', { code: invite.body.invite_code })).status).toBe(200);

    // Удаление: только владелец; всем участникам server_removed, каналы и сообщения исчезают
    const mid = await post(request, b, srv.text, 'останется только в памяти');
    expect((await api(request, b, 'DELETE', `/servers/${srv.id}`)).status).toBe(403);
    expect((await api(request, a, 'DELETE', `/servers/${srv.id}`)).status).toBe(200);
    for (const s of [sa, sb, sc]) await s.next((e) => e.type === 'server_removed' && e.server_id === srv.id);
    expect((await api(request, a, 'GET', '/servers')).body.servers.map((s: any) => s.id)).not.toContain(srv.id);
    expect((await api(request, a, 'GET', `/channels/${srv.text}/messages`)).status).toBe(404);
    expect((await api(request, a, 'DELETE', `/channels/${srv.text}/messages/${mid}`)).status).toBe(404);
    expect((await api(request, a, 'DELETE', `/servers/${srv.id}`)).status).toBe(404);
    expect((await api(request, b, 'POST', '/servers/join', { code: invite.body.invite_code })).status).toBe(404);
    for (const s of [sa, sb, sc]) s.close();
  });

  test('account: sessions list and revoke; password change ends the other sessions', async ({ request }) => {
    const e = await register(request, 'Ева');
    const second = await login(request, e);
    const third = await login(request, e);
    const asSession = (token: string): Account => ({ ...e, token });

    const list = await api(request, e, 'GET', '/auth/sessions');
    expect(list.body.sessions).toHaveLength(3);
    expect(list.body.sessions.filter((s: any) => s.current)).toHaveLength(1);
    for (const s of list.body.sessions) {
      expect(s.id).toMatch(/^[0-9a-f]{16}$/);
      expect(s.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      expect(s.expires_at > s.created_at).toBe(true);
      expect([e.token, second.token, third.token]).not.toContain(s.id);
    }

    // Завершить одну сессию: её id известен только самому пользователю
    const thirdId = (await api(request, asSession(third.token), 'GET', '/auth/sessions')).body.sessions.find((s: any) => s.current).id;
    expect((await api(request, a, 'DELETE', `/auth/sessions/${thirdId}`)).status).toBe(404);
    expect((await api(request, e, 'DELETE', `/auth/sessions/${thirdId}`)).status).toBe(200);
    expect((await api(request, asSession(third.token), 'GET', '/auth/me')).status).toBe(401);
    expect((await api(request, e, 'DELETE', '/auth/sessions/0123456789abcdef')).status).toBe(404);

    // Смена пароля: неверный старый — 403 (не 401: сессия жива), короткий новый — 400
    const ws = await Socket.open(second.token);
    expect((await api(request, e, 'POST', '/auth/password', { old_password: 'wrong-pass', new_password: 'new-password-1' })).status).toBe(403);
    expect((await api(request, e, 'POST', '/auth/password', { old_password: 'password123', new_password: 'short' })).status).toBe(400);
    expect((await api(request, e, 'GET', '/auth/me')).status).toBe(200);
    const changed = await api(request, e, 'POST', '/auth/password', { old_password: 'password123', new_password: 'new-password-1' });
    expect(changed).toEqual({ status: 200, body: { status: 'ok', revoked: 1 } });
    await ws.closed;
    expect((await api(request, asSession(second.token), 'GET', '/auth/me')).status).toBe(401);
    expect((await api(request, e, 'GET', '/auth/me')).status).toBe(200);
    expect((await login(request, e)).status).toBe(401);
    const fresh = await login(request, e, 'new-password-1');
    expect(fresh.status).toBe(200);

    // Выйти на всех остальных устройствах
    expect((await api(request, e, 'DELETE', '/auth/sessions/others')).body).toEqual({ status: 'ok', revoked: 1 });
    expect((await api(request, asSession(fresh.token), 'GET', '/auth/me')).status).toBe(401);
    const rest = await api(request, e, 'GET', '/auth/sessions');
    expect(rest.body.sessions).toHaveLength(1);
    expect(rest.body.sessions[0].current).toBe(true);
    expect((await request.get(`${API}/auth/sessions`)).status()).toBe(401);
  });
});
