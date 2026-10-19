// Сцена, свет и рендерер. Прототип работал на three.js r128: без управления цветом и с «старой»
// шкалой света. В новых версиях (r152+ и r155+) это изменилось, поэтому:
//  - ColorManagement выключен и вывод в LinearSRGB — цвета из hex попадают в кадр как в r128;
//  - интенсивность полусферного и направленного света умножена на π — так r155+ даёт ту же
//    освещённость, что r128 в режиме legacy lights.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

export const LEGACY_LIGHT = Math.PI;

export type Quality = 'low' | 'mid' | 'high';

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  night: boolean;
  fog: THREE.Fog;
}

export function isNight(): boolean {
  return getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() === 'night';
}

export function createScene(host: HTMLElement): SceneKit {
  const night = isNight();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'view';
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color(night ? 0x17202a : 0xc8d6bd);
  scene.background = sky;
  const fog = new THREE.Fog(sky, 62, 135);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
  scene.add(
    new THREE.HemisphereLight(
      night ? 0x8091c4 : 0xfff1d6,
      night ? 0x1a2416 : 0x4d5c36,
      (night ? 0.62 : 0.8) * LEGACY_LIGHT,
    ),
  );
  const sun = new THREE.DirectionalLight(night ? 0xa9bcff : 0xffe0b0, (night ? 0.7 : 1.05) * LEGACY_LIGHT);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 160 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  return { renderer, scene, camera, sun, night, fog };
}

/** Качество: плотность пикселей и размер карты теней */
export function applyQuality(kit: SceneKit, q: Quality, shadows: boolean) {
  const dpr = window.devicePixelRatio || 1;
  kit.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 0.75) : q === 'mid' ? 1 : Math.min(dpr, 1.75));
  const size = q === 'high' ? 2048 : q === 'mid' ? 1024 : 512;
  if (kit.sun.shadow.mapSize.x !== size) {
    kit.sun.shadow.mapSize.set(size, size);
    kit.sun.shadow.map?.dispose();
    kit.sun.shadow.map = null;
  }
  kit.renderer.shadowMap.enabled = shadows;
  kit.sun.castShadow = shadows;
  kit.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
  });
}
