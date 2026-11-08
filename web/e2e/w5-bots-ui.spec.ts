import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer, joinServer, pageErrors, pngBuffer, registerUser, uniqueName } from './helpers';
import { apiUser, ApiUser, call, composer, openChannelId } from './w1-helpers';
import { confirmDialog, openServerId, openServerSettings, settingsTab } from './w2-helpers';
import { openNav } from './ui-helpers';

// Интерфейс ботов (SPEC §6, docs/API.md §21–22): Настройки → Боты, кнопки под сообщением, ответы на нажатия,
// эфемерные сообщения, подсказки команд, боты и вебхуки в настройках сервера. Программа бота — прямые вызовы Bot API.
const SHOTS = process.env.VICINITY_SHOTS_DIR;

/** Вызов Bot API (JSON); на лимит 429 — ждём retry_after, как библиотеки */
async function bot(request: APIRequestContext, token: string, method: string, params: Record<string, unknown> = {}) {
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

/** Ждать обновление нужного вида длинным опросом (как aiogram) и подтвердить всё полученное */
async function waitUpdate(request: APIRequestContext, token: string, pred: (u: any) => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ups: any[] = await bot(request, token, 'getUpdates', { timeout: 3 });
    if (ups.length) await bot(request, token, 'getUpdates', { offset: ups[ups.length - 1].update_id + 1, timeout: 0 });
    const hit = ups.find(pred);
    if (hit) return hit;
  }
  throw new Error('update not received');
}

/** Ширина 390 px: без горизонтальной прокрутки + снимок */
async function phoneShot(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (SHOTS) {
    // Дождаться конца появлений (лента, сообщения) — иначе снимок полупрозрачный
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
}

test('bots UI: settings, buttons, callbacks, ephemeral, commands, server bots and webhooks', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await a.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = pageErrors(a.page);
  const alice: ApiUser = await apiUser(request, a);

  // ── Настройки → Боты: создать бота, токен один раз, копирование ──
  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(a, 'Боты').click();
  const page = a.page.locator('.settings-page');
  await expect(page.getByRole('heading', { name: 'Боты', exact: true })).toBeVisible();
  await expect(page.getByText('Ботов пока нет')).toBeVisible();
  const username = `${uniqueName('ui')}_bot`;
  await page.getByLabel('Имя', { exact: true }).fill('Погодник');
  // Неверное имя пользователя — кнопка недоступна
  await page.getByLabel('Имя пользователя').fill('weather');
  await expect(page.getByRole('button', { name: 'Создать бота' })).toBeDisabled();
  await page.getByLabel('Имя пользователя').fill(`@${username}`);
  await page.getByRole('button', { name: 'Создать бота' }).click();

  const tokenInput = page.getByRole('textbox', { name: 'Токен бота', exact: true });
  await expect(tokenInput).toBeVisible();
  const token = await tokenInput.inputValue();
  expect(token).toMatch(/^\d+:[0-9a-f]{48}$/);
  await expect(page.getByText('больше он не покажется')).toBeVisible();
  await page.locator('.bot-token-card').getByRole('button', { name: 'Копировать' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Токен скопирован' })).toBeVisible();
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  const me = await bot(request, token, 'getMe');
  expect(me).toMatchObject({ is_bot: true, username, first_name: 'Погодник' });

  const card = page.locator('.bot-item', { hasText: `@${username}` });
  await expect(card).toContainText(`…${token.slice(-4)}`);
  await expect(card).toContainText('getUpdates');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(tokenInput).toHaveCount(0);

  // Режим «читать все сообщения» сохраняется на сервере
  const readAll = card.getByRole('switch');
  await readAll.click();
  await expect(readAll).toHaveJSProperty('checked', true);
  await expect.poll(async () => (await call(request, alice, 'GET', '/bots')).body.bots[0].read_all).toBe(true);
  await readAll.click();
  await expect.poll(async () => (await call(request, alice, 'GET', '/bots')).body.bots[0].read_all).toBe(false);

  // Команды бота видны в карточке после setMyCommands
  await bot(request, token, 'setMyCommands', {
    commands: [
      { command: 'weather', description: 'Погода сейчас' },
      { command: 'week', description: 'Прогноз на неделю' },
    ],
  });

  // «Написать» — личка с ботом, пометка «Бот» в списке личек
  await card.getByRole('button', { name: 'Написать' }).click();
  await expect(a.page.locator('.settings-page')).toHaveCount(0);
  await expect(a.page.locator('.chat-title', { hasText: 'Погодник' })).toBeVisible();
  await expect(a.page.locator('.side-item', { hasText: 'Погодник' }).locator('.bot-tag')).toHaveText('Бот');
  const dmId = await openChannelId(a);

  // ── Сообщение бота с кнопками: callback, ссылка, копирование ──
  const sent = await bot(request, token, 'sendMessage', {
    chat_id: dmId,
    text: 'Где вы живёте?',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Москва', callback_data: 'city:msk' },
          { text: 'Казань', callback_data: 'city:kzn' },
        ],
        [{ text: 'Сайт прогноза', url: 'https://example.com/forecast' }],
        [{ text: 'Код города', copy_text: { text: 'MSK-77' } }],
      ],
    },
  });
  const msg = a.page.locator('.msg', { hasText: 'Где вы живёте?' });
  await expect(msg.locator('.msg-meta .bot-tag')).toHaveText('Бот');
  const kb = msg.getByRole('group', { name: 'Кнопки бота' });
  await expect(kb.locator('.bot-kb-row')).toHaveCount(3);
  const link = kb.getByRole('link', { name: 'Сайт прогноза' });
  await expect(link).toHaveAttribute('href', 'https://example.com/forecast');
  await expect(link).toHaveAttribute('title', 'Сайт прогноза — example.com');
  // Подпись callback-кнопки целиком — в подсказке (на телефоне она может не поместиться)
  await expect(kb.getByRole('button', { name: 'Москва' })).toHaveAttribute('title', 'Москва');
  await expect(link).toHaveAttribute('target', '_blank');

  // copy_text — в буфер обмена без сервера
  await kb.getByRole('button', { name: 'Код города' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Скопировано' })).toBeVisible();
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe('MSK-77');

  // callback — ждём ответа бота с индикатором; ответ — тост
  const msk = kb.getByRole('button', { name: 'Москва' });
  await msk.click();
  await expect(msk).toHaveAttribute('aria-busy', 'true');
  const up = await waitUpdate(request, token, (u) => u.callback_query?.data === 'city:msk');
  expect(up.callback_query.message.message_id).toBe(sent.message_id);
  expect(up.callback_query.from.id).toBe(alice.id);
  await bot(request, token, 'answerCallbackQuery', { callback_query_id: up.callback_query.id, text: 'Запомнил: Москва' });
  await expect(a.page.locator('.toast', { hasText: 'Запомнил: Москва' })).toBeVisible();
  await expect(msk).not.toHaveAttribute('aria-busy', 'true');
  await expect(msk).toBeEnabled();

  // show_alert — заметное окно. Нажатие с клавиатуры: пока ждём ответа, фокус остаётся на кнопке
  const kzn = kb.getByRole('button', { name: 'Казань' });
  await kzn.focus();
  await a.page.keyboard.press('Enter');
  await expect(kzn).toHaveAttribute('aria-busy', 'true');
  await expect(kzn).toBeFocused();
  const up2 = await waitUpdate(request, token, (u) => u.callback_query?.data === 'city:kzn');
  await bot(request, token, 'answerCallbackQuery', { callback_query_id: up2.callback_query.id, text: 'Казань пока не поддерживается', show_alert: true });
  const alert = a.page.locator('.modal.bot-alert');
  await expect(alert).toContainText('Казань пока не поддерживается');
  await alert.getByRole('button', { name: 'Понятно' }).click();
  await expect(alert).toHaveCount(0);

  // editMessageReplyMarkup без кнопок — кнопки исчезают, текст остаётся
  await bot(request, token, 'editMessageReplyMarkup', { chat_id: dmId, message_id: sent.message_id });
  await expect(kb).toHaveCount(0);
  await expect(msg.locator('.msg-text')).toContainText('Где вы живёте?');
  // editMessageText — новый текст и снова кнопка
  await bot(request, token, 'editMessageText', {
    chat_id: dmId,
    message_id: sent.message_id,
    text: 'Город: <b>Москва</b>',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Сменить', callback_data: 'city:change' }]] },
  });
  const edited = a.page.locator('.msg', { hasText: 'Город: Москва' });
  await expect(edited.locator('.msg-text strong')).toHaveText('Москва');
  await expect(edited.getByRole('button', { name: 'Сменить' })).toBeVisible();
  await expect(a.page.locator('.msg', { hasText: 'Где вы живёте?' })).toHaveCount(0);

  // ── Подсказки команд: «/» в начале → команды бота, Enter вставляет ──
  const input = composer(a);
  await input.fill('/');
  const popup = a.page.getByRole('listbox', { name: 'Команды ботов' });
  await expect(popup.getByRole('option')).toHaveCount(2);
  await input.pressSequentially('wea');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await expect(popup.getByRole('option')).toContainText('/weather');
  await expect(popup.getByRole('option')).toContainText('Погода сейчас');
  await input.press('Enter');
  await expect(input).toHaveValue('/weather ');
  await expect(popup).toHaveCount(0);
  // Отправленная команда доходит до бота
  await input.press('Enter');
  const cmd = await waitUpdate(request, token, (u) => u.message?.text === '/weather');
  expect(cmd.message.entities?.[0]).toMatchObject({ type: 'bot_command', offset: 0 });
  // Команда набрана целиком — Enter сразу отправляет, а не вставляет её ещё раз
  await input.fill('/week');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await waitUpdate(request, token, (u) => u.message?.text === '/week');
  // «/» не в начале сообщения — не команда
  await input.fill('привет /weather');
  await expect(popup).toHaveCount(0);
  await input.fill('');

  // Профиль бота и меню по правой кнопке: ни дружбы, ни звонка, ни «Сейчас»
  const botAuthor = a.page.locator('.msg', { hasText: 'Город: Москва' }).locator('.msg-author').first();
  await botAuthor.click({ button: 'right' });
  const userMenu = a.page.getByRole('menu', { name: 'Действия с пользователем' });
  await expect(userMenu.getByRole('menuitem', { name: 'Написать' })).toBeVisible();
  await expect(userMenu.getByRole('menuitem', { name: 'Позвонить' })).toHaveCount(0);
  await expect(userMenu.getByRole('menuitem', { name: /в друзья/ })).toHaveCount(0);
  await userMenu.getByRole('menuitem', { name: 'Профиль' }).click();
  const profile = a.page.locator('.modal', { hasText: `@${username}` }).first();
  // Вместо «Не в сети» — пометка «Бот»
  await expect(profile.locator('.pcard-presence .bot-tag')).toHaveText('Бот');
  await expect(profile.getByRole('button', { name: 'Добавить в друзья' })).toHaveCount(0);
  await profile.getByRole('tab', { name: 'Активность' }).click();
  await expect(profile.locator('.pactivity .bot-tag')).toBeVisible();
  await expect(profile.getByText('Сейчас', { exact: true })).toHaveCount(0);
  await a.page.keyboard.press('Escape');
  await expect(profile).toHaveCount(0);

  // Ряд из 8 кнопок — на телефоне переносится по 4, подписи читаются
  await bot(request, token, 'sendMessage', {
    chat_id: dmId,
    text: 'Восемь вариантов',
    reply_markup: { inline_keyboard: [Array.from({ length: 8 }, (_, i) => ({ text: `Вариант ${i + 1}`, callback_data: `v${i}` }))] },
  });

  // Телефон (вторая вкладка Алисы шириной 390): кнопки под сообщением не вылезают за экран
  const phone = await a.context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(a.page.url());
  await expect(phone.locator('.msg', { hasText: 'Город: Москва' }).getByRole('button', { name: 'Сменить' })).toBeVisible();
  const eight = phone.locator('.msg', { hasText: 'Восемь вариантов' }).locator('.bot-kb-btn');
  await expect(eight).toHaveCount(8);
  const boxes = await eight.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
  // Не помещаются в один ряд — переносятся на следующие строки, но подписи видны целиком (без обрезки)
  expect(new Set(boxes.map((r) => Math.round(r.y))).size).toBeGreaterThanOrEqual(2);
  for (const r of boxes) {
    expect(r.w).toBeGreaterThanOrEqual(56);
    expect(r.x + r.w).toBeLessThanOrEqual(390);
  }
  const clipped = await eight.locator('.bot-kb-label').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(clipped).toBe(0);
  await phoneShot(phone, 'bots-dm-390');

  // ── Сервер: владелец добавляет бота во вкладке «Боты» ──
  const code = await createServer(a, 'Метеостанция');
  await joinServer(b, code, 'Метеостанция');
  const serverId = openServerId(a);
  await openServerSettings(a);
  await settingsTab(a, 'Боты').click();
  const modal = a.page.locator('.modal.settings-modal');
  await expect(modal.getByText('На сервере пока нет ботов')).toBeVisible();
  await modal.getByLabel('Имя пользователя бота').fill(`@${username}`);
  await modal.getByRole('button', { name: 'Добавить бота' }).click();
  await expect(a.page.locator('.toast', { hasText: `Бот @${username} добавлен` })).toBeVisible();
  await expect(modal.locator('.manage-row', { hasText: `@${username}` })).toBeVisible();
  // В участниках — с пометкой
  await settingsTab(a, 'Участники').click();
  await expect(modal.locator('.manage-row', { hasText: `@${username}` }).locator('.bot-tag')).toBeVisible();

  // ── Вкладка «Вебхуки»: создать, адрес один раз ──
  await settingsTab(a, 'Вебхуки').click();
  await expect(modal.getByText('Вебхуков пока нет')).toBeVisible();
  await modal.getByLabel('Название').fill('Сборки');
  await modal.getByRole('button', { name: 'Создать вебхук' }).click();
  const urlInput = modal.getByRole('textbox', { name: 'Адрес вебхука', exact: true });
  await expect(urlInput).toBeVisible();
  const hookUrl = await urlInput.inputValue();
  expect(hookUrl).toMatch(/\/api\/v1\/webhooks\/\d+\/[0-9a-f]{48}$/);
  await expect(modal.locator('.manage-row', { hasText: 'Сборки' })).toContainText('#общий');

  await a.page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // Канал «общий» открыт у обоих
  await a.page.locator('.side-item.channel', { hasText: 'общий' }).click();
  await b.page.locator('.side-item.channel', { hasText: 'общий' }).click();
  const channelId = await openChannelId(a);
  // Вкладка-телефон в том же канале: эфемерное сообщение придёт и туда (адресат — пользователь, а не вкладка)
  await phone.goto(a.page.url());
  await expect(phone.locator('.chat-head')).toContainText('общий');

  // Сообщение вебхука: имя вебхука и пометка «Вебхук»
  const hook = await request.post(new URL(hookUrl).pathname, { data: { content: 'Сборка **прошла**' } });
  expect(hook.status()).toBe(204);
  const hookMsg = a.page.locator('.msg', { hasText: 'Сборка прошла' });
  await expect(hookMsg.locator('.msg-author')).toHaveText('Сборки');
  await expect(hookMsg.locator('.bot-tag')).toHaveText('Вебхук');
  await expect(b.page.locator('.msg', { hasText: 'Сборка прошла' }).locator('.bot-tag')).toHaveText('Вебхук');
  // Вебхук — не «моё» сообщение: создатель не может его править
  await hookMsg.hover();
  await expect(hookMsg.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
  // ↑ в пустом поле не открывает правку сообщения своего вебхука (сервер её всё равно не примет)
  await composer(a).click();
  await composer(a).press('ArrowUp');
  await expect(a.page.locator('.edit-box')).toHaveCount(0);

  // ── Эфемерное сообщение: видно только адресату, «Скрыть» убирает ──
  await bot(request, token, 'sendEphemeralMessage', {
    chat_id: channelId,
    user_id: alice.id,
    text: 'Только для Алисы',
    reply_markup: { inline_keyboard: [[{ text: 'Понял', callback_data: 'eph:ok' }]] },
  });
  const eph = a.page.locator('.msg.ephemeral', { hasText: 'Только для Алисы' });
  await expect(eph).toContainText('Видно только вам');
  await expect(eph.locator('.msg-actions')).toHaveCount(0);
  // Кнопка эфемерного сообщения тоже работает
  await eph.getByRole('button', { name: 'Понял' }).click();
  const ephUp = await waitUpdate(request, token, (u) => u.callback_query?.data === 'eph:ok');
  await bot(request, token, 'answerCallbackQuery', { callback_query_id: ephUp.callback_query.id, text: 'Принято' });
  await expect(a.page.locator('.toast', { hasText: 'Принято' })).toBeVisible();

  // Боб его не видит: следующее обычное сообщение бота у него есть, эфемерного — нет
  await bot(request, token, 'sendMessage', { chat_id: channelId, text: 'Всем привет от бота' });
  await expect(b.page.locator('.msg', { hasText: 'Всем привет от бота' })).toBeVisible();
  await expect(b.page.locator('.msg', { hasText: 'Только для Алисы' })).toHaveCount(0);
  // Эфемерное остаётся внизу ленты — под новым сообщением
  const last = a.page.locator('.messages > .msg').last();
  await expect(last).toHaveClass(/ephemeral/);

  await expect(phone.locator('.msg.ephemeral', { hasText: 'Только для Алисы' })).toContainText('Видно только вам');
  await phoneShot(phone, 'bots-ephemeral-390');

  // Настройки сервера на телефоне: «Боты» и «Вебхуки»
  await openNav(phone);
  await phone.locator('.side-head').click();
  await phone.locator('.dropdown button', { hasText: 'Настройки сервера' }).click();
  const phoneModal = phone.locator('.modal.settings-modal');
  await phoneModal.locator('.settings-tabs [role=tab]', { hasText: 'Вебхуки' }).click();
  await expect(phoneModal.locator('.manage-row', { hasText: 'Сборки' })).toBeVisible();
  await phoneShot(phone, 'bots-server-webhooks-390');
  await phoneModal.locator('.settings-tabs [role=tab]', { hasText: 'Боты' }).click();
  await expect(phoneModal.locator('.manage-row', { hasText: `@${username}` })).toBeVisible();
  await phoneShot(phone, 'bots-server-bots-390');
  await phone.keyboard.press('Escape');
  await expect(phoneModal).toHaveCount(0);

  await eph.getByRole('button', { name: 'Скрыть' }).click();
  await expect(a.page.locator('.msg', { hasText: 'Только для Алисы' })).toHaveCount(0);

  // ── Настройки → Боты на телефоне: карточка бота с сервером и командами ──
  await openNav(phone);
  await phone.getByRole('button', { name: 'Настройки', exact: true }).click();
  await phone.locator('.settings-groups button', { hasText: 'Боты' }).click();
  const phoneCard = phone.locator('.settings-page .bot-item', { hasText: `@${username}` });
  await expect(phoneCard).toContainText('Метеостанция');
  await expect(phoneCard).toContainText('/weather /week');
  await phoneShot(phone, 'bots-settings-390');
  await phone.close();

  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(a, 'Боты').click();
  const botCard = a.page.locator('.settings-page .bot-item', { hasText: `@${username}` });

  // Новый токен: старый перестаёт работать
  await botCard.getByRole('button', { name: 'Новый токен' }).click();
  await confirmDialog(a, 'Выпустить новый');
  const token2 = await a.page.getByRole('textbox', { name: 'Токен бота', exact: true }).inputValue();
  expect(token2).not.toBe(token);
  expect((await request.post(`/api/v1/bot${token}/getMe`)).status()).toBe(401);
  expect((await bot(request, token2, 'getMe')).id).toBe(me.id);
  await a.page.getByRole('button', { name: 'Готово', exact: true }).click();

  // Удалить бота
  await botCard.getByRole('button', { name: 'Удалить' }).click();
  await confirmDialog(a, 'Удалить');
  await expect(a.page.locator('.toast', { hasText: `Бот @${username} удалён` })).toBeVisible();
  await expect(a.page.getByText('Ботов пока нет')).toBeVisible();
  expect((await call(request, alice, 'GET', `/servers/${serverId}/bots`)).body.bots).toEqual([]);

  expect(errors).toEqual([]);
});

test('bots UI: photo from a bot is an inline image with lightbox, document is a file card', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const a = await registerUser(browser, 'Зритель');
  const errors = pageErrors(a.page);
  const viewer: ApiUser = await apiUser(request, a);
  const username = `${uniqueName('ph')}_bot`;
  const created = await call(request, viewer, 'POST', '/bots', { username, display_name: 'Фотобот' });
  expect(created.status).toBe(201);
  const token: string = created.body.token;

  // Личка с ботом — кнопкой «Написать» в Настройки → Боты
  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(a, 'Боты').click();
  await a.page.locator('.settings-page .bot-item', { hasText: `@${username}` }).getByRole('button', { name: 'Написать' }).click();
  await expect(a.page.locator('.chat-title', { hasText: 'Фотобот' })).toBeVisible();
  const dmId = await openChannelId(a);

  // sendPhoto multipart, как aiogram (attach://)
  const r = await request.post(`/api/v1/bot${token}/sendPhoto`, {
    multipart: {
      chat_id: String(dmId),
      photo: 'attach://pic',
      caption: 'Закат над рекой',
      pic: { name: 'sunset.png', mimeType: 'image/png', buffer: pngBuffer(160, 90) },
    },
  });
  expect((await r.json()).ok).toBe(true);
  const msg = a.page.locator('.msg', { hasText: 'Закат над рекой' });
  await expect(msg.locator('.msg-meta .bot-tag')).toHaveText('Бот');
  const img = msg.locator('button.attachment img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(160);
  await msg.locator('button.attachment').click();
  const lightbox = a.page.locator('img.lightbox');
  await expect(lightbox).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);

  // sendDocument — карточка файла с именем
  const d = await request.post(`/api/v1/bot${token}/sendDocument`, {
    multipart: { chat_id: String(dmId), document: { name: 'прогноз.txt', mimeType: 'text/plain', buffer: Buffer.from('ясно, +20') } },
  });
  expect((await d.json()).ok).toBe(true);
  await expect(a.page.locator('.attachment-file', { hasText: 'прогноз.txt' })).toBeVisible();
  expect(errors).toEqual([]);
  await a.context.close();
});
