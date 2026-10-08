// Вложения: что можно отправить (docs/API.md §2), как показать в ленте и подписать размер.

/** Сервер принимает файлы до 15 МБ */
const MAX_UPLOAD = 15 * 1024 * 1024;

// Расширения, которые сервер отклоняет (415): исполняемое и то, что браузер может выполнить
const BLOCKED = new Set(
  (
    'html htm shtml xhtml mht svg xml xsl js mjs cjs php exe bat cmd com scr pif cpl msi msp dll jar app lnk reg ' +
    'sh bash ps1 psm1 vbs vbe wsf wsh hta'
  ).split(' '),
);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Почему файл нельзя отправить; '' — можно */
export function uploadProblem(f: File): string {
  if (f.size > MAX_UPLOAD) return `«${f.name}» больше 15 МБ`;
  if (f.size === 0) return `«${f.name}» пустой`;
  if (BLOCKED.has(extOf(f.name))) return `Файлы .${extOf(f.name)} отправлять нельзя`;
  return '';
}

/** Встроенный проигрыватель для видео и звука; остальное — карточкой со ссылкой */
export function mediaKind(name: string): 'video' | 'audio' | null {
  const ext = extOf(name);
  if (ext === 'mp4' || ext === 'webm') return 'video';
  if (ext === 'mp3' || ext === 'ogg' || ext === 'wav') return 'audio';
  return null;
}

const ICONS: [string, string][] = [
  ['pdf', '📕'],
  ['doc docx odt rtf txt md', '📝'],
  ['xls xlsx ods csv', '📊'],
  ['ppt pptx odp key', '📽️'],
  ['zip rar 7z tar gz bz2 xz', '🗜️'],
  ['mp3 ogg wav flac m4a aac opus', '🎵'],
  ['mp4 webm mkv mov avi', '🎬'],
  ['png jpg jpeg gif webp bmp tiff ico heic', '🖼️'],
  ['json yaml yml toml ini log c cc cpp h hpp py rs go java kt ts tsx css sql', '🧾'],
];

export function fileIcon(name: string): string {
  const ext = extOf(name);
  return ICONS.find(([exts]) => exts.split(' ').includes(ext))?.[1] ?? '📄';
}

/** «512 Б», «1,4 КБ», «12,3 МБ» */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/** Имя вложения для подписи: присланное сервером или последний сегмент адреса */
export function attachmentName(name: string | undefined, url: string): string {
  if (name) return name;
  const tail = url.split('/').pop() ?? '';
  try {
    return decodeURIComponent(tail) || 'файл';
  } catch {
    return tail || 'файл';
  }
}
