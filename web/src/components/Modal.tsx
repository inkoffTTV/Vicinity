import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import { Icon } from './Icon';

interface Props {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  bare?: boolean;
  /** Дополнительный класс окна (размеры особых окон) */
  className?: string;
  /** Подпись окна для экранного диктора, если нет заголовка */
  label?: string;
}

export function Modal({ title, onClose, children, wide, bare, className, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Esc закрывает только верхнее окно (подтверждение поверх настроек), а не все сразу
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('.modal-backdrop');
      if (open[open.length - 1] === ref.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div ref={ref} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal${wide ? ' wide' : ''}${bare ? ' bare' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label}
      >
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn modal-close" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
              <Icon icon={X} size={22} className="anim-turn" />
            </button>
          </div>
        )}
        {/* Шапка окна стоит на месте, прокручивается только содержимое (на телефоне — тоже) */}
        {bare ? children : <div className={`modal-body${title ? '' : ' no-head'}`}>{children}</div>}
      </div>
    </div>
  );
}
