// Карты описываются данными (MapDef): размер, линии-ломаные, вышки на каждой линии, базы, фонтаны,
// лагеря, руны. Река — всегда диагональ x = z через центр, она пересекает все линии.
// Координаты — метры, ось x вправо, z «вниз» на миникарте. Команда 0 — внизу слева, команда 1 — вверху справа.
//   1v1 — одна линия по диагонали (карта прототипа 120×120, те же деревья);
//   2v2 — две линии по краям (верх и низ);
//   3v3 — три линии: верх, центр, низ. Карта растёт с числом линий.
import { Rng } from './rng';

export interface P2 {
  x: number;
  z: number;
}

export type MapId = '1v1' | '2v2' | '3v3';
export type Team2 = 0 | 1;

export interface LaneDef {
  name: 'top' | 'mid' | 'bot';
  /** Ломаная от базы команды 0 к базе команды 1 */
  points: P2[];
}

export interface TowerDef {
  team: Team2;
  lane: number;
  /** 1 — внешняя, 2 — внутренняя (закрывает кристалл) */
  tier: 1 | 2;
  x: number;
  z: number;
}

export interface CampDef extends P2 {
  type: 'small' | 'big';
  side: Team2;
}

export interface MapDef {
  id: MapId;
  /** Половина стороны карты: играбельная область примерно ±half */
  half: number;
  /** Граница движения юнитов */
  limit: number;
  /** Земля рисуется на ±ground (за краем — склоны) */
  ground: number;
  lanes: LaneDef[];
  towers: TowerDef[];
  ancients: [P2, P2];
  fountains: [P2, P2];
  /** Где возрождаются герои */
  spawns: [P2, P2];
  /** Где стоят герои в начале матча */
  starts: [P2, P2];
  camps: CampDef[];
  runeSpots: P2[];
  /** Логово Стража реки (босс) — на реке, в стороне от линий */
  boss: P2;
  seed: number;
}

export const MAP_SEED = 20261019;
export const WATER = -0.55;
const S2 = Math.SQRT2;

// ── Построение карт ──

const mirror = (p: P2): P2 => ({ x: -p.x, z: -p.z });
const pair = (p: P2): [P2, P2] => [p, mirror(p)];

/** Точка на ломаной на расстоянии s от её начала */
export function pointAt(points: readonly P2[], s: number): P2 {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= l || i === points.length - 2) {
      const k = l > 0 ? Math.min(1, Math.max(0, s / l)) : 0;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    s -= l;
  }
  return { ...points[points.length - 1] };
}

export function polyLength(points: readonly P2[]): number {
  let l = 0;
  for (let i = 0; i < points.length - 1; i++)
    l += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return l;
}

/** Вышки линии: внешняя и внутренняя — на тех же долях длины линии, что в карте прототипа */
function laneTowers(lanes: LaneDef[]): TowerDef[] {
  // Прототип: линия 130,1 м, внешняя вышка в 36,8 м от кристалла, внутренняя — в 17,0 м
  const F1 = (26 * S2) / (92 * S2);
  const F2 = (12 * S2) / (92 * S2);
  const out: TowerDef[] = [];
  lanes.forEach((ln, lane) => {
    const L = polyLength(ln.points);
    const rev = [...ln.points].reverse();
    for (const team of [0, 1] as Team2[]) {
      const pts = team ? rev : ln.points;
      for (const [tier, f] of [
        [1, F1],
        [2, F2],
      ] as const) {
        const p = pointAt(pts, L * f);
        out.push({ team, lane, tier, x: p.x, z: p.z });
      }
    }
  });
  return out;
}

function build1v1(): MapDef {
  // Карта прототипа 0.3 — координаты прежние
  const lanes: LaneDef[] = [
    {
      name: 'mid',
      points: [
        { x: -46, z: 46 },
        { x: 46, z: -46 },
      ],
    },
  ];
  return {
    id: '1v1',
    half: 60,
    limit: 59,
    ground: 75,
    lanes,
    towers: [
      { team: 0, lane: 0, tier: 1, x: -20, z: 20 },
      { team: 0, lane: 0, tier: 2, x: -34, z: 34 },
      { team: 1, lane: 0, tier: 1, x: 20, z: -20 },
      { team: 1, lane: 0, tier: 2, x: 34, z: -34 },
    ],
    ancients: pair({ x: -46, z: 46 }),
    fountains: pair({ x: -54, z: 54 }),
    spawns: pair({ x: -51, z: 51 }),
    starts: pair({ x: -40, z: 40 }),
    camps: [
      { x: -30, z: -10, type: 'big', side: 0 },
      { x: -10, z: 30, type: 'small', side: 0 },
      { x: 30, z: 10, type: 'big', side: 1 },
      { x: 10, z: -30, type: 'small', side: 1 },
    ],
    runeSpots: [
      { x: -17, z: -17 },
      { x: 17, z: 17 },
    ],
    boss: { x: 28, z: 28 },
    seed: MAP_SEED,
  };
}

/** Большие карты: базы по диагонали, линии по краям (верх/низ) и по центру */
function buildBig(id: '2v2' | '3v3', half: number, withMid: boolean, campsSide0: CampDef[]): MapDef {
  const k = half / 60;
  const a0 = { x: -46 * k, z: 46 * k };
  const a1 = mirror(a0);
  const c = half - 12; // линия по краю — в 12 м от края карты
  const bevel = 16;
  const top: LaneDef = {
    name: 'top',
    points: [a0, { x: -c, z: -c + bevel }, { x: -c + bevel, z: -c }, a1],
  };
  const bot: LaneDef = {
    name: 'bot',
    points: [a0, { x: c - bevel, z: c }, { x: c, z: c - bevel }, a1],
  };
  const mid: LaneDef = { name: 'mid', points: [a0, a1] };
  const lanes = withMid ? [top, mid, bot] : [top, bot];
  const camps = campsSide0.flatMap((cp) => [cp, { ...mirror(cp), type: cp.type, side: 1 as Team2 }]);
  return {
    id,
    half,
    limit: half - 1,
    ground: half + 15,
    lanes,
    towers: laneTowers(lanes),
    ancients: [a0, a1],
    fountains: pair({ x: -54 * k, z: 54 * k }),
    spawns: pair({ x: -51 * k, z: 51 * k }),
    starts: pair({ x: -40 * k, z: 40 * k }),
    camps,
    runeSpots: [
      { x: -17 * k, z: -17 * k },
      { x: 17 * k, z: 17 * k },
    ],
    boss: { x: 28 * k, z: 28 * k },
    seed: MAP_SEED + (withMid ? 3 : 2),
  };
}

const MAPS: Record<MapId, () => MapDef> = {
  '1v1': build1v1,
  '2v2': () =>
    buildBig('2v2', 80, false, [
      { x: -40, z: -13, type: 'big', side: 0 },
      { x: -13, z: 40, type: 'small', side: 0 },
      { x: -30, z: 10, type: 'small', side: 0 },
    ]),
  '3v3': () =>
    buildBig('3v3', 95, true, [
      { x: -47, z: -16, type: 'big', side: 0 },
      { x: -16, z: 47, type: 'small', side: 0 },
      { x: -50, z: 10, type: 'small', side: 0 },
      { x: 10, z: 50, type: 'big', side: 0 },
    ]),
};
const mapCache = new Map<MapId, MapDef>();
export function getMap(id: MapId = '1v1'): MapDef {
  let m = mapCache.get(id);
  if (!m) mapCache.set(id, (m = MAPS[id]()));
  return m;
}
/** Карта по числу игроков в команде: 1 → 1v1, 2 → 2v2, 3 → 3v3 */
export function mapIdForTeamSize(n: number): MapId {
  return n >= 3 ? '3v3' : n === 2 ? '2v2' : '1v1';
}
export const MAP_IDS: readonly MapId[] = ['1v1', '2v2', '3v3'];

// ── Геометрия ──

function segDist(x: number, z: number, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** Расстояние до ближайшей линии (на карте прототипа — то же, что |x + z| / √2 между базами) */
export function dLane(m: MapDef, x: number, z: number): number {
  if (m.id === '1v1') return Math.abs(x + z) / S2;
  let d = 1e9;
  for (const ln of m.lanes)
    for (let i = 0; i < ln.points.length - 1; i++) d = Math.min(d, segDist(x, z, ln.points[i], ln.points[i + 1]));
  return d;
}
export const dRiver = (x: number, z: number) => Math.abs(x - z) / S2;
export const dBase = (m: MapDef, x: number, z: number) =>
  Math.min(Math.hypot(x - m.ancients[0].x, z - m.ancients[0].z), Math.hypot(x - m.ancients[1].x, z - m.ancients[1].z));

/** Направление «от своей базы к вражеской» (по диагонали баз) */
export function laneDir(team: number): P2 {
  return { x: (team ? -1 : 1) / S2, z: (team ? 1 : -1) / S2 };
}

/** Ломаная линии в сторону врага для команды team */
const dirCache = new WeakMap<MapDef, P2[][][]>();
export function lanePoints(m: MapDef, lane: number, team: number): P2[] {
  let c = dirCache.get(m);
  if (!c) dirCache.set(m, (c = m.lanes.map((ln) => [ln.points, [...ln.points].reverse()])));
  return c[lane][team ? 1 : 0];
}

/** Сколько пройдено по линии (для команды team) от точки, ближайшей к (x, z) */
export function laneProgress(m: MapDef, lane: number, team: number, x: number, z: number): number {
  const pts = lanePoints(m, lane, team);
  let best = 1e9;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (l * l))) : 0;
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) {
      best = d;
      bestS = acc + t * l;
    }
    acc += l;
  }
  return bestS;
}

/** Куда идти по линии: точка на ahead метров дальше ближайшей точки линии */
export function laneAhead(m: MapDef, lane: number, team: number, x: number, z: number, ahead: number): P2 {
  const pts = lanePoints(m, lane, team);
  return pointAt(pts, laneProgress(m, lane, team, x, z) + ahead);
}

/** Ближайшая к точке линия */
export function nearestLane(m: MapDef, x: number, z: number): number {
  let best = 0;
  let bd = 1e9;
  m.lanes.forEach((ln, i) => {
    for (let j = 0; j < ln.points.length - 1; j++) {
      const d = segDist(x, z, ln.points[j], ln.points[j + 1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  });
  return best;
}

export function groundH(m: MapDef, x: number, z: number): number {
  let h =
    0.75 +
    Math.sin(x * 0.21) * 0.32 +
    Math.cos(z * 0.17) * 0.32 +
    Math.sin((x + z) * 0.11) * 0.35 +
    Math.sin(x * 0.53 + z * 0.47) * 0.12;
  const dl = dLane(m, x, z);
  if (dl < 5) h = 0.3 + (h - 0.3) * (dl / 5);
  const db = dBase(m, x, z);
  if (db < 14) h = 0.4 + (h - 0.4) * Math.max(0, (db - 10) / 4);
  const dr = dRiver(x, z);
  if (dr < 7) {
    let d = Math.pow(1 - dr / 7, 1.3) * 2.4;
    if (dl < 5) d *= 0.55 + 0.45 * (dl / 5);
    h -= d;
  }
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > m.half + 1) h += (r - m.half - 1) * 0.9;
  return h;
}

/** Высота, на которой стоит юнит (в реке — по колено в воде) */
export const unitY = (m: MapDef, x: number, z: number) => Math.max(groundH(m, x, z), WATER - 0.35);

// ── Деревья ──

export interface Tree {
  x: number;
  z: number;
  s: number;
}

const CAMP_CLEAR = 6.5;

interface TreeSet {
  /** Все деревья генератора (клиент проходит по ним, чтобы цвета крон совпали с прототипом) */
  all: Tree[];
  /** Деревья на карте: без деревьев на полянах лагерей */
  trees: Tree[];
  /** Состояние генератора после деревьев: клиент продолжает с него повороты и цвета крон */
  rngEnd: number;
  grid: TreeGrid;
}

/** Деревья — препятствия для движения. Не растут на линиях, у реки, у баз и на полянах лагерей.
 *  На карте 1v1 порядок вызовов генератора как в прототипе 0.3 — те же деревья. */
function generateTrees(m: MapDef): { all: Tree[]; rngEnd: number } {
  const rng = new Rng(m.seed);
  // В прототипе до деревьев генератор тратил по числу на каждый треугольник земли (150×150, сетка 120)
  rng.skip(120 * 120 * 2);
  const all: Tree[] = [];
  // На больших картах база просторнее и у фонтана тоже чисто (1v1 — как в прототипе)
  const big = m.id !== '1v1';
  const dFount = (x: number, z: number) =>
    Math.min(
      Math.hypot(x - m.fountains[0].x, z - m.fountains[0].z),
      Math.hypot(x - m.fountains[1].x, z - m.fountains[1].z),
    );
  for (let gx = -m.half; gx <= m.half; gx += 3.4)
    for (let gz = -m.half; gz <= m.half; gz += 3.4) {
      const x = gx + (rng.next() - 0.5) * 2.6;
      const z = gz + (rng.next() - 0.5) * 2.6;
      if (dLane(m, x, z) < 6.5 || dRiver(x, z) < 8.5 || dBase(m, x, z) < (big ? 18 : 15)) continue;
      if (big && dFount(x, z) < 15) continue;
      if (rng.next() < 0.35) continue;
      all.push({ x, z, s: 0.8 + rng.next() * 0.6 });
    }
  return { all, rngEnd: rng.seed };
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

export const treeCleared = (m: MapDef, t: P2) => m.camps.some((c) => Math.hypot(t.x - c.x, t.z - c.z) < CAMP_CLEAR);

const treeCache = new WeakMap<MapDef, TreeSet>();
export function mapTreeSet(m: MapDef): TreeSet {
  let s = treeCache.get(m);
  if (!s) {
    const g = generateTrees(m);
    const trees = g.all.filter((t) => !treeCleared(m, t));
    treeCache.set(m, (s = { all: g.all, trees, rngEnd: g.rngEnd, grid: new TreeGrid(trees) }));
  }
  return s;
}
export const mapTrees = (m: MapDef) => mapTreeSet(m).trees;
export const treeGrid = (m: MapDef) => mapTreeSet(m).grid;
