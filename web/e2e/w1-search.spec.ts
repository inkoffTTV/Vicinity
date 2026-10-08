import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, registerUser } from './helpers';
import { addTextChannel, apiUser, call, msg, openChannelId, post } from './w1-helpers';

test('search: Ctrl+F, scopes channel/server/everywhere, highlighted matches, jump to a result in another chat', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Поисковый');
  const general = await openChannelId(a);
  await addTextChannel(a, 'второй');
  await joinServer(b, code, 'Поисковый');
  await b.page.locator('.side-item.channel', { hasText: 'второй' }).click();
  const second = await openChannelId(b);
  const alice = await apiUser(request, a);
  const bob = await apiUser(request, b);
  const dm = (await call(request, bob, 'POST', '/dms', { user_id: alice.id })).body.channel_id;
  await post(request, bob, general, 'искомая фраза в общем канале, ИСКОМАЯ ещё раз');
  await post(request, bob, general, 'посторонний текст');
  await post(request, bob, second, 'искомая фраза во втором канале');
  await post(request, bob, dm, 'а вот искомая фраза в личке');
  await a.page.locator('.side-item.channel', { hasText: 'общий' }).click();
  await expect(msg(a, 'посторонний текст')).toBeVisible();

  // Ctrl+F — в поле поиска; слишком короткий запрос
  await a.page.keyboard.press('Control+f');
  const box = a.page.getByRole('searchbox', { name: 'Поиск по сообщениям' });
  await expect(box).toBeFocused();
  await box.fill('и');
  await box.press('Enter');
  const panel = a.page.locator('.search-panel');
  await expect(panel).toContainText('Введите хотя бы 2 символа');

  // В канале — одно совпадение, все вхождения подсвечены (подсветка — без учёта регистра)
  await box.fill('искомая');
  await box.press('Enter');
  await expect(panel.getByRole('radio', { name: 'В канале' })).toHaveAttribute('aria-checked', 'true');
  const hits = panel.locator('.search-hit');
  await expect(hits).toHaveCount(1);
  await expect(hits.first().locator('mark')).toHaveText(['искомая', 'ИСКОМАЯ']);
  await expect(hits.first()).toContainText('Поисковый › #общий');
  // Список участников уступает место результатам
  await expect(a.page.locator('.members')).toHaveCount(0);

  // На сервере — оба канала; везде — ещё и личка
  await panel.getByRole('radio', { name: 'На сервере' }).click();
  await expect(hits).toHaveCount(2);
  await panel.getByRole('radio', { name: 'Везде' }).click();
  await expect(hits).toHaveCount(3);
  await expect(panel.locator('.search-panel-head')).toContainText('3 результата');

  // Переход к результату в другом чате: личка открывается, сообщение подсвечено
  await hits.filter({ hasText: 'в личке' }).getByRole('button', { name: 'Перейти' }).click();
  await expect(a.page.locator('.chat-title', { hasText: 'Боб' })).toBeVisible();
  await expect(msg(a, 'а вот искомая фраза в личке')).toHaveClass(/flash/);
  // Результаты остаются, можно перейти к следующему
  await hits.filter({ hasText: 'во втором' }).click();
  await expect(a.page.locator('.side-item.channel.active', { hasText: 'второй' })).toBeVisible();
  await expect(msg(a, 'искомая фраза во втором канале')).toHaveClass(/flash/);

  // Esc в поле закрывает поиск
  await box.focus();
  await box.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(box).toHaveValue('');

  // С главной — только «везде»
  await a.page.locator('.rail-item.home').click();
  await box.fill('фраза');
  await box.press('Enter');
  await expect(hits).toHaveCount(3);
  await expect(panel.getByRole('radio')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Закрыть поиск' }).click();
  await expect(panel).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});
