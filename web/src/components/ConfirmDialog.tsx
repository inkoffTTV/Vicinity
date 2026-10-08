import { FormEvent, ReactNode, useState } from 'react';
import { Modal } from './Modal';

interface Props {
  title: string;
  children: ReactNode;
  /** Текст кнопки подтверждения */
  action: string;
  /** Кнопка подтверждения красная (необратимое действие) */
  danger?: boolean;
  /** Подтвердить можно, только введя эту строку (например, название сервера) */
  typeToConfirm?: string;
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
}

/** Подтверждение действия внутри приложения (вместо системного confirm) */
export function ConfirmDialog({ title, children, action, danger, typeToConfirm, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = typeToConfirm === undefined || typed.trim() === typeToConfirm.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="confirm-text">{children}</div>
        {typeToConfirm !== undefined && (
          <label>
            Введите «{typeToConfirm}» для подтверждения
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        <div className="row end">
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ready || busy} autoFocus={typeToConfirm === undefined}>
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}
