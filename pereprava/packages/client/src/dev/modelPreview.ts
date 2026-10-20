// Стенд моделей: все герои рядами по 8 при игровом свете. Открыть /models.html (?angle=0.5, ?team=1).
import * as THREE from 'three';
import { HEROES } from '@pereprava/shared';
import { createScene } from '../render/scene';
import { makeModel, type Rig } from '../render/models';

const q = new URLSearchParams(location.search);
const kit = createScene(document.getElementById('host')!);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5b8a3c }),
);
ground.receiveShadow = true;
kit.scene.add(ground);
const team = +(q.get('team') ?? 0);
const rigs: Rig[] = HEROES.map((h, i) => {
  const r = makeModel(h.id, team);
  r.root.position.set(((i % 8) - 3.5) * 3, 0, Math.floor(i / 8) * 4 - 4);
  kit.scene.add(r.root);
  return r;
});
const fixed = q.get('angle');
kit.camera.position.set(0, 9, 19);
kit.camera.lookAt(0, 1, 0);
const resize = () => {
  kit.renderer.setSize(innerWidth, innerHeight, false);
  kit.camera.aspect = innerWidth / innerHeight;
  kit.camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();
(function frame(t: number) {
  for (const r of rigs) r.root.rotation.y = fixed !== null ? +fixed : t / 1600;
  kit.renderer.render(kit.scene, kit.camera);
  requestAnimationFrame(frame);
})(0);
