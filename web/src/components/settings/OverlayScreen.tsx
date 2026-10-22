import { useEffect, useState } from 'react';
import { desktop, OverlayCorner, OverlayPrefs } from '../../lib/desktop';
import { Segmented, Toggle } from '../SettingControls';

const CORNERS: [OverlayCorner, string][] = [
  ['top-right', 'Справа сверху'],
  ['top-left', 'Слева сверху'],
  ['bottom-right', 'Справа снизу'],
  ['bottom-left', 'Слева снизу'],
];

/** Настройки → Оверлей (только в ПК-приложении 1.1.0+): кто говорит в голосе, звонок и сообщения поверх игры */
export function OverlayScreen() {
  const bridge = desktop?.overlay;
  const [prefs, setPrefs] = useState<OverlayPrefs>({ enabled: false, corner: 'top-right' });
  useEffect(() => {
    if (!bridge) return;
    void bridge.get().then((p) => p && setPrefs(p));
    return bridge.onChange(setPrefs);
  }, [bridge]);
  const set = (patch: Partial<OverlayPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    bridge?.set(patch);
  };

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>Оверлей</h1>
        <p className="muted">Прозрачное окно поверх игры: кто говорит в голосовом канале, входящий звонок и новые сообщения из личек и бесед.</p>
      </header>
      {!bridge ? (
        <section className="settings-card stack">
          <strong>Нужно приложение для Windows</strong>
          <span className="muted small">
            Оверлей работает только в приложении Vicinity для Windows версии 1.1.0 и новее. В браузере можно открыть страницу{' '}
            <a href="/overlay" target="_blank" rel="noreferrer">
              /overlay
            </a>{' '}
            и положить её поверх игры своими средствами.
          </span>
        </section>
      ) : (
        <section className="settings-card stack">
          <Toggle
            label="Показывать оверлей"
            hint="Клики проходят сквозь него. Включить и выключить можно и клавишами Ctrl+Shift+O, и из меню в трее"
            checked={prefs.enabled}
            onChange={(enabled) => set({ enabled })}
          />
          <Segmented<OverlayCorner> label="Угол экрана" value={prefs.corner} options={CORNERS} onChange={(corner) => set({ corner })} />
          <span className="muted small">
            Игры в эксклюзивном полноэкранном режиме рисуются мимо любых оверлеев — переключите игру в оконный режим без рамки.
          </span>
        </section>
      )}
    </div>
  );
}
