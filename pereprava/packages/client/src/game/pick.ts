// Выбор юнита по лучу из камеры — чистая функция без three.js (её проверяет vitest).
// Юнит — вертикальный столбик: от земли (y) до y + h, радиус r. Луч попадает, если проходит
// ближе «радиуса захвата» — он больше настоящего радиуса, особенно у мелких крипов,
// чтобы их было легко выбрать и пальцем, и мышью.

export interface Ray3 {
  ox: number;
  oy: number;
  oz: number;
  /** Направление (нормированное) */
  dx: number;
  dy: number;
  dz: number;
}

export interface PickCand {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Радиус юнита */
  r: number;
  /** Высота столбика */
  h: number;
}

/** Радиус захвата: настоящий радиус с запасом, мелким — запас больше */
export const grabRadius = (r: number) => Math.max(1.05, r * 1.25 + 0.35);

/** Кратчайшее расстояние от луча (t ≥ 0) до вертикального отрезка; t — где на луче */
export function rayToColumn(ray: Ray3, c: PickCand): { d: number; t: number } {
  // Отрезок Q(s) = (x, y + s, z), s ∈ [0, h]; луч P(t) = O + tD
  const wx = ray.ox - c.x;
  const wy = ray.oy - c.y;
  const wz = ray.oz - c.z;
  const b = ray.dy; // D·U, U = (0, 1, 0)
  const d = ray.dx * wx + ray.dy * wy + ray.dz * wz; // D·w
  const e = wy; // U·w
  const den = 1 - b * b;
  let t: number;
  let s: number;
  if (den < 1e-8) {
    // Луч вертикальный — просто расстояние по горизонтали
    t = Math.max(0, -d);
    s = Math.max(0, Math.min(c.h, wy + t * ray.dy));
  } else {
    // Ближайшие точки прямых, затем зажимаем s в отрезок и t в луч, пересчитывая другую
    s = Math.max(0, Math.min(c.h, (e - b * d) / den));
    t = Math.max(0, b * s - d);
    s = Math.max(0, Math.min(c.h, b * t + e));
  }
  const px = ray.ox + ray.dx * t - c.x;
  const py = ray.oy + ray.dy * t - (c.y + s);
  const pz = ray.oz + ray.dz * t - c.z;
  return { d: Math.hypot(px, py, pz), t };
}

/** Юнит под лучом: из попавших — тот, к кому луч ближе всего относительно радиуса захвата,
 *  при равенстве — ближний к камере. 0 — никого */
export function pickByRay(ray: Ray3, cands: readonly PickCand[]): number {
  let best = 0;
  let bk = Infinity;
  let bt = Infinity;
  for (const c of cands) {
    const { d, t } = rayToColumn(ray, c);
    const g = grabRadius(c.r);
    if (d > g) continue;
    const k = d / g;
    if (k < bk - 1e-6 || (Math.abs(k - bk) <= 1e-6 && t < bt)) {
      bk = k;
      bt = t;
      best = c.id;
    }
  }
  return best;
}
