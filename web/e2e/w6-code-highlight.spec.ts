import { expect, test } from '@playwright/test';
import { pageErrors, registerUser } from './helpers';
import { apiUser, composer, dmBothSides, msg } from './w1-helpers';
import { bot, createBot, dmWith, setTheme, shot } from './w6-helpers';

// Подсветка синтаксиса в блоках кода (SPEC2 §2): highlight.js лениво, подписи языков, цвета из токенов --code-*,
// вход не трактуется как HTML, разметка бота <pre><code class="language-…"> даёт тот же блок.
const CPP = ['```cpp', '#include <vector>', '// сумма', 'int sum(const std::vector<int>& v) {', '  int s = 0;', '  for (int x : v) s += x;', '  return s; /* 42 */', '}', '```'];
const PY = ['```py', '@cache', 'def greet(name: str) -> str:', '    """Приветствие"""', "    return f'Привет, {name}!' if name else None", '```'];

const hljsLoaded = (page: import('@playwright/test').Page) =>
  page.evaluate(() => performance.getEntriesByType('resource').some((r) => /\/assets\/hljs-[^/]+\.js$/.test(r.name)));

test('code blocks: lazy highlight.js, language labels, token colours, no HTML from input, bot HTML parse_mode', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  const dialogs: string[] = [];
  for (const u of [a, b]) u.page.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()));
  await dmBothSides(a, b);
  // До первого блока кода библиотека не загружена — она не в основном бандле
  expect(await hljsLoaded(a.page)).toBe(false);

  await composer(b).fill(['Код на двух языках', ...CPP, ...PY].join('\n'));
  await composer(b).press('Enter');
  const m = msg(a, 'Код на двух языках');
  const blocks = m.locator('.md-codeblock');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.locator('.md-codeblock-lang')).toHaveText(['C++', 'Python']);
  await expect(blocks.nth(1).locator('.md-codeblock-lang')).toHaveAttribute('title', 'py');
  const cpp = blocks.nth(0).locator('code.hljs');
  await expect(cpp).toHaveAttribute('data-lang', 'cpp');
  await expect(cpp.locator('.hljs-meta').first()).toContainText('#include');
  await expect(cpp.locator('.hljs-keyword', { hasText: 'return' })).toHaveCount(1);
  await expect(cpp.locator('.hljs-comment').first()).toHaveText('// сумма');
  await expect(cpp.locator('.hljs-number').first()).toHaveText('0');
  const py = blocks.nth(1).locator('code.hljs');
  await expect(py.locator('.hljs-keyword', { hasText: 'def' })).toHaveCount(1);
  await expect(py.locator('.hljs-string').first()).toBeVisible();
  // Текст блока не изменился: копируется и читается как исходник
  await expect(cpp).toHaveText(CPP.slice(1, -1).join('\n'));
  expect(await hljsLoaded(a.page)).toBe(true);

  // Цвета — токены темы, а не тема hljs: тёмная и светлая
  const color = (sel: string) => cpp.locator(sel).last().evaluate((el) => getComputedStyle(el).color);
  const token = (name: string) =>
    a.page.evaluate((n) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${n})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    }, name);
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(a.page, theme);
    expect(await color('.hljs-keyword')).toBe(await token('--code-keyword')); // return
    expect(await color('.hljs-meta')).toBe(await token('--code-meta')); // #include
    expect(await color('.hljs-comment')).toBe(await token('--code-comment'));
    expect(await color('.hljs-number')).toBe(await token('--code-number'));
  }
  expect(await token('--code-keyword')).toBe('rgb(122, 63, 209)'); // светлая: #7a3fd1
  await setTheme(a.page, 'dark');
  expect(await token('--code-keyword')).toBe('rgb(201, 167, 255)'); // тёмная: #c9a7ff

  // Снимки: ПК и телефон, тёмная и светлая
  await m.scrollIntoViewIfNeeded();
  await shot(a.page, 'code-desktop-dark');
  await setTheme(a.page, 'light');
  await shot(a.page, 'code-desktop-light');
  await a.page.setViewportSize({ width: 390, height: 844 });
  await m.locator('.md-codeblock').first().scrollIntoViewIfNeeded();
  await shot(a.page, 'code-390-light');
  await setTheme(a.page, 'dark');
  await shot(a.page, 'code-390-dark');
  await a.page.setViewportSize({ width: 1280, height: 800 });

  // Вход не трактуется как HTML: <script> и обработчики остаются текстом и внутри подсветки
  const evil = ['```html', '<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '```', '```js', 'document.body.innerHTML = "<b onclick=alert(3)>x</b>";', '```'];
  await composer(b).fill(['Опасный код', ...evil].join('\n'));
  await composer(b).press('Enter');
  const bad = msg(a, 'Опасный код');
  await expect(bad.locator('.md-codeblock-lang')).toHaveText(['HTML', 'JavaScript']);
  await expect(bad.locator('code.hljs')).toHaveCount(2);
  await expect(bad.locator('code.hljs').first()).toHaveText('<script>alert(1)</script>\n<img src=x onerror=alert(2)>');
  await expect(bad.locator('code.hljs .hljs-tag').first()).toBeVisible();
  expect(await bad.locator('script, img, b[onclick]').count()).toBe(0);

  // Без тега язык не угадываем (highlightAuto путает Python с CSS): простой текст без подписи, даже длинный код.
  // Неизвестный тег — подпись как есть, без подсветки; «text» — «Текст», без подсветки
  const auto = [
    'import os',
    'def main():',
    '    for name in os.listdir("."):',
    '        if name.endswith(".py"):',
    '            print(f"файл: {name}")',
    'if __name__ == "__main__":',
    '    main()',
  ];
  await composer(b).fill(['Без языка', '```', 'просто текст', 'в две строки', '```', '```', ...auto, '```', '```foobar', 'x = 1', '```', '```text', 'if (x) return;', '```'].join('\n'));
  await composer(b).press('Enter');
  const plain = msg(a, 'Без языка').locator('.md-codeblock');
  await expect(plain).toHaveCount(4);
  await expect(plain.nth(0).locator('.md-codeblock-lang')).toHaveCount(0);
  await expect(plain.nth(0).locator('code.hljs')).toHaveCount(0);
  await expect(plain.nth(1).locator('.md-codeblock-lang')).toHaveCount(0);
  await expect(plain.nth(1).locator('code.hljs')).toHaveCount(0);
  await expect(plain.nth(1).locator('code')).toHaveText(auto.join('\n'));
  await expect(plain.nth(2).locator('.md-codeblock-lang')).toHaveText('foobar');
  await expect(plain.nth(2).locator('code.hljs')).toHaveCount(0);
  await expect(plain.nth(3).locator('.md-codeblock-lang')).toHaveText('Текст');
  await expect(plain.nth(3).locator('code.hljs')).toHaveCount(0);

  // Псевдонимы
  await composer(b).fill(['Псевдонимы', '```c#', 'var x = 1;', '```', '```golang', 'func f() {}', '```', '```yml', 'a: 1', '```', '```sh', 'echo hi', '```'].join('\n'));
  await composer(b).press('Enter');
  await expect(msg(a, 'Псевдонимы').locator('.md-codeblock-lang')).toHaveText(['C#', 'Go', 'YAML', 'Bash']);

  // Бот: parse_mode HTML <pre><code class="language-…"> → тот же блок с подписью и подсветкой
  const alice = await apiUser(request, a);
  const codeBot = await createBot(request, alice, 'Кодер');
  const ch = await dmWith(request, alice, codeBot);
  await bot(request, codeBot.token, 'sendMessage', {
    chat_id: ch,
    parse_mode: 'HTML',
    text: 'Ответ бота\n<pre><code class="language-cpp">int main() { return 0; }</code></pre>\n<pre><code class="language-python extra">x = &lt;1&gt;</code></pre>',
  });
  await a.page.goto(`/channels/@me/${ch}`);
  const fromBot = a.page.locator('.msg', { hasText: 'Ответ бота' });
  await expect(fromBot.locator('.md-codeblock-lang')).toHaveText(['C++', 'Python']);
  await expect(fromBot.locator('code.hljs .hljs-keyword', { hasText: 'return' })).toBeVisible();
  await expect(fromBot.locator('code.hljs').nth(1)).toHaveText('x = <1>');

  expect(dialogs).toEqual([]);
  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});
