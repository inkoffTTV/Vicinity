// Поиск пути по карте: сетка 1,5 м, занятые клетки — деревья и фонтаны. Чистая функция от карты,
// поэтому детерминирована и одинакова на клиенте и сервере. Здания-вышки в сетку не входят:
// они небольшие и их юниты обходят по касательной (pushStatic в world.ts).
import { mapTrees, type MapDef, type P2 } from './map';

export const NAV_CELL = 1.5;

export interface NavGrid {
  /** Клеток по стороне */
  n: number;
  /** Координата левого/нижнего края сетки */
  min: number;
  /** 1 — занято */
  blocked: Uint8Array;
}

const gridCache = new WeakMap<MapDef, NavGrid>();

export function navGrid(m: MapDef): NavGrid {
  let g = gridCache.get(m);
  if (g) return g;
  const min = -m.limit;
  const n = Math.ceil((2 * m.limit) / NAV_CELL);
  const blocked = new Uint8Array(n * n);
  const mark = (x: number, z: number, r: number) => {
    const c0 = Math.max(0, Math.floor((x - r - min) / NAV_CELL));
    const c1 = Math.min(n - 1, Math.floor((x + r - min) / NAV_CELL));
    const r0 = Math.max(0, Math.floor((z - r - min) / NAV_CELL));
    const r1 = Math.min(n - 1, Math.floor((z + r - min) / NAV_CELL));
    for (let i = c0; i <= c1; i++)
      for (let j = r0; j <= r1; j++) {
        const cx = min + (i + 0.5) * NAV_CELL;
        const cz = min + (j + 0.5) * NAV_CELL;
        if (Math.hypot(cx - x, cz - z) < r) blocked[j * n + i] = 1;
      }
  };
  // Радиус дерева в столкновениях — 0.75·s + 0.6·радиус юнита; берём с запасом на героя
  for (const t of mapTrees(m)) mark(t.x, t.z, 0.75 * t.s + 0.7);
  for (const f of m.fountains) mark(f.x, f.z, 3.4);
  gridCache.set(m, (g = { n, min, blocked }));
  return g;
}

const cellOf = (g: NavGrid, v: number) => Math.max(0, Math.min(g.n - 1, Math.floor((v - g.min) / NAV_CELL)));
const centerOf = (g: NavGrid, c: number) => g.min + (c + 0.5) * NAV_CELL;
const isBlocked = (g: NavGrid, x: number, z: number) => g.blocked[cellOf(g, z) * g.n + cellOf(g, x)] === 1;

/** Прямая от a до b не задевает занятых клеток */
export function navClear(m: MapDef, ax: number, az: number, bx: number, bz: number): boolean {
  const g = navGrid(m);
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / (NAV_CELL * 0.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isBlocked(g, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/** Ближайшая свободная клетка (поиск кольцами) */
function freeCell(g: NavGrid, ci: number, cj: number): number {
  if (!g.blocked[cj * g.n + ci]) return cj * g.n + ci;
  for (let r = 1; r < 8; r++)
    for (let di = -r; di <= r; di++)
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= g.n || j >= g.n) continue;
        if (!g.blocked[j * g.n + i]) return j * g.n + i;
      }
  return cj * g.n + ci;
}

// Рабочие массивы A* — переиспользуются между вызовами (размер — по самой большой сетке)
let gScore = new Float32Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let gen = 0;

/** Двоичная куча по f-оценке */
class Heap {
  ids: number[] = [];
  fs: number[] = [];
  push(id: number, f: number) {
    const a = this.ids;
    const b = this.fs;
    let i = a.length;
    a.push(id);
    b.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (b[p] <= f) break;
      a[i] = a[p];
      b[i] = b[p];
      i = p;
    }
    a[i] = id;
    b[i] = f;
  }
  pop(): number {
    const a = this.ids;
    const b = this.fs;
    const top = a[0];
    const lastId = a.pop()!;
    const lastF = b.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && b[r] < b[l] ? r : l;
        if (b[c] >= lastF) break;
        a[i] = a[c];
        b[i] = b[c];
        i = c;
      }
      a[i] = lastId;
      b[i] = lastF;
    }
    return top;
  }
  get size() {
    return this.ids.length;
  }
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Путь от (sx, sz) к (tx, tz): список точек без стартовой, последняя — сама цель.
 *  Если прямая свободна — одна точка. Если пути нет — к ближайшей достижимой точке. */
export function findPath(m: MapDef, sx: number, sz: number, tx: number, tz: number): P2[] {
  if (navClear(m, sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const g = navGrid(m);
  const N = g.n * g.n;
  if (gScore.length < N) {
    gScore = new Float32Array(N);
    parent = new Int32Array(N);
    stamp = new Uint32Array(N);
    closed = new Uint32Array(N);
  }
  gen++;
  const start = freeCell(g, cellOf(g, sx), cellOf(g, sz));
  const goal = freeCell(g, cellOf(g, tx), cellOf(g, tz));
  const gi = goal % g.n;
  const gj = (goal / g.n) | 0;
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - gi);
    const dz = Math.abs(j - gj);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = new Heap();
  stamp[start] = gen;
  gScore[start] = 0;
  parent[start] = -1;
  open.push(start, h(start % g.n, (start / g.n) | 0));
  let best = start;
  let bestH = Infinity;
  let found = false;
  let expanded = 0;
  while (open.size && expanded < 20000) {
    const cur = open.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    expanded++;
    if (cur === goal) {
      found = true;
      break;
    }
    const ci = cur % g.n;
    const cj = (cur / g.n) | 0;
    const ch = h(ci, cj);
    if (ch < bestH) {
      bestH = ch;
      best = cur;
    }
    for (const [di, dj, cost] of DIRS) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= g.n || j >= g.n) continue;
      const nb = j * g.n + i;
      if (g.blocked[nb] || closed[nb] === gen) continue;
      // По диагонали не срезаем угол между двумя занятыми клетками
      if (di && dj && (g.blocked[cj * g.n + i] || g.blocked[j * g.n + ci])) continue;
      const ng = gScore[cur] + cost;
      if (stamp[nb] === gen && ng >= gScore[nb]) continue;
      stamp[nb] = gen;
      gScore[nb] = ng;
      parent[nb] = cur;
      open.push(nb, ng + h(i, j));
    }
  }
  const end = found ? goal : best;
  const cells: number[] = [];
  for (let c = end; c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  const pts: P2[] = cells.map((c) => ({ x: centerOf(g, c % g.n), z: centerOf(g, (c / g.n) | 0) }));
  if (found) pts[pts.length - 1] = { x: tx, z: tz };
  // Спрямляем: от текущей точки идём вперёд по пути, пока следующая точка видна напрямую
  const out: P2[] = [];
  let from: P2 = { x: sx, z: sz };
  let k = 0;
  while (k < pts.length) {
    let far = k;
    while (far + 1 < pts.length && navClear(m, from.x, from.z, pts[far + 1].x, pts[far + 1].z)) far++;
    out.push(pts[far]);
    from = pts[far];
    k = far + 1;
  }
  return out;
}
