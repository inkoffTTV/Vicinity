import { expect, test } from '@playwright/test';
import { createServer, joinServer, makeFriends, pageErrors, registerUser } from './helpers';
import { apiUser, call } from './w1-helpers';
import { settingsTab } from './w2-helpers';

// Приватность по элементам профиля с исключениями (docs/API.md §15): кому видно + «не показывать» / «всегда показывать»
test('profile privacy: per-element rules with exceptions, hide everything from one person', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  const c = await registerUser(browser, 'Вера');
  await makeFriends(a, b);
  // Вера не друг, но с общего сервера: профиль ей виден, а «только друзьям» — нет
  const code = await createServer(a, 'Пятница');
  await joinServer(c, code, 'Пятница');
  const alice = await apiUser(request, a);
  const boris = await apiUser(request, b);
  const vera = await apiUser(request, c);

  // Алиса заполняет профиль: «о себе», вишлист, игры, интеграции
  await call(request, alice, 'POST', '/profile/bio', { bio: 'Люблю котов' });
  const extras = {
    connections: [{ type: 'steam', name: 'alice', url: 'https://steamcommunity.com/id/alice' }],
    widgets: { favorite_game: null, games: [{ appid: 570, name: 'Игра А' }], wishlist: [{ appid: 730, name: 'Игра Б' }], order: [] },
  };
  expect((await call(request, alice, 'POST', '/profile/extras', extras)).status).toBe(200);

  const profile = async (who: typeof boris) => (await call(request, who, 'GET', `/users/${alice.id}/profile`)).body;
  // По умолчанию всё видно и другу, и незнакомой
  expect((await profile(boris)).profile_ext.widgets.wishlist).toHaveLength(1);
  expect((await profile(vera)).bio).toBe('Люблю котов');

  // Вишлист только друзьям, но не Борису; «о себе» — никому, кроме Веры
  const r = await call(request, alice, 'PATCH', '/settings/privacy', {
    rules: { wishlist: { who: 'friends', hide_from: [boris.id] }, about: { who: 'nobody', show_to: [vera.id] } },
  });
  expect(r.status).toBe(200);
  expect(r.body.rules.wishlist).toMatchObject({ who: 'friends', hide_from: [boris.id], show_to: [] });
  expect(r.body.rules.about).toMatchObject({ who: 'nobody', show_to: [vera.id] });
  const forBoris = await profile(boris);
  expect(forBoris.profile_ext.widgets.wishlist).toEqual([]);
  expect(forBoris.bio).toBe('');
  expect(forBoris.hidden).toEqual(expect.arrayContaining(['about', 'wishlist']));
  expect(forBoris.profile_ext.connections).toHaveLength(1); // интеграции не трогали
  const forVera = await profile(vera);
  expect(forVera.bio).toBe('Люблю котов'); // всегда показывать
  expect(forVera.profile_ext.widgets.wishlist).toEqual([]); // не друг
  // Сама себе Алиса видит всё
  expect((await profile(alice)).profile_ext.widgets.wishlist).toHaveLength(1);

  // Скрыть профиль целиком от Веры
  await call(request, alice, 'PATCH', '/settings/privacy', { rules: { all: { hide_from: [vera.id] } } });
  const nothing = await profile(vera);
  expect(nothing.bio).toBe('');
  expect(nothing.profile_ext.connections).toEqual([]);
  expect(nothing.profile_ext.widgets.games).toEqual([]);
  expect(nothing.activity.hidden).toBe(true);
  expect(nothing.hidden).toEqual(expect.arrayContaining(['about', 'banner', 'wishlist', 'games', 'music', 'connections']));
  // Своё id в исключениях и мусор — отбрасываются; неверные значения — 400
  const self = await call(request, alice, 'PATCH', '/settings/privacy', { rules: { music: { hide_from: [alice.id, 'x', -1, boris.id] } } });
  expect(self.body.rules.music.hide_from).toEqual([boris.id]);
  expect((await call(request, alice, 'PATCH', '/settings/privacy', { rules: { games: { who: 'secret' } } })).status).toBe(400);
  expect((await call(request, alice, 'PATCH', '/settings/privacy', { rules: { all: { who: 'friends' } } })).status).toBe(400);
  // Старые поля и who правил — одно и то же
  const legacy = await call(request, alice, 'PATCH', '/settings/privacy', { stats: 'friends' });
  expect(legacy.body.rules.stats.who).toBe('friends');

  // Экран настроек: правило вишлиста и исключение Бориса видны, можно добавить Веру в «не показывать» у интеграций
  await a.page.getByTitle('Настройки').click();
  await settingsTab(a, 'Приватность').click();
  const wishlist = a.page.locator('.privacy-element[data-key="wishlist"]');
  await expect(wishlist.getByRole('combobox', { name: 'Вишлист: кому видно' })).toHaveValue('friends');
  await expect(wishlist.getByRole('group', { name: 'Не показывать' })).toContainText('Борис');
  const conn = a.page.locator('.privacy-element[data-key="connections"]');
  await conn.getByRole('button', { name: 'Добавить' }).click();
  await conn.getByRole('searchbox').fill('Вер');
  await conn.getByRole('option', { name: /Вера/ }).click();
  await expect(conn.getByRole('group', { name: 'Не показывать' })).toContainText('Вера');
  await expect.poll(async () => (await call(request, alice, 'GET', '/settings/privacy')).body.rules.connections.hide_from).toEqual([vera.id]);
  // Убрать Бориса из исключений вишлиста
  await wishlist.getByRole('button', { name: 'Убрать Борис' }).click();
  await expect.poll(async () => (await call(request, alice, 'GET', '/settings/privacy')).body.rules.wishlist.hide_from).toEqual([]);
  expect(pageErrors(a.page)).toEqual([]);
});
