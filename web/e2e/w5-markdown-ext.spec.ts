import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { composer, dmBothSides, msgText } from './w1-helpers';

// Расширенная разметка: заголовки, списки, маскированные ссылки, метки времени <t:…>
test('headings, lists, masked links and timestamps', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await dmBothSides(a, b);
  const dialogs: string[] = [];
  for (const u of [a, b]) u.page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));

  const sendText = async (text: string) => {
    await composer(b).fill(text);
    await composer(b).press('Enter');
  };

  // ── Заголовки и списки ──
  await sendText(
    [
      'Блоки: начало',
      '# Заголовок один',
      '## Второй **жирный**',
      '### Третий',
      '- пункт раз',
      '* пункт два',
      '3. третий',
      '4. четвёртый',
      'обычная строка после списка',
      '#хештег не заголовок',
      '#### четыре решётки — текст',
      '\\# экранированная решётка',
      '\\- экранированный дефис',
      '> - пункт в цитате',
    ].join('\n'),
  );
  const blocks = msgText(a, 'Блоки: начало');
  await expect(blocks).toBeVisible();
  await expect(blocks.locator('h3.md-h1')).toHaveText('Заголовок один');
  await expect(blocks.locator('h4.md-h2')).toHaveText('Второй жирный');
  await expect(blocks.locator('h4.md-h2 strong')).toHaveText('жирный');
  await expect(blocks.locator('h5.md-h3')).toHaveText('Третий');
  await expect(blocks.locator('.md-h')).toHaveCount(3);
  await expect(blocks.locator('> ul.md-list > li')).toHaveText(['пункт раз', 'пункт два']);
  await expect(blocks.locator('ol.md-list')).toHaveAttribute('start', '3');
  await expect(blocks.locator('ol.md-list > li')).toHaveText(['третий', 'четвёртый']);
  await expect(blocks.locator('blockquote.md-quote ul.md-list > li')).toHaveText('пункт в цитате');
  await expect(blocks).toContainText('#хештег не заголовок');
  await expect(blocks).toContainText('#### четыре решётки — текст');
  await expect(blocks).toContainText('# экранированная решётка');
  await expect(blocks).toContainText('- экранированный дефис');
  // Блоки сами начинают строку — без пустых строк вокруг (white-space: pre-wrap)
  const inner = await blocks.evaluate((el) => (el as HTMLElement).innerText);
  expect(inner).not.toMatch(/\n[ \t]*\n/);
  // Заголовок крупнее текста сообщения
  const sizes = await blocks.evaluate((el) => [
    parseFloat(getComputedStyle(el).fontSize),
    parseFloat(getComputedStyle(el.querySelector('.md-h1')!).fontSize),
  ]);
  expect(sizes[1]).toBeGreaterThan(sizes[0]);

  // ── Маскированные ссылки ──
  await sendText(
    'Ссылки: [Документация](https://example.com/docs?a=1) и [https://good.example](https://evil.example/x) ' +
      'и [плохая](javascript:alert(1)) и [данные](data:text/html,<b>x</b>) и [example.com](https://www.example.com/a) ' +
      'и [вики](https://ru.wikipedia.org/wiki/Тест_(значения)) и [**жирная** @nobody](https://example.org)',
  );
  const links = msgText(a, 'Ссылки:');
  await expect(links).toBeVisible();
  const docs = links.locator('a', { hasText: 'Документация' });
  await expect(docs).toHaveAttribute('href', 'https://example.com/docs?a=1');
  await expect(docs).toHaveAttribute('title', 'https://example.com/docs?a=1');
  await expect(docs).toHaveAttribute('target', '_blank');
  await expect(docs).toHaveAttribute('rel', /noopener/);
  // Подпись выдаёт себя за другой сайт — настоящий домен рядом
  const spoof = links.locator('a', { hasText: 'https://good.example' });
  await expect(spoof).toHaveAttribute('href', 'https://evil.example/x');
  await expect(spoof).toHaveAttribute('title', 'https://evil.example/x');
  await expect(links.locator('.md-link-host')).toHaveCount(1);
  await expect(links.locator('.md-link-host')).toHaveText('(evil.example)');
  // Тот же сайт (www. не в счёт) — без подсказки
  await expect(links.locator('a', { hasText: /^example\.com$/ })).toHaveAttribute('href', 'https://www.example.com/a');
  // Скобки в адресе — парами
  await expect(links.locator('a', { hasText: 'вики' })).toHaveAttribute('href', 'https://ru.wikipedia.org/wiki/Тест_(значения)');
  // Разметка в подписи работает, упоминание — нет (кнопка внутри ссылки недопустима)
  const rich = links.locator('a[href="https://example.org"]');
  await expect(rich.locator('strong')).toHaveText('жирная');
  await expect(rich.locator('.mention, button')).toHaveCount(0);
  // javascript: и data: — остаются текстом
  await expect(links).toContainText('[плохая](javascript:alert(1))');
  await expect(links).toContainText('[данные](data:text/html,<b>x</b>)');
  await expect(a.page.locator('.messages a[href^="javascript:"], .messages a[href^="data:"]')).toHaveCount(0);

  // Подпись с точкой, «!» или невидимым символом в конце всё равно выдаёт чужой домен — подсказка есть
  await sendText('Обход: [paypal.com.](https://evil.example/a) и [bank.com\u200b!](https://evil.example/b) и [Сайт](https://evil.example/c)');
  const bypass = msgText(a, 'Обход:');
  await expect(bypass.locator('.md-link-host')).toHaveCount(2);
  await expect(bypass.locator('.md-link-host').first()).toHaveText('(evil.example)');

  // Выделение через строку «- …» не разваливается: строка внутри остаётся текстом
  await sendText('**жирное начало\n- не пункт\nконец жирного**');
  const spanning = msgText(a, 'жирное начало');
  await expect(spanning.locator('strong')).toContainText('не пункт');
  await expect(spanning.locator('ul')).toHaveCount(0);

  // ── Метки времени ──
  const now = Math.floor(Date.now() / 1000);
  const NOON = 1699963200; // 14 ноября 2023, 12:00 UTC — вторник в любом поясе от −11 до +11
  await sendText(
    `Время: <t:${now + 300}:R> | <t:${now - 3 * 86400}:R> | <t:${NOON}:d> | <t:${NOON}:D> | <t:${NOON}:t> | ` +
      `<t:${NOON}:T> | <t:${NOON}> | <t:${NOON}:F> | <t:abc> | <t:${NOON}:X>`,
  );
  const times = msgText(a, 'Время:');
  await expect(times).toBeVisible();
  const t = times.locator('time.md-time');
  await expect(t).toHaveCount(8);
  await expect(t.nth(0)).toHaveText('через 5 минут');
  await expect(t.nth(1)).toHaveText('3 дня назад');
  await expect(t.nth(2)).toHaveText('14.11.2023');
  await expect(t.nth(3)).toHaveText(/^14 ноября 2023/);
  await expect(t.nth(4)).toHaveText(/^\d{2}:\d{2}$/);
  await expect(t.nth(5)).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(t.nth(6)).toHaveText(/14 ноября 2023 г\..*\d{2}:\d{2}/);
  await expect(t.nth(7)).toHaveText(/^вторник, 14 ноября 2023/);
  // Подсказка — полная дата, атрибут datetime — момент в UTC
  await expect(t.nth(2)).toHaveAttribute('title', /вторник, 14 ноября 2023/);
  await expect(t.nth(2)).toHaveAttribute('datetime', '2023-11-14T12:00:00.000Z');
  await expect(times).toContainText('<t:abc>');
  await expect(times).toContainText(`<t:${NOON}:X>`);

  // Превью в списке чатов — без разметки, время уже отформатировано
  await sendText(`Встреча <t:${NOON}:d> [тут](https://example.com)`);
  await expect(b.page.locator('.side-item', { hasText: 'Алиса' })).toContainText('Встреча 14.11.2023 тут');

  // Телефон: блоки и ссылки без горизонтальной прокрутки
  await a.page.setViewportSize({ width: 390, height: 844 });
  await blocks.scrollIntoViewIfNeeded();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (process.env.VICINITY_SHOTS_DIR) {
    await a.page.waitForTimeout(800); // боковая панель уезжает после смены ширины
    await a.page.screenshot({ path: `${process.env.VICINITY_SHOTS_DIR}/markdown-390.png` });
  }

  expect(dialogs).toEqual([]);
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
