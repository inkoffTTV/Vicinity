// Лес: лагеря нейтралов и руна в реке.
// Нейтралы стоят на месте, пока их не тронут; напавшего преследуют не дальше 10 м от лагеря,
// потом возвращаются и восстанавливают здоровье. Пустой лагерь появляется снова в начале минуты,
// если рядом нет героев. Руна появляется каждые 90 с в одной из двух точек реки.
import type { Unit } from '../types';
import { disengage, engage } from './engage';
import { addMod, hasFlag } from './modifiers';
import { addUnit, DT, emit, fx, mapOf, moveToward, rand, unitById, type World } from './world';

const LEASH = 10;

const NEUTRALS = {
  n_small: { maxHp: 300, dmg: 16, range: 1.3, atkInt: 1.1, speed: 4.4, radius: 0.6, barH: 1.9, armor: 0 },
  n_big: { maxHp: 760, dmg: 30, range: 1.5, atkInt: 1.3, speed: 4, radius: 0.95, barH: 2.8, armor: 2 },
};

function spawnCamp(w: World, i: number) {
  const c = mapOf(w).camps[i];
  const kinds: (keyof typeof NEUTRALS)[] = c.type === 'big' ? ['n_big', 'n_small'] : ['n_small', 'n_small'];
  kinds.forEach((m, k) => {
    const a = (k / kinds.length) * Math.PI * 2 + i;
    const x = c.x + Math.cos(a) * 1.6;
    const z = c.z + Math.sin(a) * 1.6;
    addUnit(w, {
      kind: 'neutral',
      team: 2,
      model: m,
      x,
      z,
      rot: a + Math.PI,
      camp: i,
      homeX: x,
      homeZ: z,
      ...NEUTRALS[m],
    });
  });
}

export function setupCamps(w: World) {
  const camps = mapOf(w).camps;
  w.camps = camps.map((c, i) => ({ id: i, x: c.x, z: c.z, type: c.type, respawnAt: 0 }));
  camps.forEach((_, i) => spawnCamp(w, i));
}

export function updateCamps(w: World) {
  // Проверка раз в минуту, в начале минуты
  if (w.tick % (60 * 30) !== 0) return;
  w.camps.forEach((c, i) => {
    if (w.units.some((u) => u.alive && u.kind === 'neutral' && u.camp === i)) return;
    if (w.units.some((u) => u.alive && u.kind === 'hero' && Math.hypot(u.x - c.x, u.z - c.z) < 7)) return;
    spawnCamp(w, i);
  });
}

/** Нейтрал получил урон — он и соседи по лагерю нападают на обидчика */
export function aggroNeutral(w: World, t: Unit, src: Unit) {
  if (src.team === 2) return;
  for (const u of w.units) if (u.alive && u.kind === 'neutral' && u.camp === t.camp && !u.target) u.target = src.id;
}

export function updateNeutral(w: World, u: Unit) {
  if (hasFlag(u, 'stun')) return;
  const hx = u.homeX ?? u.x;
  const hz = u.homeZ ?? u.z;
  let t = unitById(w, u.target);
  if (
    t &&
    (!t.alive ||
      hasFlag(t, 'invisible') ||
      Math.hypot(t.x - hx, t.z - hz) > LEASH ||
      Math.hypot(u.x - hx, u.z - hz) > LEASH + 4)
  ) {
    u.target = 0;
    t = undefined;
  }
  if (t) {
    engage(w, u, t);
    return;
  }
  disengage(u);
  if (Math.hypot(u.x - hx, u.z - hz) > 0.3) {
    moveToward(u, hx, hz);
    // Возвращаясь, быстро восстанавливается
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25 * DT);
  } else if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.1 * DT);
}

const RUNES = ['haste', 'damage', 'regen', 'shield'] as const;
export const RUNE_NAMES: Record<string, string> = {
  haste: 'Руна скорости',
  damage: 'Руна силы',
  regen: 'Руна восстановления',
  shield: 'Руна щита',
};

export function updateRunes(w: World) {
  if (w.time >= w.nextRune) {
    w.nextRune += 90;
    if (!w.rune) {
      const spots = mapOf(w).runeSpots;
      const spot = spots[Math.floor(rand(w) * spots.length)];
      w.rune = { kind: RUNES[Math.floor(rand(w) * RUNES.length)], x: spot.x, z: spot.z };
      emit(w, { e: 'rune', x: spot.x, z: spot.z, rune: w.rune.kind });
    }
  }
  const r = w.rune;
  if (!r) return;
  for (const u of w.units) {
    if (u.kind !== 'hero' || !u.alive || Math.hypot(u.x - r.x, u.z - r.z) > 1.8) continue;
    if (r.kind === 'haste') addMod(u, 'runeHaste', 20, 0, u.id);
    else if (r.kind === 'damage') addMod(u, 'runeDamage', 20, 0, u.id);
    else if (r.kind === 'regen') addMod(u, 'runeRegen', 8, 60, u.id);
    else {
      const m = addMod(u, 'shield', 12, 0, u.id);
      m.v = Math.max(m.v, 250);
      m.t = 12;
    }
    fx(w, r.x, r.z, 0.8, 0xf1c453, 1.2, 0.5, 2);
    emit(w, { e: 'rune', x: r.x, z: r.z, rune: r.kind, taker: u.id });
    w.rune = null;
    return;
  }
}
