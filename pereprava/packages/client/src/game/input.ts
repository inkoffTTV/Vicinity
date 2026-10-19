// Ввод: мышь, тач и клавиатура превращаются в приказы. Тап/клик — идти или атаковать, перетаскивание
// пальцем — вести героя, щипок и колесо — масштаб, Q W E R — способности (с прицелом по курсору),
// 1–6 — предметы, B — лавка, S — стоп, G или Alt+клик — пинг (Shift — «опасно»).
import type { GameView } from '../render/view';

export interface InputActions {
  playing(): boolean;
  orderAt(sx: number, sy: number): void;
  moveTo(x: number, z: number): void;
  cast(slot: number, aim: { x: number; z: number } | null): void;
  useItem(slot: number, aim: { x: number; z: number } | null): void;
  toggleShop(open?: boolean): void;
  stop(): void;
  ping(x: number, z: number, kind: 'look' | 'danger' | 'go'): void;
  heroPos(): { x: number; z: number } | null;
}

export function attachInput(canvas: HTMLCanvasElement, view: GameView, act: InputActions) {
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let pinchD = 0;
  let lastMouse: { x: number; y: number } | null = null;
  let lastType = 'mouse';
  let dragT = 0;
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
    pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
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
    if (pointers.size === 1) act.orderAt(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = rel(e);
    if (e.pointerType === 'mouse') {
      lastMouse = p;
      lastType = 'mouse';
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
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code in SKILL) act.cast(SKILL[e.code], mouseAim());
    else if (/^Digit[1-6]$/.test(e.code)) act.useItem(+e.code.slice(5) - 1, mouseAim());
    else if (e.code === 'KeyB') act.toggleShop();
    else if (e.code === 'Escape') act.toggleShop(false);
    else if (e.code === 'KeyS') act.stop();
    else if (e.code === 'KeyG') {
      const g = mouseAim() ?? act.heroPos();
      if (g) act.ping(g.x, g.z, e.shiftKey ? 'danger' : 'look');
    }
  });
}
