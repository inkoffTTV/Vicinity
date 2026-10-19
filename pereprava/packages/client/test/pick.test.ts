import { describe, expect, it } from 'vitest';
import { grabRadius, pickByRay, rayToColumn, type PickCand, type Ray3 } from '../src/game/pick';

/** Луч из камеры над точкой (cx, cz), смотрящий на точку земли (x, 0, z) */
function rayTo(x: number, z: number, from = { x: 0, y: 30, z: 20 }): Ray3 {
  const dx = x - from.x;
  const dy = -from.y;
  const dz = z - from.z;
  const l = Math.hypot(dx, dy, dz);
  return { ox: from.x, oy: from.y, oz: from.z, dx: dx / l, dy: dy / l, dz: dz / l };
}

const creep = (id: number, x: number, z: number): PickCand => ({ id, x, y: 0, z, r: 0.6, h: 1.6 });
const hero = (id: number, x: number, z: number): PickCand => ({ id, x, y: 0, z, r: 0.8, h: 2.6 });
const tower = (id: number, x: number, z: number): PickCand => ({ id, x, y: 0, z, r: 2.2, h: 8 });

describe('выбор юнита по лучу', () => {
  it('луч в юнита — расстояние 0', () => {
    const c = hero(1, 3, -2);
    expect(rayToColumn(rayTo(3, -2), c).d).toBeCloseTo(0, 6);
  });

  it('вертикальный луч: расстояние по горизонтали', () => {
    const r: Ray3 = { ox: 1, oy: 10, oz: 0, dx: 0, dy: -1, dz: 0 };
    expect(rayToColumn(r, creep(1, 0, 0)).d).toBeCloseTo(1, 6);
  });

  it('объект за спиной камеры не выбирается', () => {
    const r: Ray3 = { ox: 0, oy: 1, oz: 0, dx: 1, dy: 0, dz: 0 };
    expect(pickByRay(r, [creep(1, -3, 0)])).toBe(0);
  });

  it('мелкого крипа берёт с запасом по радиусу', () => {
    // Мимо на 0,9 м — дальше настоящего радиуса 0,6, но в радиусе захвата
    expect(grabRadius(0.6)).toBeGreaterThan(0.9);
    expect(pickByRay(rayTo(0.9, 0), [creep(7, 0, 0)])).toBe(7);
    // А на 2 м — уже мимо
    expect(pickByRay(rayTo(2.2, 0), [creep(7, 0, 0)])).toBe(0);
  });

  it('из нескольких — ближайший к лучу, при равенстве — ближний к камере', () => {
    const cands = [creep(1, 0, 0), creep(2, 1.1, 0), hero(3, -6, 0)];
    expect(pickByRay(rayTo(1, 0), cands)).toBe(2);
    expect(pickByRay(rayTo(0.1, 0), cands)).toBe(1);
    expect(pickByRay(rayTo(-6, 0), cands)).toBe(3);
    // Два одинаковых на линии взгляда: ближний к камере (камера при z = 20)
    const r: Ray3 = { ox: 0, oy: 1, oz: 20, dx: 0, dy: 0, dz: -1 };
    expect(pickByRay(r, [creep(10, 0, 0), creep(11, 0, 5)])).toBe(11);
  });

  it('высокое здание ловится и по верхней части', () => {
    // Луч, проходящий над землёй мимо основания, но через тело вышки на высоте 6 м
    const r: Ray3 = { ox: -20, oy: 6, oz: 0, dx: 1, dy: 0, dz: 0 };
    expect(pickByRay(r, [tower(5, 0, 0)])).toBe(5);
    const over: Ray3 = { ox: -20, oy: 12, oz: 0, dx: 1, dy: 0, dz: 0 };
    expect(pickByRay(over, [tower(5, 0, 0)])).toBe(0);
  });
});
