// Подобрать цвета темы из баннера профиля: картинка уменьшается до 48 px, пиксели собираются
// в корзины по 4 бита на канал, берутся 2–3 самые частые и достаточно разные корзины.
// Для тёмной основы цвета притемняются, для светлой — высветляются, чтобы интерфейс остался читаемым.

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;
const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Привести цвет к яркости, подходящей основе: тёмная 0.08–0.22, светлая 0.78–0.92 */
function fit(rgb: number[], base: 'dark' | 'light'): string {
  const [r, g, b] = rgb;
  const l = lum(r, g, b);
  const target = base === 'dark' ? Math.min(0.22, Math.max(0.08, l)) : Math.min(0.92, Math.max(0.78, l));
  if (base === 'dark') {
    // Затемняем множителем, сохраняя оттенок
    const k = l > 0 ? target / l : 0;
    return toHex(r * k, g * k, b * k);
  }
  // Высветляем — смешиваем с белым
  const t = l >= target ? 0 : (target - l) / (1 - l);
  return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить баннер'));
    img.src = url;
  });
}

/** Главные цвета картинки под основу темы (2–3 штуки) */
export function paletteOf(img: CanvasImageSource & { width?: number; height?: number }, base: 'dark' | 'light', count = 3): string[] {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map<number, { n: number; sum: number[] }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Почти серые и почти чёрные/белые пиксели не задают характер темы
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 24 || max < 20 || min > 235) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, sum: [0, 0, 0] };
    e.n++;
    e.sum[0] += r;
    e.sum[1] += g;
    e.sum[2] += b;
    buckets.set(key, e);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((e) => e.sum.map((v) => v / e.n));
  const picked: number[][] = [];
  for (const c of sorted) {
    if (picked.every((p) => dist2(p, c) > 60 * 60)) picked.push(c);
    if (picked.length >= count) break;
  }
  if (picked.length === 0) return base === 'dark' ? ['#1c1f2b', '#2a2f44'] : ['#e8ebf3', '#dfe4ef'];
  if (picked.length === 1) picked.push(picked[0].map((v, i) => (i === 2 ? Math.min(255, v + 60) : v * 0.7)));
  return picked.map((c) => fit(c, base));
}

/** Цвета темы из баннера по адресу (та же точка входа, что у <img src>) */
export async function colorsFromBanner(url: string, base: 'dark' | 'light'): Promise<string[]> {
  return paletteOf(await loadImage(url), base);
}
