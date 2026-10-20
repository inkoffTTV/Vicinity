// Модели юнитов. Герои, крипы и великан — общий человеческий скелет с внешностью из looks.ts,
// волк — зверь на четырёх лапах, вышки и кристаллы — здания (всё строит humanoid.ts).
// У каждой модели есть «скелет» для процедурной анимации (anim.ts).
import * as THREE from 'three';
import { buildAncient, buildBeast, buildHumanoid, buildTotem, buildTower, type AttackStyle } from './humanoid';
import { BOSS_LOOK, CREEP_LOOKS, GIANT_LOOK, HERO_LOOKS } from './looks';

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
    // Призванные: волки Звероловки, тотем Шамана
    case 'spiritwolf':
      return buildBeast(0x7a9ad8, 0xe0f0ff, 'spiritwolf', 0.95);
    case 'boss':
      return buildHumanoid(BOSS_LOOK, 2, 'boss', 1.7);
    case 'ward': {
      const r = buildTotem(Math.min(1, team));
      r.scale = 0.45;
      r.root.scale.setScalar(0.45);
      return r;
    }
    // Курьер: маленький крылатый зверёк
    case 'courier':
      return buildBeast(0xd8b060, 0xfff4c0, 'courier', 0.55);
    case 'totem':
      return buildTotem(Math.min(1, team));
    // Облики: Оборотень в облике волка, лягушка от «Сглаза»
    case 'form:wolfform':
      return buildBeast(0x5a4a3a, 0xffd040, 'bigwolf', 1.55);
    case 'form:hex':
      return buildBeast(0x5aa040, 0xfff080, 'frog', 0.6);
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
