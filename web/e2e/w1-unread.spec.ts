import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser } from './helpers';
import { addTextChannel, apiRegister, apiUser, call, msg, openChannelId, post } from './w1-helpers';

test('server-side unread: mention badges, bold channels, restore after reload, read sync between tabs', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Непрочитанное');
  await addTextChannel(a, 'второй');
  await joinServer(b, code, 'Непрочитанное');
  await b.page.locator('.side-item.channel', { hasText: 'второй' }).click();
  const second = await openChannelId(b);
  const bob = await apiUser(request, b);
  const rail = a.page.locator('.rail-item[title="Непрочитанное"]');

  // Алиса на главной: обычное сообщение — только отметка у сервера, без красного бейджа
  await a.page.locator('.rail-item.home').click();
  await post(request, bob, second, 'обычное сообщение');
  await expect(rail).toHaveClass(/has-unread/);
  await expect(rail.locator('.badge')).toHaveCount(0);
  await expect(a.page).toHaveTitle('Vicinity');

  // Упоминание — красный бейдж у сервера, счётчик во вкладке
  await post(request, bob, second, `@${a.username} посмотри сюда`);
  await expect(rail.locator('.badge')).toHaveText('1');
  await expect(a.page).toHaveTitle('(1) Vicinity');

  // На сервере: «второй» жирный с бейджем упоминаний, открытый «общий» — нет
  await rail.click();
  const secondItem = a.page.locator('.side-item.channel', { hasText: 'второй' });
  await expect(secondItem).toHaveClass(/unread/);
  await expect(secondItem.locator('.badge.mention')).toHaveText('@1');
  await expect(a.page.locator('.side-item.channel', { hasText: 'общий' })).not.toHaveClass(/unread/);

  // После перезагрузки счётчики приходят с сервера (GET /unread)
  await a.page.reload();
  await expect(secondItem).toHaveClass(/unread/);
  await expect(secondItem.locator('.badge.mention')).toHaveText('@1');

  // Вторая вкладка того же пользователя видит то же самое
  const tab2 = await a.context.newPage();
  await tab2.goto('/');
  const secondItem2 = tab2.locator('.side-item.channel', { hasText: 'второй' });
  await expect(secondItem2.locator('.badge.mention')).toHaveText('@1');

  // Открыли канал в первой вкладке: черта «Новые» перед первым непрочитанным, отметка прочтения
  // уходит на сервер, и вторая вкладка гасит счётчики (read_state)
  await secondItem.click();
  const sep = a.page.locator('.unread-sep');
  await expect(sep).toBeVisible();
  expect(
    await sep.evaluate((el) => el.nextElementSibling?.textContent?.includes('обычное сообщение') ?? false),
  ).toBe(true);
  await expect(secondItem2).not.toHaveClass(/unread/);
  await expect(secondItem2.locator('.badge')).toHaveCount(0);
  await expect(tab2).toHaveTitle('Vicinity');

  // Личка: бейдж в обеих вкладках, прочитали в одной — гаснет в другой
  const dm = (await call(request, bob, 'POST', '/dms', { user_id: (await apiUser(request, a)).id })).body.channel_id;
  await post(request, bob, dm, 'личное сообщение');
  await expect(a.page.locator('.rail-item.home .badge')).toHaveText('1');
  await expect(tab2.locator('.rail-item.home .badge')).toHaveText('1');
  await a.page.locator('.rail-item.home').click();
  await a.page.locator('.side-item', { hasText: 'Боб' }).click();
  await expect(msg(a, 'личное сообщение')).toBeVisible();
  await expect(tab2.locator('.rail-item.home .badge')).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(tab2)).toEqual([]);
});

test('long unread history: "new messages" pill, jump to present when scrolled up', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const code = await createServer(a, 'Длинный');
  const general = await openChannelId(a);
  const carol = await apiRegister(request, 'Кира');
  const dan = await apiRegister(request, 'Данила');
  for (const u of [carol, dan]) expect((await call(request, u, 'POST', '/servers/join', { code })).status).toBe(200);
  await a.page.locator('.rail-item.home').click();
  for (let i = 0; i < 40; i++) await post(request, i % 2 ? carol : dan, general, `непрочитанное номер ${i}`);
  await expect(a.page.locator('.rail-item[title="Длинный"]')).toHaveClass(/has-unread/);

  // Канал открывается внизу; черта «Новые» выше экрана — плашка ведёт к ней
  await a.page.locator('.rail-item[title="Длинный"]').click();
  await expect(msg(a, 'непрочитанное номер 39')).toBeInViewport();
  const pill = a.page.locator('.unread-pill');
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(a.page.locator('.unread-sep')).toBeInViewport();
  await expect(a.page.locator('.unread-sep + .msg')).toContainText('непрочитанное номер 0');
  await expect(pill).toHaveCount(0);

  // Пролистали вверх — «Перейти к последним» возвращает вниз
  const back = a.page.locator('.jump-present');
  await expect(back).toBeVisible();
  await back.getByRole('button', { name: /Перейти к последним/ }).click();
  await expect(msg(a, 'непрочитанное номер 39')).toBeInViewport();
  await expect(back).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});
