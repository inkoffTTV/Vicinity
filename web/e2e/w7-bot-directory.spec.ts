import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { apiRegister, apiUser, call } from './w1-helpers';
import { bot, createBot, setTheme, shot, waitUpdate } from './w6-helpers';

// Каталог ботов и кнопка «Начать» (SPEC3, docs/API.md §21.9): раздел «Боты» в навигации → поиск → страница бота →
// «Написать» → в пустой личке карточка бота и «Начать» → бот получает /start → появляется поле ввода.
// Ссылка /bots/<username>?start=abc → «/start abc». Настройки → Боты: «Показывать в каталоге».

test('каталог ботов: поиск, страница бота, «Написать» → «Начать» → /start, затем поле ввода', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await apiRegister(request, 'Автор ботов');
  const weather = await createBot(request, owner, 'Синоптик');
  await bot(request, weather.token, 'setMyDescription', {
    description: 'Покажу прогноз погоды в любом городе.\nНапишите /weather и название города.',
  });
  await bot(request, weather.token, 'setMyShortDescription', { short_description: 'Погода в любом городе за секунду' });
  await bot(request, weather.token, 'setMyCommands', {
    commands: [
      { command: 'weather', description: 'Погода в городе' },
      { command: 'help', description: 'Что умеет бот' },
    ],
  });
  expect((await call(request, owner, 'PATCH', `/bots/${weather.id}`, { is_public: true })).status).toBe(200);

  const a = await registerUser(browser, 'Алиса');
  const errors = pageErrors(a.page);
  const page = a.page;

  // ── Раздел «Боты» в рейке ──
  await page.getByRole('button', { name: 'Боты', exact: true }).first().click();
  await expect(page).toHaveURL(/\/bots$/);
  const search = page.getByRole('searchbox', { name: 'Поиск ботов' });
  await expect(search).toBeVisible();
  await search.fill(weather.username.slice(0, 10));
  const card = page.locator('.bots-dir-card', { hasText: `@${weather.username}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Погода в любом городе за секунду');
  await expect(page.locator('.bots-dir-section', { has: card }).locator('h2')).toContainText('Каталог');
  // Поиск по описанию и без совпадений
  await search.fill('ПРОГНОЗ ПОГОДЫ');
  await expect(card).toBeVisible();
  await search.fill('такого бота точно нет 12345');
  await expect(page.locator('.bots-dir-empty')).toContainText('Таких ботов не нашлось');
  await search.fill(weather.username);
  await expect(card).toBeVisible();
  await setTheme(page, 'light');
  await shot(page, 'directory-desktop-light');
  await setTheme(page, 'dark');
  await shot(page, 'directory-desktop-dark');

  // ── Страница бота ──
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/bots/${weather.username}$`));
  const botPage = page.locator('.bot-page');
  await expect(botPage.locator('.bot-page-name')).toContainText('Синоптик');
  await expect(botPage.locator('.bot-page-desc')).toContainText('Покажу прогноз погоды в любом городе.');
  await expect(botPage.locator('.bot-commands li')).toHaveText(['/weatherПогода в городе', '/helpЧто умеет бот']);
  // Владелец не показан незнакомому человеку; «Добавить на сервер» — только если у вас есть свой сервер
  await expect(botPage.getByRole('region', { name: 'Владелец' })).toHaveCount(0);
  await expect(botPage.getByRole('button', { name: 'Добавить на сервер' })).toHaveCount(0);
  // «Поделиться» копирует ссылку на страницу бота
  await a.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await botPage.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('.toast', { hasText: 'Ссылка на бота скопирована' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/bots/${weather.username}`);
  await shot(page, 'bot-page-desktop-dark');
  await setTheme(page, 'light');
  await shot(page, 'bot-page-desktop-light');
  await setTheme(page, 'dark');

  // ── «Написать» → пустая личка: карточка бота и «Начать» вместо поля ввода ──
  await botPage.getByRole('button', { name: 'Написать' }).click();
  await expect(page).toHaveURL(/\/channels\/@me\/\d+$/);
  const intro = page.locator('.bot-intro');
  await expect(intro).toContainText('Что умеет этот бот?');
  await expect(intro).toContainText('Напишите /weather и название города.');
  await expect(intro.locator('.bot-commands li')).toHaveCount(2);
  const startBtn = page.getByRole('button', { name: 'Начать', exact: true });
  await expect(startBtn).toBeVisible();
  await expect(page.locator('.composer textarea')).toHaveCount(0);
  await shot(page, 'dm-start-desktop-dark');
  await setTheme(page, 'light');
  await shot(page, 'dm-start-desktop-light');
  await setTheme(page, 'dark');

  await startBtn.click();
  const up = await waitUpdate(request, weather.token, (u) => u.message?.text === '/start');
  expect(up.message.entities).toEqual([{ type: 'bot_command', offset: 0, length: 6 }]);
  await expect(startBtn).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toBeVisible();
  await expect(intro).toHaveCount(0);
  // Бот ответил — обычная переписка
  const ch = up.message.chat.id;
  await bot(request, weather.token, 'sendMessage', { chat_id: ch, text: 'Привет! Какой город?' });
  await expect(page.locator('.msg-text', { hasText: 'Привет! Какой город?' })).toBeVisible();
  // После перезагрузки «Начать» не возвращается (сервер помнит, что вы уже писали)
  await page.reload();
  await expect(page.locator('.composer textarea')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0);

  // В каталоге бот теперь в разделе «Есть личка»
  await page.locator('.side-item', { hasText: 'Боты' }).click();
  await page.getByRole('searchbox', { name: 'Поиск ботов' }).fill(weather.username);
  await expect(page.locator('.bots-dir-section', { has: page.locator('.bots-dir-card', { hasText: `@${weather.username}` }) }).locator('h2')).toContainText(
    'Есть личка',
  );
  expect(errors).toEqual([]);
});

test('ссылка /bots/<username>?start=abc: «Начать» отправляет «/start abc»; «Написать своё сообщение» не блокирует', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const owner = await apiRegister(request, 'Автор');
  const shop = await createBot(request, owner, 'Магазин');
  // Приватный бот: по ссылке его страница не откроется у незнакомого — сначала проверим это
  const a = await registerUser(browser, 'Борис');
  const errors = pageErrors(a.page);
  const page = a.page;
  await page.goto(`/bots/${shop.username}?start=abc`);
  await expect(page.locator('.bots-dir-empty')).toContainText('не найден');

  expect((await call(request, owner, 'PATCH', `/bots/${shop.id}`, { is_public: true })).status).toBe(200);
  await page.goto(`/bots/${shop.username}?start=abc`);
  await expect(page.locator('.bot-page-name')).toContainText('Магазин');
  await expect(page.locator('.bot-page-note')).toContainText('/start abc');
  // Пока карточка бота грузится — ни поля ввода с фокусом, ни «напишите первым», а заглушка на месте «Начать»
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/v1/bots/by-username/**', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('.bot-page').getByRole('button', { name: 'Написать', exact: true }).click();
  await expect(page).toHaveURL(/\/channels\/@me\/\d+$/);
  await expect(page.locator('.bot-start-wait')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('.composer textarea')).toHaveCount(0);
  await expect(page.getByText('напишите первым')).toHaveCount(0);
  release(); // дальше запросы карточки идут без задержки
  await expect(page.locator('.bot-start-wait')).toHaveCount(0);
  // Пустое описание — понятная подсказка
  await expect(page.locator('.bot-intro')).toContainText('Бот пока ничего о себе не рассказал. Нажмите «Начать»');
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  const up = await waitUpdate(request, shop.token, (u) => typeof u.message?.text === 'string' && u.message.text.startsWith('/start'));
  expect(up.message.text).toBe('/start abc');
  await expect(page.locator('.composer textarea')).toBeVisible();

  // Неправильный payload (пробел, слишком длинный) — просто «/start»
  const other = await createBot(request, owner, 'Второй');
  await call(request, owner, 'PATCH', `/bots/${other.id}`, { is_public: true });
  await page.goto(`/bots/${other.username}?start=${'x'.repeat(65)}`);
  await expect(page.locator('.bot-page-note')).toHaveCount(0);
  await page.locator('.bot-page').getByRole('button', { name: 'Написать', exact: true }).click();
  // «Написать своё сообщение» открывает обычное поле ввода, не дожидаясь «Начать»
  await page.getByRole('button', { name: 'Написать своё сообщение' }).click();
  const box = page.locator('.composer textarea');
  await box.fill('Здравствуйте, сколько стоит доставка?');
  await box.press('Enter');
  const first = await waitUpdate(request, other.token, (u) => !!u.message?.text);
  expect(first.message.text).toBe('Здравствуйте, сколько стоит доставка?');

  // Ссылка внутри приложения (из сообщения) открывает страницу бота без перезагрузки и тоже помнит payload
  await page.evaluate(() => ((window as any).__noReload = true));
  await page.evaluate((u) => window.dispatchEvent(new CustomEvent('vicinity-open', { detail: `/bots/${u}?start=promo_2` })), other.username);
  await expect(page.locator('.bot-page-note')).toContainText('/start promo_2');
  expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  // Диалог уже начат, но ссылка с параметром: «Начать» снова есть и отправляет «/start promo_2»
  await page.locator('.bot-page').getByRole('button', { name: 'Написать', exact: true }).click();
  const again = page.getByRole('button', { name: 'Начать', exact: true });
  await expect(again).toBeVisible();
  await expect(page.locator('.bot-intro')).toHaveCount(0);
  await again.click();
  const promo = await waitUpdate(request, other.token, (u) => typeof u.message?.text === 'string' && u.message.text.startsWith('/start'));
  expect(promo.message.text).toBe('/start promo_2');
  await expect(again).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toBeVisible();
  expect(errors).toEqual([]);
});

test('заблокированный бот: понятный текст и путь к профилю; разблокировка из лички сразу возвращает «Начать»', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const owner = await apiRegister(request, 'Автор');
  const mute = await createBot(request, owner, 'Молчун');
  await call(request, owner, 'PATCH', `/bots/${mute.id}`, { is_public: true });
  const a = await registerUser(browser, 'Глеб');
  const errors = pageErrors(a.page);
  const page = a.page;
  const me = await apiUser(request, a);
  const ch = (await call(request, me, 'POST', '/dms', { user_id: mute.id })).body.channel_id as number;
  expect((await call(request, me, 'POST', `/users/${mute.id}/block`)).status).toBe(200);

  // Страница бота: что случилось и что делать
  await page.goto(`/bots/${mute.username}`);
  const note = page.locator('.bot-page-blocked');
  await expect(note).toContainText('Вы заблокировали этого бота — разблокируйте его в профиле, чтобы написать.');
  await expect(page.locator('.bot-page').getByRole('button', { name: 'Написать', exact: true })).toBeDisabled();
  await expect(note.getByRole('button', { name: 'Открыть профиль' })).toBeVisible();

  // Личка: «Начать» нет — и карточка не зовёт её нажать
  await page.goto(`/channels/@me/${ch}`);
  await expect(page.locator('.bot-intro')).toContainText('Бот пока ничего о себе не рассказал.');
  await expect(page.locator('.bot-intro')).not.toContainText('Нажмите «Начать»');
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0);
  await expect(page.locator('.chat > .bot-start-note')).toContainText('Вы заблокировали этого бота');

  // Разблокировали из профиля поверх лички — без перехода в другой чат
  await page.locator('.chat-title.clickable').click();
  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(page.locator('.toast', { hasText: 'разблокирован' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
  await expect(page.locator('.chat > .bot-start-note')).toHaveCount(0);
  await expect(page.locator('.bot-intro')).toContainText('Нажмите «Начать», чтобы узнать.');
  expect(errors).toEqual([]);
});

test('Настройки → Боты: «Показывать в каталоге» и описание; телефон 390px без прокрутки вбок', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const a = await registerUser(browser, 'Вера', { viewport: { width: 390, height: 844 } });
  const errors = pageErrors(a.page);
  const page = a.page;
  const me = await apiUser(request, a);
  const mine = await createBot(request, me, 'Мой помощник');
  const stranger = await apiRegister(request, 'Посторонний');
  const dirOf = async () => (await call(request, stranger, 'GET', `/bots/directory?q=${mine.username}`)).body.bots as any[];
  expect(await dirOf()).toEqual([]);

  // ── Телефон: «Боты» в меню навигации ──
  await page.locator('.menu-btn:visible').first().click();
  await page.locator('.rail-item.bots').click();
  await expect(page.getByRole('searchbox', { name: 'Поиск ботов' })).toBeVisible();
  await expect(page.locator('.bots-dir-card', { hasText: `@${mine.username}` })).toBeVisible();
  await expect(page.locator('.bots-dir-card', { hasText: `@${mine.username}` })).toContainText('Ваш бот');
  await setTheme(page, 'light');
  await shot(page, 'directory-390-light');
  await setTheme(page, 'dark');
  await shot(page, 'directory-390-dark');

  // «Создать бота» из каталога открывает Настройки → Боты
  await page.getByRole('button', { name: 'Создать бота' }).first().click();
  const item = page.locator('.bot-item', { hasText: `@${mine.username}` });
  await expect(item).toBeVisible();
  const flag = item.getByRole('switch', { name: /Показывать в каталоге/ });
  await expect(flag).toHaveJSProperty('checked', false);
  await flag.click();
  await expect(flag).toHaveJSProperty('checked', true);
  await expect.poll(async () => (await dirOf()).map((x) => x.id)).toEqual([mine.id]);

  // Описание из настроек видно постороннему в карточке
  await item.getByLabel('Короткое описание').fill('Помогаю с делами');
  await item.getByLabel('Что умеет этот бот?').fill('Напоминаю о задачах.\nКоманда /todo');
  await item.getByRole('button', { name: 'Сохранить описание' }).click();
  await expect(page.locator('.toast', { hasText: 'Описание сохранено' })).toBeVisible();
  expect((await dirOf())[0].short_description).toBe('Помогаю с делами');
  expect(await bot(request, mine.token, 'getMyDescription')).toEqual({ description: 'Напоминаю о задачах.\nКоманда /todo' });
  await shot(page, 'settings-bots-390-dark');

  await flag.click();
  await expect(flag).toHaveJSProperty('checked', false);
  await expect.poll(async () => (await dirOf()).length).toBe(0);

  // ── Страница бота и личка с «Начать» на телефоне ──
  await page.goto(`/bots/${mine.username}`);
  await expect(page.locator('.bot-page-desc')).toContainText('Напоминаю о задачах.');
  await expect(page.locator('.bot-page').getByRole('region', { name: 'Владелец' })).toContainText('Вы');
  await setTheme(page, 'light');
  await shot(page, 'bot-page-390-light');
  await setTheme(page, 'dark');
  await shot(page, 'bot-page-390-dark');
  await page.locator('.bot-page').getByRole('button', { name: 'Написать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
  await shot(page, 'dm-start-390-dark');
  await setTheme(page, 'light');
  await shot(page, 'dm-start-390-light');
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await waitUpdate(request, mine.token, (u) => u.message?.text === '/start');
  await expect(page.locator('.composer textarea')).toBeVisible();
  expect(errors).toEqual([]);
});
