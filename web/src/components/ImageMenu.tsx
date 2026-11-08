import { Download, ExternalLink, Image as ImageIcon, Images, Link, Maximize2 } from 'lucide-react';
import { copyImage, copyText } from '../lib/clipboard';
import { desktop } from '../lib/desktop';
import { ImageItem, useImageMenu } from '../lib/imageMenu';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { Popover } from './Popover';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Имя файла: имя вложения от отправителя, но расширение — настоящее, из адреса на сервере */
export function imageFileName({ url, name }: ImageItem): string {
  const ext = IMAGE_EXT.exec(url.split(/[?#]/)[0])?.[0].toLowerCase() ?? '';
  const base = name.replace(/\.[^.]*$/, '').trim() || 'image';
  return base + ext;
}

// Браузер: скачать через blob — у картинок на сервере нет Content-Disposition, а атрибут download
// у ссылки на адрес работает не везде; имя файла — исходное имя вложения
async function download(item: ImageItem): Promise<boolean> {
  const { url } = item;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = imageFileName(item);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch {
    return false;
  }
}

async function saveOne(item: ImageItem) {
  const { toast } = useStore.getState();
  try {
    if (desktop?.saveImage) {
      // ПК 1.3.0: true — сохранено, null — отмена в диалоге, false — скачивание не удалось
      const saved = await desktop.saveImage(item.url, item.name);
      if (saved !== false) return;
      toast('Не удалось сохранить изображение. Проверьте связь и попробуйте ещё раз', 'error');
      return;
    }
  } catch {
    /* старый или сломанный мост — сохраняем как в браузере */
  }
  if (!(await download(item))) toast('Не удалось сохранить изображение. Проверьте связь и попробуйте ещё раз', 'error');
}

async function saveAll(items: ImageItem[]) {
  const { toast } = useStore.getState();
  if (desktop?.saveImages) {
    try {
      const n = await desktop.saveImages(items);
      if (n >= 0) toast(albumResult(n, items.length), n === items.length ? 'info' : 'error');
      return;
    } catch {
      /* сохраняем как в браузере */
    }
  }
  let ok = 0;
  for (const [k, item] of items.entries()) {
    // Пауза между файлами: браузер не принимает пачку скачиваний за одно мгновение
    if (k) await new Promise((r) => window.setTimeout(r, 250));
    if (await download(item)) ok++;
  }
  toast(albumResult(ok, items.length), ok === items.length ? 'info' : 'error');
}

function albumResult(saved: number, total: number): string {
  return saved === total
    ? `Сохранено изображений: ${saved}`
    : `Сохранено ${saved} из ${total} — проверьте связь и сохраните остальные ещё раз`;
}

async function copyPicture(url: string) {
  const { toast } = useStore.getState();
  let ok = false;
  try {
    ok = !!(await desktop?.copyImage?.(url));
  } catch {
    ok = false;
  }
  if (!ok) ok = await copyImage(url);
  toast(ok ? 'Изображение скопировано' : 'Не удалось скопировать изображение — сохраните его или скопируйте ссылку', ok ? 'info' : 'error');
}

/** Меню картинки по правой кнопке / долгому нажатию: открыть, сохранить, копировать, альбом */
export function ImageMenu() {
  const at = useImageMenu((s) => s.at);
  const close = useImageMenu((s) => s.close);
  if (!at) return null;
  const { target } = at;
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };
  const toast = useStore.getState().toast;
  const album = target.album.length > 1 ? target.album : null;

  return (
    <Popover point={at.point} onClose={close} className="menu image-menu" role="menu" label="Действия с изображением">
      {target.open && (
        <button role="menuitem" onClick={run(target.open)}>
          <Icon icon={Maximize2} size={16} />
          Открыть
        </button>
      )}
      <button role="menuitem" onClick={run(() => saveOne(target))}>
        <Icon icon={Download} size={16} />
        Сохранить
      </button>
      <button role="menuitem" onClick={run(() => copyPicture(target.url))}>
        <Icon icon={ImageIcon} size={16} />
        Копировать изображение
      </button>
      <button
        role="menuitem"
        onClick={run(async () => {
          const ok = await copyText(target.url);
          toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку — откройте оригинал и скопируйте адрес', ok ? 'info' : 'error');
        })}
      >
        <Icon icon={Link} size={16} />
        Копировать ссылку
      </button>
      <button role="menuitem" onClick={run(() => window.open(target.url, '_blank', 'noopener,noreferrer'))}>
        <Icon icon={ExternalLink} size={16} />
        Открыть оригинал в браузере
      </button>
      {album && (
        <button role="menuitem" onClick={run(() => saveAll(album))}>
          <Icon icon={Images} size={16} />
          Сохранить все из альбома ({album.length})
        </button>
      )}
    </Popover>
  );
}
