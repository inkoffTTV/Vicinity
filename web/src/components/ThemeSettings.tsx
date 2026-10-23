import { useEffect, useRef, useState, FormEvent } from 'react';
import { useThemeAccess } from '../lib/appearanceSync';
import { Monitor, Moon, Plus, Sun } from 'lucide-react';
import { api, ApiError, CommunityTheme } from '../lib/api';
import { colorsFromBanner } from '../lib/bannerColors';
import { FONT_GROUPS, UI_FONTS } from '../lib/fonts';
import { Icon } from './Icon';
import { Workshop } from './Workshop';
import { loadPlan, usePlan } from '../lib/plan';
import { useStore } from '../lib/store';
import { Eco, FontSize, Radius, ServerTheme, useAppearance } from '../lib/prefs';
import { BASE_THEMES, COLOR_THEMES, CustomTheme, gradientCss, themeById } from '../lib/themes';
import { Cards, Segmented, Slider, Toggle } from './SettingControls';

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

type Sub = 'look' | 'font' | 'workshop';

export function ThemeTab({ goTo }: { goTo: GoTo }) {
  const a = useAppearance();
  const access = useThemeAccess();
  const toast = useStore((s) => s.toast);
  const [sub, setSub] = useState<Sub>('look');
  const preview = a.preview;

  // Предпросмотр живёт, пока открыта вкладка
  useEffect(() => () => useAppearance.getState().setPreview(null), []);

  // Тема сообщества: со Standard применяется и хранится как своя с пометкой from, без подписки — предпросмотр
  const pickCommunity = (t: CommunityTheme) => {
    const theme: CustomTheme = { colors: t.colors, angle: t.angle, base: t.base, from: t.id };
    if (access.colorThemes) {
      a.setPreview(null);
      a.set(a.customTheme?.from === t.id ? { customTheme: null } : { customTheme: theme, colorTheme: null });
    } else {
      a.setPreview(preview?.customTheme?.from === t.id ? null : { colorTheme: null, customTheme: theme });
      toast('Предпросмотр: применить темы из мастерской можно с подпиской Standard');
    }
  };

  const previewName = preview
    ? (themeById(preview.colorTheme)?.name ?? (preview.customTheme ? (preview.customTheme.from ? 'Тема из мастерской' : 'Своя тема') : ''))
    : '';
  const previewNeeds = preview?.customTheme && !preview.customTheme.from ? 'Ultra' : 'Standard';
  const canKeepPreview = preview?.customTheme && !preview.customTheme.from ? access.customTheme : access.colorThemes;

  return (
    <div className="settings theme-settings">
      <h2 className="display" style={{ margin: 0 }}>
        Внешний вид
      </h2>
      <div className="subtabs" role="tablist" aria-label="Разделы внешнего вида">
        {(
          [
            ['look', 'Вид'],
            ['font', 'Шрифт'],
            ['workshop', 'Мастерская'],
          ] as [Sub, string][]
        ).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>
            {name}
          </button>
        ))}
      </div>

      {preview && (
        <div className="preview-bar" role="status">
          <span>
            Предпросмотр: <strong>{previewName}</strong>
          </span>
          {canKeepPreview ? (
            <button
              type="button"
              className="btn primary small"
              onClick={() => {
                const p = preview;
                a.setPreview(null);
                a.set(p.customTheme ? { customTheme: p.customTheme, colorTheme: null } : { colorTheme: p.colorTheme, customTheme: null });
              }}
            >
              Оставить
            </button>
          ) : (
            <>
              <span className="muted small">сохранить — с подпиской {previewNeeds}</span>
              <button type="button" className="btn primary small" onClick={() => goTo('subscription')}>
                О подписке
              </button>
            </>
          )}
          <button type="button" className="btn small" onClick={() => a.setPreview(null)}>
            Вернуть
          </button>
        </div>
      )}

      {sub === 'look' && <LookPane goTo={goTo} />}
      {sub === 'font' && <FontPane />}
      {sub === 'workshop' && <Workshop onPickTheme={pickCommunity} />}
    </div>
  );
}

// ── Вид: тема, готовые темы, стекло, фон, скругление, масштаб, экономия ──

function LookPane({ goTo }: { goTo: GoTo }) {
  const a = useAppearance();
  const access = useThemeAccess();
  const me = useStore((s) => s.me);
  const toast = useStore((s) => s.toast);
  const preview = a.preview;
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<CustomTheme>(a.customTheme && !a.customTheme.from ? a.customTheme : DEFAULT_CUSTOM);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const bgFile = useRef<HTMLInputElement>(null);

  const pickBase = (id: (typeof BASE_THEMES)[number]['id']) => a.set({ baseTheme: id, followSystem: false, colorTheme: null, customTheme: null });
  const pickColor = (id: string | null) => {
    if (id === null) {
      a.setPreview(null);
      a.set({ colorTheme: null, customTheme: null });
      return;
    }
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
  const fromBanner = async () => {
    if (!me?.banner_path) return;
    setBannerBusy(true);
    try {
      tryCustom({ ...draft, colors: await colorsFromBanner(me.banner_path, draft.base) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось прочитать баннер', 'error');
    } finally {
      setBannerBusy(false);
    }
  };
  const uploadBg = async (f: File) => {
    setBgBusy(true);
    try {
      const r = await api.uploadWorkshopImage(f);
      a.set({ background: { image: r.file_url } });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось загрузить картинку', 'error');
    } finally {
      setBgBusy(false);
    }
  };

  const activeColor = (preview ?? a).colorTheme;
  const noneOn = !preview && !a.colorTheme && !a.customTheme;
  const glassOn = !!(preview ?? a).colorTheme || !!(preview ?? a).customTheme || !!a.background;
  const baseIcon = (id: string) => (id === 'light' ? <Icon icon={Sun} size={18} /> : id === 'dark' ? <Icon icon={Moon} size={18} /> : null);

  return (
    <>
      <section className="theme-section" aria-label="Тема">
        <div className="theme-section-head">
          <div>
            <h3>Тема</h3>
            <span className="muted small">Выберите основу интерфейса</span>
          </div>
          <div className="base-themes">
            {BASE_THEMES.map((t) => {
              const on = !a.followSystem && a.baseTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="base-theme"
                  aria-pressed={on}
                  aria-label={t.name}
                  title={t.name}
                  style={{ background: t.swatch, color: t.id === 'light' ? '#222' : '#fff' }}
                  onClick={() => pickBase(t.id)}
                >
                  {baseIcon(t.id)}
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
              onClick={() => a.set({ followSystem: !a.followSystem })}
            >
              <Icon icon={Monitor} size={18} />
              {a.followSystem && (
                <span className="check">
                  <CheckIcon />
                </span>
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="theme-section" aria-label="Готовые темы">
        <h3>Готовые темы</h3>
        <span className="muted small">
          {access.colorThemes ? 'Градиент под панелями и акцент в цвет темы. Сохраняется на всех устройствах.' : 'Нажмите, чтобы посмотреть; применить — с подпиской Standard.'}
        </span>
        <div className="theme-cards">
          <button type="button" className={`theme-card${noneOn ? ' on' : ''}`} aria-pressed={noneOn} onClick={() => pickColor(null)}>
            <span className="theme-dot neutral" aria-hidden="true" />
            <span>Neutral</span>
          </button>
          {COLOR_THEMES.map((t) => {
            const on = activeColor === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-card${on ? ' on' : ''}${preview?.colorTheme === t.id ? ' previewing' : ''}`}
                aria-pressed={on}
                aria-label={t.name}
                title={t.name}
                onClick={() => pickColor(t.id)}
              >
                <span className="theme-dot" style={{ background: gradientCss(t) }} aria-hidden="true" />
                <span className="ellipsis">{t.name}</span>
                {!access.colorThemes && (
                  <span className="lock">
                    <LockIcon />
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className={`theme-card custom${editor ? ' previewing' : ''}${a.customTheme && !a.customTheme.from ? ' on' : ''}`}
            aria-pressed={!!a.customTheme && !a.customTheme.from}
            aria-label="Своя тема"
            title="Своя тема (Ultra)"
            onClick={() => {
              setEditor((v) => !v);
              if (!editor) tryCustom(a.customTheme && !a.customTheme.from ? a.customTheme : draft);
              else a.setPreview(null);
            }}
          >
            <span className="theme-dot plus" aria-hidden="true">
              <Icon icon={Plus} size={18} />
            </span>
            <span>Своя</span>
          </button>
        </div>

        {editor && (
          <div className="custom-theme-editor">
            <span className="preview" style={{ background: gradientCss(draft) }} aria-hidden="true" />
            {draft.colors.map((c, i) => (
              <label key={i}>
                Цвет {i + 1}
                <input type="color" value={c} onChange={(e) => tryCustom({ ...draft, colors: draft.colors.map((x, j) => (j === i ? e.target.value : x)) })} />
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
            <button
              type="button"
              className="btn small"
              disabled={!me?.banner_path || bannerBusy}
              title={me?.banner_path ? 'Подобрать цвета из баннера профиля' : 'Сначала загрузите баннер в профиле'}
              onClick={() => void fromBanner()}
            >
              Цвета из баннера
            </button>
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

      <section className="theme-section" aria-label="Прозрачность и фон">
        <Toggle label="Прозрачность" hint="Полупрозрачные панели поверх градиента темы или фона" checked={a.transparency} onChange={(transparency) => a.set({ transparency })} />
        <Slider
          label="Непрозрачность"
          hint={glassOn ? 'Насколько плотные панели' : 'Работает с цветовой темой или фоном'}
          value={a.panelOpacity}
          min={20}
          max={100}
          step={5}
          unit="%"
          disabled={!a.transparency || !glassOn}
          onChange={(panelOpacity) => a.set({ panelOpacity })}
        />
        <Slider
          label="Размытие фона"
          hint="Картинка под панелями размывается, чтобы текст читался"
          value={a.glassBlur}
          min={0}
          max={40}
          step={2}
          unit="px"
          disabled={!a.background}
          onChange={(glassBlur) => a.set({ glassBlur })}
        />
        <div className="setting-row bg-row">
          <span className="grow">
            <span className="toggle-label">Фон приложения</span>
            <span className="muted small toggle-hint">Своя картинка под всем интерфейсом; готовые — в Мастерской</span>
          </span>
          {a.background && <span className="bg-thumb" style={{ backgroundImage: `url("${a.background.image}")` }} aria-hidden="true" />}
          <input ref={bgFile} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void uploadBg(e.target.files[0])} />
          <button type="button" className="btn small" disabled={bgBusy} onClick={() => bgFile.current?.click()}>
            {a.background ? 'Другая картинка' : 'Загрузить картинку'}
          </button>
          {a.background && (
            <button type="button" className="btn small" onClick={() => a.set({ background: null })}>
              Убрать
            </button>
          )}
        </div>
      </section>

      <section className="theme-section" aria-label="Форма и масштаб">
        <Cards<Radius>
          label="Скругление углов"
          hint="Радиус скругления элементов интерфейса и карточек"
          value={a.radius}
          options={[
            { id: 'none', name: 'Нет', icon: <span className="radius-demo r0" /> },
            { id: 'small', name: 'Маленькое', icon: <span className="radius-demo r1" /> },
            { id: 'medium', name: 'Среднее', icon: <span className="radius-demo r2" /> },
            { id: 'large', name: 'Большое', icon: <span className="radius-demo r3" /> },
          ]}
          onChange={(radius) => a.set({ radius })}
        />
        <Segmented<string>
          label="Масштаб интерфейса"
          value={String(a.scale)}
          options={[
            ['75', '75%'],
            ['90', '90%'],
            ['100', '100%'],
            ['110', '110%'],
            ['125', '125%'],
          ]}
          onChange={(v) => a.set({ scale: Number(v) })}
        />
        <Segmented<Eco>
          label="Экономия ресурсов"
          value={a.eco}
          options={[
            ['off', 'Выключено'],
            ['minimized', 'При сворачивании'],
            ['unfocused', 'Не в фокусе'],
          ]}
          onChange={(eco) => a.set({ eco })}
        />
        <span className="muted small">Экономия убирает размытие и анимации, пока окно свёрнуто или не активно.</span>
      </section>

      <section className="theme-section" aria-label="Синхронизация">
        <Toggle label="Синхронизировать на моих устройствах" hint="Оформление хранится в аккаунте и приходит на другие браузеры." checked={a.syncDevices} onChange={(syncDevices) => a.set({ syncDevices })} />
        <Toggle label="Применить тему к профилям других" hint="Карточки чужих профилей — в ваших цветах, а не в их." checked={a.applyToProfiles} onChange={(applyToProfiles) => a.set({ applyToProfiles })} />
        <div className="theme-row">
          <div className="theme-row-text">
            <strong>Тема по умолчанию на серверах</strong>
            <span className="muted small">На серверах — ваша тема или стандартная тёмная.</span>
          </div>
          <select aria-label="Тема по умолчанию на серверах" style={{ width: 240 }} value={a.serverTheme} onChange={(e) => a.set({ serverTheme: e.target.value as ServerTheme })}>
            <option value="mine">Использовать мою тему</option>
            <option value="default">Стандартная тема Vicinity</option>
          </select>
        </div>
        {!access.colorThemes && (
          <div className="theme-promo" aria-label="Подписка">
            <span className="theme-promo-art" aria-hidden="true" />
            <div className="theme-promo-text">
              <strong>Настройте Vicinity по своему вкусу</strong>
              <span className="muted small">Цветовые темы и темы из мастерской — с подпиской Standard, своя тема из любых цветов — с Ultra.</span>
            </div>
            <button type="button" className="btn primary" onClick={() => goTo('subscription')}>
              О подписке
            </button>
          </div>
        )}
      </section>

      <div className="row end">
        <button type="button" className="link-btn muted small" onClick={() => goTo('accessibility')}>
          Контраст, насыщенность, анимации — в «Доступности»
        </button>
        <div className="grow" />
        <button type="button" className="btn" onClick={a.reset}>
          Сбросить оформление
        </button>
      </div>
    </>
  );
}

// ── Шрифт ──

function FontPane() {
  const a = useAppearance();
  const [group, setGroup] = useState('all');
  const fonts = UI_FONTS.filter((f) => group === 'all' || f.group === group);
  return (
    <>
      <section className="theme-section" aria-label="Шрифт">
        <h3>Шрифт</h3>
        <span className="muted small">Семейство шрифта интерфейса</span>
        <div className="chips" role="tablist" aria-label="Группы шрифтов">
          {[['all', 'Все'] as [string, string], ...FONT_GROUPS].map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={group === id} className={`chip${group === id ? ' on' : ''}`} onClick={() => setGroup(id)}>
              {name}
            </button>
          ))}
        </div>
        <div className="font-cards" role="radiogroup" aria-label="Шрифт интерфейса">
          {fonts.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={a.fontFamily === f.id}
              className={`font-card${a.fontFamily === f.id ? ' on' : ''}`}
              style={{ fontFamily: f.family }}
              onClick={() => a.set({ fontFamily: f.id })}
            >
              <span className="font-sample">Aa</span>
              <span className="font-name">{f.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="theme-section" aria-label="Размер и жирность">
        <Segmented<string>
          label="Размер шрифта"
          value={String(a.fontPx)}
          options={[
            ['12', '12'],
            ['14', '14'],
            ['0', '16 Авто'],
            ['18', '18'],
            ['20', '20'],
          ]}
          onChange={(v) => a.set({ fontPx: Number(v) })}
        />
        <Segmented<string>
          label="Жирность шрифта"
          value={String(a.fontWeight)}
          options={[
            ['0', 'Авто'],
            ['400', '400'],
            ['500', '500'],
            ['600', '600'],
            ['700', '700'],
          ]}
          onChange={(v) => a.set({ fontWeight: Number(v) })}
        />
        <Segmented<FontSize>
          label="Размер текста сообщений"
          value={a.fontSize}
          options={[
            ['s', 'Мелкий'],
            ['m', 'Обычный'],
            ['l', 'Крупный'],
          ]}
          onChange={(fontSize) => a.set({ fontSize })}
        />
      </section>
    </>
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
  const { current, plans, until } = usePlan();
  const list = plans.length ? plans : [current];
  const toast = useStore((s) => s.toast);
  const refreshMe = useStore((s) => s.refreshMe);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState('');
  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setCodeError('');
    try {
      const r = await api.giftRedeem(code);
      await Promise.all([refreshMe(), loadPlan()]);
      toast(`Подарок активирован: ${r.name}`);
      setCode('');
    } catch (err) {
      setCodeError(err instanceof ApiError ? err.message : 'Ошибка');
    }
    setBusy(false);
  };
  const untilText = until ? new Date(until.replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU') : '';
  return (
    <div className="settings">
      <h2 className="display" style={{ margin: 0 }}>
        Подписка
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Сейчас у вас: <strong>{current.name}</strong>
        {untilText && <> до {untilText}</>}. Оплаты в приложении нет — подписку выдаёт администратор или подарочный код.
      </p>
      <form className="settings-card stack gift-redeem" onSubmit={(e) => void redeem(e)} aria-label="Подарочный код">
        <strong>Подарочный код</strong>
        <div className="stack-row">
          <input
            className="grow mono"
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            maxLength={14}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Подарочный код"
          />
          <button className="btn primary" disabled={busy || code.replace(/-/g, '').length !== 12}>
            Активировать
          </button>
        </div>
        {codeError ? <span className="form-error">{codeError}</span> : <span className="muted small">Код подписки от администратора или друга. Ссылка вида /gift/КОД активирует его сама.</span>}
      </form>
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

