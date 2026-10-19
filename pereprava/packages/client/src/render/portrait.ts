// Портрет героя в нижней панели: та же модель крупным планом, живая (дыхание, удары, умения).
// Рисуется основным рендерером в прямоугольник под рамкой портрета — без второго контекста WebGL,
// это 6–8 лишних вызовов отрисовки за кадр.
import * as THREE from 'three';
import type { UnitSnap } from '@pereprava/shared';
import { animateRig, type Ages } from './anim';
import { makeModel, type Rig } from './models';

export class Portrait {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  private rig: Rig | null = null;
  private key = '';

  constructor() {
    this.scene.background = new THREE.Color(0x1c2432);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404858, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(2, 4, 5);
    this.scene.add(sun);
  }

  render(
    renderer: THREE.WebGLRenderer,
    el: HTMLElement,
    hero: string,
    team: number,
    snap: UnitSnap | undefined,
    ages: Ages,
    time: number,
    dt: number,
  ) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || !el.offsetParent) return;
    const key = hero + '|' + team;
    if (key !== this.key) {
      if (this.rig) this.scene.remove(this.rig.root);
      this.rig = makeModel(hero, team);
      this.rig.root.rotation.y = 0.4;
      this.scene.add(this.rig.root);
      this.key = key;
    }
    const rig = this.rig!;
    if (snap) animateRig(rig, { ...snap, mv: undefined }, time, dt, ages, true);
    // Камера на голову: высота модели — по корпусу
    const top = rig.body.position.y * 2.05;
    this.camera.aspect = r.width / r.height;
    this.camera.position.set(0.35, top + 0.05, 2.6);
    this.camera.lookAt(0, top - 0.15, 0);
    this.camera.updateProjectionMatrix();
    const c = renderer.domElement.getBoundingClientRect();
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, c.width, c.height);
  }
}
