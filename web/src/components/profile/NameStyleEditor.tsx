import { Check, Lock, Moon, Pipette, Shuffle, Sun, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError, api, normalizeExt } from '../../lib/api';
import { NAME_COLORS, NAME_EFFECTS, NAME_FONTS, NameStyle, nameCss, styleTier, TIER_INFO } from '../../lib/nameStyle';
import { usePlan } from '../../lib/plan';
import { useStore } from '../../lib/store';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Modal } from '../Modal';

const DEFAULT: NameStyle = { font: 'onest', effect: 'minimal', colors: ['#2bc6a4', '#4c9bff'] };

/** Редактор стиля ника (макет «4 · Стиль отображаемого имени»): шрифт, эффект, цвет, живой предпросмотр.
 *  Без подписки на выбранное — примерка; сохранить сервер не даст (403). */
export function NameStyleEditor({ initial, onClose, onSaved }: { initial: NameStyle | null; onClose: () => void; onSaved: (s: NameStyle | null) => void }) {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const tier = usePlan((s) => s.current.tier);
  const [style, setStyle] = useState<NameStyle>(() => {
    const s = initial ?? DEFAULT;
    return { ...s, colors: [s.colors[0] ?? DEFAULT.colors[0], s.colors[1] ?? DEFAULT.colors[1]] };
  });
  const [slot, setSlot] = useState<0 | 1>(0);
  const [light, setLight] = useState(false);
  const [busy, setBusy] = useState(false);

  const need = styleTier(style);
  const locked = need > tier;
  const isGradient = style.effect === 'gradient';
  const activeColor = isGradient ? style.colors[slot] : style.colors[0];
  const name = me.display_name;

  const setColor = (hex: string) => {
    const colors = [...style.colors];
    colors[isGradient ? slot : 0] = hex.toLowerCase();
    setStyle({ ...style, colors });
  };

  const surprise = () => {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const fonts = NAME_FONTS.filter((f) => f.tier <= Math.max(1, tier));
    const effects = NAME_EFFECTS.filter((e) => e.tier <= Math.max(1, tier));
    setStyle({ font: pick(fonts).id, effect: pick(effects).id, colors: [pick(NAME_COLORS).hex, pick(NAME_COLORS).hex] });
  };

  const save = async (value: NameStyle | null) => {
    setBusy(true);
    try {
      const p = await api.profile(me.user_id);
      const ext = normalizeExt(p.profile_ext);
      const toSave = value ? { ...value, colors: value.effect === 'gradient' ? value.colors.slice(0, 2) : value.colors.slice(0, 1) } : null;
      await api.saveProfileExt({ ...ext, name_style: toSave });
      toast(value ? 'Стиль ника сохранён' : 'Стиль ника сброшен');
      onSaved(toSave);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error');
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo(() => nameCss(style, 0, light), [style, light]);
  const fontName = NAME_FONTS.find((f) => f.id === style.font)?.name;

  return (
    <Modal onClose={onClose} bare label="Стиль отображаемого имени">
      <div className="nse">
        <header className="nse-head">
          <strong>Стиль отображаемого имени</strong>
          <span className="nse-legend">
            {[1, 2, 3].map((t) => (
              <span key={t}>
                <i style={{ background: TIER_INFO[t].bg }} /> {TIER_INFO[t].name}
              </span>
            ))}
          </span>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon icon={X} size={20} />
          </button>
        </header>

        <div className="nse-body">
          <div className="nse-left">
            <span className="nse-cap">Шрифт</span>
            <div className="nse-fonts" role="radiogroup" aria-label="Шрифт">
              {NAME_FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={style.font === f.id}
                  title={`${f.name} · ${TIER_INFO[f.tier].name}`}
                  aria-label={`${f.name}, уровень ${TIER_INFO[f.tier].name}${f.tier > tier ? ', можно примерить' : ''}`}
                  className="nse-font"
                  onClick={() => setStyle({ ...style, font: f.id })}
                >
                  <span style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: Math.round(28 * f.k) }}>Gg</span>
                  {f.tier > 1 && <i className="nse-dot" style={{ background: TIER_INFO[f.tier].bg }} />}
                  {f.tier > tier && <Icon icon={Lock} size={12} className="nse-lock" />}
                </button>
              ))}
            </div>

            <span className="nse-cap">Эффект</span>
            <div className="nse-effects" role="radiogroup" aria-label="Эффект">
              {NAME_EFFECTS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={style.effect === e.id}
                  aria-label={`${e.name}, уровень ${TIER_INFO[e.tier].name}${e.tier > tier ? ', можно примерить' : ''}`}
                  className="nse-effect"
                  onClick={() => setStyle({ ...style, effect: e.id })}
                >
                  <span className="nse-effect-sample" style={nameCss({ ...style, effect: e.id }, 20, light)}>
                    {name}
                  </span>
                  <span className="nse-effect-label">
                    {e.name}
                    {e.tier > 1 && (
                      <span className="nse-chip" style={{ background: TIER_INFO[e.tier].bg, color: TIER_INFO[e.tier].fg }}>
                        {TIER_INFO[e.tier].name}
                      </span>
                    )}
                    {e.tier > tier && <Icon icon={Lock} size={12} />}
                  </span>
                </button>
              ))}
            </div>

            <div className="nse-color-head">
              <span className="nse-cap">Цвет</span>
              {isGradient && (
                <div className="nse-slots" role="radiogroup" aria-label="Какой цвет градиента меняем">
                  {[0, 1].map((i) => (
                    <button key={i} type="button" role="radio" aria-checked={slot === i} className={slot === i ? 'on' : ''} onClick={() => setSlot(i as 0 | 1)}>
                      <i style={{ background: style.colors[i] }} /> Цвет {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="nse-colors" role="radiogroup" aria-label="Цвет">
              {NAME_COLORS.map((c) => {
                const on = activeColor === c.hex;
                return (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={c.name}
                    className={`nse-swatch${on ? ' on' : ''}`}
                    style={{ background: c.hex, ['--ring' as string]: c.hex }}
                    onClick={() => setColor(c.hex)}
                  >
                    {on && <Icon icon={Check} size={16} />}
                  </button>
                );
              })}
              <label className={`nse-custom${NAME_COLORS.some((c) => c.hex === activeColor) ? '' : ' on'}`} title="Свой цвет — со Standard">
                <span className="nse-custom-ico">
                  <Icon icon={Pipette} size={14} />
                </span>
                Свой цвет
                <i className="nse-dot static" style={{ background: TIER_INFO[2].bg }} />
                <input type="color" value={activeColor} onChange={(e) => setColor(e.target.value)} aria-label="Свой цвет" />
              </label>
            </div>
          </div>

          <aside className={`nse-preview${light ? ' light' : ''}`} aria-label="Предпросмотр">
            <div className="nse-preview-head">
              <span className="nse-cap">Предпросмотр</span>
              <div className="nse-mode" role="radiogroup" aria-label="Фон предпросмотра">
                <button type="button" role="radio" aria-checked={!light} aria-label="Тёмный фон" className={!light ? 'on' : ''} onClick={() => setLight(false)}>
                  <Icon icon={Moon} size={16} />
                </button>
                <button type="button" role="radio" aria-checked={light} aria-label="Светлый фон" className={light ? 'on' : ''} onClick={() => setLight(true)}>
                  <Icon icon={Sun} size={16} />
                </button>
              </div>
            </div>
            <span className="nse-sub">Профиль</span>
            <div className="nse-card">
              <div className="nse-card-banner" />
              <div className="nse-card-body">
                <span className="nse-card-ava">
                  <Avatar name={name} src={me.avatar_path} id={me.user_id} size={56} />
                </span>
                <span style={nameCss(style, 22, light)}>{name}</span>
                <span className="nse-muted">@{me.username}</span>
              </div>
            </div>
            <span className="nse-sub">Сообщение в чате</span>
            <div className="nse-msg">
              <Avatar name={name} src={me.avatar_path} id={me.user_id} size={36} />
              <div>
                <div>
                  <span style={preview}>{name}</span> <span className="nse-muted small">сегодня в 21:40</span>
                </div>
                <div>Кто сегодня в голосовой? Собираемся в десять.</div>
              </div>
            </div>
            <span className="nse-sub">Список участников</span>
            <div className="nse-members">
              <div className="nse-member on">
                <Avatar name={name} src={me.avatar_path} id={me.user_id} size={28} />
                <span style={preview}>{name}</span>
              </div>
              <div className="nse-member">
                <Avatar name="Лиса" id={7} size={28} />
                <span>Лиса_Дайв</span>
              </div>
            </div>
          </aside>
        </div>

        <footer className="nse-foot">
          <span className="nse-note">
            {locked
              ? `Примерка: ${fontName ?? 'стиль'} — сохранится с подпиской ${TIER_INFO[need].name}.`
              : 'Шрифт, эффект и цвет видят все — в чатах, списке участников и профиле.'}
          </span>
          {initial && (
            <button type="button" className="btn" disabled={busy} onClick={() => save(null)}>
              Сбросить
            </button>
          )}
          <button type="button" className="btn" onClick={surprise}>
            <Icon icon={Shuffle} size={16} /> Удивите меня
          </button>
          <button type="button" className="btn primary" disabled={busy || locked || tier < 1} onClick={() => save(style)}>
            Сохранить
          </button>
        </footer>
      </div>
    </Modal>
  );
}
