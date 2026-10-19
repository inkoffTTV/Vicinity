// Генератор Парка–Миллера (как в прототипе): одинаковое зерно даёт одинаковую последовательность
// на клиенте, сервере и в будущем порте на C++. Состояние — одно целое число, его легко сохранить.

export const RNG_MOD = 2147483647;

export function rngNext(seed: number): number {
  return (seed * 16807) % RNG_MOD;
}

/** Последовательность с изменяемым состоянием — для генерации карты и оформления */
export class Rng {
  constructor(public seed: number) {}
  next(): number {
    this.seed = rngNext(this.seed);
    return this.seed / RNG_MOD;
  }
  /** Пропустить n значений (так карта совпадает с прототипом, где часть чисел уходила на цвет земли) */
  skip(n: number): void {
    for (let i = 0; i < n; i++) this.seed = rngNext(this.seed);
  }
}
