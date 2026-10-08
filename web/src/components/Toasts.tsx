import { applyUpdate, usePwa } from '../lib/pwa';
import { useStore } from '../lib/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const updateReady = usePwa((s) => s.updateReady);
  return (
    <div className="toasts" aria-live="polite">
      {updateReady && (
        <div className="toast update" role="status">
          Доступна новая версия —{' '}
          <button className="btn small primary" onClick={applyUpdate}>
            обновить
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
