import { APIRequestContext, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer, IncomingMessage, Server } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngBuffer, uniqueName } from './helpers';
import { ApiUser, apiRegister, call, post } from './w1-helpers';

// Боты, Bot API в стиле Telegram и вебхуки каналов (docs/API.md §21–22) — только через API, без браузера.
// Вебхук бота ходит в мок на порту backend + 10 (http://127.0.0.1 разрешён в e2e: start-backend.mjs).
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const WS_URL = `ws://localhost:${port}/ws`;
const HOOK_PORT = port + 10;
// Мок «интернета» для sendPhoto по ссылке и второй сервер без allow_private_webhooks (§21.7)
const FILES_PORT = port + 11;
const STRICT_PORT = port + 12;

type Mode = 'json' | 'form' | 'get';

/** Вызов Bot API: /api/v1/bot<токен>/<метод> с JSON, form-urlencoded (как aiogram) или query */
async function bot(request: APIRequestContext, token: string, method: string, params: Record<string, unknown> = {}, mode: Mode = 'json') {
  const url = `/api/v1/bot${token}/${method}`;
  const flat = () =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
  // Лимит Bot API — 30 запросов в секунду на бота: на 429 ждём retry_after, как настоящие библиотеки
  for (;;) {
    const r =
      mode === 'get'
        ? await request.get(url, { params: flat() })
        : mode === 'form'
          ? await request.post(url, { form: flat() })
          : await request.post(url, { data: params });
    const body = await r.json();
    if (r.status() !== 429) return { status: r.status(), body };
    expect(body.parameters.retry_after).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, body.parameters.retry_after * 1000));
  }
}

/** Результат успешного вызова */
async function ok(request: APIRequestContext, token: string, method: string, params: Record<string, unknown> = {}, mode: Mode = 'json') {
  const r = await bot(request, token, method, params, mode);
  expect(r.body, `${method}: ${JSON.stringify(r.body)}`).toMatchObject({ ok: true });
  return r.body.result;
}

/** Все накопленные обновления, с подтверждением (следующий offset) */
async function drain(request: APIRequestContext, token: string, timeout = 0) {
  const ups = await ok(request, token, 'getUpdates', { timeout });
  if (ups.length) await ok(request, token, 'getUpdates', { offset: ups[ups.length - 1].update_id + 1 });
  return ups as any[];
}

/** WS-клиент на глобальном WebSocket Node 22: копит события, ждёт нужное */
class Socket {
  readonly events: any[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.push(JSON.parse(e.data));
      this.waiters.splice(0).forEach((w) => w());
    };
  }

  static async open(token: string): Promise<Socket> {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    const s = new Socket(ws);
    s.ws.send(JSON.stringify({ type: 'ping' }));
    await s.next((e) => e.type === 'pong');
    return s;
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

  /** Такого события нет: ping/pong гарантирует, что всё отправленное раньше уже дошло */
  async none(pred: (e: any) => boolean) {
    await new Promise((r) => setTimeout(r, 300));
    this.ws.send(JSON.stringify({ type: 'ping' }));
    await this.next((e) => e.type === 'pong');
    expect(this.events.filter(pred)).toEqual([]);
  }

  close() {
    this.ws.close();
  }
}

/** Мок приёмника вебхука бота: запоминает тело и заголовок секрета */
function hookServer() {
  const got: { body: any; secret: string | undefined; path: string }[] = [];
  let notify: (() => void) | null = null;
  const server: Server = createHttpServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      got.push({ body: JSON.parse(raw || '{}'), secret: req.headers['x-telegram-bot-api-secret-token'] as string | undefined, path: req.url ?? '' });
      res.end('ok');
      notify?.();
    });
  });
  return {
    got,
    start: () => new Promise<void>((r) => server.listen(HOOK_PORT, '127.0.0.1', () => r())),
    stop: () => new Promise<void>((r) => server.close(() => r())),
    wait: async (n: number, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (got.length < n && Date.now() < deadline) await new Promise<void>((r) => ((notify = r), setTimeout(r, 200)));
      expect(got.length).toBeGreaterThanOrEqual(n);
    },
  };
}

interface Bot {
  id: number;
  username: string;
  token: string;
}

async function createBot(request: APIRequestContext, owner: ApiUser, name = 'Тестовый бот'): Promise<Bot> {
  const username = `${uniqueName('w5')}_bot`;
  const r = await call(request, owner, 'POST', '/bots', { username, display_name: name });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.bot.id, username, token: r.body.token };
}

/** Личка человека с ботом (её начинает человек) */
async function dmWith(request: APIRequestContext, who: ApiUser, b: Bot): Promise<number> {
  const r = await call(request, who, 'POST', '/dms', { user_id: b.id, username: b.username });
  expect(r.status).toBe(201);
  return r.body.channel_id;
}

const keyboard = (rows: unknown[][]) => ({ inline_keyboard: rows });

/** Правка базы e2e-сервера напрямую (бан от админа, смена владельца) — start-backend.mjs пишет, где она */
async function dbRun(sql: string, ...args: (string | number)[]) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = readFileSync(join(tmpdir(), `vicinity-e2e-${port}.dir`), 'utf8').trim();
  const db = new DatabaseSync(join(dir, 'vicinity.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

test.describe.serial('боты и вебхуки (API)', () => {
  let a: ApiUser & { username: string };
  let b: ApiUser & { username: string };
  let c: ApiUser & { username: string };
  let main: Bot;
  let serverId = 0;
  let serverChannel = 0;

  test.beforeAll(async ({ request }) => {
    a = await apiRegister(request, 'Алиса');
    b = await apiRegister(request, 'Борис');
    c = await apiRegister(request, 'Вера');
  });

  test('создание бота: правила имени, getMe, перевыпуск токена, вход и дружба запрещены', async ({ request }) => {
    for (const username of ['ab', 'plainname', 'bad-name_bot', 'Кирилл_bot']) {
      const r = await call(request, a, 'POST', '/bots', { username, display_name: 'X' });
      expect(r.status, username).toBe(400);
      expect(r.body.error).toBeTruthy();
    }
    main = await createBot(request, a, 'Главный бот');
    expect(main.token).toMatch(new RegExp(`^${main.id}:[A-Za-z0-9_-]{32,}$`));
    const dup = await call(request, a, 'POST', '/bots', { username: main.username.toUpperCase(), display_name: 'X' });
    expect(dup.status).toBe(409);

    const list = await call(request, a, 'GET', '/bots');
    const mine = list.body.bots.find((x: any) => x.id === main.id);
    expect(mine).toMatchObject({ username: main.username, display_name: 'Главный бот', token_hint: main.token.slice(-4), read_all: false });
    expect(JSON.stringify(list.body)).not.toContain(main.token);
    expect((await call(request, b, 'GET', '/bots')).body.bots).toEqual([]);

    const me = await ok(request, main.token, 'getMe', {}, 'get');
    expect(me).toMatchObject({ id: main.id, is_bot: true, username: main.username, first_name: 'Главный бот' });

    const wrong = await bot(request, `${main.id}:wrongtoken`, 'getMe');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ ok: false, error_code: 401, description: 'Unauthorized' });
    const unknown = await bot(request, main.token, 'sendSticker');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ ok: false, error_code: 404 });

    // Новый токен — старый сразу перестаёт работать
    const regen = await call(request, a, 'POST', `/bots/${main.id}/token`);
    expect(regen.status).toBe(200);
    expect((await bot(request, main.token, 'getMe')).status).toBe(401);
    main.token = regen.body.token;
    await ok(request, main.token, 'getMe');
    // Чужой бот — как несуществующий
    expect((await call(request, b, 'POST', `/bots/${main.id}/token`)).status).toBe(404);

    // Войти ботом по паролю нельзя, в друзья не добавить
    for (const password of ['!', '', 'password123']) {
      const login = await request.post('/api/v1/auth/login', { data: { username: main.username, password } });
      expect(login.status()).toBe(401);
    }
    const fr = await call(request, b, 'POST', '/friends/request', { user_id: main.id, username: main.username });
    expect(fr.status).toBe(400);
    expect(fr.body.error).toContain('бот');

    // Поиск и профиль показывают пометку бота
    const found = await call(request, b, 'GET', `/users/search?q=${main.username}`);
    expect(found.body.users[0]).toMatchObject({ id: main.id, is_bot: true });
    const profile = await call(request, c, 'GET', `/users/${main.id}/profile`);
    expect(profile.body.is_bot).toBe(true);
  });

  test('не больше 10 ботов на владельца', async ({ request }) => {
    const d = await apiRegister(request, 'Дина');
    for (let i = 0; i < 10; i++) await createBot(request, d);
    const r = await call(request, d, 'POST', '/bots', { username: `${uniqueName('w5')}_bot`, display_name: 'X' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('10');
  });

  test('личка с ботом: getUpdates, длинный опрос, offset подтверждает', async ({ request }) => {
    const ch = await dmWith(request, b, main);
    await drain(request, main.token);
    expect(await ok(request, main.token, 'getUpdates', { timeout: 0 })).toEqual([]);

    // Длинный опрос отвечает сразу, как пришло сообщение
    const started = Date.now();
    const pending = ok(request, main.token, 'getUpdates', { timeout: 20 });
    await new Promise((r) => setTimeout(r, 400));
    await post(request, b, ch, 'привет, бот');
    const ups = await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(ups).toHaveLength(1);
    const m = ups[0].message;
    expect(m).toMatchObject({ text: 'привет, бот', chat: { id: ch, type: 'private', username: b.username }, from: { id: b.id, is_bot: false } });
    expect(typeof m.date).toBe('number');

    // Без подтверждения обновление остаётся; offset его удаляет
    const again = await ok(request, main.token, 'getUpdates', {}, 'get');
    expect(again.map((u: any) => u.update_id)).toEqual([ups[0].update_id]);
    const t0 = Date.now();
    expect(await ok(request, main.token, 'getUpdates', { offset: ups[0].update_id + 1, timeout: 1 }, 'form')).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);

    // Команда в личке: entities bot_command; правка человека — edited_message
    const mid = await post(request, b, ch, '/start привет');
    const cmd = (await drain(request, main.token))[0].message;
    expect(cmd.entities).toEqual([{ type: 'bot_command', offset: 0, length: 6 }]);
    expect((await call(request, b, 'POST', `/channels/${ch}/messages/${mid}/edit`, { text: '/start пока' })).status).toBe(200);
    const edited = await drain(request, main.token);
    expect(edited[0].edited_message).toMatchObject({ message_id: mid, text: '/start пока' });
    expect(edited[0].edited_message.edit_date).toBeTruthy();

    // Сообщения самого бота ему не приходят; бот видит пометку в ЛС-списке человека
    await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'я бот' });
    expect(await drain(request, main.token)).toEqual([]);
    const dms = await call(request, b, 'GET', '/dms');
    expect(dms.body.dms.find((d: any) => d.channel_id === ch)).toMatchObject({ user_id: main.id, is_bot: true });
  });

  test('sendMessage: кнопки, проверки, parse_mode, form-urlencoded и JSON-строки', async ({ request }) => {
    const ch = await dmWith(request, b, main);
    const kb = keyboard([[{ text: 'Да', callback_data: 'yes' }, { text: 'Сайт', url: 'https://example.com/x' }], [{ text: 'Копия', copy_text: { text: 'код' } }]]);
    const sent = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'Выберите', reply_markup: kb });
    expect(sent).toMatchObject({ text: 'Выберите', chat: { id: ch }, from: { id: main.id, is_bot: true }, reply_markup: kb });

    const history = await call(request, b, 'GET', `/channels/${ch}/messages`);
    const stored = history.body.messages.find((m: any) => m.id === sent.message_id);
    expect(stored).toMatchObject({ author_bot: true, reply_markup: kb, webhook: null });

    const bad = async (markup: unknown, needle: string) => {
      const r = await bot(request, main.token, 'sendMessage', { chat_id: ch, text: 'x', reply_markup: markup });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(r.body.description).toContain(needle);
    };
    await bad(keyboard([[{ text: 'X', url: 'javascript:alert(1)' }]]), 'BUTTON_URL_INVALID');
    await bad(keyboard([Array.from({ length: 9 }, (_, i) => ({ text: `${i}`, callback_data: `${i}` }))]), 'too many buttons in a row');
    await bad(keyboard(Array.from({ length: 11 }, (_, i) => [{ text: `${i}`, callback_data: `${i}` }])), 'too many rows');
    await bad(keyboard(Array.from({ length: 7 }, () => Array.from({ length: 8 }, (_, i) => ({ text: `${i}`, callback_data: `${i}` })))), 'too many buttons');
    await bad(keyboard([[{ text: 'X', callback_data: 'я'.repeat(33) }]]), 'BUTTON_DATA_INVALID');
    await bad(keyboard([[{ text: 'X' }]]), 'unsupported');
    await bad(keyboard([[{ text: 'X', callback_data: 'a', url: 'https://a.b' }]]), 'exactly one');
    expect((await bot(request, main.token, 'sendMessage', { chat_id: ch, text: '' })).body.description).toContain('empty');
    expect((await bot(request, main.token, 'sendMessage', { chat_id: ch, text: 'я'.repeat(4097) })).body.description).toContain('too long');
    expect((await bot(request, main.token, 'sendMessage', { chat_id: 999999, text: 'x' })).body.description).toContain('chat not found');
    // Обычные клавиатуры (не inline) молча игнорируются
    const plain = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'без кнопок', reply_markup: { keyboard: [[{ text: 'a' }]] } });
    expect(plain.reply_markup).toBeUndefined();

    // parse_mode
    const html = await ok(request, main.token, 'sendMessage', {
      chat_id: ch,
      parse_mode: 'HTML',
      text: '<b>жир</b> &amp; <i>кур</i> <a href="https://example.com">сайт</a> <code>a*b</code> 2*3 <tg-spoiler>тайна</tg-spoiler>',
    });
    expect(html.text).toBe('**жир** & *кур* [сайт](https://example.com) `a*b` 2\\*3 ||тайна||');
    const md2 = await ok(request, main.token, 'sendMessage', { chat_id: ch, parse_mode: 'MarkdownV2', text: '*жир* _кур_ __под__ ~зач~ конец\\.' });
    expect(md2.text).toBe('**жир** *кур* __под__ ~~зач~~ конец.');
    const pre = await ok(request, main.token, 'sendMessage', { chat_id: ch, parse_mode: 'HTML', text: '<pre><code class="language-js">x &lt; 1 &amp;&amp; y</code></pre>' });
    expect(pre.text).toBe('```js\nx < 1 && y\n```');

    // form-urlencoded c reply_markup JSON-строкой (так шлёт aiogram) и GET с query
    const form = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'форма', reply_markup: kb, disable_notification: true }, 'form');
    expect(form.reply_markup).toEqual(kb);
    const viaGet = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'гет', reply_to_message_id: sent.message_id }, 'get');
    expect(viaGet.reply_to_message).toMatchObject({ message_id: sent.message_id, text: 'Выберите' });
    const viaParams = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'ответ', reply_parameters: { message_id: sent.message_id } }, 'form');
    expect(viaParams.reply_to_message.message_id).toBe(sent.message_id);
    expect((await bot(request, main.token, 'sendMessage', { chat_id: ch, text: 'x', reply_to_message_id: 99999999 })).body.description).toContain('replied not found');
    await drain(request, main.token);
  });

  test('нажатие кнопки: callback_query → answerCallbackQuery → callback_answer нажавшему', async ({ request }) => {
    const ch = await dmWith(request, b, main);
    await drain(request, main.token);
    const ws = await Socket.open(b.token);
    try {
      const sent = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'Нажмите', reply_markup: keyboard([[{ text: 'Go', callback_data: 'go:1' }]]) });
      expect((await call(request, b, 'POST', `/channels/${ch}/messages/${sent.message_id}/callback`, { data: 'nope' })).status).toBe(400);
      // Не участник лички нажать не может
      expect((await call(request, c, 'POST', `/channels/${ch}/messages/${sent.message_id}/callback`, { data: 'go:1' })).status).toBe(403);
      const humanMsg = await post(request, b, ch, 'моё сообщение');
      expect((await call(request, b, 'POST', `/channels/${ch}/messages/${humanMsg}/callback`, { data: 'go:1' })).status).toBe(400);
      await drain(request, main.token);

      const press = await call(request, b, 'POST', `/channels/${ch}/messages/${sent.message_id}/callback`, { data: 'go:1' });
      expect(press.status).toBe(200);
      expect(press.body).toMatchObject({ ok: true });
      const ups = await drain(request, main.token);
      expect(ups).toHaveLength(1);
      const q = ups[0].callback_query;
      expect(q).toMatchObject({ id: press.body.query_id, data: 'go:1', from: { id: b.id }, message: { message_id: sent.message_id, chat: { id: ch } } });
      expect(q.chat_instance).toBeTruthy();

      await ok(request, main.token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Готово', show_alert: true }, 'form');
      const ans = await ws.next((e) => e.type === 'callback_answer');
      expect(ans).toMatchObject({ query_id: q.id, channel_id: ch, message_id: sent.message_id, text: 'Готово', show_alert: true });
      const again = await bot(request, main.token, 'answerCallbackQuery', { callback_query_id: q.id });
      expect(again.status).toBe(400);
      expect(again.body.description).toContain('query is too old or already answered');
      expect((await bot(request, main.token, 'answerCallbackQuery', { callback_query_id: 'deadbeef' })).status).toBe(400);
    } finally {
      ws.close();
    }
  });

  test('editMessageText, editMessageReplyMarkup и deleteMessage → события всем в чате', async ({ request }) => {
    const ch = await dmWith(request, b, main);
    const ws = await Socket.open(b.token);
    try {
      const kb = keyboard([[{ text: 'A', callback_data: 'a' }]]);
      const sent = await ok(request, main.token, 'sendMessage', { chat_id: ch, text: 'было', reply_markup: kb });

      const edited = await ok(request, main.token, 'editMessageText', { chat_id: ch, message_id: sent.message_id, text: '<b>стало</b>', parse_mode: 'HTML', reply_markup: kb });
      expect(edited).toMatchObject({ text: '**стало**', reply_markup: kb });
      expect(edited.edit_date).toBeTruthy();
      expect(await ws.next((e) => e.type === 'message_edited' && e.id === sent.message_id)).toMatchObject({ channel_id: ch, text: '**стало**', reply_markup: kb, edited: true });
      const same = await bot(request, main.token, 'editMessageText', { chat_id: ch, message_id: sent.message_id, text: '**стало**', reply_markup: kb });
      expect(same.body.description).toContain('message is not modified');

      const kb2 = keyboard([[{ text: 'B', url: 'https://example.org' }]]);
      await ok(request, main.token, 'editMessageReplyMarkup', { chat_id: ch, message_id: sent.message_id, reply_markup: kb2 }, 'form');
      expect(await ws.next((e) => e.type === 'message_edited' && e.id === sent.message_id)).toMatchObject({ text: '**стало**', reply_markup: kb2 });
      // Без reply_markup — кнопки убираются
      await ok(request, main.token, 'editMessageReplyMarkup', { chat_id: ch, message_id: sent.message_id });
      expect((await ws.next((e) => e.type === 'message_edited' && e.id === sent.message_id)).reply_markup).toBeNull();

      // Чужое сообщение бот не правит и не удаляет
      const human = await post(request, b, ch, 'человек');
      expect((await bot(request, main.token, 'editMessageText', { chat_id: ch, message_id: human, text: 'x' })).body.description).toContain("can't be edited");
      expect((await bot(request, main.token, 'deleteMessage', { chat_id: ch, message_id: human })).body.description).toContain("can't be deleted");

      expect(await ok(request, main.token, 'deleteMessage', { chat_id: ch, message_id: sent.message_id })).toBe(true);
      expect(await ws.next((e) => e.type === 'message_deleted' && e.id === sent.message_id)).toMatchObject({ channel_id: ch });
      expect((await bot(request, main.token, 'deleteMessage', { chat_id: ch, message_id: sent.message_id })).body.description).toContain('not found');
      await drain(request, main.token);
    } finally {
      ws.close();
    }
  });

  test('сервер: владелец добавляет бота, команды и упоминания, read_all, эфемерные сообщения', async ({ request }) => {
    const s = await call(request, a, 'POST', '/servers', { name: 'Сервер ботов' });
    serverId = s.body.server_id;
    expect((await call(request, b, 'POST', '/servers/join', { code: s.body.invite_code })).status).toBe(200);
    const chans = await call(request, a, 'GET', `/servers/${serverId}/channels`);
    serverChannel = chans.body.channels.find((x: any) => !x.is_voice).id;

    // Не владелец — нельзя; несуществующий бот — 404; обычного человека ботом не добавить
    expect((await call(request, b, 'POST', `/servers/${serverId}/bots`, { username: main.username })).status).toBe(403);
    expect((await call(request, a, 'POST', `/servers/${serverId}/bots`, { username: 'nobody_here_bot' })).status).toBe(404);
    expect((await call(request, a, 'POST', `/servers/${serverId}/bots`, { username: b.username })).status).toBe(404);
    const add = await call(request, a, 'POST', `/servers/${serverId}/bots`, { username: `@${main.username}` });
    expect(add.status).toBe(201);
    expect(add.body.bot).toMatchObject({ id: main.id, username: main.username });
    expect((await call(request, a, 'GET', `/servers/${serverId}/bots`)).body.bots.map((x: any) => x.id)).toEqual([main.id]);
    expect((await call(request, b, 'GET', `/servers/${serverId}/bots`)).status).toBe(403);
    const members = await call(request, b, 'GET', `/servers/${serverId}/members`);
    expect(members.body.members.find((m: any) => m.id === main.id)).toMatchObject({ is_bot: true });
    expect((await call(request, a, 'GET', '/bots')).body.bots.find((x: any) => x.id === main.id).servers).toEqual([{ id: serverId, name: 'Сервер ботов' }]);

    // Команды: setMyCommands (JSON-строкой в форме) → getMyCommands → подсказки канала
    await ok(request, main.token, 'setMyCommands', { commands: [{ command: 'help', description: 'Помощь' }, { command: '/roll', description: 'Бросить кубик' }] }, 'form');
    expect(await ok(request, main.token, 'getMyCommands')).toEqual([{ command: 'help', description: 'Помощь' }, { command: 'roll', description: 'Бросить кубик' }]);
    expect((await bot(request, main.token, 'setMyCommands', { commands: [{ command: 'Bad-Cmd', description: 'x' }] })).status).toBe(400);
    const cmds = await call(request, b, 'GET', `/channels/${serverChannel}/commands`);
    expect(cmds.body.commands).toEqual([
      { bot_id: main.id, bot_username: main.username, command: 'help', description: 'Помощь' },
      { bot_id: main.id, bot_username: main.username, command: 'roll', description: 'Бросить кубик' },
    ]);
    expect((await call(request, c, 'GET', `/channels/${serverChannel}/commands`)).status).toBe(403);
    expect((await ok(request, main.token, 'getChat', { chat_id: serverChannel })).type).toBe('supergroup');

    // Доставка в канале сервера: команды, @упоминание, ответ боту; обычные сообщения — нет
    await drain(request, main.token);
    const botMsg = await ok(request, main.token, 'sendMessage', { chat_id: serverChannel, text: 'я в канале' });
    await post(request, b, serverChannel, 'просто так');
    await post(request, b, serverChannel, '/help');
    await post(request, b, serverChannel, '/help@other_bot');
    await post(request, b, serverChannel, `эй @${main.username.toUpperCase()}, привет`);
    await post(request, b, serverChannel, `почта @${main.username}x не упоминание`);
    await post(request, b, serverChannel, 'ответ боту', { reply_to: botMsg.message_id });
    await post(request, b, serverChannel, `/roll@${main.username} 2d6`);
    let texts = (await drain(request, main.token)).map((u) => u.message.text);
    expect(texts).toEqual(['/help', `эй @${main.username.toUpperCase()}, привет`, 'ответ боту', `/roll@${main.username} 2d6`]);
    const chat = (await ok(request, main.token, 'getChat', { chat_id: serverChannel }));
    expect(chat.title).toContain('Сервер ботов');

    // read_all — все сообщения
    const patch = await call(request, a, 'PATCH', `/bots/${main.id}`, { read_all: true, description: 'Умеет всё' });
    expect(patch.body.bot).toMatchObject({ read_all: true, description: 'Умеет всё' });
    await post(request, b, serverChannel, 'любое сообщение');
    texts = (await drain(request, main.token)).map((u) => u.message.text);
    expect(texts).toEqual(['любое сообщение']);
    await call(request, a, 'PATCH', `/bots/${main.id}`, { read_all: false });

    // Эфемерное сообщение видит только адресат
    const wsB = await Socket.open(b.token);
    const wsA = await Socket.open(a.token);
    try {
      const eph = await ok(request, main.token, 'sendEphemeralMessage', {
        chat_id: serverChannel,
        user_id: b.id,
        text: '<i>только вам</i>',
        parse_mode: 'HTML',
        reply_markup: keyboard([[{ text: 'OK', callback_data: 'eph' }]]),
      });
      expect(eph.message_id).toBe(0);
      const ev = await wsB.next((e) => e.type === 'ephemeral_message');
      expect(ev).toMatchObject({ channel_id: serverChannel, message: { id: 0, ephemeral: true, author_bot: true, author_id: main.id, text: '*только вам*' } });
      expect(ev.message.ephemeral_id).toBe(eph.ephemeral_id);
      await wsA.none((e) => e.type === 'ephemeral_message');
      // В историю не попадает
      const hist = await call(request, b, 'GET', `/channels/${serverChannel}/messages`);
      expect(hist.body.messages.some((m: any) => m.text === '*только вам*')).toBe(false);
      // Кнопка эфемерного: mid = 0 + ephemeral_id
      const press = await call(request, b, 'POST', `/channels/${serverChannel}/messages/0/callback`, { data: 'eph', ephemeral_id: eph.ephemeral_id });
      expect(press.status).toBe(200);
      expect((await call(request, a, 'POST', `/channels/${serverChannel}/messages/0/callback`, { data: 'eph', ephemeral_id: eph.ephemeral_id })).status).toBe(404);
      const q = (await drain(request, main.token))[0].callback_query;
      expect(q).toMatchObject({ data: 'eph', from: { id: b.id }, message: { message_id: 0, ephemeral_id: eph.ephemeral_id } });
      // Не участнику — нельзя
      expect((await bot(request, main.token, 'sendEphemeralMessage', { chat_id: serverChannel, user_id: c.id, text: 'x' })).status).toBe(400);
    } finally {
      wsA.close();
      wsB.close();
    }
  });

  test('setWebhook: доставка на адрес с секретом, getUpdates → 409, deleteWebhook', async ({ request }) => {
    const hook = hookServer();
    await hook.start();
    try {
      const ch = await dmWith(request, b, main);
      await drain(request, main.token);
      expect((await bot(request, main.token, 'setWebhook', { url: 'ftp://example.com/hook' })).status).toBe(400);
      await ok(request, main.token, 'setWebhook', { url: `http://127.0.0.1:${HOOK_PORT}/hook?k=1`, secret_token: 'S3cret_token-1' }, 'form');
      const info = await ok(request, main.token, 'getWebhookInfo');
      expect(info).toMatchObject({ url: `http://127.0.0.1:${HOOK_PORT}/hook?k=1`, has_custom_certificate: false, pending_update_count: 0 });
      const conflict = await bot(request, main.token, 'getUpdates');
      expect(conflict.status).toBe(409);
      expect(conflict.body.ok).toBe(false);
      expect((await call(request, a, 'GET', '/bots')).body.bots.find((x: any) => x.id === main.id).webhook_url).toContain('/hook');

      await post(request, b, ch, 'на вебхук');
      await hook.wait(1);
      expect(hook.got[0].secret).toBe('S3cret_token-1');
      expect(hook.got[0].path).toBe('/hook?k=1');
      expect(hook.got[0].body).toMatchObject({ message: { text: 'на вебхук', chat: { id: ch } } });
      expect(typeof hook.got[0].body.update_id).toBe('number');
      // Доставленное уходит из очереди
      await expect.poll(async () => (await ok(request, main.token, 'getWebhookInfo')).pending_update_count).toBe(0);

      await ok(request, main.token, 'deleteWebhook', { drop_pending_updates: true });
      expect((await ok(request, main.token, 'getWebhookInfo')).url).toBe('');
      expect(await ok(request, main.token, 'getUpdates')).toEqual([]);
    } finally {
      await hook.stop();
    }
  });

  test('вебхук канала: создаёт владелец, сообщение под именем вебхука, неверный токен — 401', async ({ request }) => {
    expect(serverId).toBeGreaterThan(0);
    expect((await call(request, b, 'POST', `/servers/${serverId}/webhooks`, { channel_id: serverChannel, name: 'CI' })).status).toBe(403);
    expect((await call(request, a, 'POST', `/servers/${serverId}/webhooks`, { channel_id: 999999, name: 'CI' })).status).toBe(404);
    const made = await call(request, a, 'POST', `/servers/${serverId}/webhooks`, { channel_id: serverChannel, name: 'CI' });
    expect(made.status).toBe(201);
    expect(made.body.webhook).toMatchObject({ channel_id: serverChannel, name: 'CI' });
    const url: string = made.body.url;
    expect(url).toMatch(new RegExp(`^/api/v1/webhooks/${made.body.webhook.id}/[0-9a-f]{32,}$`));
    const listed = await call(request, a, 'GET', `/servers/${serverId}/webhooks`);
    expect(listed.body.webhooks).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(url.split('/').pop()!);

    await drain(request, main.token);
    const ws = await Socket.open(b.token);
    try {
      const r = await request.post(url, { data: { content: 'Сборка прошла @' + main.username } });
      expect(r.status()).toBe(204);
      const ev = await ws.next((e) => e.type === 'new_message' && e.channel_id === serverChannel);
      expect(ev).toMatchObject({ text: 'Сборка прошла @' + main.username, author_name: 'CI', webhook: { id: made.body.webhook.id, name: 'CI' }, author_bot: false });
    } finally {
      ws.close();
    }
    // Упоминание бота в сообщении вебхука доставляется боту
    expect((await drain(request, main.token)).map((u) => u.message.text)).toEqual(['Сборка прошла @' + main.username]);

    const named = await request.post(`${url}?wait=true`, { data: { text: 'деплой', username: 'Деплой-бот' } });
    expect(named.status()).toBe(200);
    expect(await named.json()).toMatchObject({ text: 'деплой', author_name: 'Деплой-бот', webhook: { name: 'Деплой-бот' } });
    const withButton = await request.post(url, { data: { content: 'кнопка', reply_markup: keyboard([[{ text: 'Лог', url: 'https://example.com/log' }]]) } });
    expect(withButton.status()).toBe(204);
    const cbButton = await request.post(url, { data: { content: 'нельзя', reply_markup: keyboard([[{ text: 'X', callback_data: 'x' }]]) } });
    expect(cbButton.status()).toBe(400);
    expect((await request.post(url, { data: { content: '' } })).status()).toBe(400);
    expect((await request.post(url.replace(/[0-9a-f]{8}$/, '00000000'), { data: { content: 'x' } })).status()).toBe(401);

    // Человек не может править сообщение вебхука от своего имени
    const hist = await call(request, a, 'GET', `/channels/${serverChannel}/messages`);
    const hookMsg = hist.body.messages.find((m: any) => m.text === 'деплой');
    expect(hookMsg.webhook.name).toBe('Деплой-бот');
    expect((await call(request, a, 'POST', `/channels/${serverChannel}/messages/${hookMsg.id}/edit`, { text: 'подмена' })).status).toBe(403);

    expect((await call(request, a, 'DELETE', `/servers/${serverId}/webhooks/${made.body.webhook.id}`)).status).toBe(200);
    expect((await request.post(url, { data: { content: 'после удаления' } })).status()).toBe(401);
  });

  test('беседа: бот входит сразу, без приглашения; команды доходят', async ({ request }) => {
    const g = await call(request, a, 'POST', '/channels', { type: 'group', name: 'Беседа с ботом' });
    const ch = g.body.channel_id;
    const add = await call(request, a, 'POST', `/channels/${ch}/members`, { user_id: main.id });
    expect(add.body).toMatchObject({ status: 'added', channel_id: ch });
    expect((await call(request, a, 'POST', `/channels/${ch}/members`, { user_id: main.id })).status).toBe(409);
    expect(await ok(request, main.token, 'getChat', { chat_id: ch })).toMatchObject({ id: ch, type: 'group', title: 'Беседа с ботом' });
    await drain(request, main.token);
    await post(request, a, ch, 'без команды');
    await post(request, a, ch, '/roll');
    expect((await drain(request, main.token)).map((u) => u.message.text)).toEqual(['/roll']);
  });

  test('бот убирается с сервера и удаляется вместе с токеном', async ({ request }) => {
    expect((await call(request, a, 'DELETE', `/servers/${serverId}/bots/${main.id}`)).status).toBe(200);
    const r = await bot(request, main.token, 'sendMessage', { chat_id: serverChannel, text: 'x' });
    expect(r.status).toBe(403);
    expect((await call(request, b, 'DELETE', `/bots/${main.id}`)).status).toBe(404);
    expect((await call(request, a, 'DELETE', `/bots/${main.id}`)).status).toBe(200);
    expect((await bot(request, main.token, 'getMe')).status).toBe(401);
    expect((await call(request, a, 'GET', '/bots')).body.bots).toEqual([]);
  });
});

// Исправления после ревью: доставка на вебхук, совместимость с Telegram, права после удаления и бана
test.describe.serial('боты: доставка, совместимость и права', () => {
  let a: ApiUser & { username: string };
  let b: ApiUser & { username: string };
  let hb: Bot;
  let serverId = 0;
  let channel = 0;

  test.beforeAll(async ({ request }) => {
    a = await apiRegister(request, 'Анна');
    b = await apiRegister(request, 'Богдан');
    hb = await createBot(request, a, 'Доставщик');
    const s = await call(request, a, 'POST', '/servers', { name: 'Доставка' });
    serverId = s.body.server_id;
    expect((await call(request, b, 'POST', '/servers/join', { code: s.body.invite_code })).status).toBe(200);
    channel = (await call(request, a, 'GET', `/servers/${serverId}/channels`)).body.channels.find((x: any) => !x.is_voice).id;
    expect((await call(request, a, 'POST', `/servers/${serverId}/bots`, { username: hb.username })).status).toBe(201);
  });

  test('вебхук бота: по порядку, повтор после ошибки, больше 100 накопленных, тело ответа не копится', async ({ request }) => {
    test.setTimeout(120_000);
    await call(request, a, 'PATCH', `/bots/${hb.id}`, { read_all: true });
    await drain(request, hb.token);
    // 120 обновлений быстро: 5 вебхуков канала по 24 сообщения (лимит — 30 в минуту на вебхук)
    const urls: string[] = [];
    for (let k = 0; k < 5; k++) urls.push((await call(request, a, 'POST', `/servers/${serverId}/webhooks`, { channel_id: channel, name: `W${k}` })).body.url);
    for (let n = 0; n < 120; n++) expect((await request.post(urls[n % 5], { data: { content: `n-${n}` } })).status()).toBe(204);
    expect((await ok(request, hb.token, 'getWebhookInfo')).pending_update_count).toBe(120);

    // Приёмник: первый запрос — 500, дальше 200 с огромным Content-Length и мегабайтом тела, соединение не закрывается
    const got: { id: number; text: string; code: number }[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = createHttpServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        const code = got.length === 0 ? 500 : 200;
        got.push({ id: body.update_id, text: body.message?.text, code });
        res.on('error', () => {});
        if (code === 500) return res.writeHead(500).end('fail');
        res.writeHead(200, { 'Content-Length': '4000000000' });
        res.write(Buffer.alloc(1 << 20, 120));
      });
    });
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('error', () => {});
      sock.on('close', () => sockets.delete(sock));
    });
    await new Promise<void>((r) => server.listen(HOOK_PORT, '127.0.0.1', () => r()));
    try {
      await ok(request, hb.token, 'setWebhook', { url: `http://127.0.0.1:${HOOK_PORT}/deliver` });
      // Повторный setWebhook (как aiogram при каждом старте) не шлёт то, что уже в пути
      await ok(request, hb.token, 'setWebhook', { url: `http://127.0.0.1:${HOOK_PORT}/deliver` });
      await expect.poll(() => got.filter((g) => g.code === 200).length, { timeout: 60_000 }).toBe(120);
      const okTexts = got.filter((g) => g.code === 200).map((g) => g.text);
      expect(okTexts).toEqual(Array.from({ length: 120 }, (_, n) => `n-${n}`));
      // Не дошедшее первым повторено с него же, по порядку, без дублей
      expect(got[0]).toMatchObject({ code: 500, text: 'n-0' });
      const ids = got.slice(1).map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort((x, y) => x - y)).toEqual(ids);
      await expect.poll(async () => (await ok(request, hb.token, 'getWebhookInfo')).pending_update_count).toBe(0);
      expect((await ok(request, hb.token, 'getWebhookInfo')).last_error_message).toBeUndefined();
    } finally {
      for (const sock of sockets) sock.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
    await ok(request, hb.token, 'deleteWebhook', { drop_pending_updates: true });
    await call(request, a, 'PATCH', `/bots/${hb.id}`, { read_all: false });
    for (const w of (await call(request, a, 'GET', `/servers/${serverId}/webhooks`)).body.webhooks)
      await call(request, a, 'DELETE', `/servers/${serverId}/webhooks/${w.id}`);
  });

  test('getUpdates: отрицательный offset — только последние; allowed_updates хранится у бота', async ({ request }) => {
    await drain(request, hb.token);
    for (const t of ['/one', '/two', '/three']) await post(request, b, channel, t);
    const last = await ok(request, hb.token, 'getUpdates', { offset: -1 });
    expect(last.map((u: any) => u.message.text)).toEqual(['/three']);
    // Более ранние забыты: подтверждаем последнее — очередь пуста
    expect(await ok(request, hb.token, 'getUpdates', { offset: last[0].update_id + 1 })).toEqual([]);

    // Только нажатия: сообщения после вызова не копятся, уже накопленные остаются
    await post(request, b, channel, '/before');
    await ok(request, hb.token, 'getUpdates', { allowed_updates: ['callback_query'], timeout: 0, offset: -1000 });
    await post(request, b, channel, '/after');
    expect((await ok(request, hb.token, 'getUpdates')).map((u: any) => u.message?.text)).toEqual(['/before']);
    await ok(request, hb.token, 'getUpdates', { allowed_updates: [] });
    await post(request, b, channel, '/again');
    expect((await drain(request, hb.token)).map((u: any) => u.message?.text)).toEqual(['/before', '/again']);
  });

  test('parse_mode: span-спойлер, адреса и @имена без «\\», буквальный текст HTML, ссылки MarkdownV2', async ({ request }) => {
    const send = async (text: string, parse_mode: string) =>
      (await ok(request, hb.token, 'sendMessage', { chat_id: channel, text, parse_mode })).text as string;
    expect(await send('<span class="tg-spoiler">секрет</span> открыто', 'HTML')).toBe('||секрет|| открыто');
    expect(await send('<b><span class="tg-spoiler">x</span> y</b>', 'HTML')).toBe('**||x|| y**');
    expect(await send('<span>просто</span> текст', 'HTML')).toBe('просто текст');
    expect(await send('Docs: https://example.com/my_page и @helper_bot', 'HTML')).toBe('Docs: https://example.com/my_page и @helper_bot');
    expect(await send('<a href="https://example.com/a_b">https://example.com/a_b</a>', 'HTML')).toBe('https://example.com/a_b');
    // Текст пользователя в HTML — буквальный: ни заголовка, ни цитаты, ни ссылки, ни метки времени
    expect(await send('# BUY NOW\n&gt; цитата\n- пункт\n1. первый\n[Банк](https://evil.example) &lt;t:0:R&gt;', 'HTML')).toBe(
      '\\# BUY NOW\n\\> цитата\n\\- пункт\n1\\. первый\n\\[Банк\\](https://evil.example) \\<t:0:R>',
    );
    expect(await send('[docs](https://example.com/getting_started) и ~[x](https://h.example/~user)~', 'MarkdownV2')).toBe(
      '[docs](https://example.com/getting_started) и ~~[x](https://h.example/~user)~~',
    );
    expect(await send('[Анна](tg://user?id=1), привет', 'MarkdownV2')).toBe('Анна, привет');
    expect(await send('Сайт https://my\\-site\\.com и @helper\\_bot', 'MarkdownV2')).toBe('Сайт https://my-site.com и @helper_bot');
  });

  test('entities: mention и url с offset в UTF-16; отправитель сообщения вебхука — не создатель', async ({ request }) => {
    await drain(request, hb.token);
    const text = `эй 🙂 @${hb.username} смотри https://example.com/x.`;
    await post(request, b, channel, text);
    const [u] = await drain(request, hb.token);
    const off = (needle: string) => text.indexOf(needle); // JS-строки — уже UTF-16
    expect(u.message.entities).toEqual([
      { type: 'mention', offset: off('@'), length: hb.username.length + 1 },
      { type: 'url', offset: off('https'), length: 'https://example.com/x'.length },
    ]);

    const made = await call(request, a, 'POST', `/servers/${serverId}/webhooks`, { channel_id: channel, name: 'CI' });
    expect((await request.post(made.body.url, { data: { content: `/ban @someone @${hb.username}` } })).status()).toBe(204);
    const [w] = await drain(request, hb.token);
    expect(w.message.from).toEqual({ id: 9000000000000 + made.body.webhook.id, is_bot: true, first_name: 'CI' });
    expect(w.message.from.id).not.toBe(a.id);

    // Для создателя сообщение вебхука — не своё: непрочитанное и упоминание
    const before = (await call(request, a, 'GET', '/unread')).body.channels.find((x: any) => x.channel_id === channel);
    expect(before?.unread ?? 0).toBeGreaterThan(0);
    await request.post(made.body.url, { data: { content: `@${a.username} сборка упала` } });
    const after = (await call(request, a, 'GET', '/unread')).body.channels.find((x: any) => x.channel_id === channel);
    expect(after.mentions).toBeGreaterThan(0);

    // Цитата ответа на сообщение вебхука помечена
    const hist = await call(request, a, 'GET', `/channels/${channel}/messages`);
    const hookMsg = hist.body.messages.find((m: any) => m.webhook);
    await drain(request, hb.token);
    const reply = await call(request, b, 'POST', `/channels/${channel}/messages`, { text: `ответ @${hb.username}`, reply_to: hookMsg.id });
    expect(reply.body.reply).toMatchObject({ id: hookMsg.id, author_name: 'CI', webhook: { id: made.body.webhook.id, name: 'CI' } });
    const [r] = await drain(request, hb.token);
    expect(r.message.reply_to_message.from).toEqual({ id: 9000000000000 + made.body.webhook.id, is_bot: true, first_name: 'CI' });

    // Вебхук отключается, когда создатель больше не владелец сервера
    await dbRun('UPDATE servers SET owner_id = ? WHERE id = ?', b.id, serverId);
    try {
      expect((await request.post(made.body.url, { data: { content: 'после передачи' } })).status()).toBe(403);
    } finally {
      await dbRun('UPDATE servers SET owner_id = ? WHERE id = ?', a.id, serverId);
    }
    expect((await request.post(made.body.url, { data: { content: 'снова владелец' } })).status()).toBe(204);
    await call(request, a, 'DELETE', `/servers/${serverId}/webhooks/${made.body.webhook.id}`);
  });

  test('предложения «Главной» без ботов', async ({ request }) => {
    const home = await call(request, b, 'GET', '/home');
    expect(home.status).toBe(200);
    expect((home.body.suggestions ?? []).map((x: any) => x.id)).not.toContain(hb.id);
  });

  test('бота убрали с сервера: нажатие ему не уходит, ответить на старое он не может', async ({ request }) => {
    await drain(request, hb.token);
    const sent = await ok(request, hb.token, 'sendMessage', { chat_id: channel, text: 'кнопка', reply_markup: keyboard([[{ text: 'Да', callback_data: 'yes' }]]) });
    const press = await call(request, b, 'POST', `/channels/${channel}/messages/${sent.message_id}/callback`, { data: 'yes' });
    expect(press.status).toBe(200);
    const q = (await drain(request, hb.token)).find((u) => u.callback_query)!.callback_query;
    expect((await call(request, a, 'DELETE', `/servers/${serverId}/bots/${hb.id}`)).status).toBe(200);
    const late = await bot(request, hb.token, 'answerCallbackQuery', { callback_query_id: q.id, url: 'https://evil.example' });
    expect(late.status).toBe(403);
    const again = await call(request, b, 'POST', `/channels/${channel}/messages/${sent.message_id}/callback`, { data: 'yes' });
    expect(again.status).toBe(400);
    expect(again.body.error).toContain('Бот больше не в этом чате');
    expect(await ok(request, hb.token, 'getUpdates')).toEqual([]);
  });

  test('удаление бота: события открытым клиентам; бан владельца отключает его ботов', async ({ request }) => {
    const ch = await dmWith(request, b, hb);
    const sent = await ok(request, hb.token, 'sendMessage', { chat_id: ch, text: 'исчезну' });
    const ws = await Socket.open(b.token);
    try {
      expect((await call(request, a, 'DELETE', `/bots/${hb.id}`)).status).toBe(200);
      expect(await ws.next((e) => e.type === 'message_deleted' && e.id === sent.message_id)).toMatchObject({ channel_id: ch });
      expect(await ws.next((e) => e.type === 'channel_member_left' && e.channel_id === ch)).toMatchObject({ user_id: hb.id });
    } finally {
      ws.close();
    }

    // Админ заблокировал владельца — его бот перестаёт работать
    const owner = await apiRegister(request, 'Нарушитель');
    const evil = await createBot(request, owner, 'Спамер');
    await ok(request, evil.token, 'getMe');
    await dbRun('UPDATE users SET banned = 1 WHERE id = ?', owner.id);
    expect((await bot(request, evil.token, 'getMe')).status).toBe(401);
  });
});


/** Мок раздачи файлов для sendPhoto/sendDocument по ссылке */
function filesServer(png: Buffer) {
  const server: Server = createHttpServer((req, res) => {
    if (req.url === '/img.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    } else if (req.url === '/moved') {
      res.writeHead(302, { Location: '/img.png' });
      res.end();
    } else if (req.url === '/note') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('просто текст');
    } else if (req.url === '/slow') {
      // Медленный хост: держит место скачивания 2,5 с
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
      }, 2500);
    } else if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(21 * 1024 * 1024, 1));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return {
    start: () => new Promise<void>((r) => server.listen(FILES_PORT, '127.0.0.1', () => r())),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Bot API с файлами: multipart (поля и части attach://) — как шлёт aiogram */
async function botForm(request: APIRequestContext, token: string, method: string, multipart: Record<string, any>) {
  for (;;) {
    const r = await request.post(`/api/v1/bot${token}/${method}`, { multipart });
    const body = await r.json();
    if (r.status() !== 429) return { status: r.status(), body };
    await new Promise((res) => setTimeout(res, body.parameters.retry_after * 1000));
  }
}

const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });

/** Каталог загрузок e2e-сервера: upload_path "." внутри document_root "./uploads/" (backend/config.json) */
function uploadDir() {
  return join(readFileSync(join(tmpdir(), `vicinity-e2e-${port}.dir`), 'utf8').trim(), 'uploads');
}
/** Файл на диске по URL /uploads/… */
const uploadPath = (url: string) => join(uploadDir(), url.replace(/^\/uploads\//, ''));
const countFiles = (sub: string) => readdirSync(join(uploadDir(), sub)).length;

/** JPEG из одних заголовков: APP1 Exif с Orientation и SOF0 с размером кадра (декодировать не нужно) */
function exifJpeg(width: number, height: number, orientation: number) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(exif.length + 2);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, exif, sof, Buffer.from([0xff, 0xd9])]);
}

/** Скачать файл бота по file_path из getFile */
async function download(request: APIRequestContext, token: string, filePath: string) {
  return request.get(`/api/v1/file/bot${token}/${filePath}`);
}

test.describe.serial('боты: картинки и файлы (§21.7)', () => {
  let a: ApiUser & { username: string };
  let other: ApiUser & { username: string };
  let fb: Bot;
  let foreign: Bot;
  let chat = 0;
  let photoId = '';
  const png = pngBuffer(48, 32);
  const files = filesServer(pngBuffer(20, 10));

  test.beforeAll(async ({ request }) => {
    a = await apiRegister(request, 'Фотограф');
    other = await apiRegister(request, 'Чужой');
    fb = await createBot(request, a, 'Фотобот');
    foreign = await createBot(request, other, 'Чужой бот');
    chat = await dmWith(request, a, fb);
    await files.start();
  });

  test.afterAll(async () => {
    await files.stop();
  });

  test('sendPhoto: multipart, attach://, file_id; подпись — caption; не картинка — 400', async ({ request }) => {
    const r1 = await botForm(request, fb.token, 'sendPhoto', {
      chat_id: String(chat),
      photo: file('кадр.png', 'image/png', png),
      caption: '<b>Привет</b> с картинкой',
      parse_mode: 'HTML',
    });
    expect(r1.body, JSON.stringify(r1.body)).toMatchObject({ ok: true });
    const m1 = r1.body.result;
    expect(m1.text).toBeUndefined();
    expect(m1.caption).toBe('**Привет** с картинкой');
    expect(m1.photo).toHaveLength(1);
    expect(m1.photo[0]).toMatchObject({ width: 48, height: 32, file_size: png.length });
    expect(m1.photo[0].file_id).toMatch(/^vca_[0-9a-f]{32}\.png$/);
    photoId = m1.photo[0].file_id;

    // Человек видит обычное сообщение-картинку с подписью
    const hist = await call(request, a, 'GET', `/channels/${chat}/messages`);
    const seen = hist.body.messages.find((m: any) => m.id === m1.message_id);
    expect(seen).toMatchObject({ attachment_type: 'image', attachment_name: 'кадр.png', text: '**Привет** с картинкой', author_bot: true });
    expect(seen.attachment).toMatch(/^\/uploads\/attachments\/[0-9a-f]{32}\.png$/);

    // Как aiogram: строка attach://<имя> и часть с этим именем
    const r2 = await botForm(request, fb.token, 'sendPhoto', { chat_id: String(chat), photo: 'attach://pic1', pic1: file('x.png', 'image/png', pngBuffer(8, 6)) });
    expect(r2.body.result.photo[0]).toMatchObject({ width: 8, height: 6 });
    expect(r2.body.result.caption).toBeUndefined();

    // Повтор по file_id — своя копия того же файла (жёсткая ссылка): свой URL и file_id, общий file_unique_id
    const m3 = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: photoId, caption: 'ещё раз' });
    expect(m3.photo[0].file_id).not.toBe(photoId);
    expect(m3.photo[0].file_unique_id).toBe(m1.photo[0].file_unique_id);
    expect(m3.attachment.url).not.toBe(seen.attachment);
    expect(statSync(uploadPath(m3.attachment.url)).ino).toBe(statSync(uploadPath(seen.attachment)).ino);
    // Удаление копии отзывает только её ссылку
    await ok(request, fb.token, 'deleteMessage', { chat_id: chat, message_id: m3.message_id });
    expect((await request.get(m3.attachment.url)).status()).toBe(404);
    expect((await request.get(seen.attachment)).status()).toBe(200);
    // …а удаление последнего сообщения с файлом — и сам файл
    const m4 = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: photoId });
    await ok(request, fb.token, 'deleteMessage', { chat_id: chat, message_id: m1.message_id });
    expect((await request.get(seen.attachment)).status()).toBe(404);
    expect((await request.get(m4.attachment.url)).status()).toBe(200);
    photoId = m4.photo[0].file_id;

    const bad = await botForm(request, fb.token, 'sendPhoto', { chat_id: String(chat), photo: file('fake.png', 'image/png', Buffer.from('не картинка')) });
    expect(bad.status).toBe(400);
    expect(bad.body.description).toContain('IMAGE_PROCESS_FAILED');
    const noFile = await bot(request, fb.token, 'sendPhoto', { chat_id: chat });
    expect(noFile.status).toBe(400);
    for (const photo of ['vca_00000000000000000000000000000000.png', '../../etc/passwd', 'vca_../../vicinity.db', 'attach://none'])
      expect((await bot(request, fb.token, 'sendPhoto', { chat_id: chat, photo })).body.description, photo).toContain('wrong file identifier');
  });

  test('по ссылке: картинка, перенаправление, документ; не картинка в sendPhoto и слишком большой файл — 400', async ({ request }) => {
    const url = `http://127.0.0.1:${FILES_PORT}`;
    const p = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: `${url}/img.png`, caption: 'из сети' });
    expect(p.photo[0]).toMatchObject({ width: 20, height: 10 });
    expect(p.attachment.name).toBe('img.png');
    const moved = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: `${url}/moved` });
    expect(moved.photo[0]).toMatchObject({ width: 20, height: 10 });

    const notImage = await bot(request, fb.token, 'sendPhoto', { chat_id: chat, photo: `${url}/note` });
    expect(notImage.status).toBe(400);
    expect(notImage.body.description).toContain('IMAGE_PROCESS_FAILED');
    const doc = await ok(request, fb.token, 'sendDocument', { chat_id: chat, document: `${url}/note` });
    expect(doc.document).toMatchObject({ file_name: 'note.txt', mime_type: 'text/plain' });
    expect((await bot(request, fb.token, 'sendDocument', { chat_id: chat, document: `${url}/missing` })).body.description).toContain(
      'failed to get HTTP URL content',
    );
    expect((await bot(request, fb.token, 'sendDocument', { chat_id: chat, document: `${url}/big` })).body.description).toContain('too big');
    expect((await bot(request, fb.token, 'sendDocument', { chat_id: chat, document: 'ftp://127.0.0.1/x' })).status).toBe(400);
  });

  test('без allow_private_webhooks ссылки на частные и локальные адреса не скачиваются', async ({ request }) => {
    test.setTimeout(60_000);
    // Второй сервер с запретом (основной e2e-сервер разрешает 127.0.0.1 для моков)
    const here = dirname(fileURLToPath(import.meta.url));
    const child = spawn(process.execPath, [join(here, 'start-backend.mjs')], {
      env: { ...process.env, VICINITY_E2E_PORT: String(STRICT_PORT), VICINITY_BOTS_ALLOW_PRIVATE_WEBHOOKS: '0' },
      stdio: 'ignore',
      detached: true,
    });
    try {
      const base = `http://localhost:${STRICT_PORT}`;
      for (let i = 0; ; i++) {
        const up = await request.get(`${base}/api/v1/health`).then((r) => r.ok(), () => false);
        if (up) break;
        if (i > 100) throw new Error('strict backend did not start');
        await new Promise((r) => setTimeout(r, 200));
      }
      const name = uniqueName('strict');
      const reg = await request.post(`${base}/api/v1/auth/register`, { data: { username: name, password: 'password123', display_name: 'Строгий' } });
      const token = (await reg.json()).token;
      const auth = { Authorization: `Bearer ${token}` };
      const created = await (await request.post(`${base}/api/v1/bots`, { headers: auth, data: { username: `${name}_bot`, display_name: 'Б' } })).json();
      const dm = await (await request.post(`${base}/api/v1/dms`, { headers: auth, data: { user_id: created.bot.id, username: `${name}_bot` } })).json();
      for (const photo of [
        `http://127.0.0.1:${FILES_PORT}/img.png`,
        `http://localhost:${FILES_PORT}/img.png`,
        `http://[::1]:${FILES_PORT}/img.png`,
        'http://10.0.0.1/x.png',
        'http://169.254.169.254/latest/meta-data',
      ]) {
        const r = await request.post(`${base}/api/v1/bot${created.token}/sendPhoto`, { data: { chat_id: dm.channel_id, photo } });
        expect(r.status(), photo).toBe(400);
        expect((await r.json()).description, photo).toContain('private or local');
      }
    } finally {
      // Вся группа процессов: node и сам VicinityServer
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    }
  });

  test('sendDocument: текстовый файл; getFile и скачивание; чужой бот и неверный токен', async ({ request }) => {
    const text = Buffer.from('строка 1\nстрока 2\n');
    const r = await botForm(request, fb.token, 'sendDocument', { chat_id: String(chat), document: file('заметка.txt', 'text/plain', text), caption: 'файл' });
    const d = r.body.result.document;
    expect(d).toMatchObject({ file_name: 'заметка.txt', mime_type: 'text/plain', file_size: text.length });
    expect(r.body.result.caption).toBe('файл');
    const f = await ok(request, fb.token, 'getFile', { file_id: d.file_id });
    expect(f).toMatchObject({ file_id: d.file_id, file_unique_id: d.file_unique_id, file_size: text.length });
    expect(f.file_path).toMatch(/^files\/[0-9a-f]{32}\.txt$/);
    const got = await download(request, fb.token, f.file_path);
    expect(got.status()).toBe(200);
    expect(Buffer.from(await got.body()).equals(text)).toBe(true);
    expect(got.headers()['content-type']).toBe('application/octet-stream');
    expect(got.headers()['content-disposition']).toContain("filename*=UTF-8''%D0%B7");

    // Чужой бот не в этом чате: ни getFile, ни скачивание, ни повтор по file_id
    expect((await bot(request, foreign.token, 'getFile', { file_id: d.file_id })).body.description).toContain('invalid file_id');
    expect((await download(request, foreign.token, f.file_path)).status()).toBe(404);
    const foreignChat = await dmWith(request, other, foreign);
    expect((await bot(request, foreign.token, 'sendDocument', { chat_id: foreignChat, document: d.file_id })).status).toBe(400);
    // Неверный токен, несуществующий файл, попытка выйти из каталога
    expect((await download(request, `${fb.id}:${'0'.repeat(48)}`, f.file_path)).status()).toBe(401);
    expect((await download(request, fb.token, 'files/00000000000000000000000000000000.txt')).status()).toBe(404);
    // «..» Drogon отклоняет сам (403), до маршрута дело не доходит
    for (const path of ['files/..%2F..%2Fvicinity.db', 'files/../../vicinity.db', '..%2Fvicinity.db'])
      expect([403, 404], path).toContain((await download(request, fb.token, path)).status());
    expect((await download(request, fb.token, 'avatars/x.png')).status()).toBe(404);
  });

  test('sendMediaGroup: две картинки подряд, подпись только у первой; кнопки и один элемент — 400', async ({ request }) => {
    const r = await botForm(request, fb.token, 'sendMediaGroup', {
      chat_id: String(chat),
      media: JSON.stringify([
        { type: 'photo', media: 'attach://p1', caption: 'альбом' },
        { type: 'photo', media: 'attach://p2' },
      ]),
      p1: file('1.png', 'image/png', pngBuffer(10, 10)),
      p2: file('2.png', 'image/png', pngBuffer(12, 12)),
    });
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true });
    const msgs = r.body.result;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].message_id).toBe(msgs[0].message_id + 1);
    expect(msgs[0].caption).toBe('альбом');
    expect(msgs[1].caption).toBeUndefined();
    expect(msgs.map((m: any) => m.photo[0].width)).toEqual([10, 12]);
    // Альбом — общий media_group_id, как в Telegram
    expect(msgs[0].media_group_id).toMatch(/^\d+$/);
    expect(msgs[1].media_group_id).toBe(msgs[0].media_group_id);

    const media = [{ type: 'photo', media: photoId }, { type: 'photo', media: photoId }];
    expect((await bot(request, fb.token, 'sendMediaGroup', { chat_id: chat, media, reply_markup: keyboard([[{ text: 'x', callback_data: 'x' }]]) })).status).toBe(400);
    expect((await bot(request, fb.token, 'sendMediaGroup', { chat_id: chat, media: [media[0]] })).status).toBe(400);
    expect((await bot(request, fb.token, 'sendMediaGroup', { chat_id: chat, media: [media[0], { type: 'document', media: photoId }] })).status).toBe(400);
    expect(await ok(request, fb.token, 'sendMediaGroup', { chat_id: chat, media })).toHaveLength(2);
  });

  test('editMessageCaption меняет подпись; editMessageText у картинки и подпись у текста — 400', async ({ request }) => {
    const m = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: photoId, caption: 'старая' });
    const ws = await Socket.open(a.token);
    try {
      const e = await ok(request, fb.token, 'editMessageCaption', { chat_id: chat, message_id: m.message_id, caption: '<i>новая</i>', parse_mode: 'HTML' });
      expect(e.caption).toBe('*новая*');
      expect(e.photo[0].file_id).toBe(m.photo[0].file_id);
      expect(await ws.next((x) => x.type === 'message_edited' && x.id === m.message_id)).toMatchObject({ text: '*новая*', edited: true });
    } finally {
      ws.close();
    }
    const same = await bot(request, fb.token, 'editMessageCaption', { chat_id: chat, message_id: m.message_id, caption: '<i>новая</i>', parse_mode: 'HTML' });
    expect(same.body.description).toContain('not modified');
    expect((await bot(request, fb.token, 'editMessageText', { chat_id: chat, message_id: m.message_id, text: 'x' })).body.description).toContain(
      'no text',
    );
    const t = await ok(request, fb.token, 'sendMessage', { chat_id: chat, text: 'просто текст' });
    expect((await bot(request, fb.token, 'editMessageCaption', { chat_id: chat, message_id: t.message_id, caption: 'x' })).body.description).toContain(
      'no caption',
    );
    // Подпись можно убрать совсем
    const cleared = await ok(request, fb.token, 'editMessageCaption', { chat_id: chat, message_id: m.message_id });
    expect(cleared.caption).toBeUndefined();
  });

  test('человек присылает картинку → в обновлении photo с file_id → getFile → те же байты', async ({ request }) => {
    await drain(request, fb.token);
    const img = pngBuffer(64, 40);
    const up = await request.post(`/api/v1/channels/${chat}/attachments`, {
      headers: { Authorization: `Bearer ${a.token}` },
      multipart: { file: file('фото.png', 'image/png', img) },
    });
    expect(up.status()).toBe(201);
    const att = await up.json();
    await post(request, a, chat, 'вот фото', { attachment: att.url, attachment_name: att.name });
    const doc = await request.post(`/api/v1/channels/${chat}/attachments`, {
      headers: { Authorization: `Bearer ${a.token}` },
      multipart: { file: file('отчёт.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test')) },
    });
    const docAtt = await doc.json();
    await post(request, a, chat, '', { attachment: docAtt.url, attachment_name: docAtt.name });

    const ups = await drain(request, fb.token);
    const photoMsg = ups.find((u) => u.message?.photo)?.message;
    expect(photoMsg).toMatchObject({ caption: 'вот фото', from: { id: a.id, is_bot: false } });
    expect(photoMsg.text).toBeUndefined();
    expect(photoMsg.photo[0]).toMatchObject({ width: 64, height: 40, file_size: img.length });
    const docMsg = ups.find((u) => u.message?.document)?.message;
    expect(docMsg.document).toMatchObject({ file_name: 'отчёт.pdf', mime_type: 'application/pdf' });
    expect(docMsg.caption).toBeUndefined();

    const f = await ok(request, fb.token, 'getFile', { file_id: photoMsg.photo[0].file_id });
    const got = await download(request, fb.token, f.file_path);
    expect(got.status()).toBe(200);
    expect(got.headers()['content-type']).toBe('image/png');
    expect(Buffer.from(await got.body()).equals(img)).toBe(true);
    // Чужой бот этот файл не получит
    expect((await bot(request, foreign.token, 'getFile', { file_id: photoMsg.photo[0].file_id })).status).toBe(400);
    expect((await download(request, foreign.token, f.file_path)).status()).toBe(404);
  });

  test('альбом: одна часть дважды — один файл на диске; ошибка в элементе удаляет уже сохранённые', async ({ request }) => {
    const r = await botForm(request, fb.token, 'sendMediaGroup', {
      chat_id: String(chat),
      media: JSON.stringify([{ type: 'photo', media: 'attach://p' }, { type: 'photo', media: 'attach://p' }]),
      p: file('same.png', 'image/png', pngBuffer(9, 9)),
    });
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true });
    const [x, y] = r.body.result;
    expect(x.attachment.url).not.toBe(y.attachment.url);
    expect(statSync(uploadPath(x.attachment.url)).ino).toBe(statSync(uploadPath(y.attachment.url)).ino);
    expect(y.photo[0].file_unique_id).toBe(x.photo[0].file_unique_id);

    const images = countFiles('attachments');
    const docs = countFiles('files');
    const bad = await botForm(request, fb.token, 'sendMediaGroup', {
      chat_id: String(chat),
      media: JSON.stringify([{ type: 'photo', media: 'attach://good' }, { type: 'photo', media: 'attach://text' }]),
      good: file('good.png', 'image/png', pngBuffer(7, 7)),
      text: file('text.txt', 'text/plain', Buffer.from('не картинка')),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.description).toContain('IMAGE_PROCESS_FAILED');
    expect(countFiles('attachments')).toBe(images);
    expect(countFiles('files')).toBe(docs);
  });

  test('ответ на картинку: reply_to_message с photo и caption, без text', async ({ request }) => {
    await drain(request, fb.token);
    const pic = await ok(request, fb.token, 'sendPhoto', { chat_id: chat, photo: photoId, caption: 'подпись' });
    await post(request, a, chat, '/sticker', { reply_to: pic.message_id });
    const ups = await drain(request, fb.token);
    const reply = ups.find((u) => u.message?.text === '/sticker')?.message.reply_to_message;
    expect(reply).toMatchObject({ message_id: pic.message_id, caption: 'подпись', from: { id: fb.id, is_bot: true } });
    expect(reply.text).toBeUndefined();
    expect(reply.photo[0].file_id).toBe(pic.photo[0].file_id);
    expect(reply.date).toBeGreaterThan(0);
    expect(reply.reply_to_message).toBeUndefined();
  });

  test('файл человека, отправленный ботом по file_id: удаление исходного отзывает его ссылку; удаление бота — файлы бота', async ({ request }) => {
    const cb = await createBot(request, a, 'Копирующий бот');
    const dm = await dmWith(request, a, cb);
    const up = await request.post(`/api/v1/channels/${dm}/attachments`, {
      headers: { Authorization: `Bearer ${a.token}` },
      multipart: { file: file('личное.png', 'image/png', pngBuffer(30, 30)) },
    });
    expect(up.status()).toBe(201);
    const att = await up.json();
    const mid = await post(request, a, dm, '', { attachment: att.url, attachment_name: att.name });
    const fid = (await drain(request, cb.token)).find((u) => u.message?.photo)?.message.photo[0].file_id;
    expect(fid).toBeTruthy();

    const copy = await ok(request, cb.token, 'sendPhoto', { chat_id: dm, photo: fid });
    expect(copy.attachment.url).not.toBe(att.url);
    // Автор удаляет своё сообщение: его ссылка больше не работает, копия бота — своя
    expect((await call(request, a, 'DELETE', `/channels/${dm}/messages/${mid}`)).status).toBe(200);
    expect((await request.get(att.url)).status()).toBe(404);
    expect((await request.get(copy.attachment.url)).status()).toBe(200);
    expect((await bot(request, cb.token, 'sendPhoto', { chat_id: dm, photo: fid })).body.description).toContain('wrong file identifier');

    // Удаление бота удаляет и файлы его сообщений
    expect((await call(request, a, 'DELETE', `/bots/${cb.id}`)).status).toBe(200);
    expect((await request.get(copy.attachment.url)).status()).toBe(404);
  });

  test('размер по подписке владельца; имя без расширения — по содержимому; EXIF; голосовое webm', async ({ request }) => {
    test.setTimeout(60_000);
    const owner = await apiRegister(request, 'Без подписки');
    const tb = await createBot(request, owner, 'Бот без подписки');
    const dm = await dmWith(request, owner, tb);
    // Бесплатно — 15 МБ, как у самого человека; Standard — 50
    const big = file('big.bin', 'application/octet-stream', Buffer.alloc(16 * 1024 * 1024, 7));
    const tooBig = await botForm(request, tb.token, 'sendDocument', { chat_id: String(dm), document: big });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.description).toContain('too big');
    await dbRun('UPDATE users SET subscription_tier = 2 WHERE id = ?', owner.id);
    const fine = await botForm(request, tb.token, 'sendDocument', { chat_id: String(dm), document: big });
    expect(fine.body.result?.document?.file_size, JSON.stringify(fine.body).slice(0, 300)).toBe(16 * 1024 * 1024);

    // aiogram URLInputFile: случайное имя без расширения — расширение по содержимому
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)]);
    const v = await botForm(request, tb.token, 'sendVoice', { chat_id: String(dm), voice: file('Xk3_aP9qLw', 'application/octet-stream', ogg), duration: '3' });
    expect(v.body, JSON.stringify(v.body)).toMatchObject({ ok: true });
    expect(v.body.result.voice).toMatchObject({ mime_type: 'audio/ogg', duration: 3 });
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
    const au = await botForm(request, tb.token, 'sendAudio', { chat_id: String(dm), audio: file('Zq81LmPx0a', 'application/octet-stream', mp3) });
    expect(au.body.result.audio).toMatchObject({ file_name: 'Zq81LmPx0a.mp3', mime_type: 'audio/mpeg' });

    // Снимок телефона: кадр 40×20 с Orientation 6 показывается 20×40
    const turned = await botForm(request, tb.token, 'sendPhoto', { chat_id: String(dm), photo: file('phone.jpg', 'image/jpeg', exifJpeg(40, 20, 6)) });
    expect(turned.body.result.photo[0]).toMatchObject({ width: 20, height: 40 });
    const straight = await botForm(request, tb.token, 'sendPhoto', { chat_id: String(dm), photo: file('flat.jpg', 'image/jpeg', exifJpeg(40, 20, 1)) });
    expect(straight.body.result.photo[0]).toMatchObject({ width: 40, height: 20 });

    // Голосовое из Chrome (webm) — audio/webm; обычный webm-файл человека — document, а не video
    await drain(request, tb.token);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from('webm'), Buffer.alloc(100)]);
    for (const [name, extra] of [
      ['voice-1.webm', { kind: 'voice', meta: { duration: 2, peaks: [] } }],
      ['clip.webm', {}],
    ] as const) {
      const up = await request.post(`/api/v1/channels/${dm}/attachments`, {
        headers: { Authorization: `Bearer ${owner.token}` },
        multipart: { file: file(name, 'audio/webm', webm) },
      });
      const att = await up.json();
      await post(request, owner, dm, '', { attachment: att.url, attachment_name: att.name, ...extra });
    }
    const ups = await drain(request, tb.token);
    expect(ups.find((u) => u.message?.voice)?.message.voice.mime_type).toBe('audio/webm');
    const clip = ups.find((u) => u.message?.document?.file_name === 'clip.webm')?.message;
    expect(clip).toBeTruthy();
    expect(clip.video).toBeUndefined();
  });

  test('скачивания по ссылкам: не больше двух сразу на бота, другой бот не ждёт', async ({ request }) => {
    const s1 = await createBot(request, a, 'Медленный 1');
    const s2 = await createBot(request, a, 'Медленный 2');
    const c1 = await dmWith(request, a, s1);
    const c2 = await dmWith(request, a, s2);
    const photo = `http://127.0.0.1:${FILES_PORT}/slow`;
    const send = (token: string, chatId: number) =>
      request.post(`/api/v1/bot${token}/sendPhoto`, { data: { chat_id: chatId, photo } }).then((r) => r.status());
    const statuses = await Promise.all([send(s1.token, c1), send(s1.token, c1), send(s1.token, c1), send(s2.token, c2)]);
    expect(statuses.slice(0, 3).sort()).toEqual([200, 200, 429]);
    expect(statuses[3]).toBe(200);
  });
});
