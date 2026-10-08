import { Browser, BrowserContext, expect, Page } from '@playwright/test';
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
  opts: { viewport?: { width: number; height: number }; colorScheme?: 'dark' | 'light' } = {},
): Promise<User> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    colorScheme: opts.colorScheme ?? 'dark',
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

export function pageErrors(page: Page): string[] {
  return (page as any).__errors ?? [];
}

/** a → заявка в друзья → b принимает. */
export async function makeFriends(a: User, b: User) {
  await a.page.locator('.rail-item.home').click();
  await a.page.locator('.tabs button', { hasText: 'Добавить в друзья' }).click();
  await a.page.locator('.add-friend input').fill(b.username);
  await a.page.locator(`.user-row:has-text("@${b.username}")`).getByRole('button', { name: 'В друзья' }).click();
  await b.page.locator('.rail-item.home').click();
  await b.page.locator('.tabs button', { hasText: 'Заявки' }).click();
  await b.page.locator(`.friend-row:has-text("${a.displayName}")`).getByRole('button', { name: 'Принять' }).click();
  await b.page.locator('.tabs button', { hasText: 'Все' }).click();
  await expect(b.page.locator(`.friend-row:has-text("${a.displayName}")`)).toBeVisible();
}

/** Открыть личку из профиля через поиск. */
export async function openDm(from: User, to: User) {
  await from.page.locator('.rail-item.home').click();
  await from.page.locator('.tabs button', { hasText: 'Добавить в друзья' }).click();
  await from.page.locator('.add-friend input').fill(to.username);
  await from.page.locator(`.user-row:has-text("@${to.username}")`).getByRole('button', { name: 'Написать' }).click();
  await expect(from.page.locator('.composer textarea')).toBeVisible();
}

export async function send(u: User, text: string) {
  await u.page.locator('.composer textarea').fill(text);
  await u.page.locator('.composer textarea').press('Enter');
  await expect(u.page.locator('.msg-text', { hasText: text }).last()).toBeVisible();
}

/** Создать сервер, вернуть код приглашения. */
export async function createServer(u: User, name: string): Promise<string> {
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
