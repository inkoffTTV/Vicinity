import { ReactNode, useEffect } from 'react';

interface Props {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  bare?: boolean;
}

export function Modal({ title, onClose, children, wide, bare }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}${bare ? ' bare' : ''}`} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
