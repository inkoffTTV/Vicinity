import { expect, test } from '@playwright/test';
import { controlSocket, pageErrors, registerUser } from './helpers';
import { composer, dmBothSides, msgText } from './w1-helpers';

test('typing indicator: shown to the other side, throttled, cleared by the message or after 6 s', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const channelId = await dmBothSides(a, b);
  const typing = a.page.locator('.typing-line');

  // Сколько сигналов «печатает» уходит из вкладки Боба
  let sent = 0;
  b.page.on('websocket', (ws) =>
    ws.on('framesent', (f) => {
      if (typeof f.payload === 'string' && f.payload.includes('"typing"')) sent++;
    }),
  );
  await b.page.reload();
  await expect(b.page.locator('.user-panel')).toContainText('В сети');

  await composer(b).pressSequentially('привет, как дела?', { delay: 40 });
  await expect(typing).toHaveText('Боб печатает…');
  // Сообщение снимает индикатор сразу
  await composer(b).press('Enter');
  await expect(msgText(a, 'привет, как дела?')).toBeVisible();
  await expect(typing).toHaveText('');

  // Набор без отправки: индикатор гаснет сам через 6 секунд
  sent = 0;
  await composer(b).pressSequentially('долгий набор текста', { delay: 200 });
  expect(sent).toBeGreaterThanOrEqual(1);
  expect(sent).toBeLessThanOrEqual(2); // ~4 с набора — не чаще раза в 3 с
  await expect(typing).toHaveText('Боб печатает…');
  await expect(typing).toHaveText('', { timeout: 9_000 });

  // Несколько человек: имена через «и», больше двух — обобщённо
  const ws = await controlSocket(a);
  await a.page.locator('.side-item', { hasText: 'Боб' }).click();
  ws.inject({ type: 'typing', channel_id: channelId, user_id: 900001, name: 'Вера' });
  await expect(typing).toHaveText('Вера печатает…');
  ws.inject({ type: 'typing', channel_id: channelId, user_id: 900002, name: 'Глеб' });
  await expect(typing).toHaveText('Вера и Глеб печатают…');
  ws.inject({ type: 'typing', channel_id: channelId, user_id: 900003, name: 'Даша' });
  await expect(typing).toHaveText('Несколько человек печатают…');

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
