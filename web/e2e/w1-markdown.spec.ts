import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { composer, dmBothSides, msg, msgText } from './w1-helpers';

test('markdown renders safely; XSS attempts stay inert text; mentions and emoji-only messages', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await dmBothSides(a, b);
  const dialogs: string[] = [];
  for (const u of [a, b]) u.page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));

  await composer(b).fill(
    [
      'Разметка: **жирный**, *курсив*, _наклонный_, __подчёркнутый__, ~~зачёркнутый~~, `код <b>`, ||тайна|| ' +
        'и ссылка https://example.com/path?a=1.',
      '```js',
      'const answer = 42; // очень длинная строка кода, которая должна прокручиваться по горизонтали, а не переноситься',
      '```',
      '> цитата первая',
      '> цитата вторая',
      'после цитаты snake_case_name',
    ].join('\n'),
  );
  await composer(b).press('Enter');
  const rich = msg(a, 'Разметка:');
  await expect(rich).toBeVisible();
  const text = rich.locator('.msg-text');
  await expect(text.locator('strong')).toHaveText('жирный');
  await expect(text.locator('em')).toHaveText(['курсив', 'наклонный']);
  await expect(text.locator('u')).toHaveText('подчёркнутый');
  await expect(text.locator('s')).toHaveText('зачёркнутый');
  await expect(text.locator('code.md-code')).toHaveText('код <b>');
  const link = text.locator('a[href="https://example.com/path?a=1"]');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(text).toContainText('snake_case_name');

  // Блок кода: подпись языка, прокрутка вбок, копирование
  const block = text.locator('.md-codeblock');
  await expect(block.locator('.md-codeblock-lang')).toHaveText('js');
  await expect(block.locator('pre')).toHaveCSS('overflow-x', 'auto');
  await expect(block.locator('pre')).toHaveCSS('white-space', 'pre');
  await block.getByRole('button', { name: 'Копировать' }).click();
  await expect(block.getByRole('button', { name: /Скопировано/ })).toBeVisible();

  await expect(text.locator('blockquote.md-quote')).toHaveText(/цитата первая\s+цитата вторая/);

  // Спойлер скрыт до щелчка
  const spoiler = text.locator('.md-spoiler');
  await expect(spoiler).not.toHaveClass(/shown/);
  await expect(spoiler.locator('span')).toHaveCSS('visibility', 'hidden');
  await spoiler.click();
  await expect(text.locator('.md-spoiler.shown')).toHaveText('тайна');

  // Попытки XSS: всё остаётся текстом
  const evil =
    '<img src=x onerror=alert(1)> <script>alert(2)</script> [ссылка](javascript:alert(3)) javascript:alert(4) ' +
    '<a href="javascript:alert(5)">a</a> ftp://example.com data:text/html,<b>x</b> **<svg onload=alert(6)>**';
  await composer(b).fill(evil);
  await composer(b).press('Enter');
  const bad = msgText(a, '<img src=x onerror=alert(1)>');
  await expect(bad).toBeVisible();
  await expect(bad).toContainText('<script>alert(2)</script>');
  await expect(bad.locator('strong')).toHaveText('<svg onload=alert(6)>');
  await expect(a.page.locator('.messages img[src="x"], .messages script, .messages svg')).toHaveCount(0);
  await expect(a.page.locator('.messages a[href^="javascript:"], .messages a[href^="data:"], .messages a[href^="ftp:"]')).toHaveCount(0);
  await expect(bad.locator('a')).toHaveCount(0);

  // Упоминание меня: подсветка имени и всего сообщения; у автора — без подсветки сообщения
  await composer(b).fill(`@${a.username} глянь`);
  await composer(b).press('Enter');
  const mention = msg(a, 'глянь');
  await expect(mention).toHaveClass(/mentioned/);
  await expect(mention.locator('.mention.me')).toHaveText('@Алиса');
  await expect(msg(b, 'глянь')).not.toHaveClass(/mentioned/);
  await expect(msg(b, 'глянь').locator('.mention')).toHaveText('@Алиса');
  // Несуществующий логин — просто текст
  await composer(b).fill('привет @nobody_here');
  await composer(b).press('Enter');
  await expect(msgText(a, 'привет @nobody_here').locator('.mention')).toHaveCount(0);

  // Только эмодзи — крупно; эмодзи с текстом — обычным размером
  await composer(b).fill('🎉🔥');
  await composer(b).press('Enter');
  await expect(a.page.locator('.msg-text.jumbo', { hasText: '🎉🔥' })).toBeVisible();
  await composer(b).fill('ура 🎉');
  await composer(b).press('Enter');
  await expect(msgText(a, 'ура 🎉')).not.toHaveClass(/jumbo/);

  // «О себе» в профиле — та же разметка
  await b.page.getByTitle('Настройки').click();
  await b.page.locator('label:has-text("О себе") textarea').fill('**Главное** обо мне и <i>не html</i>');
  await b.page.locator('.modal').getByRole('button', { name: 'Сохранить' }).click();
  await expect(b.page.locator('.toast', { hasText: 'Профиль сохранён' })).toBeVisible();
  await a.page.locator('.chat-title', { hasText: 'Боб' }).click();
  await expect(a.page.locator('.profile-card .bio strong')).toHaveText('Главное');
  await expect(a.page.locator('.profile-card .bio')).toContainText('<i>не html</i>');

  expect(dialogs).toEqual([]);
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
