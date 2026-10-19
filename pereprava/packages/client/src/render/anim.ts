// Процедурная анимация общего скелета: покой (дыхание), бег (ноги и руки в противофазе, наклон,
// плащ), атака по виду оружия (рубящий удар, укол, выстрел, заклинание), замах умения (руки вверх)
// и его применение, вздрагивание от урона. Возраст событий (сколько секунд прошло) — из тиков снимка.
import type { UnitSnap } from '@pereprava/shared';
import type { Rig } from './models';

export interface Ages {
  atk: number;
  cast: number;
  hurt: number;
}

const ATK_TIME = 0.42;
const approach = (cur: number, target: number, k: number) => cur + (target - cur) * k;
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export function animateRig(rig: Rig, s: UnitSnap, time: number, dt: number, ages: Ages, mobile: boolean) {
  // «Толчок» при ударе, касте и полученном уроне (0,06 по щиту)
  const bump = Math.max(0, 0.15 - ages.atk, 0.18 - ages.cast, (s.sh ? 0.06 : 0.1) - ages.hurt);
  if (!mobile || rig.kind === 'building' || !rig.kind) {
    rig.root.scale.setScalar(rig.scale * (1 + bump * 0.25));
    return;
  }
  rig.root.scale.setScalar(rig.scale * (1 + bump * 0.3));
  if (rig.kind === 'beast') return animateBeast(rig, s, time, dt, ages);
  const b = rig.body;
  const k = Math.min(1, dt * 12);
  const y0 = (b.userData.y0 as number | undefined) ?? b.position.y;
  b.userData.y0 = y0;
  const ph = time * (s.k === 'hero' ? 10 : 11) + s.id;
  const run = s.mv ? Math.sin(ph) : 0;
  const [aL, aR] = rig.arms!;
  const [lL, lR] = rig.legs!;
  // Ноги
  lL.rotation.x = approach(lL.rotation.x, run * 0.8, k);
  lR.rotation.x = approach(lR.rotation.x, -run * 0.8, k);
  // Корпус: подпрыгивание на бегу, дыхание в покое; наклон вперёд на бегу, назад — от удара
  const hurt = ages.hurt < 0.18 ? Math.sin((ages.hurt / 0.18) * Math.PI) * 0.22 : 0;
  b.position.y = y0 + (s.mv ? Math.abs(Math.sin(ph)) * 0.09 : Math.sin(time * 2.2 + s.id) * 0.015);
  b.rotation.x = approach(b.rotation.x, (s.mv ? 0.12 : 0) - hurt, k);
  // Руки по умолчанию: на бегу — взмах, в покое — чуть разведены и покачиваются
  let lx = s.mv ? run * 0.6 : Math.sin(time * 2.2 + s.id) * 0.04;
  let rx = s.mv ? -run * 0.6 : -Math.sin(time * 2.2 + s.id) * 0.04;
  let twist = 0;
  // Замах умения: руки поднимаются, пока идёт каст-пойнт; потом — толчок вперёд
  const windup = s.cast ? Math.min(1, 1 - s.cast.t / s.cast.T) : 0;
  const release = ages.cast < 0.3 ? Math.sin((ages.cast / 0.3) * Math.PI) : 0;
  if (windup > 0) {
    lx = rx = -2.5 * ease(windup);
  } else if (release > 0) {
    lx = rx = -1.4 - release * 0.4;
  } else if (ages.atk < ATK_TIME) {
    const t = ages.atk / ATK_TIME;
    switch (rig.attack) {
      case 'swing':
        rx = t < 0.35 ? -2.7 * ease(t / 0.35) : -2.7 + 2.3 * ease((t - 0.35) / 0.65);
        twist = t < 0.35 ? -0.25 * (t / 0.35) : -0.25 + 0.45 * ease((t - 0.35) / 0.65);
        break;
      case 'thrust':
        rx = t < 0.3 ? 0.5 * (t / 0.3) : 0.5 - 2.1 * Math.sin(((t - 0.3) / 0.7) * Math.PI);
        lx = rig.attack === 'thrust' && t > 0.5 ? -1.2 * Math.sin(((t - 0.5) / 0.5) * Math.PI) : lx;
        break;
      case 'shoot':
        // Лук вперёд, тетиву назад, отпустили
        lx = -1.55;
        rx = t < 0.7 ? -1.55 + 0.3 * (t / 0.7) : -1.0;
        twist = -0.2;
        break;
      case 'cast':
        rx = -1.9 * Math.sin(t * Math.PI);
        lx = -0.6 * Math.sin(t * Math.PI);
        break;
    }
  }
  aL.rotation.x = approach(aL.rotation.x, lx, Math.min(1, dt * 20));
  aR.rotation.x = approach(aR.rotation.x, rx, Math.min(1, dt * 20));
  aL.rotation.z = approach(aL.rotation.z, -0.12, k);
  aR.rotation.z = approach(aR.rotation.z, 0.12, k);
  b.rotation.y = approach(b.rotation.y, twist, Math.min(1, dt * 16));
  // Плащ развевается
  if (rig.cape)
    rig.cape.rotation.x = approach(
      rig.cape.rotation.x,
      s.mv ? 0.45 + Math.sin(ph * 2) * 0.06 : 0.06 + Math.sin(time * 1.6 + s.id) * 0.04,
      Math.min(1, dt * 6),
    );
}

function animateBeast(rig: Rig, s: UnitSnap, time: number, dt: number, ages: Ages) {
  const b = rig.body;
  const k = Math.min(1, dt * 12);
  const y0 = (b.userData.y0 as number | undefined) ?? b.position.y;
  b.userData.y0 = y0;
  const ph = time * 13 + s.id;
  const run = s.mv ? Math.sin(ph) : 0;
  const legs = rig.legs!;
  // Галоп: передние вместе, задние в противофазе
  legs.forEach((l, i) => (l.rotation.x = approach(l.rotation.x, (i < 2 ? run : -run) * 0.7, k)));
  b.position.y = y0 + (s.mv ? Math.abs(Math.sin(ph)) * 0.1 : Math.sin(time * 2 + s.id) * 0.02);
  // Бросок вперёд при укусе
  const lunge = ages.atk < 0.3 ? Math.sin((ages.atk / 0.3) * Math.PI) : 0;
  b.position.z = lunge * 0.35;
  b.rotation.x = approach(b.rotation.x, lunge * 0.25 - (ages.hurt < 0.15 ? 0.15 : 0), k);
}
