// Карта 120×120: одна линия по диагонали от базы к базе, река поперёк, лес. Координаты — метры,
// ось x вправо, z «вниз» на миникарте. Команда 0 — внизу слева, команда 1 — вверху справа.
import { Rng } from './rng';

export interface P2 {
  x: number;
  z: number;
}

export const MAP_SEED = 20261019;
export const WATER = -0.55;
export const MAP_LIMIT = 59;
const S2 = Math.SQRT2;

/** Кристаллы (главные здания) */
export const ANCIENTS: readonly P2[] = [
  { x: -46, z: 46 },
  { x: 46, z: -46 },
];
/** Вышки на линии */
export const TOWERS: readonly P2[] = [
  { x: -20, z: 20 },
  { x: 20, z: -20 },
];
export const FOUNTAINS: readonly P2[] = [
  { x: -54, z: 54 },
  { x: 54, z: -54 },
];
export const SPAWNS: readonly P2[] = [
  { x: -51, z: 51 },
  { x: 51, z: -51 },
];

export const dLane = (x: number, z: number) => Math.abs(x + z) / S2;
export const dRiver = (x: number, z: number) => Math.abs(x - z) / S2;
export const dBase = (x: number, z: number) =>
  Math.min(Math.hypot(x - ANCIENTS[0].x, z - ANCIENTS[0].z), Math.hypot(x - ANCIENTS[1].x, z - ANCIENTS[1].z));

/** Направление «вперёд по линии» для команды (к вражеской базе) */
export function laneDir(team: number): P2 {
  return { x: (team ? -1 : 1) / S2, z: (team ? 1 : -1) / S2 };
}

export function groundH(x: number, z: number): number {
  let h =
    0.75 +
    Math.sin(x * 0.21) * 0.32 +
    Math.cos(z * 0.17) * 0.32 +
    Math.sin((x + z) * 0.11) * 0.35 +
    Math.sin(x * 0.53 + z * 0.47) * 0.12;
  const dl = dLane(x, z);
  if (dl < 5) h = 0.3 + (h - 0.3) * (dl / 5);
  const db = dBase(x, z);
  if (db < 14) h = 0.4 + (h - 0.4) * Math.max(0, (db - 10) / 4);
  const dr = dRiver(x, z);
  if (dr < 7) {
    let d = Math.pow(1 - dr / 7, 1.3) * 2.4;
    if (dl < 5) d *= 0.55 + 0.45 * (dl / 5);
    h -= d;
  }
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 61) h += (r - 61) * 0.9;
  return h;
}

/** Высота, на которой стоит юнит (в реке — по колено в воде) */
export const unitY = (x: number, z: number) => Math.max(groundH(x, z), WATER - 0.35);

export interface Tree {
  x: number;
  z: number;
  s: number;
}

/** Состояние генератора после деревьев: клиент продолжает с него повороты и цвета крон, как прототип */
export let treesRngEnd = 0;

/** Деревья — препятствия для движения. Порядок вызовов генератора как в прототипе 0.3. */
export function generateTrees(): Tree[] {
  const rng = new Rng(MAP_SEED);
  // В прототипе до деревьев генератор тратил по числу на каждый треугольник земли (150×150, сетка 120)
  rng.skip(120 * 120 * 2);
  const trees: Tree[] = [];
  for (let gx = -60; gx <= 60; gx += 3.4)
    for (let gz = -60; gz <= 60; gz += 3.4) {
      const x = gx + (rng.next() - 0.5) * 2.6;
      const z = gz + (rng.next() - 0.5) * 2.6;
      if (dLane(x, z) < 6.5 || dRiver(x, z) < 8.5 || dBase(x, z) < 15) continue;
      if (rng.next() < 0.35) continue;
      trees.push({ x, z, s: 0.8 + rng.next() * 0.6 });
    }
  treesRngEnd = rng.seed;
  return trees;
}

/** Сетка деревьев для быстрых столкновений: ячейка 5 м */
export class TreeGrid {
  readonly cells = new Map<number, Tree[]>();
  constructor(readonly trees: Tree[]) {
    for (const t of trees) {
      const k = TreeGrid.key(Math.floor(t.x / 5), Math.floor(t.z / 5));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(t);
    }
  }
  static key(cx: number, cz: number) {
    return (cx + 100) * 1000 + (cz + 100);
  }
  near(x: number, z: number, out: Tree[]): Tree[] {
    out.length = 0;
    const cx = Math.floor(x / 5);
    const cz = Math.floor(z / 5);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const c = this.cells.get(TreeGrid.key(cx + i, cz + j));
        if (c) for (const t of c) out.push(t);
      }
    return out;
  }
}

let cachedTrees: Tree[] | null = null;
let cachedGrid: TreeGrid | null = null;
export function mapTrees(): Tree[] {
  return (cachedTrees ??= generateTrees());
}
export function treeGrid(): TreeGrid {
  return (cachedGrid ??= new TreeGrid(mapTrees()));
}
