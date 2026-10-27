import { expect, test } from '@playwright/test';
import { createServer, joinServer, makeFriends, openDm, pageErrors, registerUser, send } from './helpers';
import { apiUser, call } from './w1-helpers';

// Главная: сводка «Пока вас не было», статистика, «Сейчас», «Стоит внимания», предложения (docs/API.md §19)
test('home: digest from facts, stats, attention and friend suggestions', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const c = await registerUser(browser, 'Вера');
  await makeFriends(a, b);
  await openDm(b, a);
  await send(b, 'привет, глянь главную');
  await send(b, 'и ещё раз');
  const code = await createServer(a, 'Пятница');
  await joinServer(c, code, 'Пятница');

  // API: факты собраны, без ключа сводка шаблонная
  const alice = await apiUser(request, a);
  const r = await call(request, alice, 'GET', '/home');
  expect(r.status).toBe(200);
  expect(r.body.digest.source).toBe('rules');
  expect(r.body.digest.text).toContain('в личке с Борис');
  expect(r.body.stats.messages).toBe(2);
  expect(r.body.stats.friends).toBe(1);
  expect(r.body.channels[0]).toMatchObject({ kind: 'dm', name: 'Борис', messages: 2 });
  // Вера с общего сервера — в предложениях, Борис (друг) — нет
  expect(r.body.suggestions.map((s: { display_name: string }) => s.display_name)).toEqual(['Вера']);

  // Экран
  await a.page.getByRole('button', { name: 'Главная' }).click();
  await expect(a.page).toHaveURL(/\/home$/);
  const home = a.page.getByRole('region', { name: 'Главная' });
  await expect(home.getByRole('heading', { name: 'Пока вас не было' })).toBeVisible();
  await expect(home.getByRole('region', { name: 'Пока вас не было' })).toContainText('в личке с Борис');
  await home.getByRole('button', { name: 'Развернуть сводку' }).click();
  await expect(home.getByRole('button', { name: 'Свернуть' })).toBeVisible();
  await expect(home.getByRole('region', { name: 'Статистика за сутки' })).toContainText('сообщений за сутки');
  await expect(home.getByRole('region', { name: 'Стоит внимания' })).toContainText('Борис');
  await expect(home.getByRole('region', { name: 'Что нового' })).toContainText('Главная');
  // Предложение «В друзья» уходит заявкой
  const sug = home.getByRole('region', { name: 'Предложения' });
  await expect(sug).toContainText('Вера');
  await sug.getByRole('button', { name: 'В друзья' }).click();
  await expect(a.page.locator('.toast', { hasText: 'Заявка отправлена' })).toBeVisible();
  await expect(sug).not.toContainText('Вера');
  // Перезагрузка по прямой ссылке открывает главную
  await a.page.reload();
  await expect(home.getByRole('heading', { name: 'Пока вас не было' })).toBeVisible();
  expect(pageErrors(a.page)).toEqual([]);
});
