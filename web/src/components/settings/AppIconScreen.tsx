import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { APP_ICONS, AppIcon, appIconById, appIconUrl } from '../../lib/appIcon';
import { useAppearance } from '../../lib/prefs';
import { useStore } from '../../lib/store';
import { Icon } from '../Icon';

const TIER_NAME: Record<number, string> = { 0: 'Basic', 2: 'Standard', 3: 'Ultra' };
const SECTIONS: { tier: number; title: string }[] = [
  { tier: 0, title: 'Базовые' },
  { tier: 2, title: 'Входят в Standard' },
  { tier: 3, title: 'Входят в Ultra' },
];
const PHONE_APPS = ['Камера', 'Фото', 'Часы', 'Карты', 'Заметки', 'Vicinity', 'Погода', 'Музыка', 'Почта', 'Календарь', 'Файлы', 'Книги'];
const plural = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'значок' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'значка' : 'значков'}`;

function IconImg({ icon, size }: { icon: AppIcon; size: number }) {
  return <img className="ai-img" src={appIconUrl(icon)} width={size} height={size} alt="" draggable={false} />;
}

/** Настройки → Значок приложения (макет 01): выбор, примерка закрытых значков, предпросмотр вкладки и телефона */
export function AppIconScreen({ goSubscription }: { goSubscription: () => void }) {
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const toast = useStore((s) => s.toast);
  const appliedId = useAppearance((s) => s.appIcon);
  const setAppearance = useAppearance((s) => s.set);
  const [trying, setTrying] = useState<AppIcon | null>(null);

  const locked = (i: AppIcon) => i.tier > tier;
  const applied = locked(appIconById(appliedId)) ? APP_ICONS[0] : appIconById(appliedId);
  const cur = trying ?? applied;

  const pick = (i: AppIcon) => {
    if (locked(i)) return setTrying(i);
    setTrying(null);
    if (i.id === applied.id) return;
    setAppearance({ appIcon: i.id });
    toast(`Значок изменён на «${i.name}»`);
  };

  return (
    <div className="settings appicon-screen">
      <header className="settings-head">
        <h1 className="display">Значок приложения</h1>
        <p className="muted">Меняйте значок Vicinity на устройстве</p>
      </header>

      {tier < 3 && (
        <div className="ai-banner">
          <span>
            {tier < 2
              ? 'Значки доступны с подпиской Standard. Любой можно примерить, сохранить — только «Классику» и «Ночь».'
              : 'Значки Ultra можно примерить, но сохранить их можно только с подпиской Ultra.'}
          </span>
          <button type="button" className="btn small" onClick={goSubscription}>
            О подписке
          </button>
        </div>
      )}

      <div className="ai-layout">
        <div className="ai-sections">
          {SECTIONS.map((sec) => {
            const list = APP_ICONS.filter((i) => i.tier === sec.tier);
            return (
              <section key={sec.tier} className="acc-section" aria-label={sec.title}>
                <h2 className="acc-section-title ai-sec-title">
                  {sec.title}
                  <span className="muted small">{plural(list.length)}</span>
                </h2>
                <div className="ai-grid">
                  {list.map((i) => {
                    const isApplied = i.id === applied.id && !trying;
                    const isTrying = trying?.id === i.id;
                    const isLocked = locked(i);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        className={`ai-tile${isApplied ? ' on' : ''}${isTrying ? ' trying' : ''}${isLocked ? ' locked' : ''}`}
                        aria-pressed={isApplied}
                        aria-label={i.name + (isLocked ? `, нужен ${TIER_NAME[i.tier]}, можно примерить` : '') + (isApplied ? ', выбран' : '')}
                        onClick={() => pick(i)}
                      >
                        <span className="ai-tile-icon">
                          <IconImg icon={i} size={56} />
                          {isApplied && (
                            <span className="ai-check" aria-hidden="true">
                              <Icon icon={Check} size={11} />
                            </span>
                          )}
                          {isLocked && (
                            <span className="ai-lock" aria-hidden="true">
                              <Icon icon={Lock} size={10} />
                            </span>
                          )}
                        </span>
                        <span className="ai-name">{i.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <p className="muted small">Во вкладке браузера значок меняется сразу. У установленного приложения — после перезапуска.</p>
        </div>

        <aside className="ai-preview" aria-label="Предпросмотр">
          <div className="ai-preview-head">
            <IconImg icon={cur} size={40} />
            <div>
              <span className="muted small">Предпросмотр</span>
              <strong>{cur.name}</strong>
            </div>
          </div>

          <span className="muted small">Вкладка браузера</span>
          <div className="ai-browser" aria-hidden="true">
            <div className="ai-tabs">
              <span className="ai-tab on">
                <IconImg icon={cur} size={14} /> Vicinity · #общий
              </span>
              <span className="ai-tab">
                <i className="ai-tab-dot" /> Почта
              </span>
            </div>
            <div className="ai-url">{location.host}/общий</div>
          </div>

          <span className="muted small">Главный экран телефона</span>
          <div className="ai-phone" aria-hidden="true">
            {PHONE_APPS.map((a, n) => (
              <span key={a} className={`ai-app${a === 'Vicinity' ? ' ours' : ''}`}>
                {a === 'Vicinity' ? <IconImg icon={cur} size={40} /> : <i className={`ai-app-blank c${n % 6}`} />}
                <span>{a}</span>
              </span>
            ))}
          </div>

          {trying && (
            <div className="ai-trying">
              <span>
                Вы примеряете «{trying.name}». Сохранить можно с подпиской <strong>{TIER_NAME[trying.tier]}</strong>
              </span>
              <div className="row">
                <button type="button" className="btn small" onClick={() => setTrying(null)}>
                  Вернуть «{applied.name}»
                </button>
                <button type="button" className="btn small primary" onClick={goSubscription}>
                  О подписке
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
