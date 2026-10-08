import { APIRequestContext, expect, Page } from '@playwright/test';
import { openDm, send, tokenOf, uniqueName, User } from './helpers';

// Общие шаги для w1-*.spec.ts (чат: ответы, непрочитанное, разметка, файлы, закрепы, поиск).

export const msg = (u: User, text: string) => u.page.locator('.msg', { hasText: text });
export const msgText = (u: User, text: string) => u.page.locator('.msg-text', { hasText: text });
export const composer = (u: User) => u.page.locator('.composer textarea');

export interface ApiUser {
  token: string;
  id: number;
}

/** Токен и id пользователя браузера — для запросов к API от его имени */
export async function apiUser(request: APIRequestContext, u: User): Promise<ApiUser> {
  const token = await tokenOf(u);
  const r = await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBe(true);
  return { token, id: (await r.json()).user_id };
}

/** Пользователь только для API (без браузера) */
export async function apiRegister(request: APIRequestContext, displayName: string): Promise<ApiUser & { username: string }> {
  const username = uniqueName('api');
  const r = await request.post('/api/v1/auth/register', { data: { username, password: 'password123', display_name: displayName } });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { token: body.token, id: body.user_id, username };
}

export async function call(request: APIRequestContext, who: ApiUser, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const r = await request.fetch(`/api/v1${path}`, { method, headers: { Authorization: `Bearer ${who.token}` }, data });
  const text = await r.text();
  return { status: r.status(), body: text ? JSON.parse(text) : null };
}

/** Отправить сообщение через API; при лимите частоты (429) — подождать и повторить */
export async function post(request: APIRequestContext, who: ApiUser, channelId: number, text: string, extra: object = {}) {
  for (;;) {
    const r = await call(request, who, 'POST', `/channels/${channelId}/messages`, { text, ...extra });
    if (r.status !== 429) {
      expect(r.status).toBe(201);
      return r.body.id as number;
    }
    await new Promise((res) => setTimeout(res, 600));
  }
}

/** Личка a ↔ b, открытая у обоих; возвращает id канала */
export async function dmBothSides(a: User, b: User): Promise<number> {
  await openDm(a, b);
  await send(a, 'начало переписки');
  await b.page.locator('.side-item', { hasText: a.displayName }).click();
  await expect(msgText(b, 'начало переписки')).toBeVisible();
  return Number(await a.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.view') ?? '{}').channelId));
}

/** Подменить видимость вкладки (headless-браузер всегда «видим») */
export const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

/** Создать текстовый канал на открытом сервере и открыть его */
export async function addTextChannel(u: User, name: string) {
  await u.page.locator('.side-head').click();
  await u.page.locator('.dropdown button', { hasText: 'Создать текстовый канал' }).click();
  await u.page.locator('.modal input').fill(name);
  await u.page.locator('.modal').getByRole('button', { name: 'Создать' }).click();
  await expect(u.page.locator('.side-item.channel', { hasText: name })).toBeVisible();
}

/** id канала, открытого на экране */
export const openChannelId = (u: User) =>
  u.page.evaluate(() => Number(JSON.parse(localStorage.getItem('vicinity.view') ?? '{}').channelId));
