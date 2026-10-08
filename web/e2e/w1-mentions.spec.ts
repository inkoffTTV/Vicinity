import { expect, test } from '@playwright/test';
import { createGroup, createServer, joinServer, pageErrors, registerUser } from './helpers';
import { apiUser, call, composer, msg, openChannelId, post, setHidden } from './w1-helpers';

test('mention autocomplete: server members, arrows with Enter/Tab, Esc closes', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const c = await registerUser(browser, 'Кира');
  const code = await createServer(a, 'Упоминания');
  await joinServer(b, code, 'Упоминания');
  await joinServer(c, code, 'Упоминания');
  await expect(a.page.locator('.members .member')).toHaveCount(3);

  // «@» — все участники, кроме себя
  const popup = a.page.locator('.mention-popup');
  await composer(a).fill('Привет @');
  await expect(popup.getByRole('option')).toHaveCount(2);
  await expect(popup).not.toContainText('Алиса');
  // По началу имени или логина
  await composer(a).pressSequentially('ки');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await expect(popup.getByRole('option')).toContainText('Кира');
  await composer(a).press('Tab');
  await expect(popup).toHaveCount(0);
  await expect(composer(a)).toHaveValue(`Привет @${c.username} `);

  // Стрелки выбирают, Enter вставляет (а не отправляет)
  await composer(a).pressSequentially('и @');
  await expect(popup.getByRole('option')).toHaveCount(2);
  const options = popup.getByRole('option');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await composer(a).press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  const second = (await options.nth(1).locator('.muted').textContent())!;
  await composer(a).press('Enter');
  await expect(composer(a)).toHaveValue(`Привет @${c.username} и ${second} `);

  // Esc закрывает подсказку, следующий Enter отправляет
  await composer(a).pressSequentially('@');
  await expect(popup).toBeVisible();
  await composer(a).press('Escape');
  await expect(popup).toHaveCount(0);
  await composer(a).press('Backspace');
  await composer(a).press('Enter');
  await expect(msg(c, 'Привет').locator('.mention.me').first()).toHaveText('@Кира');
  await expect(msg(c, 'Привет')).toHaveClass(/mentioned/);

  expect(pageErrors(a.page)).toEqual([]);
});

test('mention autocomplete in a group chat suggests its members', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await createGroup(a, 'Беседа с упоминаниями');
  const group = await openChannelId(a);
  const bob = await apiUser(request, b);
  expect((await call(request, await apiUser(request, a), 'POST', `/channels/${group}/members`, { user_id: bob.id })).status).toBe(200);
  // Новый участник беседы попадает в подсказки сразу (channel_member_joined)
  await composer(a).fill('@бо');
  await expect(a.page.locator('.mention-popup').getByRole('option')).toHaveText([new RegExp(`Боб\\s*@${b.username}`)]);
  await composer(a).press('Enter');
  await composer(a).pressSequentially('привет');
  await composer(a).press('Enter');
  await expect(msg(a, 'привет').locator('.mention')).toHaveText('@Боб');
  expect(pageErrors(a.page)).toEqual([]);
});

test('notifications: DMs and mentions notify; per-server level and per-channel mute are respected', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const code = await createServer(a, 'Сигналы');
  await joinServer(b, code, 'Сигналы');
  const general = await openChannelId(b);

  // Системные уведомления Боба записываются (разрешение выдано)
  await b.context.addInitScript(() => {
    const notes: { title: string; body: string }[] = [];
    (window as any).__notes = notes;
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) {
        notes.push({ title, body: opts?.body ?? '' });
      }
      close() {}
    }
    (window as any).Notification = FakeNotification;
  });
  await b.page.reload();
  await expect(b.page.locator('.user-panel')).toContainText('В сети');
  await setHidden(b.page, true);
  const notes = () => b.page.evaluate(() => (window as any).__notes as { title: string; body: string }[]);
  const alice = await apiUser(request, a);
  const bob = await apiUser(request, b);

  // По умолчанию на сервере — только упоминания
  await post(request, alice, general, 'обычное на сервере');
  await post(request, alice, general, `@${b.username} есть дело`);
  await expect.poll(notes).toEqual([{ title: 'Алиса упоминает вас', body: `@${b.username} есть дело` }]);

  // Сервер: «Все сообщения»
  await setHidden(b.page, false);
  await b.page.getByRole('button', { name: 'Уведомления', exact: true }).click();
  await b.page.getByRole('menuitemradio', { name: 'Все сообщения' }).click();
  await setHidden(b.page, true);
  await post(request, alice, general, 'теперь обо всём');
  await expect.poll(async () => (await notes()).length).toBe(2);
  expect((await notes())[1]).toEqual({ title: 'Алиса', body: 'теперь обо всём' });

  // Сервер: «Ничего» — даже упоминание молчит (проверяем по следующему уведомлению из лички)
  await setHidden(b.page, false);
  await b.page.getByRole('button', { name: 'Уведомления', exact: true }).click();
  await b.page.getByRole('menuitemradio', { name: 'Ничего' }).click();
  await setHidden(b.page, true);
  await post(request, alice, general, `@${b.username} молчи`);
  const dm = (await call(request, alice, 'POST', '/dms', { user_id: bob.id })).body.channel_id;
  await post(request, alice, dm, 'личное первое');
  await expect.poll(async () => (await notes()).length).toBe(3);
  expect((await notes())[2]).toEqual({ title: 'Алиса', body: 'личное первое' });

  // Заглушённая личка (контекстное меню в списке) — без уведомлений
  await setHidden(b.page, false);
  await b.page.locator('.rail-item.home').click();
  const dmItem = b.page.locator('.side-item', { hasText: 'Алиса' });
  await dmItem.click({ button: 'right' });
  await b.page.getByRole('menuitemcheckbox', { name: /Заглушить канал/ }).click();
  await expect(dmItem).toHaveClass(/muted-ch/);
  await setHidden(b.page, true);
  await post(request, alice, dm, 'личное заглушённое');
  await setHidden(b.page, false);
  await dmItem.click({ button: 'right' });
  await b.page.getByRole('menuitemcheckbox', { name: /Включить уведомления канала/ }).click();
  await expect(dmItem).not.toHaveClass(/muted-ch/);
  await b.page.locator('.side-item', { hasText: 'Друзья' }).click();
  await setHidden(b.page, true);
  await post(request, alice, dm, 'личное снова слышно');
  await expect.poll(async () => (await notes()).length).toBe(4);
  expect((await notes())[3]).toEqual({ title: 'Алиса', body: 'личное снова слышно' });

  // Настройки — в этом браузере и переживают перезагрузку
  const saved = await b.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.notify') ?? '{}'));
  expect(Object.values(saved.servers)).toEqual(['none']);
  expect(saved.muted).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
