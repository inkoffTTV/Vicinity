import { Browser, expect, Page } from '@playwright/test';
import { User } from './helpers';

// Общие шаги для ui-*.spec.ts: значки вместо эмодзи, вёрстка на телефоне, связь с администратором.

/** Эмодзи и псевдографика, которыми раньше рисовали кнопки (✕ ☰ ➤ ＋ ⬇ ▾ ✓ ↩ и пиктограммы) */
const GLYPHS = /[\p{Extended_Pictographic}←-⇿☰-☷✓-✖➤⬇▾＋]/u;

// Что считается кнопкой/значком интерфейса
const CONTROLS = [
  'button',
  'a.icon-btn',
  '[role=button]',
  '[role=menuitem]',
  '[role=menuitemcheckbox]',
  '[role=menuitemradio]',
  '[role=tab]',
  '.side-icon',
  '.badge',
  '.session-icon',
  '.file-icon',
  '.switcher-icon',
  '.msg-pin-flag',
  '.owner-crown',
  '.search-box-icon',
  '.invite-card-icon',
  '.popover-head',
  '.modal-head',
  '.chat-head',
].join(', ');

// Где эмодзи — содержимое: реакции, быстрые реакции, сетка палитры, текст сообщений
const CONTENT = '.reactions, .emoji-picker, .emoji-panel-grid, .emoji-panel-foot, .msg-text, .reply-text, .side-preview, .pin-text, .search-hit-text';

/** Кнопки и значки на экране, в тексте которых есть эмодзи (кроме мест, где эмодзи — содержимое) */
export async function emojiControls(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ controls, content, glyphs }) => {
      const re = new RegExp(glyphs, 'u');
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(controls))) {
        if (el.closest(content)) continue;
        // Текст без вложенного содержимого (превью сообщения внутри пункта лички и т.п.)
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(content).forEach((n) => n.remove());
        const text = clone.textContent ?? '';
        if (re.test(text)) bad.push(`${el.tagName.toLowerCase()}.${el.className}: «${text.trim().slice(0, 60)}»`);
      }
      return bad;
    },
    { controls: CONTROLS, content: CONTENT, glyphs: GLYPHS.source },
  );
}

export async function expectNoEmojiControls(page: Page, where: string) {
  expect(await emojiControls(page), where).toEqual([]);
}

/** Регистрация с заданным логином (например, администратора inkoff) */
export async function registerNamed(
  browser: Browser,
  username: string,
  displayName: string,
  viewport = { width: 1280, height: 800 },
): Promise<User> {
  const context = await browser.newContext({ viewport, colorScheme: 'dark' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await page.goto('/');
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click();
  await page.locator('input[autocomplete=username]').fill(username);
  await page.locator('label:has-text("Отображаемое имя") input').fill(displayName);
  await page.locator('input[type=password]').fill('password123');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('.user-panel')).toContainText('В сети');
  return { page, context, username, displayName };
}

/** На узком экране список каналов спрятан в меню — открыть его */
export async function openNav(page: Page) {
  const menu = page.locator('.chat-head .menu-btn');
  if ((await page.locator('.app.nav-open').count()) === 0 && (await menu.isVisible())) {
    await menu.click();
    await expect(page.locator('.app.nav-open')).toBeVisible();
  }
}
