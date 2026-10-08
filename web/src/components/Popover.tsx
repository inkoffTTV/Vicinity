import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Под кнопкой (по её правому краю) или у точки (контекстное меню) */
  anchor?: HTMLElement;
  point?: { x: number; y: number };
  onClose: () => void;
  className: string;
  role: 'menu' | 'dialog';
  label: string;
  children: ReactNode;
}

/** Всплывающая панель поверх интерфейса: закрывается щелчком мимо, Esc, сменой размера окна */
export function Popover({ anchor, point, onClose, className, role, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // В пределах окна: у кнопки — выравнивание по её правому краю, у точки — от неё вправо-вниз
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = anchor?.getBoundingClientRect();
    const left = r ? r.right - w : point?.x ?? 0;
    const top = r ? r.bottom + 6 : point?.y ?? 0;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
    });
  }, [anchor, point]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      // Стрелки ходят по пунктам меню
      if (role === 'menu' && el && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const items = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) return;
        e.preventDefault();
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        return;
      }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose, role]);

  // Фокус внутрь, когда панель встала на место (скрытый элемент фокус не принимает)
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>('button, a[href], input')?.focus();
  }, [placed]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      role={role}
      aria-label={label}
      style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
