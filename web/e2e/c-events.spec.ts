import { APIRequestContext, expect, test } from '@playwright/test';
import {
  controlSocket,
  createGroup,
  createServer,
  joinServer,
  pageErrors,
  registerUser,
  send,
  tokenOf,
  uniqueName,
  User,
} from './helpers';

// Новые типы событий (docs/API.md §7, §8, §10, §12) старый бэкенд ещё не рассылает —
// подаём их странице через перехват WebSocket, а изменения на сервере делаем обычным REST.

async function apiUser(request: APIRequestContext, displayName: string) {
  const username = uniqueName('api');
  const r = await request.post('/api/v1/auth/register', { data: { username, password: 'password123', display_name: displayName } });
  expect(r.ok()).toBe(true);
  const { token, user_id } = await r.json();
  return { username, token: token as string, id: user_id as number };
}

async function userId(request: APIRequestContext, u: User): Promise<number> {
  const r = await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${await tokenOf(u)}` } });
  return (await r.json()).user_id;
}

test('new server/user/channel events update the UI without a reload', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Старое имя');
  await joinServer(b, code, 'Старое имя');
  await send(b, 'привет от Боба');
  await expect(a.page.locator('.members .member', { hasText: 'Боб' })).toBeVisible();
  const serverId: number = await a.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.view')!).serverId);
  const aliceId = await userId(request, a);
  const bobId = await userId(request, b);

  const sock = await controlSocket(a);
  await expect(a.page.locator('.side-head', { hasText: 'Старое имя' })).toBeVisible();

  // server_updated
  sock.inject({ type: 'server_updated', server_id: serverId, name: 'Новое имя', icon: '' });
  await expect(a.page.locator('.side-head', { hasText: 'Новое имя' })).toBeVisible();
  await expect(a.page.locator('.rail-item[title="Новое имя"]')).toBeVisible();

  // user_updated: имя меняется в участниках и в уже загруженных сообщениях
  sock.inject({ type: 'user_updated', user_id: bobId, display_name: 'Борис', avatar_path: '', accent_color: '#123456' });
  await expect(a.page.locator('.members .member', { hasText: 'Борис' })).toBeVisible();
  await expect(a.page.locator('.msg', { hasText: 'привет от Боба' }).locator('.msg-author')).toHaveText('Борис');

  // server_channels_changed: канал создан через REST, событие подтягивает список
  const created = await request.post(`/api/v1/servers/${serverId}/channels`, {
    headers: { Authorization: `Bearer ${await tokenOf(a)}` },
    data: { name: 'новости', is_voice: 0 },
  });
  expect(created.ok()).toBe(true);
  await expect(a.page.locator('.side-item', { hasText: 'новости' })).toHaveCount(0);
  sock.inject({ type: 'server_channels_changed', server_id: serverId });
  await expect(a.page.locator('.side-item', { hasText: 'новости' })).toBeVisible();

  // server_member_joined: вступивший по коду появляется в списке участников
  const c = await apiUser(request, 'Ваня');
  expect((await request.post('/api/v1/servers/join', { headers: { Authorization: `Bearer ${c.token}` }, data: { code } })).ok()).toBe(true);
  sock.inject({ type: 'server_member_joined', server_id: serverId, user_id: c.id });
  await expect(a.page.locator('.members .member', { hasText: 'Ваня' })).toBeVisible();

  // server_member_left: ушедший исчезает
  sock.inject({ type: 'server_member_left', server_id: serverId, user_id: bobId });
  await expect(a.page.locator('.members .member', { hasText: 'Борис' })).toHaveCount(0);

  // call_unavailable: подсказка вместо бесконечного ожидания
  sock.inject({ type: 'call_unavailable', user_id: c.id });
  await expect(a.page.locator('.toast.error', { hasText: 'Ваня сейчас не в сети' })).toBeVisible();

  // channel_updated + channel_removed для беседы, открытой на экране
  await createGroup(a, 'Беседа');
  const groupId: number = await a.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.view')!).channelId);
  sock.inject({ type: 'channel_updated', channel_id: groupId, name: 'Переименованная' });
  await expect(a.page.locator('.side-item', { hasText: 'Переименованная' })).toBeVisible();
  await expect(a.page.locator('.chat-title', { hasText: 'Переименованная' })).toBeVisible();
  sock.inject({ type: 'channel_removed', channel_id: groupId });
  await expect(a.page.locator('.side-item', { hasText: 'Переименованная' })).toHaveCount(0);
  await expect(a.page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();
  await expect(a.page.locator('.toast', { hasText: 'больше недоступна' })).toBeVisible();

  // server_member_left про себя: сервер пропадает из рейки
  sock.inject({ type: 'server_member_left', server_id: serverId, user_id: aliceId });
  await expect(a.page.locator('.rail-item[title="Новое имя"]')).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
});
