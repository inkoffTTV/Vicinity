import { expect, test } from '@playwright/test';
import { createServer, makeFriends, openDm, registerUser, tokenOf } from './helpers';

const API = `http://localhost:${process.env.VICINITY_E2E_PORT ?? 18080}/api/v1`;

// Личный фон в личке виден только тому, кто поставил; собеседник ставит его себе по предложению
test('personal chat background and proposal', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Борис');
  await makeFriends(b, a);
  await openDm(a, b);
  await openDm(b, a);

  await a.page.locator('.chat-head').getByRole('button', { name: 'Фон чата' }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Фон чата' });
  await dialog.getByRole('button', { name: 'Лагуна' }).click();
  await expect(dialog.getByRole('button', { name: 'Лагуна' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Сохранить и предложить собеседнику' }).click();
  await expect(a.page.locator('.chat-bg')).toHaveCount(1);
  await expect(a.page.locator('.toast', { hasText: 'Фон установлен' })).toBeVisible();

  // У Бориса фона нет, есть предложение
  const proposal = b.page.locator('.bg-proposal');
  await expect(proposal).toBeVisible();
  await expect(b.page.locator('.chat-bg')).toHaveCount(0);
  await proposal.getByRole('button', { name: 'Поставить себе' }).click();
  await expect(b.page.locator('.chat-bg')).toHaveCount(1);
  if (process.env.VICINITY_SHOTS_DIR) {
    await b.page.waitForTimeout(450);
    await b.page.screenshot({ path: `${process.env.VICINITY_SHOTS_DIR}/chat-bg-dm.png` });
  }

  // Фон переживает перезагрузку (localStorage)
  await b.page.reload();
  await expect(b.page.locator('.chat-bg')).toHaveCount(1);

  // Убрать
  await b.page.locator('.chat-head').getByRole('button', { name: 'Фон чата' }).click();
  const d2 = b.page.getByRole('dialog', { name: 'Фон чата' });
  await d2.getByRole('button', { name: 'Без фона' }).click();
  await d2.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(b.page.locator('.chat-bg')).toHaveCount(0);
});

// Фон канала ставит владелец сервера, видят все; чужие значения сервер отклоняет
test('server channel background by owner', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  await createServer(a, 'Мой сервер');

  await a.page.locator('.chat-head').getByRole('button', { name: 'Фон чата' }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Фон чата' });
  await dialog.getByRole('button', { name: 'Сетка' }).click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(a.page.locator('.chat-bg')).toHaveCount(1);

  const token = await tokenOf(a);
  const auth = { Authorization: `Bearer ${token}` };
  const servers = (await (await a.page.request.get(`${API}/servers`, { headers: auth })).json()) as { servers: { id: number }[] };
  const sid = servers.servers[0].id;
  const chans = (await (await a.page.request.get(`${API}/servers/${sid}/channels`, { headers: auth })).json()) as {
    channels: { id: number; is_voice: number; background: string | null }[];
  };
  const text = chans.channels.find((c) => !c.is_voice)!;
  expect(JSON.parse(text.background ?? 'null')).toMatchObject({ preset: 'grid', dim: 40 });

  const bad = await a.page.request.post(`${API}/channels/${text.id}/update`, { headers: auth, data: { background: { preset: 'nope' } } });
  expect(bad.status()).toBe(400);
  const badImage = await a.page.request.post(`${API}/channels/${text.id}/update`, {
    headers: auth,
    data: { background: { image: '/uploads/avatars/x.png' } },
  });
  expect(badImage.status()).toBe(400);

  // Не владелец не может
  const b = await registerUser(browser, 'Борис');
  const tb = await tokenOf(b);
  const forbidden = await a.page.request.post(`${API}/channels/${text.id}/update`, {
    headers: { Authorization: `Bearer ${tb}` },
    data: { background: null },
  });
  expect([403, 404]).toContain(forbidden.status());

  // Убрать фон
  await a.page.locator('.chat-head').getByRole('button', { name: 'Фон чата' }).click();
  const d2 = a.page.getByRole('dialog', { name: 'Фон чата' });
  await d2.getByRole('button', { name: 'Без фона' }).click();
  await d2.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(a.page.locator('.chat-bg')).toHaveCount(0);
});
