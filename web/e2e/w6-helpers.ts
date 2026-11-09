import { APIRequestContext, expect, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { uniqueName } from './helpers';
import { ApiUser, call } from './w1-helpers';

// Общее для w6-*: вызовы Bot API, бот с личкой, тема и снимки экрана
export const SHOTS = process.env.VICINITY_SHOTS_DIR;

/** Вызов Bot API (JSON); на лимит 429 — ждём retry_after, как библиотеки */
export async function bot(request: APIRequestContext, token: string, method: string, params: Record<string, unknown> = {}) {
  for (;;) {
    const r = await request.post(`/api/v1/bot${token}/${method}`, { data: params, timeout: 70_000 });
    const body = await r.json();
    if (r.status() !== 429) {
      expect(body, `${method}: ${JSON.stringify(body)}`).toMatchObject({ ok: true });
      return body.result;
    }
    await new Promise((res) => setTimeout(res, body.parameters.retry_after * 1000));
  }
}

/** Ждать обновление нужного вида длинным опросом и подтвердить всё полученное */
export async function waitUpdate(request: APIRequestContext, token: string, pred: (u: any) => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ups: any[] = await bot(request, token, 'getUpdates', { timeout: 2 });
    if (ups.length) await bot(request, token, 'getUpdates', { offset: ups[ups.length - 1].update_id + 1, timeout: 0 });
    const hit = ups.find(pred);
    if (hit) return hit;
  }
  throw new Error('update not received');
}

export interface TestBot {
  id: number;
  username: string;
  token: string;
}

export async function createBot(request: APIRequestContext, owner: ApiUser, name: string): Promise<TestBot> {
  const username = `${uniqueName('w6')}_bot`;
  const r = await call(request, owner, 'POST', '/bots', { username, display_name: name });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.bot.id, username, token: r.body.token };
}

/** Личка человека с ботом */
export async function dmWith(request: APIRequestContext, who: ApiUser, b: TestBot): Promise<number> {
  const r = await call(request, who, 'POST', '/dms', { user_id: b.id, username: b.username });
  expect(r.status).toBe(201);
  return r.body.channel_id;
}

/** Базовая тема без захода в настройки: атрибут на <html>, как ставит lib/prefs.ts */
export const setTheme = (page: Page, theme: 'dark' | 'light' | 'graphite' | 'black') =>
  page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

/** Снимок экрана после конца анимаций; на телефоне — проверка, что нет прокрутки вбок */
export async function shot(page: Page, name: string) {
  const width = page.viewportSize()?.width ?? 1280;
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (!SHOTS) return;
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((x) => x.effect?.getComputedTiming().iterations !== Infinity)
        .map((x) => x.finished.catch(() => undefined)),
    ),
  );
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
