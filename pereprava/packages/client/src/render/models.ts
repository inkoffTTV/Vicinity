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

export function makeRanger(): Rig {
  const r = rig();
  const b = r.body;
  part(b, geo('rng-legs', () => new THREE.CylinderGeometry(0.3, 0.45, 0.9, 6)), mat(0x5a4632), 0, 0.45, 0);
  part(b, geo('rng-torso', () => new THREE.CylinderGeometry(0.42, 0.34, 1, 6)), mat(0x4f8a3a), 0, 1.35, 0);
  part(b, geo('rng-cape', () => new THREE.ConeGeometry(0.62, 1.5, 6, 1, true)), mat(0x2f5a2a, { side: THREE.DoubleSide }), 0, 1.35, -0.12);
  part(b, geo('rng-head', () => new THREE.IcosahedronGeometry(0.36, 0)), mat(0xf0c9a0), 0, 2.08, 0);
  const hood = part(b, geo('rng-hood', () => new THREE.ConeGeometry(0.46, 0.75, 6)), mat(0x3d7a32), 0, 2.4, -0.05);
  hood.rotation.x = -0.25;
  const bow = new THREE.Group();
  bow.position.set(-0.55, 1.45, 0.25);
  const arc = part(bow, geo('rng-bow', () => new THREE.TorusGeometry(0.75, 0.05, 5, 12, Math.PI)), mat(0x8a5a2a), 0, 0, 0);
  arc.rotation.z = Math.PI / 2;
  part(bow, geo('rng-string', () => new THREE.CylinderGeometry(0.01, 0.01, 1.5, 3)), mat(0xe8e2d2), 0, 0, 0);
  b.add(bow);
  r.weapon = bow;
  part(b, geo('rng-quiver', () => new THREE.CylinderGeometry(0.14, 0.12, 0.9, 5)), mat(0x6b4b2e), 0.25, 1.6, -0.35).rotation.z = 0.3;
  addShield(r, 1.5);
  return r;
}

export function makeKeeper(): Rig {
  const r = rig();
  const b = r.body;
  part(b, geo('kpr-robe', () => new THREE.CylinderGeometry(0.32, 0.9, 1.8, 8)), mat(0xf2ead8), 0, 0.9, 0);
  part(b, geo('kpr-sash', () => new THREE.CylinderGeometry(0.4, 0.42, 0.18, 8)), mat(0xd4a63a), 0, 1.35, 0);
  part(b, geo('kpr-head', () => new THREE.IcosahedronGeometry(0.38, 0)), mat(0xf0c9a0), 0, 2.05, 0);
  part(b, geo('kpr-hair', () => new THREE.ConeGeometry(0.42, 0.9, 7)), mat(0xc98a3a), 0, 1.95, -0.12);
  const halo = part(b, geo('kpr-halo', () => new THREE.TorusGeometry(0.42, 0.04, 4, 16)), mat(0xffe08a, { emissive: 0xffc94a, emissiveIntensity: 1 }), 0, 2.6, 0);
  halo.rotation.x = Math.PI / 2;
  const staff = new THREE.Group();
  staff.position.set(0.7, 1.15, 0.1);
  part(staff, geo('kpr-staff', () => new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5)), mat(0xd9c8a0), 0, 0, 0);
  part(staff, geo('kpr-crystal', () => new THREE.OctahedronGeometry(0.26, 0)), mat(0xa8ffd0, { emissive: 0x3cd08a, emissiveIntensity: 1 }), 0, 1.3, 0);
  b.add(staff);
  r.weapon = staff;
  addShield(r, 1.6);
  return r;
}

export function makeShade(): Rig {
  const r = rig();
  const b = r.body;
  part(b, geo('shd-legs', () => new THREE.CylinderGeometry(0.3, 0.4, 0.9, 6)), mat(0x24222e), 0, 0.45, 0);
  part(b, geo('shd-cloak', () => new THREE.CylinderGeometry(0.3, 0.75, 1.5, 7)), mat(0x3a3250), 0, 1.25, 0);
  part(b, geo('shd-head', () => new THREE.IcosahedronGeometry(0.34, 0)), mat(0xd8b898), 0, 2.05, 0);
  part(b, geo('shd-hood', () => new THREE.ConeGeometry(0.45, 0.8, 6)), mat(0x2a2440), 0, 2.3, -0.05);
  part(b, geo('shd-mask', () => new THREE.BoxGeometry(0.42, 0.14, 0.12)), mat(0x9a2a3a), 0, 2.0, 0.3);
  const blades = new THREE.Group();
  blades.position.set(0, 1.25, 0.2);
  for (const sx of [-1, 1]) {
    const d = part(blades, geo('shd-blade', () => new THREE.BoxGeometry(0.08, 0.08, 0.8)), mat(0xd8dce8, { metalness: 0.5 }), sx * 0.55, 0, 0.3);
    d.rotation.y = sx * 0.2;
  }
  b.add(blades);
  r.weapon = blades;
  addShield(r, 1.5);
  return r;
}

export function makeNeutral(big: boolean): Rig {
  const r = rig(big ? 1.5 : 1);
  const b = r.body;
  const fur = mat(big ? 0x7a6a4a : 0x8a7a5a);
  const body = part(b, geo('n-body', () => new THREE.DodecahedronGeometry(0.6, 0)), fur, 0, 0.65, 0);
  body.scale.set(1.1, 0.9, 1.3);
  part(b, geo('n-head', () => new THREE.IcosahedronGeometry(0.34, 0)), fur, 0, 0.95, 0.65);
  for (const sx of [-1, 1]) {
    const h = part(b, geo('n-horn', () => new THREE.ConeGeometry(0.08, 0.35, 4)), mat(0xe8dcc0), sx * 0.2, 1.25, 0.65);
    h.rotation.z = -sx * 0.4;
  }
  part(b, geo('n-eyes', () => new THREE.BoxGeometry(0.3, 0.06, 0.06)), mat(0xffd27a, { emissive: 0xffa040, emissiveIntensity: 0.8 }), 0, 1.0, 0.95);
  r.weapon = b.children[1];
  return r;
}

/** Модели по id из снимка, кроме базовых */
export const HERO_MODELS: Record<string, () => Rig> = {
  ranger: makeRanger,
  keeper: makeKeeper,
  shade: makeShade,
  n_small: () => makeNeutral(false),
  n_big: () => makeNeutral(true),
};

/** Невидимость своего/союзного героя: полупрозрачные копии материалов */
export function setGhost(r: Rig, on: boolean) {
  const ud = r.root.userData as { ghost?: boolean; orig?: Map<THREE.Mesh, THREE.Material> };
  if (!!ud.ghost === on) return;
  ud.ghost = on;
  ud.orig ??= new Map();
  r.body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (on) {
      ud.orig!.set(m, m.material as THREE.Material);
      const c = (m.material as THREE.Material).clone();
      c.transparent = true;
      c.opacity = 0.38;
      m.material = c;
    } else {
      const orig = ud.orig!.get(m);
      if (orig) {
        (m.material as THREE.Material).dispose();
        m.material = orig;
      }
    }
  });
}
