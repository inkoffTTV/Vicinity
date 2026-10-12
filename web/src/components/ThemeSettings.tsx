import { CSSProperties, useEffect, useState } from 'react';
import { useThemeAccess } from '../lib/appearanceSync';
import { usePlan } from '../lib/plan';
import { ACCENTS, DEFAULT_ACCENT, FontSize, ServerTheme, useAppearance } from '../lib/prefs';
import { BASE_THEMES, COLOR_THEMES, CustomTheme, gradientCss, themeById } from '../lib/themes';
import { Segmented, Toggle } from './SettingControls';

type GoTo = (tab: 'accessibility' | 'subscription') => void;

const DEFAULT_CUSTOM: CustomTheme = { colors: ['#2b1a8f', '#1c7ad6'], angle: 135, base: 'dark' };

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

// ── Тема ──

export function ThemeTab({ goTo }: { goTo: GoTo }) {
  const a = useAppearance();
  const access = useThemeAccess();
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<CustomTheme>(a.customTheme ?? DEFAULT_CUSTOM);
  const preview = a.preview;

  // Предпросмотр живёт, пока открыта вкладка
  useEffect(() => () => useAppearance.getState().setPreview(null), []);

  const pickBase = (id: (typeof BASE_THEMES)[number]['id']) =>
    a.set({ baseTheme: id, followSystem: false, colorTheme: null, customTheme: null });

  const pickColor = (id: string) => {
    if (access.colorThemes) {
      a.setPreview(null);
      a.set({ colorTheme: a.colorTheme === id ? null : id, customTheme: null });
    } else {
      a.setPreview(preview?.colorTheme === id ? null : { colorTheme: id, customTheme: null });
    }
  };

  const tryCustom = (t: CustomTheme) => {
    setDraft(t);
    a.setPreview({ colorTheme: null, customTheme: t });
  };

  const saveCustom = () => {
    a.setPreview(null);
    a.set({ customTheme: draft, colorTheme: null });
    setEditor(false);
  };

  const previewName = preview
    ? (themeById(preview.colorTheme)?.name ?? (preview.customTheme ? 'Своя тема' : ''))
    : '';
  const previewNeeds = preview?.customTheme ? 'Ultra' : 'Standard';
  const canKeepPreview = preview?.customTheme ? access.customTheme : access.colorThemes;
  const activeId = (preview ?? a).colorTheme;
  const accent = a.accent || DEFAULT_ACCENT;

  return (
    <div className="settings theme-settings">
      <h2 className="display" style={{ margin: 0 }}>
        Тема
      </h2>

      <Toggle
        label="Как тема устройства"
        hint="Светлая или тёмная — как на вашем устройстве."
        checked={a.followSystem}
        onChange={(followSystem) => a.set({ followSystem, colorTheme: followSystem ? null : a.colorTheme, customTheme: followSystem ? null : a.customTheme })}
      />

      <section className="theme-section" aria-label="Темы по умолчанию">
        <h3>Темы по умолчанию</h3>
        <div className="base-themes">
          {BASE_THEMES.map((t) => {
            const on = !a.followSystem && !a.colorTheme && !a.customTheme && a.baseTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className="base-theme"
                aria-pressed={on}
                aria-label={t.name}
                title={t.name}
                style={{ background: t.swatch }}
                onClick={() => pickBase(t.id)}
              >
                {on && (
                  <span className="check">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="base-theme sync"
            aria-pressed={a.followSystem}
            aria-label="Как тема устройства"
            title="Как тема устройства"
            onClick={() => a.set({ followSystem: !a.followSystem, colorTheme: null, customTheme: null })}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" />
            </svg>
            {a.followSystem && (
              <span className="check">
                <CheckIcon />
              </span>
            )}
          </button>
        </div>
      </section>

      {!access.colorThemes && (
        <section className="theme-promo" aria-label="Подписка">
          <span className="theme-promo-art" aria-hidden="true" />
          <div className="theme-promo-text">
            <strong>Настройте Vicinity по своему вкусу</strong>
            <span className="muted small">
              Цветовые темы — с подпиской Standard, своя тема из любых цветов — с Ultra.
            </span>
          </div>
          <button type="button" className="btn primary" onClick={() => goTo('subscription')}>
            Подробнее
          </button>
        </section>
      )}

      <section className="color-themes" aria-label="Цветовые темы">
        <div className="color-themes-head">
          <div className="grow">
            <strong>Цветовые темы</strong>
            <span className="muted small">
              {access.colorThemes ? 'Выберите тему — она сохранится на всех устройствах.' : 'Нажмите на тему, чтобы посмотреть, как она выглядит.'}
            </span>
          </div>
          {!access.colorThemes && (
            <button type="button" className="btn small" onClick={() => goTo('subscription')}>
              <LockIcon /> Откройте с подпиской
            </button>
          )}
        </div>

        {preview && (
          <div className="preview-bar" role="status">
            <span className="grow">
              Предпросмотр: <strong>{previewName}</strong>.{' '}
              {canKeepPreview ? '' : `Сохранить тему можно с подпиской ${previewNeeds}.`}
            </span>
            <button type="button" className="btn small" onClick={() => a.setPreview(null)}>
              Вернуть мою тему
            </button>
            {canKeepPreview ? (
              <button
                type="button"
                className="btn small primary"
                onClick={() => (preview.customTheme ? saveCustom() : pickColor(preview.colorTheme!))}
              >
                Применить
              </button>
            ) : (
              <button type="button" className="btn small primary" onClick={() => goTo('subscription')}>
                О подписке
              </button>
            )}
          </div>
        )}

        <div className="color-grid">
          <button
            type="button"
            className={`color-swatch custom${editor ? ' previewing' : ''}`}
            aria-pressed={!!a.customTheme}
            aria-label="Своя тема"
            title="Своя тема (Ultra)"
            onClick={() => {
              setEditor((v) => !v);
              if (!editor) tryCustom(a.customTheme ?? draft);
              else a.setPreview(null);
            }}
          >
            <span className="new-tag">НОВОЕ</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-1-1.6-1-2.6 1-2.4 2.4-2.4H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8z" />
              <circle cx="7.5" cy="11" r="1.2" />
              <circle cx="10.5" cy="7" r="1.2" />
              <circle cx="15" cy="7.5" r="1.2" />
            </svg>
          </button>
          {COLOR_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`color-swatch${preview?.colorTheme === t.id ? ' previewing' : ''}`}
              aria-pressed={activeId === t.id}
              aria-label={t.name}
              title={t.name}
              style={{ background: gradientCss(t) }}
              onClick={() => pickColor(t.id)}
            >
              {!access.colorThemes && (
                <span className="lock">
                  <LockIcon />
                </span>
              )}
            </button>
          ))}
        </div>

        {editor && (
          <div className="custom-theme-editor">
            <span className="preview" style={{ background: gradientCss(draft) }} aria-hidden="true" />
            {draft.colors.map((c, i) => (
              <label key={i}>
                Цвет {i + 1}
                <input
                  type="color"
                  value={c}
                  onChange={(e) => tryCustom({ ...draft, colors: draft.colors.map((x, j) => (j === i ? e.target.value : x)) })}
                />
              </label>
            ))}
            {draft.colors.length < 3 ? (
              <button type="button" className="btn small" onClick={() => tryCustom({ ...draft, colors: [...draft.colors, '#a3168a'] })}>
                + цвет
              </button>
            ) : (
              <button type="button" className="btn small" onClick={() => tryCustom({ ...draft, colors: draft.colors.slice(0, 2) })}>
                − цвет
              </button>
            )}
            <label style={{ minWidth: 160 }}>
              Угол {draft.angle}°
              <input type="range" min={0} max={360} step={15} value={draft.angle} onChange={(e) => tryCustom({ ...draft, angle: Number(e.target.value) })} />
            </label>
            <Segmented<'dark' | 'light'>
              label="Основа"
              value={draft.base}
              options={[
                ['dark', 'Тёмная'],
                ['light', 'Светлая'],
              ]}
              onChange={(base) => tryCustom({ ...draft, base })}
            />
            {access.customTheme ? (
              <button type="button" className="btn primary" onClick={saveCustom}>
                Применить свою тему
              </button>
            ) : (
              <span className="muted small">Своя тема сохраняется с подпиской Ultra — пока это предпросмотр.</span>
            )}
          </div>
        )}
      </section>

      <Toggle
        label="Синхронизировать тему на моих устройствах"
        hint="Тема и оформление сохраняются в аккаунте и приходят на другие браузеры."
        checked={a.syncDevices}
        onChange={(syncDevices) => a.set({ syncDevices })}
      />
      <Toggle
        label="Применить тему к профилям других пользователей"
        hint="Карточки профилей других людей — в ваших цветах, а не в их."
        checked={a.applyToProfiles}
        onChange={(applyToProfiles) => a.set({ applyToProfiles })}
      />
      <div className="theme-row">
        <div className="theme-row-text">
          <strong>Тема по умолчанию на серверах</strong>
          <span className="muted small">На серверах — ваша тема или стандартная тёмная.</span>
        </div>
        <select
          aria-label="Тема по умолчанию на серверах"
          style={{ width: 240 }}
          value={a.serverTheme}
          onChange={(e) => a.set({ serverTheme: e.target.value as ServerTheme })}
        >
          <option value="mine">Использовать мою тему</option>
          <option value="default">Стандартная тема Vicinity</option>
        </select>
      </div>

      <div className="setting-row">
        <span className="setting-label">Акцентный цвет</span>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${accent === c ? ' on' : ''}`}
              aria-label={`Цвет ${c}`}
              aria-pressed={accent === c}
              style={{ '--swatch': c } as CSSProperties}
              onClick={() => a.set({ accent: c === DEFAULT_ACCENT ? '' : c })}
            />
          ))}
          <label className="swatch custom" title="Свой цвет">
            <input type="color" aria-label="Свой цвет" value={accent} onChange={(e) => a.set({ accent: e.target.value })} />
          </label>
        </div>
      </div>

      <section className="theme-section" aria-label="Связанные настройки">
        <h3 className="muted">Связанные настройки</h3>
        <button type="button" className="link-card" onClick={() => goTo('accessibility')}>
          <span className="link-card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="4.5" r="1.8" />
              <path d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5l-3 6M12 14.5l3 6" />
            </svg>
          </span>
          <span className="grow">
            <strong>Специальные возможности</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Насыщенность цветов, высокий контраст, размер шрифта и анимации
            </span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </section>

      <div className="row end">
        <div className="grow" />
        <button type="button" className="btn" onClick={a.reset}>
          Сбросить оформление
        </button>
      </div>
    </div>
  );
}

// ── Специальные возможности ──

export function AccessibilityTab() {
  const a = useAppearance();
  return (
    <div className="settings">
      <h2 className="display" style={{ margin: 0 }}>
        Специальные возможности
      </h2>
      <div className="setting-row">
        <span className="setting-label" id="saturation-label">
          Насыщенность цветов — {a.saturation}%
        </span>
        <div className="range-row">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            aria-labelledby="saturation-label"
            value={a.saturation}
            onChange={(e) => a.set({ saturation: Number(e.target.value) })}
          />
          <button type="button" className="btn small" disabled={a.saturation === 100} onClick={() => a.set({ saturation: 100 })}>
            Сбросить
          </button>
        </div>
      </div>
      <Toggle
        label="Высокий контраст"
        hint="Текст ярче, у кнопок и полей заметные границы"
        checked={a.highContrast}
        onChange={(highContrast) => a.set({ highContrast })}
      />
      <Segmented<FontSize>
        label="Размер шрифта сообщений"
        value={a.fontSize}
        options={[
          ['s', 'Мелкий'],
          ['m', 'Обычный'],
          ['l', 'Крупный'],
        ]}
        onChange={(fontSize) => a.set({ fontSize })}
      />
      <Toggle
        label="Компактный режим"
        hint="Меньше отступы и аватары — больше сообщений на экране"
        checked={a.compact}
        onChange={(compact) => a.set({ compact })}
      />
      <Toggle
        label="Уменьшить анимацию"
        hint="Анимации выключаются и так, если это задано в системе"
        checked={a.reducedMotion}
        onChange={(reducedMotion) => a.set({ reducedMotion })}
      />
    </div>
  );
}

// ── Подписка ──

const TIER_TAG = ['', 'BASIC', 'STANDARD', 'ULTRA'];

export function SubscriptionTab() {
  const { current, plans } = usePlan();
  const list = plans.length ? plans : [current];
  return (
    <div className="settings">
      <h2 className="display" style={{ margin: 0 }}>
        Подписка
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Сейчас у вас: <strong>{current.name}</strong>. Оплаты в приложении нет — подписку выдаёт администратор сервера.
      </p>
      <div className="plans">
        {list.map((p) => (
          <section key={p.tier} className={`plan${p.tier === current.tier ? ' current' : ''}`} aria-label={p.name}>
            <div className="row-between center-y">
              <strong style={{ fontSize: 18 }}>{p.name}</strong>
              {p.tier > 0 ? <span className={`tier-tag t${p.tier}`}>{TIER_TAG[p.tier]}</span> : null}
            </div>
            <div className="plan-stats">
              <div>
                Файлы<strong>{p.files_mb} МБ</strong>
              </div>
              <div>
                Экран<strong>
                  {p.screen.height >= 2160 ? '4K' : `${p.screen.height}p`} · {p.screen.fps}
                </strong>
              </div>
            </div>
            <ul>
              <li>{p.servers < 0 ? 'Сколько угодно своих серверов' : `До ${p.servers} своих серверов`}</li>
              <li>Камера в звонках {p.camera_height}p</li>
              <li>«О себе» до {p.bio} символов</li>
              {p.name_color && <li>{p.gradient_name ? 'Градиентный ник' : 'Ник цветом профиля'}</li>}
              {p.animated_banner && <li>Анимированный баннер</li>}
              {p.color_themes && <li>Цветовые темы оформления</li>}
              {p.custom_theme && <li>Своя тема из любых цветов</li>}
              {p.tier > 0 && <li>Значок {TIER_TAG[p.tier]} у ника</li>}
            </ul>
            {p.tier === current.tier && <span className="muted small">Ваш уровень</span>}
          </section>
        ))}
      </div>
    </div>
  );
}

