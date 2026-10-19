// Земля, вода, деревья, камни и фонтаны — статичная часть карты. Геометрия и случайные отклонения
// повторяют прототип 0.3 (тот же генератор и порядок вызовов), поэтому карта выглядит так же.
import * as THREE from 'three';
import { dLane, dRiver, groundH, mapTreeSet, Rng, treeCleared, WATER, type MapDef } from '@pereprava/shared';
import { mat, TEAM_COLORS } from './models';

const C = {
  g1: new THREE.Color(0x6b9a4b),
  g2: new THREE.Color(0x587f3c),
  dirt: new THREE.Color(0xb9975f),
  sand: new THREE.Color(0xc9b27c),
  bank: new THREE.Color(0x7d9a52),
  rock: new THREE.Color(0x8a8578),
  b0: new THREE.Color(0xb7b29f),
  b1: new THREE.Color(0x6e5a55),
  wither: new THREE.Color(0x5a5d3c),
};

function groundColor(m: MapDef, x: number, z: number, y: number, c: THREE.Color) {
  if (y > 2.2) return c.copy(C.rock);
  if (y < WATER + 0.12) return c.copy(C.sand);
  if (Math.hypot(x - m.ancients[0].x, z - m.ancients[0].z) < 11) return c.copy(C.b0);
  if (Math.hypot(x - m.ancients[1].x, z - m.ancients[1].z) < 11) return c.copy(C.b1);
  const wob = Math.sin(x * 0.7) * 0.5 + Math.cos(z * 0.9) * 0.5;
  if (dLane(m, x, z) < 3.2 + wob * 0.6) return c.copy(C.dirt);
  if (dRiver(x, z) < 7.5) return c.copy(C.bank);
  const n = (Math.sin(x * 0.13 + z * 0.07) + Math.cos(z * 0.11 - x * 0.05)) * 0.25 + 0.5;
  c.copy(C.g1).lerp(C.g2, n);
  if (x - z > 10) c.lerp(C.wither, Math.min(1, (x - z - 10) / 50) * 0.65);
  return c;
}

export interface Terrain {
  group: THREE.Group;
  water: THREE.Mesh;
}

/** Убрать землю со сцены и освободить видеопамять (смена карты) */
export function disposeTerrain(t: Terrain) {
  t.group.removeFromParent();
  t.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
  });
}

/** Земля, вода, деревья, камни и фонтаны карты. На карте 1v1 — как в прототипе (сетка 120 на 150 м) */
export function buildTerrain(m: MapDef, night: boolean): Terrain {
  const group = new THREE.Group();
  const rng = new Rng(m.seed);
  const rnd = () => rng.next();
  const size = m.ground * 2;
  // Плотность сетки как у прототипа (1,25 м), но на больших картах не больше 160 ячеек — бюджет телефона
  const segs = m.id === '1v1' ? 120 : Math.min(160, Math.round(size / 1.25));

  const g = new THREE.PlaneGeometry(size, size, segs, segs);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundH(m, p.getX(i), p.getZ(i)));
  const ng = g.toNonIndexed();
  g.dispose();
  const np = ng.attributes.position;
  const col = new Float32Array(np.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < np.count; i += 3) {
    const x = (np.getX(i) + np.getX(i + 1) + np.getX(i + 2)) / 3;
    const y = (np.getY(i) + np.getY(i + 1) + np.getY(i + 2)) / 3;
    const z = (np.getZ(i) + np.getZ(i + 1) + np.getZ(i + 2)) / 3;
    groundColor(m, x, z, y, c);
    const j = (rnd() - 0.5) * 0.05;
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r + j;
      col[(i + k) * 3 + 1] = c.g + j;
      col[(i + k) * 3 + 2] = c.b + j;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeVertexNormals();
  const ground = new THREE.Mesh(
    ng,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: night ? 0x2a5f8a : 0x3a8fc7,
      transparent: true,
      opacity: 0.82,
      roughness: 0.2,
      metalness: 0.1,
    }),
  );
  water.position.y = WATER;
  group.add(water);

  // Деревья: позиции — из общей карты (это препятствия), повороты и цвета — дальше по той же последовательности
  // Перебираем все деревья прототипа (чтобы случайные повороты и цвета совпадали), а на полянах лагерей — пропускаем
  const set = mapTreeSet(m);
  const all = set.all;
  const trees = set.trees;
  rng.seed = set.rngEnd;
  const crowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.25, 3.2, 6).translate(0, 2.7, 0),
    mat(0xffffff),
    trees.length,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.2, 0.28, 1.4, 5).translate(0, 0.7, 0),
    mat(0x6b4b2e),
    trees.length,
  );
  const dm = new THREE.Object3D();
  const greens = [0x2f6b35, 0x3b7a3a, 0x2a5a30, 0x4a7d3a];
  const dry = [0x4b5a35, 0x5d5b3a, 0x45502f];
  let i = 0;
  for (const t of all) {
    dm.position.set(t.x, groundH(m, t.x, t.z) - 0.1, t.z);
    dm.rotation.y = rnd() * 6.28;
    dm.scale.set(t.s, t.s * (0.9 + rnd() * 0.3), t.s);
    const pal = t.x - t.z > 10 ? dry : greens;
    const color = pal[Math.floor(rnd() * pal.length)];
    if (treeCleared(m, t)) continue;
    dm.updateMatrix();
    crowns.setMatrixAt(i, dm.matrix);
    trunks.setMatrixAt(i, dm.matrix);
    crowns.setColorAt(i++, new THREE.Color(color));
  }
  crowns.instanceColor!.needsUpdate = true;
  crowns.castShadow = trunks.castShadow = true;
  crowns.receiveShadow = true;
  group.add(crowns, trunks);

  // Камни вдоль реки
  const k = m.half / 60;
  const nRocks = Math.round(40 * k);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), mat(0x8f8a7e), nRocks);
  for (let i = 0; i < nRocks; i++) {
    let x: number;
    let z: number;
    do {
      x = (rnd() - 0.5) * 110 * k;
      z = x + (rnd() - 0.5) * 20;
    } while (dLane(m, x, z) < 5);
    dm.position.set(x, groundH(m, x, z), z);
    dm.rotation.set(rnd() * 3, rnd() * 3, 0);
    const s = 0.5 + rnd() * 1.1;
    dm.scale.set(s, s * 0.7, s);
    dm.updateMatrix();
    rocks.setMatrixAt(i, dm.matrix);
  }
  rocks.castShadow = true;
  group.add(rocks);

  m.fountains.forEach((F, t) => {
    const f = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.7, 10), mat(t ? 0x5f4b49 : 0xa49c88));
    base.position.y = 0.35;
    base.castShadow = base.receiveShadow = true;
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 0.2, 10),
      mat(t ? 0xff9a8a : 0x7fe0d0, { emissive: TEAM_COLORS[t], emissiveIntensity: 0.6 }),
    );
    pool.position.y = 0.65;
    f.add(base, pool);
    f.position.set(F.x, groundH(m, F.x, F.z), F.z);
    group.add(f);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(7.5, 8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[t], transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.position.set(F.x, groundH(m, F.x, F.z) + 0.08, F.z);
    group.add(ring);
  });
  return { group, water };
}
