// Процедурные модели 0.4: общий скелет на всех героев и крипов (тело, две руки, две ноги, плащ),
// внешность — данными (Look). Части каждой кости сливаются в один меш с цветами в вершинах
// (плюс один светящийся), поэтому герой — 6–8 вызовов отрисовки, а одинаковые крипы делят
// геометрию и рисуются инстансами. Сторонних моделей нет — всё из примитивов (см. ASSETS.md).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rig } from './models';

export type HeadGear =
  | 'hood'
  | 'helm'
  | 'hat'
  | 'horns'
  | 'hair'
  | 'mask'
  | 'crown'
  | 'skull'
  | 'bandana'
  | 'plume'
  | 'antlers';
export type Weapon =
  | 'staff'
  | 'sword'
  | 'axe'
  | 'hammer'
  | 'bow'
  | 'daggers'
  | 'spear'
  | 'orb'
  | 'scythe'
  | 'club'
  | 'fists'
  | 'crossbow'
  | 'book'
  | 'whip'
  | 'lute';
export type Offhand = 'shield' | 'dagger' | 'orb' | 'lantern' | 'book' | null;
export type AttackStyle = 'swing' | 'thrust' | 'shoot' | 'cast';
/** Телосложение — четыре типа скелета поверх роста и ширины: отличаются длиной ног, торсом, толщиной рук и головой */
export type Build = 'lean' | 'normal' | 'heavy' | 'giant';
const BUILDS: Record<Build, { w: number; h: number; leg: number; torso: number; arm: number; head: number }> = {
  lean: { w: 0.88, h: 1.0, leg: 1.08, torso: 0.95, arm: 0.85, head: 1.05 },
  normal: { w: 1, h: 1, leg: 1, torso: 1, arm: 1, head: 1 },
  heavy: { w: 1.18, h: 1.0, leg: 0.94, torso: 1.06, arm: 1.25, head: 0.98 },
  giant: { w: 1.3, h: 1.08, leg: 1.0, torso: 1.1, arm: 1.35, head: 0.92 },
};

export interface Look {
  /** Рост (1 — обычный, ≈ 2,3 м) и ширина плеч */
  height: number;
  bulk: number;
  /** Тип скелета (по умолчанию normal) */
  build?: Build;
  skin: number;
  cloth: number;
  armor: number;
  trim: number;
  /** Свечение: глаза, оружие, руны */
  glow: number;
  hair?: number;
  head: HeadGear;
  /** Одежда торса: мантия закрывает ноги до колен */
  torso: 'robe' | 'plate' | 'leather' | 'bare' | 'coat';
  shoulders?: 'pads' | 'spikes' | 'fur' | 'orbs' | null;
  /** Цвет плаща (нет — без плаща) */
  cape?: number | null;
  weapon: Weapon;
  offhand?: Offhand;
  /** Дополнительно: колчан, крылья, хвост, рюкзак, ореол */
  extra?: ('quiver' | 'wings' | 'tail' | 'pack' | 'halo' | 'scarf' | 'belt')[];
}

// ── Сборка слитых мешей ──

/** Материалы на все модели: цвет — в вершинах */
const STD = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05 });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
STD.name = 'v-std';
GLOW.name = 'v-glow';

const tmpM = new THREE.Matrix4();
const WEAPON_SCALE = new THREE.Matrix4().makeScale(1.4, 1.4, 1.4);
const NO_SCALE = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

type V3 = [number, number, number];

class Parts {
  std: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1], glow = false) {
    const geo = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    geo.deleteAttribute('uv');
    tmpQ.setFromEuler(tmpE.set(r[0], r[1], r[2]));
    tmpM.compose(new THREE.Vector3(...p), tmpQ, new THREE.Vector3(...s));
    geo.applyMatrix4(tmpM);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    tmpC.setHex(color);
    for (let i = 0; i < n; i++) col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (glow ? this.glow : this.std).push(geo);
    return this;
  }
  /** Забрать части другого набора, преобразовав их матрицей (оружие крупнее вокруг кисти) */
  absorb(o: Parts, m: THREE.Matrix4) {
    for (const g of o.std) this.std.push(g.applyMatrix4(m));
    for (const g of o.glow) this.glow.push(g.applyMatrix4(m));
    return this;
  }
  /** Слить в меши (кэшируются по ключу, чтобы одинаковые модели делили геометрию) */
  build(key: string): (THREE.BufferGeometry | null)[] {
    let c = mergedCache.get(key);
    if (!c) {
      c = [this.std, this.glow].map((list) => (list.length ? mergeGeometries(list) : null));
      for (const g of [...this.std, ...this.glow]) g.dispose();
      mergedCache.set(key, c);
    }
    return c;
  }
}
const mergedCache = new Map<string, (THREE.BufferGeometry | null)[]>();

/** Добавить в группу меши кости */
function bone(group: THREE.Object3D, parts: Parts, key: string) {
  const [s, g] = parts.build(key);
  if (s) {
    const m = new THREE.Mesh(s, STD);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (g) group.add(new THREE.Mesh(g, GLOW));
}

// Примитивы (низкополигональные)
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const ball = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
const gem = (r: number) => new THREE.OctahedronGeometry(r, 0);
const ring = (r: number, t: number) => new THREE.TorusGeometry(r, t, 4, 10);

const shade = (c: number, k: number) => tmpC.setHex(c).multiplyScalar(k).getHex();

// ── Человек ──

/** Атака по виду оружия */
export function attackOf(w: Weapon): AttackStyle {
  if (w === 'bow' || w === 'crossbow') return 'shoot';
  if (w === 'staff' || w === 'orb' || w === 'book' || w === 'lute') return 'cast';
  if (w === 'spear' || w === 'daggers' || w === 'fists') return 'thrust';
  return 'swing';
}

/** Оружие в правой руке: рука смотрит вниз (−Y), кисть на y = −L, вперёд — +Z */
function weapon(p: Parts, l: Look, L: number) {
  const y = -L;
  const wood = 0x7a5534;
  const steel = 0xc9d2dc;
  switch (l.weapon) {
    case 'staff':
      p.add(cyl(0.05, 0.06, 2.4), wood, [0, y + 0.3, 0.12]);
      p.add(ring(0.2, 0.04), l.trim, [0, y + 1.55, 0.12]);
      p.add(gem(0.2), l.glow, [0, y + 1.6, 0.12], [0, 0, 0], [1, 1.4, 1], true);
      break;
    case 'orb':
      p.add(ball(0.24, 1), l.glow, [0, y - 0.05, 0.3], [0, 0, 0], [1, 1, 1], true);
      p.add(ring(0.3, 0.03), l.trim, [0, y - 0.05, 0.3], [Math.PI / 2, 0, 0]);
      break;
    case 'book':
      p.add(box(0.36, 0.48, 0.1), l.cloth, [0, y, 0.25], [0.3, 0, 0]);
      p.add(box(0.3, 0.42, 0.11), 0xf0e6c8, [0, y, 0.25], [0.3, 0, 0]);
      p.add(gem(0.08), l.glow, [0, y + 0.05, 0.32], [0.3, 0, 0], [1, 1, 1], true);
      break;
    case 'sword':
      p.add(box(0.07, 0.3, 0.07), 0x4a3424, [0, y, 0.1]);
      p.add(box(0.36, 0.06, 0.1), l.trim, [0, y - 0.18, 0.1]);
      p.add(box(0.1, 1.15, 0.035), steel, [0, y - 0.8, 0.1]);
      p.add(cone(0.07, 0.18, 4), steel, [0, y - 1.46, 0.1], [Math.PI, 0, 0]);
      break;
    case 'axe':
      p.add(cyl(0.05, 0.05, 1.5), wood, [0, y - 0.45, 0.1]);
      p.add(box(0.06, 0.5, 0.42), steel, [0, y - 1.05, 0.32]);
      p.add(box(0.07, 0.12, 0.2), l.trim, [0, y - 1.05, 0.12]);
      break;
    case 'hammer':
      p.add(cyl(0.06, 0.06, 1.5), wood, [0, y - 0.45, 0.1]);
      p.add(box(0.42, 0.34, 0.34), 0x6d7480, [0, y - 1.15, 0.1]);
      p.add(box(0.46, 0.08, 0.38), l.trim, [0, y - 1.15, 0.1]);
      break;
    case 'club':
      p.add(cyl(0.18, 0.08, 1.4), 0x6a4a2c, [0, y - 0.6, 0.1]);
      p.add(cone(0.06, 0.16, 4), 0xd8d0b8, [0.16, y - 1.0, 0.1], [0, 0, -1.4]);
      p.add(cone(0.06, 0.16, 4), 0xd8d0b8, [-0.16, y - 1.1, 0.1], [0, 0, 1.4]);
      break;
    case 'spear':
      p.add(cyl(0.045, 0.045, 2.6), wood, [0, y - 0.2, 0.1]);
      p.add(cone(0.1, 0.42, 4), steel, [0, y - 1.7, 0.1], [Math.PI, 0, 0]);
      p.add(box(0.12, 0.12, 0.12), l.trim, [0, y - 1.42, 0.1]);
      break;
    case 'scythe':
      p.add(cyl(0.045, 0.045, 2.4), 0x3a2f2a, [0, y - 0.2, 0.1]);
      p.add(box(0.05, 0.12, 0.95), steel, [0, y - 1.35, 0.5], [0.35, 0, 0]);
      p.add(box(0.03, 0.05, 0.9), l.glow, [0, y - 1.42, 0.52], [0.35, 0, 0], [1, 1, 1], true);
      break;
    case 'daggers':
      p.add(box(0.06, 0.16, 0.06), 0x3a2a20, [0, y, 0.1]);
      p.add(box(0.06, 0.04, 0.5), steel, [0, y - 0.04, 0.42]);
      p.add(box(0.02, 0.02, 0.44), l.glow, [0, y - 0.01, 0.42], [0, 0, 0], [1, 1, 1], true);
      break;
    case 'bow':
      // Лук держит левая рука — здесь только тетива-стрела
      p.add(cyl(0.02, 0.02, 0.7), 0xd8c8a0, [0, y, 0.2], [Math.PI / 2, 0, 0]);
      break;
    case 'crossbow':
      p.add(box(0.1, 0.12, 0.8), wood, [0, y, 0.3]);
      p.add(box(0.8, 0.06, 0.08), 0x5a5f68, [0, y, 0.6]);
      break;
    case 'whip':
      p.add(cyl(0.05, 0.05, 0.3), 0x3a2a20, [0, y, 0.1]);
      for (let i = 0; i < 5; i++)
        p.add(cyl(0.025, 0.025, 0.32), l.trim, [0, y - 0.25 - i * 0.26, 0.15 + i * 0.07], [0.25, 0, 0]);
      break;
    case 'lute':
      p.add(ball(0.26, 0), wood, [0, y + 0.1, 0.3], [0, 0, 0], [1, 1.2, 0.5]);
      p.add(box(0.07, 0.6, 0.05), 0x4a3424, [0, y + 0.5, 0.3]);
      break;
    case 'fists':
      p.add(box(0.2, 0.2, 0.22), l.trim, [0, y, 0.05]);
      p.add(cone(0.04, 0.14, 4), 0xd8d0b8, [0, y - 0.02, 0.2], [Math.PI / 2, 0, 0]);
      break;
  }
}

function offhand(p: Parts, l: Look, L: number) {
  const y = -L;
  switch (l.offhand ?? (l.weapon === 'bow' ? 'bow' : l.weapon === 'daggers' ? 'dagger' : null)) {
    case 'shield':
      p.add(cyl(0.48, 0.48, 0.09, 8), l.armor, [0.12, y + 0.2, 0.12], [0, 0, Math.PI / 2]);
      p.add(cyl(0.36, 0.36, 0.1, 8), l.trim, [0.13, y + 0.2, 0.12], [0, 0, Math.PI / 2]);
      p.add(cone(0.1, 0.18, 6), 0xd8dde4, [0.22, y + 0.2, 0.12], [0, 0, -Math.PI / 2]);
      break;
    case 'dagger':
      p.add(box(0.06, 0.16, 0.06), 0x3a2a20, [0, y, 0.1]);
      p.add(box(0.06, 0.04, 0.5), 0xc9d2dc, [0, y - 0.04, 0.42]);
      break;
    case 'orb':
      p.add(ball(0.2, 1), l.glow, [0, y - 0.1, 0.25], [0, 0, 0], [1, 1, 1], true);
      break;
    case 'lantern':
      p.add(box(0.2, 0.28, 0.2), 0x3a3a40, [0, y - 0.3, 0.15]);
      p.add(ball(0.11, 0), l.glow, [0, y - 0.3, 0.15], [0, 0, 0], [1, 1, 1], true);
      break;
    case 'book':
      p.add(box(0.34, 0.44, 0.1), l.cloth, [0, y, 0.2], [0.4, 0, 0]);
      break;
    case 'bow': {
      // Дуга лука из трёх отрезков и тетива
      const c = 0x8a5a30;
      p.add(box(0.06, 0.6, 0.06), c, [0, y - 0.05, 0.3]);
      p.add(box(0.06, 0.55, 0.06), c, [0, y + 0.5, 0.18], [-0.45, 0, 0]);
      p.add(box(0.06, 0.55, 0.06), c, [0, y - 0.6, 0.18], [0.45, 0, 0]);
      p.add(cyl(0.01, 0.01, 1.7), 0xe8e0c8, [0, y - 0.05, 0.02]);
      p.add(gem(0.07), l.glow, [0, y - 0.05, 0.34], [0, 0, 0], [1, 1, 1], true);
      break;
    }
  }
}

function headgear(p: Parts, l: Look, hy: number, hr: number) {
  switch (l.head) {
    case 'hood':
      p.add(cone(hr * 1.35, hr * 2.6, 7), l.cloth, [0, hy + hr * 0.55, -0.05], [-0.2, 0, 0]);
      p.add(box(hr * 1.4, hr * 0.5, 0.05), shade(l.cloth, 0.4), [0, hy - hr * 0.05, hr * 0.85]);
      break;
    case 'helm':
      p.add(cyl(hr * 1.08, hr * 1.12, hr * 1.4, 7), l.armor, [0, hy + hr * 0.2, 0]);
      p.add(cone(hr * 1.1, hr * 0.6, 7), l.armor, [0, hy + hr * 1.2, 0]);
      p.add(box(hr * 1.5, hr * 0.14, 0.06), 0x15181c, [0, hy, hr * 1.05]);
      p.add(box(0.06, hr * 0.7, hr * 1.4), l.trim, [0, hy + hr * 1.3, -0.05]);
      break;
    case 'plume':
      p.add(cyl(hr * 1.08, hr * 1.12, hr * 1.3, 7), l.armor, [0, hy + hr * 0.25, 0]);
      p.add(box(hr * 1.5, hr * 0.14, 0.06), 0x15181c, [0, hy, hr * 1.05]);
      p.add(box(0.12, hr * 0.9, hr * 1.8), l.trim, [0, hy + hr * 1.45, -0.15], [0.3, 0, 0]);
      break;
    case 'hat':
      p.add(cyl(hr * 2.1, hr * 2.1, 0.06, 9), l.cloth, [0, hy + hr * 0.75, 0]);
      p.add(cone(hr * 1.05, hr * 2.6, 7), l.cloth, [0, hy + hr * 2.0, -0.08], [-0.25, 0, 0]);
      p.add(cyl(hr * 1.06, hr * 1.06, 0.12, 7), l.trim, [0, hy + hr * 0.85, 0]);
      break;
    case 'horns':
      for (const sx of [-1, 1])
        p.add(cone(hr * 0.28, hr * 1.5, 5), 0xe8dcc0, [sx * hr * 0.9, hy + hr * 0.9, 0], [0.3, 0, -sx * 0.6]);
      p.add(box(hr * 1.6, hr * 0.5, hr * 1.4), l.armor, [0, hy + hr * 0.55, -0.02]);
      break;
    case 'antlers':
      for (const sx of [-1, 1]) {
        p.add(cyl(0.04, 0.05, hr * 1.8), 0xb89a70, [sx * hr * 0.7, hy + hr * 1.3, 0], [0, 0, -sx * 0.5]);
        p.add(cyl(0.03, 0.04, hr * 0.9), 0xb89a70, [sx * hr * 1.2, hy + hr * 1.6, 0.05], [0, 0, -sx * 1.2]);
      }
      break;
    case 'hair':
      p.add(ball(hr * 1.08, 0), l.hair ?? 0x3a2a20, [0, hy + hr * 0.2, -hr * 0.18], [0, 0, 0], [1, 0.9, 1.05]);
      p.add(box(hr * 0.9, hr * 1.4, hr * 0.4), l.hair ?? 0x3a2a20, [0, hy - hr * 0.5, -hr * 0.85]);
      break;
    case 'mask':
      p.add(box(hr * 1.6, hr * 1.0, 0.08), l.trim, [0, hy, hr * 0.92]);
      p.add(box(hr * 1.3, hr * 0.12, 0.09), l.glow, [0, hy + hr * 0.1, hr * 0.97], [0, 0, 0], [1, 1, 1], true);
      p.add(cone(hr * 1.2, hr * 1.4, 6), l.cloth, [0, hy + hr * 0.9, -0.08], [-0.3, 0, 0]);
      break;
    case 'crown':
      p.add(cyl(hr * 0.95, hr * 0.95, hr * 0.5, 7), 0xf1c453, [0, hy + hr * 0.95, 0]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.add(cone(0.06, hr * 0.5, 4), 0xf1c453, [Math.sin(a) * hr * 0.85, hy + hr * 1.35, Math.cos(a) * hr * 0.85]);
      }
      p.add(gem(0.08), l.glow, [0, hy + hr * 0.95, hr * 0.95], [0, 0, 0], [1, 1, 1], true);
      p.add(ball(hr * 1.02, 0), l.hair ?? 0xd8d0c0, [0, hy + hr * 0.15, -hr * 0.15]);
      break;
    case 'skull':
      p.add(box(hr * 0.5, hr * 0.15, 0.06), l.glow, [0, hy + hr * 0.1, hr * 0.92], [0, 0, 0], [1, 1, 1], true);
      p.add(cone(hr * 1.4, hr * 2.0, 6), l.cloth, [0, hy + hr * 0.6, -0.12], [-0.35, 0, 0]);
      break;
    case 'bandana':
      p.add(cyl(hr * 1.03, hr * 1.03, hr * 0.35, 7), l.trim, [0, hy + hr * 0.45, 0]);
      p.add(box(0.06, hr * 0.3, hr * 1.2), l.trim, [hr * 0.5, hy + hr * 0.2, -hr * 1.2], [0.6, 0.3, 0]);
      p.add(ball(hr * 1.02, 0), l.hair ?? 0x2a2018, [0, hy + hr * 0.35, -hr * 0.2], [0, 0, 0], [1, 0.75, 1]);
      break;
  }
}

/** Цвет команды на моделях: одна перевязь через грудь у людей и крипов, тотемы и башни */
export const TEAM_ACCENT = [0x3ec7a1, 0xe2504a, 0xc8b48a];

export function buildHumanoid(look: Look, team: number, key: string, scale = 1): Rig {
  const l = look;
  const H = l.height * (!key.startsWith('creep') && l.build ? BUILDS[l.build].h : 1);
  // Проход читаемости — только для героев (крипы мелкие и рисуются инстансами, их не трогаем):
  // разница в телосложении заметнее, голова и оружие крупнее
  const hero = !key.startsWith('creep');
  const B = BUILDS[(hero && l.build) || 'normal'];
  const W = (hero ? 1 + (l.bulk - 1) * 1.8 : l.bulk) * B.w;
  const legL = 1.0 * H * B.leg;
  const hip = legL;
  const torsoH = 0.78 * H * B.torso;
  const shY = hip + torsoH * 0.88;
  const armLen = 0.86 * H;
  // Голова крупнее: с игровой камеры на телефоне лицо и головной убор — главное, что видно
  const hr = 0.25 * (0.85 + 0.15 * W) * (hero ? 1.3 : 1) * B.head;
  const hy = hip + torsoH + hr * 1.05;
  const tw = 0.36 * W;
  const tc = TEAM_ACCENT[team] ?? TEAM_ACCENT[2];
  const k = `${key}|${team}`;

  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const body = new THREE.Group();
  body.position.y = hip;
  root.add(body);

  // Тело: торс, голова, головной убор, наплечники, пояс — относительно таза (y = 0)
  const tp = new Parts();
  const ty = (y: number) => y - hip;
  const torsoColor = l.torso === 'plate' ? l.armor : l.cloth;
  if (l.torso === 'robe') {
    // Мантия — расширяющийся конус до колен
    tp.add(cyl(tw * 0.85, tw * 1.35, torsoH + 0.55, 8), l.cloth, [0, ty(hip + torsoH / 2 - 0.27), 0]);
    tp.add(cyl(tw * 1.37, tw * 1.37, 0.08, 8), l.trim, [0, ty(hip - 0.52), 0]);
  } else {
    tp.add(box(tw * 2, torsoH * 0.62, 0.44 * W), torsoColor, [0, ty(hip + torsoH * 0.62), 0]);
    tp.add(box(tw * 1.7, torsoH * 0.42, 0.38 * W), l.torso === 'bare' ? l.skin : shade(torsoColor, 0.85), [
      0,
      ty(hip + torsoH * 0.2),
      0,
    ]);
    if (l.torso === 'plate') tp.add(box(tw * 1.4, torsoH * 0.38, 0.05), l.trim, [0, ty(hip + torsoH * 0.65), 0.23 * W]);
    if (l.torso === 'coat') tp.add(box(tw * 2.05, torsoH * 0.5, 0.42 * W), l.cloth, [0, ty(hip - 0.05), 0]);
    if (l.torso === 'leather')
      tp.add(box(0.08, torsoH * 0.7, 0.46 * W), l.trim, [0, ty(hip + torsoH * 0.55), 0], [0, 0, 0.6]);
  }
  // Пояс — в отделке героя
  tp.add(box(tw * 2.05, 0.12, 0.46 * W), shade(l.trim, 0.9), [0, ty(hip + 0.05), 0]);
  tp.add(box(0.14, 0.14, 0.05), l.trim, [0, ty(hip + 0.05), 0.24 * W]);
  // Единственная метка команды — широкая перевязь через грудь: одна, крупная, видна с игровой камеры издалека
  const sashZ = l.torso === 'robe' ? tw * 1.12 : 0.22 * W + 0.04;
  tp.add(box(tw * 0.8, torsoH * 1.2, 0.07), tc, [0, ty(hip + torsoH * 0.52), sashZ], [0, 0, 0.6]);
  // Шея и голова
  tp.add(cyl(0.09, 0.11, 0.18, 5), l.skin, [0, ty(hip + torsoH + 0.05), 0]);
  tp.add(ball(hr, 0), l.skin, [0, ty(hy), 0], [0, 0, 0], [1, 1.08, 1]);
  // Глаза светятся (на телефоне читается лучше, чем лицо)
  if (l.head !== 'mask' && l.head !== 'skull')
    tp.add(box(hr * 1.1, hr * 0.12, 0.05), l.glow, [0, ty(hy + hr * 0.12), hr * 0.92], [0, 0, 0], [1, 1, 1], true);
  if (l.head === 'skull') tp.add(ball(hr * 1.02, 0), 0xe8e0cc, [0, ty(hy), 0]);
  headgear(tp, l, ty(hy), hr);
  // Наплечники
  for (const sx of [-1, 1]) {
    const x = sx * (tw + 0.08);
    switch (l.shoulders) {
      case 'pads':
        tp.add(ball(0.2 * W, 0), l.armor, [x, ty(shY + 0.06), 0], [0, 0, 0], [1.2, 0.7, 1.1]);
        tp.add(gem(0.07), l.glow, [x * 1.05, ty(shY + 0.18), 0.1], [0, 0, 0], [1, 1, 1], true);
        break;
      case 'spikes':
        tp.add(ball(0.18 * W, 0), l.armor, [x, ty(shY + 0.05), 0], [0, 0, 0], [1.2, 0.7, 1.1]);
        tp.add(cone(0.06, 0.32, 4), 0xd8d0c0, [x * 1.1, ty(shY + 0.3), 0], [0, 0, -sx * 0.4]);
        break;
      case 'fur':
        tp.add(ball(0.24 * W, 0), 0x8a7a60, [x * 0.9, ty(shY + 0.02), -0.04], [0, 0, 0], [1.3, 0.6, 1.2]);
        break;
      case 'orbs':
        tp.add(ball(0.11, 0), l.glow, [x * 1.15, ty(shY + 0.28), 0], [0, 0, 0], [1, 1, 1], true);
        break;
    }
  }
  for (const e of l.extra ?? []) {
    if (e === 'quiver') {
      tp.add(cyl(0.12, 0.1, 0.8, 6), 0x6a4a2c, [0.15, ty(hip + torsoH * 0.6), -0.3], [0.35, 0, -0.3]);
      for (const dx of [-0.04, 0.04])
        tp.add(cone(0.05, 0.14, 4), l.trim, [0.25 + dx, ty(hip + torsoH + 0.15), -0.42], [0.35, 0, -0.3]);
    } else if (e === 'wings') {
      for (const sx of [-1, 1])
        tp.add(box(1.1, 0.7, 0.05), l.cloth, [sx * 0.6, ty(shY + 0.1), -0.35], [0.15, sx * 0.35, sx * 0.35]);
    } else if (e === 'tail') {
      tp.add(cone(0.1, 0.9, 5), l.skin, [0, ty(hip - 0.1), -0.55], [-1.9, 0, 0]);
    } else if (e === 'pack') {
      tp.add(box(0.5, 0.6, 0.3), 0x6a4a2c, [0, ty(hip + torsoH * 0.6), -0.36]);
      tp.add(box(0.52, 0.1, 0.32), l.trim, [0, ty(hip + torsoH * 0.85), -0.36]);
    } else if (e === 'halo') {
      tp.add(ring(hr * 1.2, 0.03), l.glow, [0, ty(hy + hr * 1.7), -0.05], [Math.PI / 2, 0, 0], [1, 1, 1], true);
    } else if (e === 'scarf') {
      tp.add(cyl(0.16, 0.2, 0.14, 7), l.trim, [0, ty(hip + torsoH - 0.02), 0]);
      tp.add(box(0.14, 0.5, 0.05), l.trim, [0.12, ty(hip + torsoH - 0.3), -0.25], [0.3, 0, 0]);
    } else if (e === 'belt') {
      tp.add(box(0.14, 0.18, 0.1), 0x6a4a2c, [-tw * 0.7, ty(hip), 0.24 * W]);
      tp.add(box(0.14, 0.18, 0.1), 0x6a4a2c, [tw * 0.7, ty(hip), 0.24 * W]);
    }
  }
  bone(body, tp, k + '|body');

  // Руки: опора в плече, рука висит вниз
  const sleeve = l.torso === 'plate' ? l.armor : l.torso === 'bare' ? l.skin : l.cloth;
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * (tw + 0.1), ty(shY), 0);
    const ap = new Parts();
    ap.add(box(0.19 * W * B.arm, armLen * 0.52, 0.2 * W * B.arm), sleeve, [0, -armLen * 0.26, 0]);
    ap.add(box(0.17 * W * B.arm, armLen * 0.46, 0.18 * W * B.arm), l.torso === 'bare' ? l.skin : shade(sleeve, 0.9), [
      0,
      -armLen * 0.72,
      0,
    ]);
    if (l.torso === 'plate' || l.torso === 'leather')
      ap.add(box(0.21 * W * B.arm, 0.12, 0.22 * W * B.arm), l.trim, [0, -armLen * 0.62, 0]);
    ap.add(box(0.15, 0.15, 0.15), l.skin, [0, -armLen, 0]);
    // Оружие и вторая рука — крупнее в 1,4 раза вокруг кисти, чтобы читались сверху
    const wp = new Parts();
    if (sx > 0) weapon(wp, l, armLen);
    else offhand(wp, l, armLen);
    ap.absorb(
      wp,
      (hero ? WEAPON_SCALE : NO_SCALE)
        .clone()
        .premultiply(new THREE.Matrix4().makeTranslation(0, -armLen, 0))
        .multiply(new THREE.Matrix4().makeTranslation(0, armLen, 0)),
    );
    bone(g, ap, `${k}|arm${sx}`);
    body.add(g);
    arms.push(g);
  }

  // Ноги: опора в тазу (у мантии ноги короче видны)
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * tw * 0.5, hip, 0);
    const lp = new Parts();
    const pants = l.torso === 'plate' ? shade(l.armor, 0.85) : shade(l.cloth, 0.7);
    lp.add(box(0.22 * W, legL * 0.5, 0.24 * W), pants, [0, -legL * 0.27, 0]);
    lp.add(box(0.19 * W, legL * 0.46, 0.21 * W), shade(pants, 0.85), [0, -legL * 0.72, 0]);
    lp.add(box(0.22 * W, 0.14, 0.34 * W), 0x3a2a20, [0, -legL + 0.07, 0.06]);
    if (l.torso === 'plate') lp.add(box(0.24 * W, 0.12, 0.26 * W), l.trim, [0, -legL * 0.5, 0.02]);
    bone(g, lp, `${k}|leg${sx}`);
    root.add(g);
    legs.push(g);
  }

  // Плащ: опора между лопаток
  let capeG: THREE.Group | undefined;
  if (l.cape) {
    capeG = new THREE.Group();
    capeG.position.set(0, ty(shY + 0.05), -0.24 * W);
    const cp = new Parts();
    cp.add(box(tw * 2.1, H * 1.25, 0.05), l.cape, [0, -H * 0.62, -0.03]);
    cp.add(box(tw * 2.12, 0.1, 0.06), l.trim, [0, -H * 1.22, -0.03]);
    bone(capeG, cp, `${k}|cape`);
    body.add(capeG);
  }

  // Пузырь щита — общий для всех
  const shield = new THREE.Mesh(
    SHIELD_GEO,
    new THREE.MeshBasicMaterial({ color: 0x8ee6ff, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shield.position.y = hip + 0.3;
  shield.scale.setScalar(1.2 + W * 0.35);
  shield.visible = false;
  root.add(shield);

  return {
    root,
    body,
    scale,
    weapon: arms[1],
    shield,
    kind: 'humanoid',
    arms: [arms[0], arms[1]],
    legs: [legs[0], legs[1]],
    cape: capeG,
    attack: attackOf(l.weapon),
  };
}
const SHIELD_GEO = new THREE.IcosahedronGeometry(1, 1);

// ── Зверь (лесной волк) ──

export function buildBeast(fur: number, glow: number, key: string, scale = 1): Rig {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const body = new THREE.Group();
  body.position.y = 0.75;
  root.add(body);
  const p = new Parts();
  p.add(box(0.55, 0.5, 1.2), fur, [0, 0.05, 0]);
  p.add(box(0.6, 0.55, 0.45), shade(fur, 1.15), [0, 0.12, 0.45]);
  p.add(box(0.42, 0.38, 0.5), fur, [0, 0.3, 0.9]);
  p.add(box(0.26, 0.2, 0.32), shade(fur, 0.8), [0, 0.2, 1.25]);
  p.add(box(0.3, 0.06, 0.06), glow, [0, 0.4, 1.15], [0, 0, 0], [1, 1, 1], true);
  for (const sx of [-1, 1]) p.add(cone(0.08, 0.22, 4), shade(fur, 0.7), [sx * 0.14, 0.58, 0.85]);
  p.add(cone(0.1, 0.7, 4), fur, [0, 0.15, -0.85], [-2.0, 0, 0]);
  const bodyMesh = new THREE.Group();
  bone(bodyMesh, p, key + '|body');
  body.add(bodyMesh);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [
    [-0.2, 0.42],
    [0.2, 0.42],
    [-0.2, -0.42],
    [0.2, -0.42],
  ]) {
    const g = new THREE.Group();
    g.position.set(x, 0.75, z);
    const lp = new Parts();
    lp.add(box(0.14, 0.75, 0.16), shade(fur, 0.85), [0, -0.37, 0]);
    bone(g, lp, key + '|leg');
    root.add(g);
    legs.push(g);
  }
  return { root, body, scale, weapon: body, kind: 'beast', legs, attack: 'thrust' };
}

// ── Тотем шамана ──

export function buildTotem(team: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const p = new Parts();
  const tc = TEAM_ACCENT[team] ?? TEAM_ACCENT[2];
  p.add(cyl(0.35, 0.45, 0.3, 6), 0x5a4a3a, [0, 0.15, 0]);
  p.add(cyl(0.22, 0.26, 1.8, 6), 0x8a6a44, [0, 1.2, 0]);
  for (const [y, c] of [
    [0.8, 0x4a9a6a],
    [1.4, 0xc8a050],
    [2.0, 0x4a9a6a],
  ] as const) {
    p.add(box(0.5, 0.42, 0.5), c, [0, y, 0]);
    p.add(box(0.3, 0.08, 0.05), 0x90f0b8, [0, y + 0.05, 0.26], [0, 0, 0], [1, 1, 1], true);
  }
  for (const sx of [-1, 1]) p.add(box(0.5, 0.12, 0.2), 0x8a6a44, [sx * 0.45, 2.1, 0], [0, 0, sx * 0.3]);
  p.add(gem(0.18), tc, [0, 2.45, 0], [0, 0, 0], [1, 1.4, 1], true);
  bone(body, p, 'totem|' + team);
  return { root, body, scale: 1, kind: 'building' };
}

// ── Здания ──

const STONE = [0xb4ab96, 0x6e5a56];
const STONE_D = [0x8a826e, 0x4d3e3c];

export function buildTower(team: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = STONE[team];
  const d = STONE_D[team];
  const tc = TEAM_ACCENT[team];
  const p = new Parts();
  p.add(cyl(1.8, 2.2, 1.0, 8), d, [0, 0.5, 0]);
  p.add(cyl(1.25, 1.55, 3.8, 8), s, [0, 2.9, 0]);
  p.add(cyl(1.3, 1.3, 0.18, 8), d, [0, 2.0, 0]);
  p.add(cyl(1.3, 1.3, 0.18, 8), d, [0, 3.6, 0]);
  p.add(cyl(1.6, 1.25, 0.7, 8), s, [0, 5.15, 0]);
  // Зубцы
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.add(box(0.45, 0.45, 0.3), d, [Math.sin(a) * 1.45, 5.7, Math.cos(a) * 1.45], [0, a, 0]);
  }
  // Знамёна команды
  for (const a of [0, Math.PI])
    p.add(box(0.7, 1.6, 0.05), tc, [Math.sin(a) * 1.42, 3.5, Math.cos(a) * 1.42], [0, a, 0]);
  // Окна-бойницы светятся
  for (const a of [Math.PI / 2, -Math.PI / 2])
    p.add(box(0.18, 0.5, 0.05), tc, [Math.sin(a) * 1.4, 4.1, Math.cos(a) * 1.4], [0, a, 0], [1, 1, 1], true);
  // Чаша для кристалла
  p.add(cyl(0.55, 0.3, 0.4, 6), d, [0, 6.0, 0]);
  bone(body, p, 'tower|' + team);
  const g = new Parts();
  g.add(gem(0.65), tc, [0, 0, 0], [0, 0, 0], [1, 1.5, 1], true);
  const gemG = new THREE.Group();
  gemG.position.y = 6.9;
  bone(gemG, g, 'tower-gem|' + team);
  body.add(gemG);
  return { root, body, scale: 1, gem: gemG as unknown as THREE.Mesh, kind: 'building' };
}

export function buildAncient(team: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = STONE[team];
  const d = STONE_D[team];
  const tc = TEAM_ACCENT[team];
  const p = new Parts();
  p.add(cyl(3.6, 4.2, 1.2, 10), d, [0, 0.6, 0]);
  p.add(cyl(2.8, 3.4, 0.9, 10), s, [0, 1.65, 0]);
  p.add(cyl(2.9, 2.9, 0.12, 10), tc, [0, 2.1, 0], [0, 0, 0], [1, 1, 1], true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 3.3;
    const z = Math.sin(a) * 3.3;
    p.add(box(0.55, 3.2, 0.55), s, [x, 3.6, z], [0, -a, 0]);
    p.add(box(0.75, 0.3, 0.75), d, [x, 5.3, z], [0, -a, 0]);
    p.add(gem(0.18), tc, [x, 5.65, z], [0, 0, 0], [1, 1, 1], true);
  }
  // Арки между колоннами
  p.add(ring(3.3, 0.18), d, [0, 5.35, 0], [Math.PI / 2, 0, 0]);
  bone(body, p, 'ancient|' + team);
  const g = new Parts();
  g.add(gem(1.9), tc, [0, 0, 0], [0, 0, 0], [1, 1.45, 1], true);
  g.add(ring(2.4, 0.07), 0xf1c453, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1], true);
  const gemG = new THREE.Group();
  gemG.position.y = 5;
  bone(gemG, g, 'ancient-gem|' + team);
  body.add(gemG);
  return { root, body, scale: 1, gem: gemG as unknown as THREE.Mesh, kind: 'building' };
}
