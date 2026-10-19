// Эффекты: облачка, вспышки и кольца — инстансами (один вызов отрисовки на весь пул, сколько бы
// их ни было в драке), снаряды — по форме (стрела, сгусток, болт, кинжал, камень) со своим следом
// и вспышкой попадания. Вид снаряда умения — в таблице PROJ_FX, атак — по модели стрелявшего.
import * as THREE from 'three';
import { attackOf } from './humanoid';
import { CREEP_LOOKS, HERO_LOOKS } from './looks';

const VERT = `
attribute float aAlpha;
varying float vA;
varying vec3 vC;
void main() {
  vA = aAlpha;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FRAG = `
varying float vA;
varying vec3 vC;
void main() { gl_FragColor = vec4(vC, vA); }`;

interface Item {
  x: number;
  y: number;
  z: number;
  size: number;
  grow: number;
  life: number;
  max: number;
  color: number;
  alpha: number;
}

/** Пул одинаковых частиц в одном InstancedMesh: цвет и прозрачность у каждой своя */
export class FxPool {
  readonly mesh: THREE.InstancedMesh;
  private items: Item[] = [];
  private alpha: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    private readonly cap: number,
    additive = false,
  ) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alpha);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.c.setHex(0xffffff));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, color: number, size: number, life: number, grow = 1.6, alpha = 0.9) {
    // Пул ограничен: в большой драке лишние облачка не нужны
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ x, y, z, size, grow, life, max: life, color, alpha });
  }

  update(dt: number) {
    const it = this.items;
    let w = 0;
    for (let i = 0; i < it.length; i++) {
      const f = it[i];
      f.life -= dt;
      if (f.life <= 0) continue;
      const k = 1 - f.life / f.max;
      const s = f.size * (1 + k * f.grow);
      this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.sc.set(s, s, s));
      this.mesh.setMatrixAt(w, this.m);
      this.mesh.setColorAt(w, this.c.setHex(f.color));
      this.alpha.setX(w, f.alpha * (1 - k));
      it[w++] = f;
    }
    it.length = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }
}

// ── Снаряды ──

export type ProjShape = 'arrow' | 'orb' | 'bolt' | 'dagger' | 'rock' | 'vine' | 'star';

export interface ProjFx {
  shape: ProjShape;
  color: number;
  /** Цвет следа (0 — без следа) */
  trail: number;
  /** Вспышка попадания: цвет и размер */
  hit: number;
  hitSize: number;
}

/** Снаряды умений по id умения */
export const PROJ_FX: Record<string, ProjFx> = {
  fireball: { shape: 'orb', color: 0xffb347, trail: 0xff7a1f, hit: 0xff8a2a, hitSize: 1.6 },
  pierce: { shape: 'arrow', color: 0xd8ffb0, trail: 0xb6f08a, hit: 0xc8f08a, hitSize: 1 },
  bind: { shape: 'vine', color: 0x6ad87a, trail: 0x4ab85a, hit: 0x8af0a0, hitSize: 1.2 },
  dagger: { shape: 'dagger', color: 0xd8c8ff, trail: 0x9d7bff, hit: 0xc6b8ff, hitSize: 0.9 },
  mend: { shape: 'star', color: 0xfff2b8, trail: 0xf1e38a, hit: 0xfff2b8, hitSize: 1.2 },
};

/** Вид снаряда обычной атаки — по модели стрелявшего */
export function attackFx(model: string | undefined, color: number): ProjFx {
  if (model === 'tower') return { shape: 'bolt', color, trail: color, hit: color, hitSize: 1.2 };
  const look = model ? (HERO_LOOKS[model] ?? (model === 'ranged' ? CREEP_LOOKS.ranged : undefined)) : undefined;
  if (look && attackOf(look.weapon) === 'shoot')
    return { shape: 'arrow', color: 0xe8dcc0, trail: 0, hit: color, hitSize: 0.6 };
  return {
    shape: 'orb',
    color: look?.glow ?? color,
    trail: look?.glow ?? color,
    hit: look?.glow ?? color,
    hitSize: 0.7,
  };
}

const geoCache = new Map<ProjShape, THREE.BufferGeometry>();
function shapeGeo(s: ProjShape): THREE.BufferGeometry {
  let g = geoCache.get(s);
  if (g) return g;
  switch (s) {
    case 'arrow': {
      // Древко вдоль +Z с наконечником
      const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 4).rotateX(Math.PI / 2);
      const tip = new THREE.ConeGeometry(0.08, 0.22, 4).rotateX(Math.PI / 2).translate(0, 0, 0.55);
      g = mergeTwo(shaft, tip);
      break;
    }
    case 'bolt':
      g = new THREE.OctahedronGeometry(0.35, 0).scale(0.7, 0.7, 1.6);
      break;
    case 'dagger':
      g = new THREE.BoxGeometry(0.08, 0.04, 0.6);
      break;
    case 'rock':
      g = new THREE.DodecahedronGeometry(0.4, 0);
      break;
    case 'vine':
      g = new THREE.TorusKnotGeometry(0.22, 0.06, 24, 4);
      break;
    case 'star':
      g = new THREE.OctahedronGeometry(0.45, 0);
      break;
    default:
      g = new THREE.IcosahedronGeometry(0.5, 0);
  }
  geoCache.set(s, g);
  return g;
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const na = a.toNonIndexed();
  const nb = b.toNonIndexed();
  const pos = new Float32Array([...na.getAttribute('position').array, ...nb.getAttribute('position').array]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const projMats = new Map<number, THREE.MeshBasicMaterial>();
export function projMesh(fx: ProjFx, size: number): THREE.Mesh {
  let m = projMats.get(fx.color);
  if (!m) projMats.set(fx.color, (m = new THREE.MeshBasicMaterial({ color: fx.color, toneMapped: false })));
  const mesh = new THREE.Mesh(shapeGeo(fx.shape), m);
  mesh.scale.setScalar(fx.shape === 'arrow' || fx.shape === 'dagger' ? Math.max(1, size) : size * 0.9);
  return mesh;
}

/** Снаряд, который вращается в полёте (остальные смотрят по ходу) */
export const spins = (s: ProjShape) => s === 'orb' || s === 'rock' || s === 'vine' || s === 'star';
