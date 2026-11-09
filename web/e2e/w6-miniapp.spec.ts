import { expect, Frame, Page, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageErrors, registerUser } from './helpers';
import { apiUser } from './w1-helpers';
import { bot, createBot, dmWith, setTheme, shot } from './w6-helpers';

// Мини-приложения ботов (SPEC2 §4, docs/API.md §21.8). Интернета в e2e нет: тестовое мини-приложение на node:http
// (порт backend + 12) говорит тем же протоколом, что telegram-web-app.js в iframe — JSON {eventType, eventData}
// через postMessage — и читает tgWebAppData из фрагмента адреса.
const port = Number(process.env.VICINITY_E2E_PORT ?? 18080);
const APP_PORT = port + 12;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const APP_URL = `${APP_ORIGIN}/shop`;
// Другой origin того же сервера: адрес /hop отвечает 302 сюда (как example.com → www.example.com)
const HOP_ORIGIN = `http://localhost:${APP_PORT}`;

const MINI_APP = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Магазин</title>
<style>
  body { margin: 0; padding: 16px; font: 16px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  h1 { margin: 0 0 12px; font-size: 22px; }
  .card { padding: 12px 14px; border-radius: 12px; background: var(--sec); margin-bottom: 12px; }
  .hint { color: var(--hint); }
  a { color: var(--link); }
</style></head>
<body>
<h1>Магазин</h1>
<div class="card" id="who"></div>
<div class="card"><b>Слон</b><div class="hint">Большой, серый, почти новый</div></div>
<div class="card"><b>Чайник</b><div class="hint">Свистит, когда закипает</div></div>
<script>
  var hash = location.hash.slice(1);
  var q = hash.indexOf('?');
  if (q >= 0) hash = hash.slice(q + 1);
  var params = new URLSearchParams(hash);
  window.__initData = params.get('tgWebAppData') || '';
  window.__version = params.get('tgWebAppVersion');
  window.__platform = params.get('tgWebAppPlatform');
  window.__theme = JSON.parse(params.get('tgWebAppThemeParams') || '{}');
  window.__events = [];
  function post(type, data) {
    window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data === undefined ? '' : data }), '*');
  }
  window.__post = post;
  function applyTheme(t) {
    var s = document.body.style;
    s.setProperty('--bg', t.bg_color); s.setProperty('--fg', t.text_color);
    s.setProperty('--sec', t.secondary_bg_color); s.setProperty('--hint', t.hint_color); s.setProperty('--link', t.link_color);
  }
  applyTheme(window.__theme);
  var user = JSON.parse(new URLSearchParams(window.__initData).get('user') || '{}');
  document.getElementById('who').textContent = 'Здравствуйте, ' + (user.first_name || 'гость') + '!';
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    window.__events.push(m);
    if (m.eventType === 'theme_changed') applyTheme(m.eventData.theme_params);
    if (m.eventType === 'main_button_pressed')
      post('web_app_open_popup', { title: 'Подтверждение', message: 'Купить слона?',
        buttons: [{ id: 'yes', type: 'default', text: 'Купить' }, { id: 'no', type: 'cancel' }] });
    if (m.eventType === 'popup_closed' && m.eventData.button_id === 'yes') post('web_app_close');
  });
  post('iframe_ready', { reload_supported: true });
  post('web_app_request_theme');
  post('web_app_request_viewport');
  post('web_app_setup_main_button', { is_visible: true, is_active: true, is_progress_visible: false, text: 'Оформить заказ' });
  post('web_app_ready');
</script>
</body></html>`;

/** Проверка initData, как у Telegram (и aiogram safe_parse_webapp_init_data) */
function validInitData(initData: string, token: string): boolean {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return false;
  p.delete('hash');
  const check = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return createHmac('sha256', secret).update(check).digest('hex') === hash;
}

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

/** iframe мини-приложения (новый после каждого открытия или «Обновить») */
async function appFrame(page: Page, origin = APP_ORIGIN): Promise<Frame> {
  const panel = page.locator('.webapp-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  let frame: Frame | undefined;
  await expect
    .poll(async () => {
      frame = page.frames().find((f) => f.url().startsWith(origin) && !f.isDetached());
      try {
        return frame ? await frame.evaluate(() => typeof (window as any).__post) : 'none';
      } catch {
        return 'detached';
      }
    })
    .toBe('function');
  return frame!;
}

const events = (f: Frame) => f.evaluate(() => (window as any).__events as { eventType: string; eventData: any }[]);
const eventTypes = async (f: Frame) => (await events(f)).map((e) => e.eventType);
const post = (f: Frame, type: string, data?: unknown) => f.evaluate(([t, d]) => (window as any).__post(t, d), [type, data] as const);

let server: Server;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/hop')) {
      res.writeHead(302, { Location: `${HOP_ORIGIN}/shop` });
      res.end();
    } else if (req.url?.startsWith('/shop')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(MINI_APP);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(APP_PORT, '127.0.0.1', r));
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

test('mini app: button → ready → MainButton → popup → close; signed initData; menu button; isolation', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const a = await registerUser(browser, 'Алиса');
  const errors = pageErrors(a.page);
  const alice = await apiUser(request, a);
  const shopBot = await createBot(request, alice, 'Магазин');
  const ch = await dmWith(request, alice, shopBot);
  const sent = await bot(request, shopBot.token, 'sendMessage', {
    chat_id: ch,
    text: 'Добро пожаловать в магазин',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть магазин', web_app: { url: APP_URL } }]] },
  });
  const page = a.page;
  await page.goto(`/channels/@me/${ch}`);
  const panel = page.locator('.webapp-panel');

  // ── Кнопка сообщения → панель с iframe → web_app_ready ──
  await page.locator(`.msg[data-mid="${sent.message_id}"]`).getByRole('button', { name: 'Открыть магазин' }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Мини-приложение: Магазин' })).toBeVisible();
  await expect(panel.locator('.webapp-title')).toContainText(`127.0.0.1:${APP_PORT}`);
  const iframe = panel.locator('iframe.webapp-frame');
  // Без allow-popups: window.open из мини-приложения не обходит лимит ссылок (в ПК-приложении ушёл бы в системный браузер)
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-modals');
  let app = await appFrame(page);
  await expect(page.frameLocator('.webapp-frame').locator('#who')).toHaveText('Здравствуйте, Алиса!');

  // Параметры telegram-web-app.js во фрагменте; initData подписан токеном бота
  expect(await app.evaluate(() => [(window as any).__version, (window as any).__platform])).toEqual(['7.10', 'web']);
  const initData: string = await app.evaluate(() => (window as any).__initData);
  expect(validInitData(initData, shopBot.token)).toBe(true);
  const fields = new URLSearchParams(initData);
  const user = JSON.parse(fields.get('user')!);
  expect(user).toMatchObject({ id: alice.id, first_name: 'Алиса', language_code: 'ru', allows_write_to_pm: true });
  expect(fields.get('chat_type')).toBe('sender');
  expect(fields.get('chat_instance')).toBe(String(ch));
  expect(fields.get('query_id')).toMatch(/^[0-9a-f]{32}$/);
  expect(Math.abs(Number(fields.get('auth_date')) - Date.now() / 1000)).toBeLessThan(120);
  // Подделка: другой id пользователя или чужой токен — подпись не сходится
  fields.set('user', JSON.stringify({ ...user, id: alice.id + 1 }));
  expect(validInitData(fields.toString(), shopBot.token)).toBe(false);
  expect(validInitData(initData, `${shopBot.id}:${'0'.repeat(48)}`)).toBe(false);
  // Токен сессии Vicinity мини-приложению не уходит
  expect(app.url()).not.toContain(alice.token);

  // Тема и размер окна по запросу; цвета — из токенов Vicinity, #rrggbb
  await expect.poll(() => eventTypes(app)).toEqual(expect.arrayContaining(['theme_changed', 'viewport_changed']));
  const theme = (await events(app)).find((e) => e.eventType === 'theme_changed')!.eventData.theme_params;
  for (const k of ['bg_color', 'text_color', 'hint_color', 'link_color', 'button_color', 'button_text_color', 'secondary_bg_color',
    'header_bg_color', 'accent_text_color', 'section_bg_color', 'section_header_text_color', 'subtitle_text_color', 'destructive_text_color'])
    expect(theme[k], k).toMatch(/^#[0-9a-f]{6}$/);
  const vp = (await events(app)).find((e) => e.eventType === 'viewport_changed')!.eventData;
  expect(vp).toMatchObject({ is_expanded: true, is_state_stable: true });
  expect(vp.height).toBeGreaterThan(300);
  // Тема Vicinity сменилась — мини-приложение получает новые цвета
  await setTheme(page, 'light');
  await expect
    .poll(async () => (await events(app)).filter((e) => e.eventType === 'theme_changed').at(-1)?.eventData.theme_params.bg_color)
    .not.toBe(theme.bg_color);
  await setTheme(page, 'dark');

  // ── MainButton → main_button_pressed → popup мини-приложения нашим окном → popup_closed → web_app_close ──
  const mainBtn = panel.locator('.webapp-foot').getByRole('button', { name: 'Оформить заказ' });
  await expect(mainBtn).toBeVisible();
  await expect(mainBtn).toHaveClass(/primary/);
  await shot(page, 'miniapp-desktop-dark');
  await mainBtn.click();
  await expect.poll(() => eventTypes(app)).toContain('main_button_pressed');
  const popup = page.getByRole('dialog', { name: 'Подтверждение' });
  await expect(popup).toContainText('Купить слона?');
  await expect(popup.locator('.webapp-popup-buttons button')).toHaveText(['Купить', 'Отмена']);
  await shot(page, 'miniapp-popup-desktop-dark');
  await popup.getByRole('button', { name: 'Купить' }).click();
  // Мини-приложение получило popup_closed {button_id: "yes"} и закрылось само
  await expect(panel).toHaveCount(0);

  // ── Кнопка меню бота в шапке лички (setChatMenuButton) ──
  await bot(request, shopBot.token, 'setChatMenuButton', { chat_id: ch, menu_button: { type: 'web_app', text: 'Магазин', web_app: { url: APP_URL } } });
  expect(await bot(request, shopBot.token, 'getChatMenuButton', { chat_id: ch })).toMatchObject({ type: 'web_app', text: 'Магазин' });
  await page.goto(`/channels/@me/${ch}`);
  const menuBtn = page.locator('.chat-head').getByRole('button', { name: 'Открыть мини-приложение: Магазин' });
  await menuBtn.click();
  app = await appFrame(page);
  expect(validInitData(await app.evaluate(() => (window as any).__initData), shopBot.token)).toBe(true);

  // Изоляция: страница мини-приложения не достаёт до Vicinity, чужие postMessage панель не слушает
  expect(
    await app.evaluate(() => {
      try {
        return String(window.parent.document.title);
      } catch {
        return 'blocked';
      }
    }),
  ).toBe('blocked');
  await page.evaluate(() => window.postMessage(JSON.stringify({ eventType: 'web_app_close', eventData: '' }), '*'));
  await page.waitForTimeout(300);
  await expect(panel).toBeVisible();

  // BackButton, своя кнопка шапки и цвет шапки
  await post(app, 'web_app_setup_back_button', { is_visible: true });
  await panel.getByRole('button', { name: 'Назад' }).click();
  await expect.poll(() => eventTypes(app)).toContain('back_button_pressed');
  const headEl = panel.locator('.webapp-head');
  const headBg = () => headEl.evaluate((e) => getComputedStyle(e).backgroundColor);
  const headContrast = () =>
    headEl.evaluate((e) => {
      const rgb = (c: string) => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
      const lum = (c: string) => {
        const [r, g, b] = rgb(c).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const cs = getComputedStyle(e);
      const [x, y] = [lum(cs.color), lum(cs.backgroundColor)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    });
  await post(app, 'web_app_set_header_color', { color: '#1d6b4f' });
  await expect(panel.locator('.webapp-head.tinted')).toBeVisible();
  expect(await headBg()).toBe('rgb(29, 107, 79)');
  // Неверный цвет (не #rrggbb) не применяется: шапка и фон под iframe прежние
  const bodyBg = await panel.locator('.webapp-body').evaluate((e) => getComputedStyle(e).backgroundColor);
  await post(app, 'web_app_set_header_color', { color: 'url(javascript:1)' });
  await post(app, 'web_app_set_background_color', { color: 'red; background: url(x)' });
  await page.waitForTimeout(200);
  expect(await headBg()).toBe('rgb(29, 107, 79)');
  expect(await panel.locator('.webapp-body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(bodyBg);
  // Смена темы Vicinity пересчитывает цвет текста шапки: в обеих темах ≥ 4.5:1
  expect(await headContrast()).toBeGreaterThanOrEqual(4.5);
  await expect(headEl).not.toHaveClass(/inverse/);
  await setTheme(page, 'light');
  await expect(headEl).toHaveClass(/inverse/);
  expect(await headContrast()).toBeGreaterThanOrEqual(4.5);
  await setTheme(page, 'dark');
  await expect(headEl).not.toHaveClass(/inverse/);
  // Цвет, на котором текст не читается (серый #707070 в тёмной теме — около 4.2:1), не применяется
  await post(app, 'web_app_set_header_color', { color: '#707070' });
  await expect(panel.locator('.webapp-head.tinted')).toHaveCount(0);
  await post(app, 'web_app_set_header_color', { color_key: 'bg_color' });
  await expect(panel.locator('.webapp-head.tinted')).toBeVisible();
  expect(await headContrast()).toBeGreaterThanOrEqual(4.5);

  // Попапы не спамятся: из пяти подряд показан один, остальным сразу popup_closed {} (иначе telegram-web-app.js
  // считал бы их открытыми и бросал ошибку на каждом следующем showAlert); Esc — popup_closed без button_id
  const closed = async () => (await events(app)).filter((e) => e.eventType === 'popup_closed').map((e) => e.eventData);
  for (let i = 0; i < 5; i++) await post(app, 'web_app_open_popup', { message: `Попап ${i}` });
  await expect(page.locator('.webapp-popup')).toHaveCount(1);
  await expect(page.locator('.webapp-popup')).toContainText('Попап 0');
  await expect.poll(closed).toEqual([{}, {}, {}, {}]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.webapp-popup')).toHaveCount(0);
  await expect.poll(closed).toEqual([{}, {}, {}, {}, {}]);
  // Неверный попап (без текста) тоже получает ответ
  await post(app, 'web_app_open_popup', { message: '' });
  await expect.poll(async () => (await closed()).length).toBe(6);
  await expect(page.locator('.webapp-popup')).toHaveCount(0);
  await expect(panel).toBeVisible();

  // open_link: только http(s), в новой вкладке (window.open подменён: в e2e нет интернета и лишних вкладок)
  await page.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((u: string) => ((window as any).__opened.push(u), {})) as typeof window.open;
  });
  await post(app, 'web_app_open_link', { url: 'javascript:alert(1)' });
  await post(app, 'web_app_open_link', { url: 'https://example.com/docs' });
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toEqual(['https://example.com/docs']);
  // Буфер обмена мини-приложению не отдаём; неизвестное — молча игнорируем
  await post(app, 'web_app_read_text_from_clipboard', { req_id: 'r1' });
  await expect.poll(async () => (await events(app)).find((e) => e.eventType === 'clipboard_text_received')?.eventData).toEqual({ req_id: 'r1' });
  await post(app, 'web_app_something_new', { x: 1 });

  // Подтверждение закрытия
  await post(app, 'web_app_setup_closing_behavior', { need_confirmation: true });
  await page.waitForTimeout(100);
  await panel.locator('.webapp-head').getByRole('button', { name: 'Закрыть' }).click();
  const confirm = page.getByRole('dialog', { name: 'Закрыть мини-приложение?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(panel).toBeVisible();
  await panel.locator('.webapp-head').getByRole('button', { name: 'Закрыть' }).click();
  await confirm.locator('form').getByRole('button', { name: 'Закрыть' }).click();
  await expect(panel).toHaveCount(0);

  // ── Бот ещё без ключа подписи (создан до мини-приложений): без hash и с предупреждением; любой вызов Bot API чинит ──
  await dbRun('UPDATE bots SET webapp_key = NULL WHERE user_id = ?', shopBot.id);
  await menuBtn.click();
  await expect(panel.locator('.webapp-warn')).toContainText('Бот ещё не активировал мини-приложения');
  app = await appFrame(page);
  expect(new URLSearchParams(await app.evaluate(() => (window as any).__initData)).has('hash')).toBe(false);
  await bot(request, shopBot.token, 'getMe');
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('.webapp-warn')).toHaveCount(0);
  await expect
    .poll(async () => {
      try {
        return await (await appFrame(page)).evaluate(() => (window as any).__initData as string);
      } catch {
        return '';
      }
    })
    .toContain('hash=');
  app = await appFrame(page);
  expect(validInitData(await app.evaluate(() => (window as any).__initData), shopBot.token)).toBe(true);

  // ── Телефон: панель на весь экран и модальная (остальное приложение inert), без прокрутки вбок ──
  await expect(panel).toHaveAttribute('aria-modal', 'false');
  await expect(page.locator('main.main')).not.toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('main.main')).toHaveAttribute('inert', '');
  await expect(page.locator('.nav')).toHaveAttribute('inert', '');
  // Tab не уходит в скрытый чат
  await panel.getByRole('button', { name: 'Обновить' }).focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('main.main, .nav'))).toBe(false);
  }
  await expect(panel.locator('.webapp-foot').getByRole('button', { name: 'Оформить заказ' })).toBeVisible();
  await shot(page, 'miniapp-390-dark');
  await setTheme(page, 'light');
  await shot(page, 'miniapp-390-light');
  await setTheme(page, 'dark');
  // Esc в окне мини-приложения закрывает его
  await panel.getByRole('button', { name: 'Обновить' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('main.main')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.nav')).not.toHaveAttribute('inert', '');

  expect(errors).toEqual([]);
});

test('mini app: redirect to another origin keeps the protocol working; menu button updates live; phone hides popups', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const a = await registerUser(browser, 'Вера', { popups: true });
  const errors = pageErrors(a.page);
  const vera = await apiUser(request, a);
  const shop = await createBot(request, vera, 'Лавка');
  const ch = await dmWith(request, vera, shop);
  const news = await createBot(request, vera, 'Новости');
  const newsCh = await dmWith(request, vera, news);
  const page = a.page;
  await page.goto(`/channels/@me/${ch}`);
  const panel = page.locator('.webapp-panel');
  const menuBtn = page.locator('.chat-head').getByRole('button', { name: 'Открыть мини-приложение: Лавка' });

  // ── Бот ставит кнопку меню, пока личка открыта (обычно в ответ на /start): шапка обновляется без перехода ──
  await expect(page.locator('.chat-head')).toBeVisible();
  await expect(menuBtn).toHaveCount(0);
  await bot(request, shop.token, 'setChatMenuButton', { chat_id: ch, menu_button: { type: 'web_app', text: 'Лавка', web_app: { url: `${APP_ORIGIN}/hop` } } });
  await expect(menuBtn).toBeVisible();
  // Сброс к default — кнопка уходит; общая кнопка бота (без chat_id) — появляется снова
  await bot(request, shop.token, 'setChatMenuButton', { chat_id: ch });
  await expect(menuBtn).toHaveCount(0);
  await bot(request, shop.token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Лавка', web_app: { url: `${APP_ORIGIN}/hop` } } });
  await expect(menuBtn).toBeVisible();

  // ── Адрес кнопки отвечает 302 на другой origin: ready, MainButton и ответы доходят ──
  await menuBtn.click();
  const app = await appFrame(page, HOP_ORIGIN);
  expect(app.url().startsWith(`${HOP_ORIGIN}/shop`)).toBe(true);
  await expect.poll(() => eventTypes(app)).toEqual(expect.arrayContaining(['theme_changed', 'viewport_changed']));
  const mainBtn = panel.locator('.webapp-foot').getByRole('button', { name: 'Оформить заказ' });
  await mainBtn.click();
  await expect.poll(() => eventTypes(app)).toContain('main_button_pressed');
  const popup = page.getByRole('dialog', { name: 'Подтверждение' });
  await popup.getByRole('button', { name: 'Купить' }).click();
  await expect(panel).toHaveCount(0);

  // ── Телефон: баннеры не перекрывают мини-приложение на весь экран ──
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = page.locator('.notify-popups .notify-popup');
  await bot(request, news.token, 'sendMessage', { chat_id: newsCh, text: 'Свежий выпуск' });
  await expect(cards).toHaveCount(1);
  await page.locator('.chat-head').getByRole('button', { name: 'Открыть мини-приложение: Лавка' }).click();
  await expect(panel).toBeVisible();
  // Баннер, который был на экране, ушёл; новые не появляются, пока окно открыто
  await expect(cards).toHaveCount(0);
  await bot(request, news.token, 'sendMessage', { chat_id: newsCh, text: 'Ещё выпуск' });
  await page.waitForTimeout(1200);
  await expect(cards).toHaveCount(0);
  await panel.locator('.webapp-head').getByRole('button', { name: 'Закрыть' }).click();
  await expect(panel).toHaveCount(0);
  await bot(request, news.token, 'sendMessage', { chat_id: newsCh, text: 'И ещё' });
  await expect(cards).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('mini app API: url must match the button or the menu, same origin as Vicinity is refused', async ({ request, browser }) => {
  const a = await registerUser(browser, 'Борис');
  const boris = await apiUser(request, a);
  const b = await createBot(request, boris, 'Проверка');
  const ch = await dmWith(request, boris, b);
  const hdr = { Authorization: `Bearer ${boris.token}` };
  const open = (data: object) => request.post(`/api/v1/bots/${b.id}/webapp`, { headers: hdr, data });
  // Ни кнопки, ни меню — 400
  expect((await open({ url: APP_URL, channel_id: ch })).status()).toBe(400);
  // Кнопка с другим адресом — 400; с этим — 200
  const m = await bot(request, b.token, 'sendMessage', {
    chat_id: ch,
    text: 'x',
    reply_markup: { inline_keyboard: [[{ text: 'App', web_app: { url: APP_URL } }]] },
  });
  expect((await open({ url: `${APP_ORIGIN}/other`, channel_id: ch, message_id: m.message_id })).status()).toBe(400);
  const ok = await open({ url: APP_URL, channel_id: ch, message_id: m.message_id, theme_params: { bg_color: '#102030', text_color: 'red' } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.signed).toBe(true);
  expect(body.theme_params).toEqual({ bg_color: '#102030' });
  expect(body.url_with_fragment).toBe(
    `${APP_URL}#tgWebAppData=${encodeURIComponent(body.init_data)}&tgWebAppVersion=7.10&tgWebAppPlatform=web&tgWebAppThemeParams=${encodeURIComponent('{"bg_color":"#102030"}')}`,
  );
  expect(validInitData(body.init_data, b.token)).toBe(true);
  // Чужой человек не открывает мини-приложение из чужой лички
  const other = await registerUser(browser, 'Чужой');
  const stranger = await apiUser(request, other);
  const r = await request.post(`/api/v1/bots/${b.id}/webapp`, {
    headers: { Authorization: `Bearer ${stranger.token}` },
    data: { url: APP_URL, channel_id: ch, message_id: m.message_id },
  });
  expect([403, 404]).toContain(r.status());
  // Адрес на хосте самого Vicinity (с любым портом, точкой в конце, другим регистром) в iframe с allow-same-origin
  // вышел бы из песочницы или делил бы с Vicinity куки — запрещено и в setChatMenuButton, и при открытии
  const menu = (url: string) =>
    request.post(`http://localhost:${port}/api/v1/bot${b.token}/setChatMenuButton`, {
      data: { menu_button: { type: 'web_app', text: 'Свой', web_app: { url } } },
    });
  for (const self of [`http://localhost:${port}/x`, `http://LOCALHOST:${port + 1}/x`, 'http://localhost./x', 'https://localhost:443/x']) {
    expect((await menu(self)).status(), self).toBe(400);
    // Кнопку, записанную в обход Bot API (старый сервер), тоже не откроет
    await dbRun(`INSERT INTO bot_menu_buttons(bot_id, channel_id, button) VALUES(?, 0, ?)
      ON CONFLICT(bot_id, channel_id) DO UPDATE SET button = excluded.button`, b.id, JSON.stringify({ type: 'web_app', text: 'Свой', web_app: { url: self } }));
    const same = await request.post(`http://localhost:${port}/api/v1/bots/${b.id}/webapp`, { headers: hdr, data: { url: self, channel_id: ch } });
    expect(same.status(), self).toBe(400);
  }
  await dbRun('DELETE FROM bot_menu_buttons WHERE bot_id = ?', b.id);
  // Записи хоста, которые браузер понял бы иначе, чем сервер (IPv4 не a.b.c.d, «\\», %-коды, не-ASCII), — 400 всегда
  for (const odd of [
    'https://0x7f000001/',
    'https://2130706433/',
    'https://127.1/',
    'https://3232235777/',
    'https://0x7f.0.0.1/',
    'https://127.0.0.010/',
    'https://example.com\\@127.0.0.1/',
    'https://192.168.1.1\\admin',
    'https://%31%32%37.0.0.1/',
    'https://\uff11\uff12\uff17.0.0.1/',
  ]) {
    expect((await menu(odd)).status(), odd).toBe(400);
    const inline = await request.post(`/api/v1/bot${b.token}/sendMessage`, {
      data: { chat_id: ch, text: 'x', reply_markup: { inline_keyboard: [[{ text: 'App', web_app: { url: odd } }]] } },
    });
    expect(inline.status(), odd).toBe(400);
  }
  // Обычные адреса проходят (в e2e частные разрешены allow_private_webhooks)
  for (const fine of ['https://example.com/app', 'https://xn--80ak6aa92e.com/', 'https://127.0.0.1/', 'https://[::1]:8443/'])
    expect((await menu(fine)).status(), fine).toBe(200);
  await bot(request, b.token, 'setChatMenuButton', {});
  // Неверный адрес кнопки меню — 400 от Bot API
  const bad = await request.post(`/api/v1/bot${b.token}/setChatMenuButton`, {
    data: { menu_button: { type: 'web_app', text: 'x', web_app: { url: 'javascript:alert(1)' } } },
  });
  expect(bad.status()).toBe(400);
  // answerWebAppQuery: сообщение от бота в чат, где открыли; второй раз — 400
  const qid = new URLSearchParams(body.init_data).get('query_id');
  await bot(request, b.token, 'answerWebAppQuery', {
    web_app_query_id: qid,
    result: { type: 'article', id: '1', title: 't', input_message_content: { message_text: 'Заказ оформлен' } },
  });
  const again = await request.post(`/api/v1/bot${b.token}/answerWebAppQuery`, {
    data: { web_app_query_id: qid, result: { type: 'article', id: '1', title: 't', input_message_content: { message_text: 'x' } } },
  });
  expect(again.status()).toBe(400);
  const msgs = await request.get(`/api/v1/channels/${ch}/messages`, { headers: hdr });
  expect(JSON.stringify(await msgs.json())).toContain('Заказ оформлен');
});
