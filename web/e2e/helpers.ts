import { Browser, BrowserContext, expect, Page, WebSocketRoute } from '@playwright/test';
import { deflateSync } from 'node:zlib';

let seq = 0;
/** Уникальный логин в рамках прогона (база общая на весь прогон). */
export function uniqueName(prefix: string) {
  seq += 1;
  return `${prefix}${process.pid % 1000}${Date.now() % 100000}${seq}`;
}

export interface User {
  page: Page;
  context: BrowserContext;
  username: string;
  displayName: string;
}

/** Новый браузерный контекст + регистрация. Ждёт подключения WebSocket. */
export async function registerUser(
  browser: Browser,
  displayName: string,
  opts: { viewport?: { width: number; height: number }; colorScheme?: 'dark' | 'light'; denoise?: boolean } = {},
): Promise<User> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    colorScheme: opts.colorScheme ?? 'dark',
  });
  // Поддельный микрофон Chromium пищит чистым тоном, а RNNoise (включён по умолчанию) считает его шумом
  // и почти гасит — тесты голоса и звонков отключают модель; тест RNNoise просит её явно (denoise: true)
  if (!opts.denoise)
    await context.addInitScript(() => {
      try {
        if (localStorage.getItem('vicinity.media') === null) localStorage.setItem('vicinity.media', JSON.stringify({ denoise: false }));
      } catch {
        /* изолированный iframe активности без allow-same-origin: localStorage недоступен */
      }
    });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  const username = uniqueName(displayName.toLowerCase().replace(/[^a-z]/g, '') || 'user');
  await page.goto('/');
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('label:has-text("Отображаемое имя") input').fill(displayName);
  await page.locator('input[type=password]').fill('password123');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('.user-panel')).toBeVisible();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  return { page, context, username, displayName };
}

/** Войти существующим пользователем на экране входа (после выхода или в новой вкладке). */
export async function loginAs(page: Page, username: string) {
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('input[type=password]').fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.user-panel')).toContainText('В сети');
}

/** Зарегистрироваться на уже открытом экране входа (та же вкладка, что у прежнего пользователя). */
export async function registerHere(page: Page, displayName: string): Promise<string> {
  const username = uniqueName(displayName.toLowerCase().replace(/[^a-z]/g, '') || 'user');
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('label:has-text("Отображаемое имя") input').fill(displayName);
  await page.locator('input[type=password]').fill('password123');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  return username;
}

export function pageErrors(page: Page): string[] {
  return (page as any).__errors ?? [];
}

/** a → заявка в друзья (по полному нику — поиска по части ника больше нет) → b принимает. */
export async function makeFriends(a: User, b: User) {
  await a.page.locator('.rail-item.home').click();
  await a.page.locator('.tabs button', { hasText: 'Добавить в друзья' }).click();
  await a.page.locator('.add-friend input').fill(b.username);
  await a.page.locator('.add-friend').getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(a.page.locator('.add-friend-result')).toContainText('Заявка отправлена');
  await b.page.locator('.rail-item.home').click();
  await b.page.locator('.tabs button', { hasText: 'Заявки' }).click();
  await b.page.locator(`.friend-row:has-text("${a.displayName}")`).getByRole('button', { name: 'Принять' }).click();
  await b.page.locator('.tabs button', { hasText: 'Все' }).click();
  await expect(b.page.locator(`.friend-row:has-text("${a.displayName}")`)).toBeVisible();
}

/** Открыть личку: незнакомым писать нельзя — сначала в друзья (если ещё нет), затем «Написать». */
export async function openDm(from: User, to: User) {
  await from.page.locator('.rail-item.home').click();
  await from.page.locator('.tabs button', { hasText: 'Все' }).click();
  const row = from.page.locator('.friend-row', { hasText: `@${to.username}` });
  if (!(await row.count())) {
    await makeFriends(from, to);
    await from.page.locator('.rail-item.home').click();
    await from.page.locator('.tabs button', { hasText: 'Все' }).click();
  }
  await row.getByRole('button', { name: 'Написать' }).click();
  await expect(from.page.locator('.composer textarea')).toBeVisible();
}

export async function send(u: User, text: string) {
  await u.page.locator('.composer textarea').fill(text);
  await u.page.locator('.composer textarea').press('Enter');
  await expect(u.page.locator('.msg-text', { hasText: text }).last()).toBeVisible();
}

/** Создать сервер, вернуть код приглашения. */
export async function createServer(u: User, name: string): Promise<string> {
  // На телефоне панель серверов спрятана за кнопкой «Меню»
  const menu = u.page.getByRole('button', { name: 'Меню' }).first();
  if ((await u.page.locator('.app.nav-open').count()) === 0 && (await menu.isVisible())) {
    await menu.click();
    await expect(u.page.locator('.app.nav-open')).toBeVisible();
  }
  await u.page.locator('.rail-item.add').click();
  await u.page.locator('.modal input').first().fill(name);
  await u.page.locator('.modal').getByRole('button', { name: 'Создать' }).click();
  await expect(u.page.locator('.side-head', { hasText: name })).toBeVisible();
  const toast = await u.page.locator('.toast', { hasText: 'Код приглашения' }).textContent();
  return toast!.match(/: (\w+)$/)![1];
}

export async function joinServer(u: User, code: string, name: string) {
  await u.page.locator('.rail-item.add').click();
  await u.page.locator('.modal input').nth(1).fill(code);
  await u.page.locator('.modal').getByRole('button', { name: 'Вступить' }).click();
  await expect(u.page.locator('.side-head', { hasText: name })).toBeVisible();
}

/** Создать беседу и открыть её. */
export async function createGroup(u: User, name: string) {
  await u.page.locator('.rail-item.home').click();
  await u.page.getByRole('button', { name: 'Создать беседу' }).click();
  await u.page.locator('.modal input').fill(name);
  await u.page.locator('.modal').getByRole('button', { name: 'Создать' }).click();
  await expect(u.page.locator('.chat-title', { hasText: name })).toBeVisible();
}

/** Управление WebSocket страницы через перехват Playwright: обрыв и «зависшее» соединение. */
export interface SocketControl {
  /** Сколько раз страница подключалась к /ws */
  connections(): number;
  /** Сервер закрывает текущее соединение */
  drop(): Promise<void>;
  /** Текущее соединение перестаёт пропускать кадры в обе стороны, но не закрывается (как при смене сети) */
  stall(): void;
  /** Доставить странице событие «от сервера» (типы, которые старый бэкенд ещё не рассылает) */
  inject(ev: Record<string, unknown>): void;
}

/** Включить перехват WebSocket и переподключить страницу через него. */
export async function controlSocket(u: User): Promise<SocketControl> {
  let current: WebSocketRoute | null = null;
  let count = 0;
  const stalled = new Set<WebSocketRoute>();
  await u.context.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    count += 1;
    current = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (!stalled.has(ws)) server.send(m);
    });
    server.onMessage((m) => {
      if (!stalled.has(ws)) ws.send(m);
    });
  });
  await u.page.reload();
  await expect(u.page.locator('.user-panel')).toContainText('В сети');
  return {
    connections: () => count,
    drop: async () => {
      await current?.close();
    },
    stall: () => {
      if (current) stalled.add(current);
    },
    inject: (ev) => current?.send(JSON.stringify(ev)),
  };
}

/** Токен сессии из localStorage страницы (для прямых запросов к API от имени пользователя). */
export async function tokenOf(u: User): Promise<string> {
  const token = await u.page.evaluate(() => localStorage.getItem('vicinity.token'));
  expect(token).toBeTruthy();
  return token!;
}

/** Маленький валидный PNG (сплошной цвет) для тестов загрузки. */
export function pngBuffer(w = 120, h = 80): Buffer {
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)])),
  );
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
