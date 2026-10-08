import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pageErrors, registerUser, send } from './helpers';
import { composer, dmBothSides, msg, msgText } from './w1-helpers';

const bytes = (n: number, fill = 7) => Buffer.alloc(n, fill);

test('files: queue of several files, card with size and download, media players, rejected types', async ({ browser, request }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await dmBothSides(a, b);
  const input = a.page.locator('.composer input[type=file]');

  // Запрещённый тип не попадает в очередь
  await input.setInputFiles({ name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>1</script>') });
  await expect(a.page.locator('.toast', { hasText: 'Файлы .html отправлять нельзя' })).toBeVisible();
  await expect(a.page.locator('.upload-queue')).toHaveCount(0);

  // Перетаскивание файла на поле ввода
  const dropped = await a.page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['перетащено'], 'dragged.txt', { type: 'text/plain' }));
    return dt;
  });
  await a.page.locator('.composer').dispatchEvent('dragover', { dataTransfer: dropped });
  await expect(a.page.locator('.composer.dragging')).toBeVisible();
  await a.page.locator('.composer').dispatchEvent('drop', { dataTransfer: dropped });
  await expect(a.page.locator('.composer.dragging')).toHaveCount(0);
  await expect(a.page.locator('.upload-queue')).toContainText('dragged.txt');
  await a.page.getByRole('button', { name: 'Убрать вложение «dragged.txt»' }).click();
  await expect(a.page.locator('.upload-queue')).toHaveCount(0);

  // Несколько файлов: очередь, лишний убираем; каждый уходит отдельным сообщением, текст — с первым
  const report = bytes(300_000);
  const notes = Buffer.from('заметки к отчёту');
  await input.setInputFiles([
    { name: 'отчёт.pdf', mimeType: 'application/pdf', buffer: report },
    { name: 'лишний.txt', mimeType: 'text/plain', buffer: Buffer.from('не нужен') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: notes },
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: bytes(2048) },
    { name: 'voice.ogg', mimeType: 'audio/ogg', buffer: bytes(1024) },
  ]);
  const queue = a.page.locator('.upload-queue .upload-preview');
  await expect(queue).toHaveCount(5);
  await a.page.getByRole('button', { name: 'Убрать вложение «лишний.txt»' }).click();
  await expect(queue).toHaveCount(4);
  await composer(a).fill('файлы к письму');
  await composer(a).press('Enter');
  await expect(queue).toHaveCount(0);

  // Карточка: значок по типу, имя, размер, ссылка на скачивание с исходным именем
  const card = msg(b, 'файлы к письму').locator('.file-card');
  await expect(card.locator('.file-name')).toHaveText('отчёт.pdf');
  await expect(card).toContainText('293 КБ');
  await expect(card.locator('.file-icon')).toHaveText('📕');
  const link = card.locator('a.file-name');
  await expect(link).toHaveAttribute('href', /^\/uploads\/files\/[0-9a-f]+\.pdf$/);
  await expect(link).toHaveAttribute('download', 'отчёт.pdf');
  const file = await request.get((await link.getAttribute('href'))!);
  expect(file.headers()['content-disposition']).toBe(`attachment; filename="_____.pdf"; filename*=UTF-8''${encodeURIComponent('отчёт.pdf')}`);
  expect((await file.body()).equals(report)).toBe(true);
  const notesCard = b.page.locator('.file-card', { hasText: 'notes.txt' });
  await expect(notesCard.locator('.file-icon')).toHaveText('📝');
  const [download] = await Promise.all([
    b.page.waitForEvent('download'),
    notesCard.getByRole('link', { name: 'Скачать «notes.txt»' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('notes.txt');
  expect(readFileSync(await download.path()).equals(notes)).toBe(true);

  // Видео и звук — встроенные проигрыватели
  const video = b.page.locator('.attachment-file.with-video video');
  await expect(video).toHaveAttribute('src', /^\/uploads\/files\/[0-9a-f]+\.mp4$/);
  await expect(b.page.locator('.attachment-file.with-video .file-name')).toHaveText('clip.mp4');
  await expect(b.page.locator('.attachment-file.with-audio audio')).toHaveAttribute('src', /\.ogg$/);
  // Лишний файл не ушёл
  await expect(b.page.locator('.file-name', { hasText: 'лишний.txt' })).toHaveCount(0);

  expect(pageErrors(a.page)).toEqual([]);
  expect(pageErrors(b.page)).toEqual([]);
});

test('files: upload progress is shown and the upload can be cancelled', async ({ browser }) => {
  const a = await registerUser(browser, 'Алиса');
  const b = await registerUser(browser, 'Боб');
  await dmBothSides(a, b);
  const input = a.page.locator('.composer input[type=file]');

  // Медленный канал на отправку — загрузка идёт несколько секунд
  const cdp = await a.context.newCDPSession(a.page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 256 * 1024,
  });

  // Отмена: сообщение исчезает, до собеседника ничего не доходит
  await input.setInputFiles({ name: 'big.zip', mimeType: 'application/zip', buffer: bytes(4_000_000) });
  await composer(a).fill('большой архив');
  await composer(a).press('Enter');
  const pending = a.page.locator('.msg.pending', { hasText: 'большой архив' });
  const bar = pending.getByRole('progressbar', { name: 'Загрузка «big.zip»' });
  await expect(bar).toBeVisible();
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
  await pending.getByRole('button', { name: 'Отменить' }).click();
  await expect(a.page.locator('.msg', { hasText: 'большой архив' })).toHaveCount(0);

  // Загрузка до конца: прогресс растёт, затем сообщение подтверждается
  await input.setInputFiles({ name: 'medium.zip', mimeType: 'application/zip', buffer: bytes(700_000) });
  await composer(a).fill('средний архив');
  await composer(a).press('Enter');
  const seen = new Set<number>();
  const uploading = a.page.locator('.msg.pending', { hasText: 'средний архив' }).getByRole('progressbar');
  await expect
    .poll(
      async () => {
        const v = await uploading.getAttribute('aria-valuenow', { timeout: 500 }).catch(() => null);
        if (v !== null) seen.add(Number(v));
        return [...seen].some((x) => x > 0 && x < 100);
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expect(msg(b, 'средний архив').locator('.file-name')).toHaveText('medium.zip');
  await expect(a.page.locator('.msg.pending')).toHaveCount(0);

  // Отменённый файл так и не появился
  await send(a, 'последнее');
  await expect(msgText(b, 'последнее')).toBeVisible();
  await expect(b.page.locator('.msg', { hasText: 'большой архив' })).toHaveCount(0);
  expect(pageErrors(a.page)).toEqual([]);
});
