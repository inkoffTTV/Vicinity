// Модели юнитов. Герои, крипы и великан — общий человеческий скелет с внешностью из looks.ts,
// волк — зверь на четырёх лапах, вышки и кристаллы — здания (всё строит humanoid.ts).
// У каждой модели есть «скелет» для процедурной анимации (anim.ts).
import * as THREE from 'three';
import { buildAncient, buildBeast, buildHumanoid, buildTower, type AttackStyle } from './humanoid';
import { CREEP_LOOKS, GIANT_LOOK, HERO_LOOKS } from './looks';

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

export interface Rig {
  root: THREE.Group;
  /** Корпус: наклоны, подпрыгивание (у человека — от таза) */
  body: THREE.Group;
  /** Чем бьёт (у человека — правая рука с оружием) */
  weapon?: THREE.Object3D;
  shield?: THREE.Mesh;
  /** Кристалл здания: вращается, гаснет при разрушении */
  gem?: THREE.Object3D;
  /** Базовый масштаб модели */
  scale: number;
  kind?: 'humanoid' | 'beast' | 'building';
  arms?: [THREE.Group, THREE.Group];
  legs?: THREE.Group[];
  cape?: THREE.Group;
  attack?: AttackStyle;
}

/** Модель по id из снимка */
export function makeModel(model: string, team: number): Rig {
  switch (model) {
    case 'melee':
    case 'ranged':
      return buildHumanoid(CREEP_LOOKS[model], team, 'creep-' + model, 0.72);
    case 'tower':
      return buildTower(Math.min(1, team));
    case 'ancient':
      return buildAncient(Math.min(1, team));
    case 'n_small':
      return buildBeast(0x8a7a5a, 0xffc04a, 'wolf', 0.95);
    case 'n_big':
      return buildHumanoid(GIANT_LOOK, 2, 'giant', 0.9);
    default: {
      const look = HERO_LOOKS[model] ?? HERO_LOOKS.mage;
      return buildHumanoid(look, team, 'hero-' + model, 1);
    }
  }
}

/** Невидимость своего/союзного героя: полупрозрачные копии материалов */
export function setGhost(r: Rig, on: boolean) {
  const ud = r.root.userData as { ghost?: boolean; orig?: Map<THREE.Mesh, THREE.Material> };
  if (!!ud.ghost === on) return;
  ud.ghost = on;
  ud.orig ??= new Map();
  r.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === r.shield) return;
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
