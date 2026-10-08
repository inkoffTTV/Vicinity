// Иконки приложения (PWA, apple-touch-icon) из того же рисунка, что public/favicon.svg:
// закруглённый квадрат цвета акцента и белая «V». Рисуем сами (сглаживание 4×4 на пиксель)
// и кодируем PNG через zlib — без нативных зависимостей. Запуск: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x58, 0x65, 0xf2];
const FG = [0xff, 0xff, 0xff];
// Рисунок в координатах 0..64, как viewBox у favicon.svg
const V = [
  [18, 18],
  [32, 48],
  [46, 18],
];
const STROKE = 3.5; // половина stroke-width="7"
const RADIUS = 16;

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const inV = (x, y) => Math.min(segDist(x, y, V[0], V[1]), segDist(x, y, V[1], V[2])) <= STROKE;

function inRounded(x, y) {
  const dx = Math.max(RADIUS - x, x - (64 - RADIUS), 0);
  const dy = Math.max(RADIUS - y, y - (64 - RADIUS), 0);
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

/** RGBA-картинка size×size; fullBleed — фон до краёв (maskable, apple-touch-icon) */
function render(size, fullBleed) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 64;
          const v = ((y + (sy + 0.5) / SS) / size) * 64;
          if (!fullBleed && !inRounded(u, v)) continue;
          if (inV(u, v)) fg++;
          else bg++;
        }
      const total = SS * SS;
      const alpha = (bg + fg) / total;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = alpha ? Math.round((BG[c] * bg + FG[c] * fg) / (bg + fg)) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

function png(size, rgba) {
  const rows = [];
  for (let y = 0; y < size; y++) rows.push(Buffer.from([0]), rgba.subarray(y * size * 4, (y + 1) * size * 4));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const icons = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  // У maskable фон до краёв: система сама обрежет кругом или «каплей»; «V» и так в безопасной зоне
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, fullBleed] of icons) {
  writeFileSync(new URL(name, out), png(size, render(size, fullBleed)));
  console.log(`public/icons/${name} ${size}×${size}`);
}
