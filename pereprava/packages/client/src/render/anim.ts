// Процедурная анимация: подпрыгивание при ходьбе, «толчок» при ударе и получении урона, замах оружием,
// подъём рук при касте. Возраст событий (сколько секунд прошло) приходит из тиков снимка.
import type { UnitSnap } from '@pereprava/shared';
import type { Rig } from './models';

export interface Ages {
  atk: number;
  cast: number;
  hurt: number;
}

export function animateRig(rig: Rig, s: UnitSnap, time: number, dt: number, ages: Ages, mobile: boolean) {
  // «Толчок» как в прототипе: удар 0,15, каст 0,18, полученный урон 0,1 (0,06 по щиту)
  const bump = Math.max(0, 0.15 - ages.atk, 0.18 - ages.cast, (s.sh ? 0.06 : 0.1) - ages.hurt);
  if (!mobile) {
    rig.root.scale.setScalar(rig.scale * (1 + bump * 0.25));
    return;
  }
  rig.root.scale.setScalar(rig.scale * (1 + bump * 1.2));
  const b = rig.body;
  if (s.mv) {
    const f = s.k === 'hero' ? 11 : 13;
    b.position.y = Math.abs(Math.sin(time * f + s.id)) * 0.14;
    b.rotation.x += (0.12 - b.rotation.x) * Math.min(1, dt * 10);
  } else {
    b.position.y *= Math.max(0, 1 - dt * 12);
    b.rotation.x += (0 - b.rotation.x) * Math.min(1, dt * 10);
  }
  // Замах оружием: 0,3 с после удара
  const w = rig.weapon;
  if (w) {
    const k = ages.atk < 0.3 ? Math.sin((ages.atk / 0.3) * Math.PI) : 0;
    const c = ages.cast < 0.35 ? Math.sin((ages.cast / 0.35) * Math.PI) : 0;
    const casting = s.cast ? Math.min(1, 1 - s.cast.t / s.cast.T) : 0;
    w.rotation.x = -k * 1.1 - Math.max(c, casting) * 0.9;
  }
  // Каст: тело вытягивается вверх
  b.scale.y = 1 + (ages.cast < 0.25 ? Math.sin((ages.cast / 0.25) * Math.PI) * 0.06 : 0);
}
