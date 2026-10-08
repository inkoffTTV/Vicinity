// Перебор для капчи ALTCHA: найти number ∈ [0, max], при котором SHA-256(salt + number) == challenge.
// Свой SHA-256 вместо crypto.subtle: тот асинхронный (медленно на сотнях тысяч коротких хэшей)
// и есть только на HTTPS. Модуль без зависимостей — работает и в Web Worker, и в основном потоке.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const W = new Uint32Array(64);
const H = new Uint32Array(8);

function compress(block: Uint8Array, offset: number) {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    W[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
  }
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15], w2 = W[i - 2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
}

const INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
let buf = new Uint8Array(128);

/** SHA-256 строки из байтов 0..255 (ASCII); результат — в H (8 слов) */
function sha256Ascii(text: string) {
  const len = text.length;
  const blocks = ((len + 8) >> 6) + 1;
  if (buf.length < blocks * 64) buf = new Uint8Array(blocks * 64);
  buf.fill(0, 0, blocks * 64);
  for (let i = 0; i < len; i++) buf[i] = text.charCodeAt(i) & 0xff;
  buf[len] = 0x80;
  const bits = len * 8;
  const end = blocks * 64;
  buf[end - 4] = (bits >>> 24) & 0xff;
  buf[end - 3] = (bits >>> 16) & 0xff;
  buf[end - 2] = (bits >>> 8) & 0xff;
  buf[end - 1] = bits & 0xff;
  for (let i = 0; i < 8; i++) H[i] = INIT[i];
  for (let i = 0; i < blocks; i++) compress(buf, i * 64);
}

/** hex SHA-256 строки (для проверок) */
export function sha256Hex(text: string): string {
  sha256Ascii(String.fromCharCode(...new TextEncoder().encode(text)));
  let out = '';
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

/** number, решающий задачу, или -1 (нет решения до max) */
export function solve(salt: string, challenge: string, max: number): number {
  if (!/^[0-9a-f]{64}$/.test(challenge)) return -1;
  const target = new Uint32Array(8);
  for (let i = 0; i < 8; i++) target[i] = parseInt(challenge.slice(i * 8, i * 8 + 8), 16);
  const ascii = salt; // соль от сервера — ASCII (hex + "?expires=…")
  for (let n = 0; n <= max; n++) {
    sha256Ascii(ascii + n);
    if (
      H[0] >>> 0 === target[0] && H[1] >>> 0 === target[1] && H[2] >>> 0 === target[2] &&
      H[3] >>> 0 === target[3] && H[4] >>> 0 === target[4] && H[5] >>> 0 === target[5] &&
      H[6] >>> 0 === target[6] && H[7] >>> 0 === target[7]
    )
      return n;
  }
  return -1;
}
