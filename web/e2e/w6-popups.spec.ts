import { expect, Page, test } from '@playwright/test';
import { createServer, pageErrors, registerUser } from './helpers';
import { apiRegister, apiUser, call, dmBothSides, msg, openChannelId, post } from './w1-helpers';
import { settingsTab } from './w2-helpers';
import { setTheme, shot } from './w6-helpers';

// Всплывающие уведомления в приложении (SPEC2 §3): баннер о сообщении в другом чате — те же правила, что у звука
// и системных уведомлений (lib/notify.ts): заглушённые, уровни серверов, свои сообщения; щелчок открывает чат.
const quiet = (page: Page) => page.waitForTimeout(1200); // «ничего не появилось» — ждём доставку по WS

test('in-app popups: shown for other chats, collapse, limit, auto-hide with hover pause, rules, setting, 390px', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const a = await registerUser(browser, 'Алиса', { popups: true });
  const b = await registerUser(browser, 'Боб');
  const dm = await dmBothSides(a, b);
  const alice = await apiUser(request, a);
  const bob = await apiUser(request, b);
  const code = await createServer(a, 'Поляна');
  const general = await openChannelId(a);
  expect((await call(request, bob, 'POST', '/servers/join', { code })).status).toBeLessThan(300);
  const popups = a.page.locator('.notify-popups');
  const cards = popups.locator('.notify-popup');
  const home = () => a.page.locator('.rail-item.home').click();
  await home();
  await expect(popups).toHaveAttribute('role', 'status');
  await expect(popups).toHaveAttribute('aria-live', 'polite');

  // ── Личка, пока открыта главная: баннер с автором, местом и текстом; фокус не перехвачен ──
  await post(request, bob, dm, 'Привет из **лички**');
  await expect(cards).toHaveCount(1);
  const card = cards.first();
  await expect(card.locator('.notify-popup-name')).toHaveText('Боб');
  await expect(card.locator('.notify-popup-where')).toHaveText('Личные сообщения');
  await expect(card.locator('.notify-popup-text')).toHaveText('Привет из лички');
  await expect(card.getByRole('button', { name: 'Закрыть уведомление' })).toBeVisible();
  expect(await a.page.evaluate(() => !!document.activeElement?.closest('.notify-popups'))).toBe(false);
  await a.page.mouse.move(5, 795); // курсор не над баннером
  await shot(a.page, 'popup-desktop-dark');
  await setTheme(a.page, 'light');
  await shot(a.page, 'popup-desktop-light');
  // Подписи баннера читаются (≥ 4.5:1) во всех четырёх базовых темах, и под курсором тоже (фон подсвечен bg-hover)
  for (const theme of ['dark', 'light', 'graphite', 'black'] as const) {
    await setTheme(a.page, theme);
    for (const hover of [false, true]) {
      if (hover) await card.locator('.notify-popup-open').hover();
      else await a.page.mouse.move(5, 795);
      const ratios = await card.evaluate((root) => {
        const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        // Фон под элементом: полупрозрачные слои сводятся снизу вверх
        const backdrop = (el: Element | null): number[] => {
          const chain: number[][] = [];
          for (let e = el; e; e = e.parentElement) {
            const [r, g, b, al = 1] = rgba(getComputedStyle(e).backgroundColor);
            if (al > 0) chain.push([r, g, b, al]);
            if (al >= 1) break;
          }
          return chain.reverse().reduce((acc, [r, g, b, al]) => [0, 1, 2].map((i) => acc[i] * (1 - al) + [r, g, b][i] * al), [0, 0, 0]);
        };
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        return ['.notify-popup-name', '.notify-popup-where', '.notify-popup-text'].map((sel) => {
          const el = root.querySelector(sel)!;
          const [x, y] = [lum(rgba(getComputedStyle(el).color).slice(0, 3)), lum(backdrop(el))].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        });
      });
      for (const r of ratios) expect(r, `${theme}${hover ? ' hover' : ''}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await a.page.mouse.move(5, 795);
  await setTheme(a.page, 'dark');

  // Второе сообщение того же чата — тот же баннер, со счётчиком
  await post(request, bob, dm, 'и ещё одно');
  await expect(cards).toHaveCount(1);
  await expect(card.locator('.notify-popup-where')).toHaveText('Личные сообщения · 2 сообщения');
  await expect(card.locator('.notify-popup-text')).toHaveText('и ещё одно');

  // Щелчок открывает чат на сообщении, баннер пропадает
  await card.locator('.notify-popup-open').click();
  await expect(msg(a, 'и ещё одно')).toBeVisible();
  await expect(cards).toHaveCount(0);
  expect(await openChannelId(a)).toBe(dm);

  // Открытый чат — баннера нет
  await post(request, bob, dm, 'в открытом чате');
  await expect(msg(a, 'в открытом чате')).toBeVisible();
  await expect(cards).toHaveCount(0);

  // ── Свои сообщения (с другого устройства) — нет; сервер по умолчанию «только @упоминания» ──
  await home();
  await post(request, alice, dm, 'моё сообщение');
  await post(request, bob, general, 'без упоминания');
  await quiet(a.page);
  await expect(cards).toHaveCount(0);
  await post(request, bob, general, `@${a.username} глянь сюда`);
  await expect(cards).toHaveCount(1);
  await expect(card).toHaveClass(/mention/);
  await expect(card.locator('.notify-popup-where')).toHaveText(/^#.+ · Поляна$/);
  await card.getByRole('button', { name: 'Закрыть уведомление' }).click();
  await expect(cards).toHaveCount(0);

  // ── Не больше трёх: четвёртый чат вытесняет самый старый в «И ещё 1» ──
  const others = [];
  for (const name of ['Вера', 'Глеб']) {
    const u = await apiRegister(request, name);
    expect((await call(request, u, 'POST', '/servers/join', { code })).status).toBeLessThan(300);
    const ch = (await call(request, u, 'POST', '/dms', { user_id: alice.id })).body.channel_id as number;
    others.push({ u, ch, name });
  }
  await post(request, bob, dm, 'от Боба');
  await expect(cards).toHaveCount(1);
  for (const o of others) await post(request, o.u, o.ch, `от ${o.name}`);
  await post(request, bob, general, `@${a.username} от сервера`);
  await expect(cards).toHaveCount(3);
  // Новые сверху: сервер, Глеб, Вера; Боб ушёл в счётчик
  await expect(cards.locator('.notify-popup-text')).toHaveText([`@${a.username} от сервера`, 'от Глеб', 'от Вера']);
  await expect(popups.locator('.notify-popups-more')).toContainText('И ещё 1');
  await popups.getByRole('button', { name: 'Скрыть все' }).click();
  await expect(cards).toHaveCount(0);
  await expect(popups.locator('.notify-popups-more')).toHaveCount(0);

  // ── Автоскрытие ~5 с; пока курсор на баннере — не скрывается ──
  await post(request, bob, dm, 'наведите на меня');
  await expect(cards).toHaveCount(1);
  await card.hover();
  await a.page.waitForTimeout(6500);
  await expect(cards).toHaveCount(1);
  await a.page.mouse.move(5, 795);
  await expect(cards).toHaveCount(0, { timeout: 7000 });

  // ── Фокус с клавиатуры держит баннер, в том числе после перестановки стопки; ушёл фокус — баннер скрывается.
  // «Держат» проверяется по :focus-within в момент срабатывания таймера, а не счётчиком focus/blur ──
  const vera = others[0];
  await post(request, bob, dm, 'от Боба снова');
  await post(request, vera.u, vera.ch, 'от Веры');
  await expect(cards.locator('.notify-popup-text')).toHaveText(['от Веры', 'от Боба снова']);
  const veraCard = cards.filter({ hasText: 'от Веры' });
  await veraCard.locator('.notify-popup-open').focus();
  // Новое сообщение Боба поднимает его баннер наверх — узлы стопки переставляются
  await post(request, bob, dm, 'и опять Боб');
  await expect(cards.locator('.notify-popup-text')).toHaveText(['и опять Боб', 'от Веры']);
  await a.page.waitForTimeout(6500);
  if (await a.page.evaluate(() => !!document.activeElement?.closest('.notify-popup'))) await expect(veraCard).toHaveCount(1);
  await a.page.locator('.side-item').first().focus();
  await expect(veraCard).toHaveCount(0, { timeout: 8000 });
  await expect(cards).toHaveCount(0, { timeout: 8000 });

  // ── Закрыли баннер с клавиатуры — фокус на соседнем баннере, а не в body ──
  await post(request, bob, dm, 'первый');
  await post(request, vera.u, vera.ch, 'второй');
  await expect(cards).toHaveCount(2);
  const sideItem = a.page.locator('.side-item', { hasText: 'Боб' });
  await sideItem.focus();
  await cards.first().getByRole('button', { name: 'Закрыть уведомление' }).focus();
  await a.page.keyboard.press('Enter');
  await expect(cards).toHaveCount(1);
  expect(await a.page.evaluate(() => document.activeElement?.classList.contains('notify-popup-open'))).toBe(true);
  await expect(cards.first()).toContainText('первый');
  await a.page.keyboard.press('Tab');
  await a.page.keyboard.press('Enter'); // «Закрыть уведомление» последнего — фокус возвращается туда, откуда пришёл
  await expect(cards).toHaveCount(0);
  await expect(sideItem).toBeFocused();

  // ── Заглушённая личка — нет ──
  const dmItem = a.page.locator('.side-item', { hasText: 'Боб' });
  await dmItem.click({ button: 'right' });
  await a.page.getByRole('menuitemcheckbox', { name: /Заглушить канал/ }).click();
  await expect(dmItem).toHaveClass(/muted-ch/);
  await post(request, bob, dm, 'в заглушённую');
  await quiet(a.page);
  await expect(cards).toHaveCount(0);
  await dmItem.click({ button: 'right' });
  await a.page.getByRole('menuitemcheckbox', { name: /Включить уведомления канала/ }).click();
  await expect(dmItem).not.toHaveClass(/muted-ch/);

  // ── Настройки → Уведомления: выключить баннеры (хранится в localStorage) ──
  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(a, 'Уведомления').click();
  const toggle = a.page.getByRole('switch', { name: 'Всплывающие уведомления в приложении' });
  await expect(toggle).toHaveJSProperty('checked', true);
  await toggle.click();
  await expect(toggle).toHaveJSProperty('checked', false);
  expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('vicinity.notify') ?? '{}').popups)).toBe(false);
  await a.page.getByRole('button', { name: 'Закрыть настройки' }).first().click();
  await home();
  await post(request, bob, dm, 'баннеры выключены');
  await quiet(a.page);
  await expect(cards).toHaveCount(0);
  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await settingsTab(a, 'Уведомления').click();
  await toggle.click();
  await expect(toggle).toHaveJSProperty('checked', true);
  await a.page.getByRole('button', { name: 'Закрыть настройки' }).first().click();
  await home();

  // ── Настройки открыты поверх лички: её сообщения дают баннер, щелчок закрывает настройки и показывает чат ──
  await dmItem.click();
  await expect(a.page.locator('.chat-head')).toContainText('Боб');
  await a.page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(a.page.getByRole('button', { name: 'Закрыть настройки' }).first()).toBeVisible();
  await post(request, bob, dm, 'пока вы в настройках');
  await expect(cards).toHaveCount(1);
  await card.locator('.notify-popup-open').click();
  await expect(a.page.getByRole('button', { name: 'Закрыть настройки' })).toHaveCount(0);
  await expect(msg(a, 'пока вы в настройках')).toBeVisible();
  await expect(cards).toHaveCount(0);
  await home();

  // ── Телефон 390 px: баннер сверху на всю ширину с отступами; свайп вбок закрывает ──
  await a.page.setViewportSize({ width: 390, height: 844 });
  await post(request, bob, dm, 'Длинное сообщение, которое на телефоне занимает две строки и обрезается многоточием, чтобы баннер не рос бесконечно вниз');
  await expect(cards).toHaveCount(1);
  // Появление сдвигает баннер на --space-2 вверх — меряем после анимации
  await card.evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.width).toBeGreaterThan(390 - 2 * 8 - 2);
  expect(await card.locator('.notify-popup-text').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await a.page.mouse.move(195, 800);
  await shot(a.page, 'popup-390-dark');
  await setTheme(a.page, 'light');
  await shot(a.page, 'popup-390-light');
  await setTheme(a.page, 'dark');
  // Свайп пальцем (pointerType touch): короткий (меньше 72 px) возвращает баннер на место, длинный — закрывает сразу,
  // а не автоскрытием через 5 с
  const swipe = (to: number) =>
    card.evaluate((el, end) => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const ev = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
      ev('pointerdown', r.left + 40);
      for (let x = 60; x <= end; x += 20) ev('pointermove', r.left + x);
      ev('pointerup', r.left + end);
    }, to);
  await swipe(100);
  await a.page.waitForTimeout(300);
  await expect(cards).toHaveCount(1);
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await swipe(200);
  await expect(cards).toHaveCount(0, { timeout: 1000 });

  expect(pageErrors(a.page)).toEqual([]);
});
