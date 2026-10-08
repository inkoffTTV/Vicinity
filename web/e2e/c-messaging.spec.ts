import { expect, test } from '@playwright/test';
import { controlSocket, openDm, pageErrors, registerUser, send, User } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POST_MESSAGES = /\/api\/v1\/channels\/\d+\/messages$/;

const msgText = (u: User, text: string) => u.page.locator('.msg-text', { hasText: text });

/** Личка a ↔ b, открытая у обоих. */
async function openDmBothSides(a: User, b: User) {
  await openDm(a, b);
  await send(a, 'начало переписки');
  await b.page.locator('.side-item', { hasText: a.displayName }).click();
  await expect(msgText(b, 'начало переписки')).toBeVisible();
}

test('optimistic send: shown at once as pending, confirmed exactly once (REST first or WS echo first)', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);

  // 1) Запрос уходит на сервер с задержкой: сообщение уже в ленте как «отправляется», поле очищено
  await a.page.route(POST_MESSAGES, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await sleep(1500);
    await route.continue();
  });
  const box = a.page.locator('.composer textarea');
  await box.fill('медленная отправка');
  await box.press('Enter');
  await expect(box).toHaveValue('');
  await expect(a.page.locator('.msg.pending', { hasText: 'медленная отправка' })).toBeVisible();
  await expect(a.page.locator('.msg.pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(msgText(a, 'медленная отправка')).toHaveCount(1);
  await expect(msgText(b, 'медленная отправка')).toHaveCount(1);
  await a.page.unroute(POST_MESSAGES);

  // 2) Сервер сохранил сразу, но ответ REST задержан — эхо по WS приходит раньше ответа
  await a.page.route(POST_MESSAGES, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    await sleep(1500);
    await route.fulfill({ response });
  });
  await box.fill('эхо раньше ответа');
  await box.press('Enter');
  await expect(msgText(b, 'эхо раньше ответа')).toHaveCount(1);
  await expect(msgText(a, 'эхо раньше ответа')).toHaveCount(1);
  await expect(a.page.locator('.msg.pending')).toHaveCount(0);
  await sleep(1800); // ответ REST пришёл после эха — дубля нет
  await expect(msgText(a, 'эхо раньше ответа')).toHaveCount(1);
  await a.page.unroute(POST_MESSAGES);

  // 3) Несколько сообщений подряд — порядок сохраняется, без дублей
  for (const t of ['раз', 'два', 'три']) {
    await box.fill(`очередь ${t}`);
    await box.press('Enter');
  }
  await expect(b.page.locator('.msg-text', { hasText: 'очередь' })).toHaveText(['очередь раз', 'очередь два', 'очередь три']);
  await expect(a.page.locator('.msg-text', { hasText: 'очередь' })).toHaveText(['очередь раз', 'очередь два', 'очередь три']);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('own message appears from the REST response when the WebSocket is silent', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);

  const sock = await controlSocket(a);
  sock.stall(); // соединение «живо», но эхо new_message до страницы не доходит
  const box = a.page.locator('.composer textarea');
  await box.fill('без вебсокета');
  await box.press('Enter');
  await expect(msgText(b, 'без вебсокета')).toHaveCount(1);
  await expect(a.page.locator('.msg:not(.pending):not(.failed)', { hasText: 'без вебсокета' })).toHaveCount(1);

  // После переподключения история перечитывается — сообщение остаётся в одном экземпляре
  await sock.drop();
  await expect.poll(() => sock.connections()).toBe(2);
  await expect(a.page.locator('.user-panel')).toContainText('В сети');
  await send(b, 'после переподключения');
  await expect(msgText(a, 'после переподключения')).toBeVisible();
  await expect(msgText(a, 'без вебсокета')).toHaveCount(1);
  expect(pageErrors(a.page)).toEqual([]);
});

test('failed send keeps the message with retry and discard', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDmBothSides(a, b);

  await a.page.route(POST_MESSAGES, (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.fallback(),
  );
  const box = a.page.locator('.composer textarea');
  await box.fill('повторю позже');
  await box.press('Enter');
  const failed = a.page.locator('.msg.failed', { hasText: 'повторю позже' });
  await expect(failed).toBeVisible();
  await expect(failed).toContainText('Не отправлено');
  await expect(a.page.locator('.toast.error')).toBeVisible();

  await box.fill('передумал');
  await box.press('Enter');
  await expect(a.page.locator('.msg.failed', { hasText: 'передумал' })).toBeVisible();

  await a.page.unroute(POST_MESSAGES);
  await failed.getByRole('button', { name: 'Повторить' }).click();
  await expect(msgText(b, 'повторю позже')).toHaveCount(1);
  await expect(a.page.locator('.msg.failed', { hasText: 'повторю позже' })).toHaveCount(0);
  await expect(msgText(a, 'повторю позже')).toHaveCount(1);

  await a.page.locator('.msg.failed', { hasText: 'передумал' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(msgText(a, 'передумал')).toHaveCount(0);
  await sleep(500);
  await expect(msgText(b, 'передумал')).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});

test('paste: text wins over the image rendering that office apps add; a bare image is attached', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDm(a, b);

  const paste = (withText: boolean) =>
    a.page.evaluate((withText) => {
      const ta = document.querySelector('.composer textarea')!;
      const dt = new DataTransfer();
      if (withText) dt.setData('text/plain', 'A1\tB1');
      dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' }));
      // true — браузер вставит текст сам (событие не отменено)
      return ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, withText);

  expect(await paste(true)).toBe(true);
  await expect(a.page.locator('.upload-preview')).toHaveCount(0);
  expect(await paste(false)).toBe(false);
  await expect(a.page.locator('.upload-preview')).toBeVisible();
});

test('drafts survive channel switches but not sending; stale search answers do not win', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await openDm(a, b);
  const box = a.page.locator('.composer textarea');
  const dm = a.page.locator('.side-item', { hasText: 'Боб' });
  const friendsItem = a.page.locator('.side-item', { hasText: 'Друзья' });

  await box.fill('недописанное');
  await friendsItem.click();
  await dm.click();
  await expect(box).toHaveValue('недописанное');
  await box.press('Enter');
  await expect(msgText(a, 'недописанное')).toBeVisible();
  await friendsItem.click();
  await dm.click();
  await expect(box).toHaveValue('');

  // Ответ на прежний запрос поиска приходит последним и не перетирает свежие результаты
  const prefix = b.username.slice(0, -1);
  await a.page.route(/\/api\/v1\/users\/search\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') !== prefix) return route.fallback();
    await sleep(1500);
    await route.fulfill({ json: { users: [] } });
  });
  await friendsItem.click();
  await a.page.locator('.tabs button', { hasText: 'Добавить в друзья' }).click();
  const search = a.page.locator('.add-friend input');
  await search.fill(prefix);
  await sleep(500);
  await search.fill(b.username);
  const row = a.page.locator(`.user-row:has-text("@${b.username}")`);
  await expect(row).toBeVisible();
  await sleep(1700);
  await expect(row).toBeVisible();
  await expect(a.page.getByText('Никого не найдено')).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});
