import { expect, Locator, Page, test } from '@playwright/test';
import { createServer, pageErrors, registerUser } from './helpers';
import { settingsTab } from './w2-helpers';
import { openNav } from './ui-helpers';

// Телефон 360×640: окна настроек не выходят за экран, раздел прокручивается до последнего
// элемента, и каждая последняя кнопка раздела нажимается.

const PHONE = { width: 360, height: 640 };

/** Элемент целиком в видимой области экрана */
async function expectOnScreen(page: Page, el: Locator, what: string) {
  // Дождаться конца появления окон (лист выезжает снизу) — меряем итоговое положение
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const box = await el.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, what).not.toBeNull();
  expect(box!.y, `${what}: верх`).toBeGreaterThanOrEqual(0);
  expect(box!.x, `${what}: левый край`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${what}: низ`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(box!.x + box!.width, `${what}: правый край`).toBeLessThanOrEqual(vp.width + 0.5);
}

/** Прокрутить раздел до конца и убедиться, что последний элемент управления виден и нажимается */
async function checkPanel(page: Page, panel: Locator, what: string, frame = '.modal.settings-modal') {
  await expect(panel).toBeVisible();
  // Окно целиком на экране, страница вбок не прокручивается
  await expectOnScreen(page, page.locator(frame), `${what}: окно`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${what}: ширина страницы`).toBeLessThanOrEqual(PHONE.width);

  const scrolled = await panel.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2;
  });
  expect(scrolled, `${what}: раздел прокручивается до конца`).toBe(true);

  const controls = panel.locator('button:visible:not([disabled]), input:visible:not([disabled]), select:visible, textarea:visible');
  // Пустой раздел (например, банов нет) — проверять нечего
  if ((await controls.count()) === 0) return;
  const last = controls.last();
  await last.scrollIntoViewIfNeeded();
  await expectOnScreen(page, last, `${what}: последний элемент`);
  // Проверка нажатия: Playwright убеждается, что элемент принимает щелчок (ничто его не перекрывает)
  await last.click({ trial: true });

  // И последняя кнопка раздела — тоже
  const buttons = panel.locator('button:visible:not([disabled])');
  if ((await buttons.count()) > 0) {
    await buttons.last().scrollIntoViewIfNeeded();
    await expectOnScreen(page, buttons.last(), `${what}: последняя кнопка`);
    await buttons.last().click({ trial: true });
  }
}

test('settings on a 360×640 phone: list of sections, each opens full-screen and scrolls to its last control', async ({ browser }) => {
  const u = await registerUser(browser, 'Мобила', { viewport: PHONE });
  const page = u.page;
  const frame = '.settings-page';

  await openNav(page);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const nav = page.locator('.settings-nav');
  await expect(nav).toBeVisible();
  await expectOnScreen(page, nav.getByRole('button', { name: 'Закрыть настройки' }), 'закрыть');

  const sections = ['Аккаунт', 'Профиль', 'Внешний вид', 'Значок приложения', 'Голос и видео', 'Уведомления', 'Горячие клавиши', 'Доступность', 'О подписке'];
  for (const tab of sections) {
    // Пункт меню виден и нажимается, даже если список прокручен
    await settingsTab(u, tab).scrollIntoViewIfNeeded();
    await expectOnScreen(page, settingsTab(u, tab), `пункт ${tab}`);
    await settingsTab(u, tab).click();
    await expect(settingsTab(u, tab)).toHaveAttribute('aria-current', 'page');
    // Раздел — на весь экран, с кнопкой «К разделам»
    const back = page.locator('.settings-main').getByRole('button', { name: 'К разделам' });
    await expectOnScreen(page, back, `${tab}: назад`);
    await checkPanel(page, page.locator('.settings-main-body'), `настройки: ${tab}`, frame);
    await back.click();
    await expect(nav).toBeVisible();
  }

  // Самая длинная форма — аккаунт: последний элемент доступен и с открытой «клавиатурой»
  // (видимая область ниже — окно сжимается вместе с ней)
  await settingsTab(u, 'Аккаунт').click();
  await page.setViewportSize({ width: 360, height: 360 });
  await checkPanel(page, page.locator('.settings-main-body'), 'аккаунт при открытой клавиатуре', frame);
  await page.setViewportSize(PHONE);

  await page.locator('.settings-main').getByRole('button', { name: 'Закрыть настройки' }).click();
  await expect(page.locator(frame)).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
  await u.context.close();
});

test('server settings, dialogs and menus on a 360×640 phone stay within the screen', async ({ browser }) => {
  const u = await registerUser(browser, 'Хозяин', { viewport: PHONE });
  const page = u.page;

  await openNav(page);
  await createServer(u, 'Карманный сервер');
  await openNav(page);
  await page.locator('.side-head').click();
  await expectOnScreen(page, page.locator('.dropdown button').last(), 'меню сервера');
  await page.locator('.dropdown button', { hasText: 'Настройки сервера' }).click();
  for (const tab of ['Обзор', 'Приглашения', 'Участники', 'Баны', 'Удаление сервера']) {
    await settingsTab(u, tab).scrollIntoViewIfNeeded();
    await settingsTab(u, tab).click();
    await expectOnScreen(page, settingsTab(u, tab), `вкладка ${tab}`);
    await checkPanel(page, page.locator('#server-panel'), `сервер: ${tab}`);
  }
  // Подтверждение поверх настроек — лист снизу, обе кнопки на экране
  await page.locator('#server-panel').getByRole('button', { name: 'Удалить сервер' }).click();
  const confirm = page.locator('.modal').last();
  await expectOnScreen(page, confirm, 'подтверждение');
  await expectOnScreen(page, confirm.getByRole('button', { name: 'Отмена' }), 'отмена');
  await expectOnScreen(page, confirm.getByRole('button', { name: 'Удалить навсегда' }), 'удалить навсегда');
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  // Меню пользователя внизу боковой панели и поле ввода
  await openNav(page);
  await page.locator('.user-panel-me').click();
  await expectOnScreen(page, page.locator('.dropdown.up'), 'меню статуса');
  await page.locator('.user-panel-me').click();
  await page.locator('.nav-scrim').click({ position: { x: 350, y: 300 } });
  // Пустое поле — вместо «Отправить» кнопка записи голосового
  await expectOnScreen(page, page.getByRole('button', { name: /Отправить|Записать голосовое/ }), 'отправить');
  await expectOnScreen(page, page.getByRole('button', { name: 'Прикрепить файлы' }), 'прикрепить');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);

  // Быстрый переход — сверху, во всю ширину
  await page.keyboard.press('Control+k');
  await expectOnScreen(page, page.locator('.modal.switcher'), 'быстрый переход');
  await page.keyboard.press('Escape');

  expect(pageErrors(page)).toEqual([]);
  await u.context.close();
});
