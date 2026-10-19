// Low-poly модели из примитивов (как в прототипе). У каждой модели есть «скелет» для процедурной
// анимации: rig.body (наклоны, подпрыгивание), rig.weapon (замах), rig.shield (пузырь щита).
import * as THREE from 'three';

export const TEAM_COLORS = [0x3ec7a1, 0xe2504a, 0xc8b48a];

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Плоско затенённый материал (кэшируется: одинаковые цвета — один материал, меньше переключений) */
export function mat(color: number, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...o });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  weapon?: THREE.Object3D;
  shield?: THREE.Mesh;
  gem?: THREE.Mesh;
  /** Базовый масштаб модели */
  scale: number;
}

function part(g: THREE.Object3D, gm: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(gm, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function rig(scale = 1): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.scale.setScalar(scale);
  return { root, body, scale };
}

function addShield(r: Rig, radius: number) {
  const s = new THREE.Mesh(
    geo('shield' + radius, () => new THREE.IcosahedronGeometry(radius, 1)),
    new THREE.MeshBasicMaterial({ color: 0x8ee6ff, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  s.position.y = 1.4;
  s.visible = false;
  r.root.add(s);
  r.shield = s;
}

export function makeMage(): Rig {
  const r = rig();
  const b = r.body;
  part(b, geo('mage-robe', () => new THREE.CylinderGeometry(0.35, 0.85, 1.7, 7)), mat(0x5b5fd6), 0, 0.85, 0);
  part(b, geo('mage-head', () => new THREE.IcosahedronGeometry(0.42, 0)), mat(0xf0c9a0), 0, 2, 0);
  const hat = part(b, geo('mage-hat', () => new THREE.ConeGeometry(0.6, 1.1, 7)), mat(0x3a3da8), 0, 2.7, 0);
  hat.rotation.x = -0.18;
  const staff = new THREE.Group();
  staff.position.set(0.7, 1.2, 0.1);
  part(staff, geo('mage-staff', () => new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5)), mat(0x8a6a44), 0, 0, 0);
  part(staff, geo('mage-orb', () => new THREE.IcosahedronGeometry(0.24, 0)), mat(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 1.1 }), 0, 1.3, 0);
  b.add(staff);
  r.weapon = staff;
  addShield(r, 1.6);
  return r;
}

export function makeBrute(): Rig {
  const r = rig(1.08);
  const b = r.body;
  const skin = mat(0x9a4a3c);
  const iron = mat(0x4d4f57, { metalness: 0.3 });
  part(b, geo('brute-legs', () => new THREE.CylinderGeometry(0.75, 0.6, 1.1, 6)), mat(0x3b2a26), 0, 0.55, 0);
  part(b, geo('brute-torso', () => new THREE.CylinderGeometry(0.95, 0.7, 1.1, 6)), skin, 0, 1.6, 0);
  part(b, geo('brute-shoulders', () => new THREE.BoxGeometry(2.1, 0.45, 0.8)), iron, 0, 2.1, 0);
  part(b, geo('brute-head', () => new THREE.IcosahedronGeometry(0.48, 0)), skin, 0, 2.6, 0.1);
  part(b, geo('brute-helm', () => new THREE.CylinderGeometry(0.52, 0.56, 0.35, 6)), iron, 0, 2.85, 0.1);
  for (const sx of [-1, 1]) {
    const h = part(b, geo('brute-horn', () => new THREE.ConeGeometry(0.14, 0.6, 5)), mat(0xe8dcc0), sx * 0.45, 3.15, 0.1);
    h.rotation.z = -sx * 0.5;
  }
  const axe = new THREE.Group();
  axe.position.set(1.15, 1.5, 0.35);
  part(axe, geo('brute-haft', () => new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5)), mat(0x6b4b2e), 0, 0, 0);
  const blade = part(axe, geo('brute-blade', () => new THREE.BoxGeometry(0.12, 0.9, 0.8)), mat(0xc9ccd4, { metalness: 0.4 }), 0, 0.85, 0.4);
  blade.rotation.x = 0.2;
  b.add(axe);
  r.weapon = axe;
  addShield(r, 1.8);
  return r;
}

const CREEP = [mat(TEAM_COLORS[0]), mat(TEAM_COLORS[1])];
const CREEP_R = [mat(0x2a9c7d), mat(0xb8392f)];
const DARK = mat(0x2a2f38);
const METAL = mat(0x9aa3ad, { metalness: 0.3 });

export function makeCreep(team: number, ranged: boolean): Rig {
  const r = rig();
  const b = r.body;
  const t = Math.min(1, team);
  const body = part(b, geo('creep-body', () => new THREE.DodecahedronGeometry(0.55, 0)), ranged ? CREEP_R[t] : CREEP[t], 0, 0.62, 0);
  body.scale.set(1, 1.15, 1);
  part(b, geo('creep-eye', () => new THREE.BoxGeometry(0.5, 0.12, 0.12)), DARK, 0, 0.85, 0.45);
  if (ranged) part(b, geo('creep-hat', () => new THREE.ConeGeometry(0.35, 0.7, 5)), DARK, 0, 1.45, 0);
  else r.weapon = part(b, geo('creep-blade', () => new THREE.BoxGeometry(0.1, 0.1, 0.9)), METAL, 0.55, 0.7, 0.25);
  return r;
}

const STONE = [mat(0xa49c88), mat(0x5f4b49)];
const GEM = [0, 1].map((t) => mat(TEAM_COLORS[t], { emissive: TEAM_COLORS[t], emissiveIntensity: 0.8 }));

export function makeTower(team: number): Rig {
  const r = rig();
  const b = r.body;
  const st = STONE[team];
  part(b, geo('tower-base', () => new THREE.CylinderGeometry(1.7, 2.1, 1.2, 6)), st, 0, 0.6, 0);
  part(b, geo('tower-mid', () => new THREE.CylinderGeometry(1.05, 1.35, 4.2, 6)), st, 0, 3.3, 0);
  part(b, geo('tower-top', () => new THREE.CylinderGeometry(1.45, 1.05, 0.8, 6)), st, 0, 5.8, 0);
  r.gem = part(b, geo('tower-gem', () => new THREE.OctahedronGeometry(0.7, 0)), GEM[team], 0, 6.9, 0);
  return r;
}

export function makeAncient(team: number): Rig {
  const r = rig();
  const b = r.body;
  const st = STONE[team];
  part(b, geo('anc-base', () => new THREE.CylinderGeometry(3.4, 4, 1.4, 8)), st, 0, 0.7, 0);
  part(b, geo('anc-step', () => new THREE.CylinderGeometry(2.4, 3, 1, 8)), st, 0, 1.9, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    part(b, geo('anc-pillar', () => new THREE.BoxGeometry(0.6, 2.8, 0.6)), st, Math.cos(a) * 3.2, 2.6, Math.sin(a) * 3.2);
  }
  const gem = part(b, geo('anc-gem', () => new THREE.OctahedronGeometry(2, 0)), GEM[team], 0, 5, 0);
  gem.scale.y = 1.4;
  r.gem = gem;
  return r;
}

/** Модель по id из снимка */
export function makeModel(model: string, team: number): Rig {
  switch (model) {
    case 'mage':
      return makeMage();
    case 'brute':
      return makeBrute();
    case 'melee':
      return makeCreep(team, false);
    case 'ranged':
      return makeCreep(team, true);
    case 'tower':
      return makeTower(team);
    case 'ancient':
      return makeAncient(team);
    default:
      return HERO_MODELS[model]?.() ?? makeCreep(team, false);
  }
}

/** Модели героев, добавленных позже (фаза 3), регистрируются здесь */
export const HERO_MODELS: Record<string, () => Rig> = {};
