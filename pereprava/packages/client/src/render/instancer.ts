// Инстансинг моделей массовых юнитов (крипы, нейтралы).
// Модель остаётся обычной иерархией three.js — процедурная анимация двигает её как раньше, — но её
// меши не рисуются сами: каждый кадр их мировые матрицы копируются в InstancedMesh, по одному на пару
// «геометрия + материал». Сорок крипов — это 7 вызовов отрисовки вместо 120.
import * as THREE from 'three';
import type { Rig } from './models';

interface Batch {
  mesh: THREE.InstancedMesh;
  n: number;
}

export class RigInstancer {
  private batches = new Map<string, Batch>();
  private rigs = new Map<Rig, THREE.Mesh[]>();

  constructor(private readonly scene: THREE.Scene) {}

  add(r: Rig) {
    const parts: THREE.Mesh[] = [];
    // Все меши модели (ноги висят на корне, а не на корпусе), кроме пузыря щита
    r.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m === r.shield) return;
      m.visible = false;
      parts.push(m);
    });
    this.rigs.set(r, parts);
  }

  remove(r: Rig) {
    this.rigs.delete(r);
  }

  private batch(m: THREE.Mesh): Batch {
    const mat = m.material as THREE.Material;
    const key = m.geometry.uuid + mat.uuid;
    let b = this.batches.get(key);
    if (!b) {
      b = { mesh: this.makeMesh(m, 32), n: 0 };
      this.batches.set(key, b);
    }
    return b;
  }

  private makeMesh(m: THREE.Mesh, cap: number) {
    const mesh = new THREE.InstancedMesh(m.geometry, m.material as THREE.Material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = m.castShadow;
    mesh.receiveShadow = m.receiveShadow;
    this.scene.add(mesh);
    return mesh;
  }

  /** Места не хватило (большая волна) — вдвое больше, уже записанные матрицы переносим */
  private grow(b: Batch, m: THREE.Mesh) {
    const old = b.mesh;
    b.mesh = this.makeMesh(m, old.instanceMatrix.count * 2);
    (b.mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    this.scene.remove(old);
    old.dispose();
  }

  /** После анимации кадра: переложить матрицы частей в инстансы */
  update() {
    for (const b of this.batches.values()) b.n = 0;
    for (const [r, parts] of this.rigs) {
      if (!r.root.visible || !r.root.parent) continue;
      r.root.updateMatrixWorld(true);
      for (const m of parts) {
        const b = this.batch(m);
        if (b.n >= b.mesh.instanceMatrix.count) this.grow(b, m);
        b.mesh.setMatrixAt(b.n++, m.matrixWorld);
      }
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    this.rigs.clear();
  }
}
