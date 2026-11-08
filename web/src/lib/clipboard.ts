/** Скопировать текст в буфер обмена. Clipboard API есть только в защищённом контексте (https, localhost) —
 *  иначе через скрытое поле и execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

// Буфер обмена Chromium принимает картинки только в PNG: jpeg, webp и gif перерисовываем через canvas
// (вложения лежат на том же сервере — canvas не «испорчен» чужим источником). У gif остаётся первый кадр.
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

/** Скопировать картинку по адресу в буфер обмена (PNG). Нужен защищённый контекст и жест пользователя. */
export async function copyImage(url: string): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  try {
    // Обещание внутри ClipboardItem: жест пользователя не «истекает», пока картинка грузится (Safari)
    const png = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then(asPng);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
