import { desktop, useDesktopUpdate } from '../lib/desktop';

/** ПК-приложение скачало новую версию — предложить перезапуск */
export function DesktopUpdateBanner() {
  const ready = useDesktopUpdate();
  if (!ready || !desktop) return null;
  return (
    <div className="desktop-update" role="status">
      <span>Готово обновление Vicinity</span>
      <button type="button" className="btn small primary" onClick={() => desktop?.installUpdate()}>
        Перезапустить
      </button>
    </div>
  );
}
