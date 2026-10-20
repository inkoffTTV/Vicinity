// Ввод: мышь, тач и клавиатура превращаются в приказы. Тап/клик — идти или атаковать, перетаскивание
// пальцем — вести героя, щипок и колесо — масштаб, Q W E R — способности (прицел или сразу по курсору —
// см. настройки), Ctrl + Q W E R — изучить умение, A + клик — атака с передвижением, Esc или правая
// кнопка — отменить прицел, 1–6 — предметы, T — телепорт, C — курьер, B — лавка, S — стоп,
// G или Alt+клик — пинг (Shift — «опасно»). Правую кнопку можно держать — герой идёт за курсором.
import type { GameView } from '../render/view';

export interface InputActions {
  playing(): boolean;
  /** Нажатие по полю. button: 0 — левая/палец, 2 — правая. false — не вести героя за пальцем дальше */
  orderAt(sx: number, sy: number, button: number, touch: boolean): boolean;
  /** Курсор мыши над полем (без нажатия) */
  hover(sx: number, sy: number): void;
  moveTo(x: number, z: number): void;
  /** Клавиша способности */
  skillKey(slot: number): void;
  /** Ctrl + клавиша способности: изучить */
  learn(slot: number): void;
  /** T: свиток телепорта — выбрать, куда */
  tpAim(): void;
  /** C: отправить курьера */
  courier(): void;
  /** Y: колесо фраз */
  sayWheel(): void;
  useItem(slot: number, aim: { x: number; z: number } | null): void;
  /** A: следующий клик — атака с передвижением */
  armAttackMove(): void;
  /** Esc: отменить прицел; true — было что отменять */
  cancelAim(): boolean;
  toggleShop(open?: boolean): void;
  stop(): void;
  ping(x: number, z: number, kind: 'look' | 'danger' | 'go'): void;
  heroPos(): { x: number; z: number } | null;
}

export function attachInput(canvas: HTMLCanvasElement, view: GameView, act: InputActions) {
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; drag: boolean }>();
  let pinchD = 0;
  let lastMouse: { x: number; y: number } | null = null;
  let lastType = 'mouse';
  let dragT = 0;
  let hoverQueued = false;
  const rel = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clampZoom = (z: number) => Math.max(0.65, Math.min(1.6, z));

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* не важно */
    }
    const p = rel(e);
    lastType = e.pointerType;
    const ptr = { x: p.x, y: p.y, sx: p.x, sy: p.y, drag: false };
    pointers.set(e.pointerId, ptr);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (pointers.size === 1 && e.altKey && act.playing()) {
      const g = view.groundAt(p.x, p.y);
      if (g) act.ping(g.x, g.z, e.shiftKey ? 'danger' : 'look');
      return;
    }
    if (pointers.size === 1) ptr.drag = act.orderAt(p.x, p.y, e.button, e.pointerType !== 'mouse');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = rel(e);
    if (e.pointerType === 'mouse') {
      lastMouse = p;
      lastType = 'mouse';
      // Наведение — не чаще раза за кадр
      if (!hoverQueued) {
        hoverQueued = true;
        requestAnimationFrame(() => {
          hoverQueued = false;
          if (lastMouse) act.hover(lastMouse.x, lastMouse.y);
        });
      }
    }
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    ptr.x = p.x;
    ptr.y = p.y;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0) view.zoom = clampZoom((view.zoom * pinchD) / d);
      pinchD = d;
      return;
    }
    if (
      pointers.size === 1 &&
      ptr.drag &&
      act.playing() &&
      Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 10 &&
      performance.now() - dragT > 110
    ) {
      dragT = performance.now();
      const g = view.groundAt(p.x, p.y);
      if (g) act.moveTo(g.x, g.z);
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchD = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      lastMouse = null;
      act.hover(-1, -1);
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.zoom = clampZoom(view.zoom * (e.deltaY > 0 ? 1.08 : 0.93));
    },
    { passive: false },
  );
  const mouseAim = () => (lastType === 'mouse' && lastMouse ? view.groundAt(lastMouse.x, lastMouse.y) : null);
  const SKILL: Record<string, number> = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3 };
  window.addEventListener('keydown', (e) => {
    if (e.repeat || !act.playing()) return;
    const t = e.target as HTMLElement | null;
    // В поле ввода (поиск в лавке) работает только Esc — закрыть
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
    if (e.code in SKILL && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      act.learn(SKILL[e.code]);
    } else if (e.code in SKILL) act.skillKey(SKILL[e.code]);
    else if (e.code === 'KeyT') act.tpAim();
    else if (e.code === 'KeyC') act.courier();
    else if (e.code === 'KeyY') act.sayWheel();
    else if (/^Digit[1-6]$/.test(e.code)) act.useItem(+e.code.slice(5) - 1, mouseAim());
    else if (e.code === 'KeyA') act.armAttackMove();
    else if (e.code === 'KeyB') {
      // Лавка ставит фокус в поиск прямо сейчас — без этого буква «b» попала бы в поле
      e.preventDefault();
      act.toggleShop();
    } else if (e.code === 'Escape') {
      if (!act.cancelAim()) act.toggleShop(false);
    } else if (e.code === 'KeyS') act.stop();
    else if (e.code === 'KeyG') {
      const g = mouseAim() ?? act.heroPos();
      if (g) act.ping(g.x, g.z, e.shiftKey ? 'danger' : 'look');
    }
  });
}
