// Динамическое разрешение для слабых телефонов: раз в 2 с смотрим средний кадр. Дольше 20 мс (меньше
// 50 FPS) — рисуем в меньшем разрешении, быстрее 17 мс — понемногу возвращаем. Картинка чуть мягче,
// зато управление остаётся плавным.
export class AutoScale {
  scale = 1;
  private sum = 0;
  private n = 0;

  constructor(
    private readonly apply: (scale: number) => void,
    private readonly min = 0.55,
  ) {}

  tick(dt: number) {
    if (document.hidden) return this.reset();
    this.sum += dt;
    this.n++;
    if (this.sum < 2) return;
    const avg = this.sum / this.n;
    this.reset();
    const prev = this.scale;
    if (avg > 1 / 50) this.scale = Math.max(this.min, this.scale - 0.15);
    else if (avg < 1 / 58) this.scale = Math.min(1, this.scale + 0.1);
    if (this.scale !== prev) this.apply(this.scale);
  }

  reset() {
    this.sum = 0;
    this.n = 0;
  }
}
