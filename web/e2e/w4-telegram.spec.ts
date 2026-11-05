import { expect, test } from '@playwright/test';
import { createServer as createHttpServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { makeFriends, pageErrors, registerUser } from './helpers';
import { apiRegister, apiUser, call, post } from './w1-helpers';
import { settingsTab } from './w2-helpers';

// Мост с Telegram (docs/API.md §20). Настоящий Telegram в тестах недоступен: сервер ходит в мок Bot API
// на порту backend + 9 (адрес и токен задаёт e2e/start-backend.mjs).
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080) + 9;
const TOKEN = 'e2e-token';
const CHAT = 777000111;

interface Sent {
  method: string;
  body: any;
  message_id: number;
}

/** Мок Bot API: getMe, deleteWebhook, getUpdates (длинный опрос до 1 с), sendMessage, setMessageReaction */
function mockTelegram() {
  const sent: Sent[] = [];
  const queue: any[] = [];
  let updateId = 1;
  let messageId = 100;
  let waiting: ((v: any[]) => void) | null = null;
  const server: Server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const m = req.url?.match(new RegExp(`^/bot${TOKEN}/(\\w+)$`));
      const reply = (result: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result }));
      };
      if (!m) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, description: 'Not Found' }));
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      const method = m[1];
      if (method === 'getMe') return reply({ id: 1, is_bot: true, username: 'vicinity_e2e_bot' });
      if (method === 'deleteWebhook') return reply(true);
      if (method === 'getUpdates') {
        const offset = Number(body.offset ?? 0);
        const take = () => queue.filter((u) => u.update_id >= offset);
        if (take().length) return reply(take());
        const timer = setTimeout(() => {
          waiting = null;
          reply([]);
        }, 1000);
        waiting = () => {
          clearTimeout(timer);
          waiting = null;
          reply(take());
        };
        return;
      }
      const id = ++messageId;
      sent.push({ method, body, message_id: id });
      if (method === 'sendMessage') return reply({ message_id: id, chat: { id: body.chat_id }, text: body.text });
      return reply(true);
    });
  });
  return {
    sent,
    start: () => new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r())),
    stop: () =>
      new Promise<void>((r) => {
        waiting?.([]);
        server.closeAllConnections();
        server.close(() => r());
      }),
    /** Сообщение пользователя боту */
    say: (text: string, extra: object = {}) => {
      queue.push({
        update_id: updateId++,
        message: { message_id: ++messageId, chat: { id: CHAT, type: 'private' }, from: { id: CHAT, username: 'alice_tg', first_name: 'Алиса' }, text, ...extra },
      });
      waiting?.([]);
      return messageId;
    },
    toChat: () => sent.filter((s) => s.method === 'sendMessage' && s.body.chat_id === CHAT),
  };
}

test('telegram bridge: link by deep link, forward DMs and mentions, reply goes back to the same chat, /stop', async ({ browser, request }) => {
  const tg = mockTelegram();
  await tg.start();
  try {
    const a = await registerUser(browser, 'Алиса');
    const b = await registerUser(browser, 'Борис');
    await makeFriends(a, b);
    const alice = await apiUser(request, a);
    const boris = await apiUser(request, b);

    // Бот подключился к (моку) Telegram и узнал своё имя
    await expect.poll(async () => (await call(request, alice, 'GET', '/telegram')).body, { timeout: 15000 }).toMatchObject({
      available: true,
      bot_username: 'vicinity_e2e_bot',
      linked: false,
    });

    // Привязка: одноразовая ссылка t.me/<бот>?start=<код>, «Start» в Telegram
    const link = (await call(request, alice, 'POST', '/telegram/link')).body;
    expect(link.url).toBe(`https://t.me/vicinity_e2e_bot?start=${link.code}`);
    tg.say(`/start ${link.code}`);
    await expect.poll(async () => (await call(request, alice, 'GET', '/telegram')).body.linked).toBe(true);
    const st = (await call(request, alice, 'GET', '/telegram')).body;
    expect(st).toMatchObject({ tg_username: 'alice_tg', enabled: true, offline_only: true, servers: 'mentions' });
    await expect.poll(() => tg.toChat().map((s) => s.body.text).join('\n')).toContain('Telegram подключён');
    // Код одноразовый
    tg.say(`/start ${link.code}`);
    await expect.poll(() => tg.toChat().at(-1)?.body.text ?? '').toContain('Ссылка устарела');

    // Алиса в сети, а «только когда не в сети» включено — ничего не приходит
    const dm = (await call(request, boris, 'POST', '/dms', { user_id: alice.id })).body.channel_id as number;
    const before = tg.toChat().length;
    await post(request, boris, dm, 'пока ты в сети');
    await new Promise((r) => setTimeout(r, 700));
    expect(tg.toChat().length).toBe(before);

    // Пересылать всегда: личное сообщение приходит с именем автора
    expect((await call(request, alice, 'PATCH', '/telegram', { offline_only: false })).body.offline_only).toBe(false);
    await post(request, boris, dm, 'привет <b>из</b> Vicinity');
    await expect.poll(() => tg.toChat().at(-1)?.body.text ?? '').toContain('привет &lt;b&gt;из&lt;/b&gt; Vicinity');
    const fwd = tg.toChat().at(-1)!;
    expect(fwd.body.text).toContain('<b>Борис</b>');
    expect(fwd.body.parse_mode).toBe('HTML');

    // Ответ в Telegram на это сообщение уходит в ту же личку от имени Алисы, бот ставит реакцию
    const replyId = tg.say('ответ из телеграма', { reply_to_message: { message_id: fwd.message_id } });
    await expect
      .poll(async () => (await call(request, boris, 'GET', `/channels/${dm}/messages`)).body.messages.map((m: any) => `${m.author_id}:${m.text}`))
      .toContain(`${alice.id}:ответ из телеграма`);
    await expect.poll(() => tg.sent.some((s) => s.method === 'setMessageReaction' && s.body.message_id === replyId)).toBe(true);
    // Своё же сообщение Алисе в Telegram не возвращается
    expect(tg.toChat().some((s) => s.body.text.includes('ответ из телеграма'))).toBe(false);

    // «Заметки»: просто сообщение боту попадает в Заметки, заметка из Vicinity — в Telegram (даже когда в сети)
    const dms = (await call(request, alice, 'GET', '/dms')).body.dms;
    expect(dms[0]).toMatchObject({ notes: true, display_name: 'Заметки', user_id: alice.id });
    const notes = dms[0].channel_id as number;
    const fromTg = tg.say('купить хлеб');
    await expect
      .poll(async () => (await call(request, alice, 'GET', `/channels/${notes}/messages`)).body.messages.map((m: any) => m.text))
      .toContain('купить хлеб');
    await expect.poll(() => tg.sent.some((s) => s.method === 'setMessageReaction' && s.body.message_id === fromTg)).toBe(true);
    // Заметка из Telegram обратно в Telegram не дублируется
    expect(tg.toChat().some((s) => s.body.text.includes('купить хлеб'))).toBe(false);
    await call(request, alice, 'PATCH', '/telegram', { offline_only: true });
    await post(request, alice, notes, 'идея для турнира');
    await expect.poll(() => tg.toChat().at(-1)?.body.text ?? '').toBe('<b>Заметки</b>\nидея для турнира');
    // Чужим заметки недоступны
    expect((await call(request, boris, 'GET', `/channels/${notes}/messages`)).status).toBe(403);
    await call(request, alice, 'PATCH', '/telegram', { offline_only: false });

    // Сервер: без упоминания не приходит, с упоминанием — приходит
    const vera = await apiRegister(request, 'Вера');
    const srv = (await call(request, alice, 'POST', '/servers', { name: 'Пятница' })).body;
    await call(request, vera, 'POST', '/servers/join', { code: srv.invite_code });
    const general = (await call(request, alice, 'GET', `/servers/${srv.server_id}/channels`)).body.channels.find((c: any) => !c.is_voice).id;
    const n = tg.toChat().length;
    await post(request, vera, general, 'всем привет');
    await new Promise((r) => setTimeout(r, 700));
    expect(tg.toChat().length).toBe(n);
    const login = (await call(request, alice, 'GET', '/auth/me')).body.username;
    await post(request, vera, general, `@${login} глянь`);
    await expect.poll(() => tg.toChat().at(-1)?.body.text ?? '').toContain('Упоминание');
    expect(tg.toChat().at(-1)!.body.text).toContain('#общий · Пятница');

    // Проверка значений
    expect((await call(request, alice, 'PATCH', '/telegram', { servers: 'some' })).status).toBe(400);

    // Заметки в боковой панели: без звонка, с заметкой из Telegram
    await a.page.locator('.rail-item.home').click();
    await a.page.locator('.side-item.notes-item').click();
    await expect(a.page.locator('.chat-head')).toContainText('Заметки');
    await expect(a.page.locator('.chat-head').getByRole('button', { name: 'Позвонить' })).toHaveCount(0);
    await expect(a.page.locator('.msg-text', { hasText: 'купить хлеб' })).toBeVisible();

    // Экран настроек: подключённый Telegram и кнопка «Отключить»
    await a.page.getByTitle('Настройки').click();
    await settingsTab(a, 'Уведомления').click();
    const card = a.page.getByRole('region', { name: 'Telegram' });
    await expect(card).toContainText('Подключён: @alice_tg');
    await card.getByRole('button', { name: 'Отключить' }).click();
    await expect(card.getByRole('button', { name: 'Подключить Telegram' })).toBeVisible();
    expect((await call(request, alice, 'GET', '/telegram')).body.linked).toBe(false);
    await expect.poll(() => tg.toChat().at(-1)?.body.text ?? '').toContain('Отключено в настройках Vicinity');

    // /stop из Telegram тоже отвязывает
    const link2 = (await call(request, alice, 'POST', '/telegram/link')).body;
    tg.say(`/start ${link2.code}`);
    await expect.poll(async () => (await call(request, alice, 'GET', '/telegram')).body.linked).toBe(true);
    tg.say('/stop');
    await expect.poll(async () => (await call(request, alice, 'GET', '/telegram')).body.linked).toBe(false);
    expect(pageErrors(a.page)).toEqual([]);
  } finally {
    await tg.stop();
  }
});
