import { expect, test } from '@playwright/test';
import { createServer, joinServer, pageErrors, pngBuffer, registerUser } from './helpers';
import { apiRegister, call } from './w1-helpers';
import { confirmDialog, openServerId, openServerSettings, settingsTab } from './w2-helpers';

// Настройки сервера: владелец меняет название, иконку, код приглашения, банит и снимает бан,
// управляет каналами; участник видит всё вживую, может покинуть сервер; удаление сервера.

test('owner renames the server, sets an icon, regenerates the invite, manages channels — members see it live', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Мастерская');
  await joinServer(b, code, 'Мастерская');

  // Участнику настройки владельца недоступны: в меню только приглашение и выход
  await b.page.locator('.side-head').click();
  await expect(b.page.locator('.dropdown button', { hasText: 'Настройки сервера' })).toHaveCount(0);
  await expect(b.page.locator('.dropdown button', { hasText: 'Покинуть сервер' })).toBeVisible();
  await b.page.locator('.side-head').click();

  // Название
  await openServerSettings(a);
  const name = a.page.locator('.settings-panel label:has-text("Название сервера") input');
  await expect(name).toHaveValue('Мастерская');
  await name.fill('Новая мастерская');
  await a.page.locator('.settings-panel').getByRole('button', { name: 'Сохранить' }).click();
  await expect(b.page.locator('.side-head', { hasText: 'Новая мастерская' })).toBeVisible();
  await expect(b.page.locator('.rail-item[title="Новая мастерская"]')).toBeVisible();

  // Иконка
  await a.page.locator('.server-overview input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: pngBuffer(64, 64) });
  await expect(a.page.locator('.toast', { hasText: 'Иконка сервера обновлена' })).toBeVisible();
  await expect(b.page.locator('.rail-item[title="Новая мастерская"] img')).toHaveAttribute('src', /^\/uploads\//);
  await expect(a.page.locator('.server-overview-icon img')).toHaveAttribute('src', /^\/uploads\//);

  // Приглашение: ссылка вида origin/invite/CODE; новый код — старый перестаёт работать
  await settingsTab(a, 'Приглашения').click();
  await expect(a.page.locator('.invite-code')).toHaveText(code);
  const origin = new URL(a.page.url()).origin;
  await expect(a.page.locator('.invite-link input')).toHaveValue(`${origin}/invite/${code}`);
  await a.page.getByRole('button', { name: 'Создать новый код' }).click();
  await confirmDialog(a, 'Создать новый код');
  await expect(a.page.locator('.invite-code')).not.toHaveText(code);
  const fresh = (await a.page.locator('.invite-code').textContent())!.trim();
  await expect(a.page.locator('.invite-link input')).toHaveValue(`${origin}/invite/${fresh}`);
  const c = await apiRegister(request, 'Вика');
  expect((await call(request, c, 'POST', '/servers/join', { code })).status).toBe(404);
  expect((await call(request, c, 'POST', '/servers/join', { code: fresh })).status).toBe(200);
  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('.modal')).toHaveCount(0);

  // Каналы: шестерёнка владельца — переименовать и удалить (с подтверждением)
  await a.page.locator('.side-head').click();
  await a.page.locator('.dropdown button', { hasText: 'Создать текстовый канал' }).click();
  await a.page.locator('.modal input').fill('черновики');
  await a.page.locator('.modal').getByRole('button', { name: 'Создать' }).click();
  await expect(b.page.locator('.side-item.channel', { hasText: 'черновики' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Изменить канал черновики' })).toHaveCount(0);
  await a.page.locator('.side-row', { hasText: 'черновики' }).hover();
  await a.page.getByRole('button', { name: 'Изменить канал черновики' }).click();
  await a.page.locator('.modal input').fill('чистовики');
  await a.page.locator('.modal').getByRole('button', { name: 'Сохранить' }).click();
  await expect(b.page.locator('.side-item.channel', { hasText: 'чистовики' })).toBeVisible();
  await expect(b.page.locator('.side-item.channel', { hasText: 'черновики' })).toHaveCount(0);

  // Удаление — через контекстное меню канала
  await a.page.locator('.side-item.channel', { hasText: 'чистовики' }).click({ button: 'right' });
  await a.page.getByRole('menuitem', { name: /Изменить канал/ }).click();
  await a.page.locator('.modal').getByRole('button', { name: 'Удалить канал' }).click();
  await confirmDialog(a, 'Удалить');
  await expect(b.page.locator('.side-item.channel', { hasText: 'чистовики' })).toHaveCount(0);
  await expect(a.page.locator('.side-item.channel', { hasText: 'чистовики' })).toHaveCount(0);
  await expect(a.page.locator('.modal')).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('members: search, kick and ban with confirmation, bans list and unban, leave, delete with name check', async ({
  browser,
  request,
}) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Вера');
  const code = await createServer(a, 'Клуб');
  await joinServer(b, code, 'Клуб');
  await joinServer(c, code, 'Клуб');
  const serverId = openServerId(a);

  await openServerSettings(a);
  await settingsTab(a, 'Участники').click();
  const rows = a.page.locator('.settings-panel .manage-row');
  await expect(rows).toHaveCount(3);
  await a.page.getByRole('searchbox', { name: 'Поиск участников' }).fill('бо');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Боб');

  // Бан: подтверждение, Боб теряет сервер сразу, остальные видят, что он ушёл
  await rows.first().getByRole('button', { name: 'Забанить' }).click();
  await expect(a.page.locator('.modal').last()).toContainText('не сможет вернуться');
  await confirmDialog(a, 'Забанить');
  await expect(b.page.locator('.toast', { hasText: 'Вас удалили с сервера' })).toBeVisible();
  await expect(b.page.locator('.rail-item[title="Клуб"]')).toHaveCount(0);
  await expect(c.page.locator('.members .member', { hasText: 'Боб' })).toHaveCount(0);

  // В списке банов — Боб; вступить по коду он не может, пока бан не снят
  await settingsTab(a, 'Баны').click();
  const bans = a.page.locator('.settings-panel .manage-row');
  await expect(bans).toHaveCount(1);
  await expect(bans.first()).toContainText('Боб');
  await b.page.locator('.rail-item.add').click();
  await b.page.locator('.modal input').nth(1).fill(code);
  await b.page.locator('.modal').getByRole('button', { name: 'Вступить' }).click();
  await expect(b.page.locator('.modal .form-error')).toContainText('заблокированы');
  await b.page.keyboard.press('Escape');
  await bans.first().getByRole('button', { name: 'Разбанить' }).click();
  await expect(a.page.locator('.settings-panel')).toContainText('Забаненных нет');
  await joinServer(b, code, 'Клуб');

  // Исключить: тоже с подтверждением; Отмена ничего не делает
  await settingsTab(a, 'Участники').click();
  await a.page.getByRole('searchbox', { name: 'Поиск участников' }).fill('Вера');
  await rows.first().getByRole('button', { name: 'Исключить' }).click();
  await a.page.locator('.modal').last().getByRole('button', { name: 'Отмена' }).click();
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button', { name: 'Исключить' }).click();
  await confirmDialog(a, 'Исключить');
  await expect(c.page.locator('.rail-item[title="Клуб"]')).toHaveCount(0);
  await a.page.keyboard.press('Escape');

  // Участник покидает сервер сам — владелец видит это сразу
  await expect(a.page.locator('.members .member', { hasText: 'Боб' })).toBeVisible();
  await b.page.locator('.side-head').click();
  await b.page.locator('.dropdown button', { hasText: 'Покинуть сервер' }).click();
  await confirmDialog(b, 'Покинуть');
  await expect(b.page.locator('.rail-item[title="Клуб"]')).toHaveCount(0);
  await expect(b.page.locator('.toast', { hasText: 'Вы покинули сервер «Клуб»' })).toBeVisible();
  await expect(b.page.locator('.toast', { hasText: 'Вас удалили' })).toHaveCount(0);
  await expect(a.page.locator('.members .member', { hasText: 'Боб' })).toHaveCount(0);

  // Удаление: кнопка активна только после ввода точного названия; у участников сервер пропадает
  await joinServer(b, code, 'Клуб');
  await openServerSettings(a);
  await settingsTab(a, 'Удаление сервера').click();
  await a.page.locator('.settings-panel').getByRole('button', { name: 'Удалить сервер' }).click();
  const confirm = a.page.locator('.modal').last();
  await confirm.locator('input').fill('Клу');
  await expect(confirm.getByRole('button', { name: 'Удалить навсегда' })).toBeDisabled();
  await confirmDialog(a, 'Удалить навсегда', 'Клуб');
  await expect(a.page.locator('.rail-item[title="Клуб"]')).toHaveCount(0);
  await expect(a.page.locator('.modal')).toHaveCount(0);
  await expect(a.page.locator('.toast', { hasText: 'Сервер «Клуб» удалён' })).toBeVisible();
  await expect(b.page.locator('.rail-item[title="Клуб"]')).toHaveCount(0);
  await expect(b.page.locator('.chat-head', { hasText: 'Друзья' })).toBeVisible();
  const r = await request.get(`/api/v1/servers/${serverId}/channels`, {
    headers: { Authorization: `Bearer ${await a.page.evaluate(() => localStorage.getItem('vicinity.token'))}` },
  });
  expect([403, 404]).toContain(r.status());

  for (const u of [a, b, c]) expect(pageErrors(u.page)).toEqual([]);
});
