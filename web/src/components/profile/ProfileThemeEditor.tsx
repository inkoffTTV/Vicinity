import { Lock } from 'lucide-react';
import { useState } from 'react';
import { labelOn, PROFILE_THEME_PRESETS, ProfileTheme, themeSurface } from '../../lib/profileTheme';
import { ColorPicker } from '../ColorPicker';
import { Icon } from '../Icon';

const RECENT_KEY = 'vc.recentColors';
const DEFAULT_RECENT = ['#2bc6a4', '#ff6b9a', '#ffb443', '#7db8f5', '#b78cf7', '#f6e7c8', '#1a1b1f', '#5cf2cf'];

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || 'null');
    return Array.isArray(v) && v.every((c) => typeof c === 'string') ? v.slice(0, 8) : DEFAULT_RECENT;
  } catch {
    return DEFAULT_RECENT;
  }
}
function pushRecent(list: string[], hex: string): string[] {
  const next = [hex, ...list.filter((c) => c !== hex)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* приватный режим — недавние только в памяти */
  }
  return next;
}

/** Тема профиля (Standard): два кружка «Верх»/«Низ» со своим выбором цвета, готовые пары и проверка контраста */
export function ProfileThemeEditor({ value, tier, onChange }: { value: ProfileTheme | null; tier: number; onChange: (t: ProfileTheme | null) => void }) {
  const [open, setOpen] = useState<'top' | 'bottom' | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const theme = value ?? { top: '#5cf2cf', bottom: '#4c3ba8' };
  const surface = value ? themeSurface(value) : null;
  const locked = tier < 2;

  const set = (side: 'top' | 'bottom', hex: string) => onChange({ ...theme, [side]: hex });
  const close = () => {
    if (open && value) setRecent((r) => pushRecent(r, value[open]));
    setOpen(null);
  };

  return (
    <div className="pte">
      {locked && (
        <span className="pte-lock muted small">
          <Icon icon={Lock} size={12} /> Со Standard — примерить можно, сохранить нельзя
        </span>
      )}
      <div className="pte-strip" style={{ background: `linear-gradient(90deg, ${theme.top}, ${theme.bottom})` }}>
        {(['top', 'bottom'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`pte-dot${open === side ? ' on' : ''}`}
            style={{ background: theme[side], color: labelOn(theme[side]) }}
            aria-expanded={open === side}
            onClick={() => {
              if (!value) onChange(theme);
              open === side ? close() : (close(), setOpen(side));
            }}
          >
            {side === 'top' ? 'Верх' : 'Низ'}
          </button>
        ))}
      </div>
      {open && (
        <ColorPicker
          title={open === 'top' ? 'Цвет верха' : 'Цвет низа'}
          value={theme[open]}
          recent={recent}
          onChange={(hex) => set(open, hex)}
        />
      )}
      <div className="pte-presets" role="radiogroup" aria-label="Готовые пары">
        {PROFILE_THEME_PRESETS.map((p) => {
          const on = !!value && value.top === p.top && value.bottom === p.bottom;
          return (
            <button
              key={p.name}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              title={p.name}
              aria-label={p.name}
              style={{ background: `linear-gradient(135deg, ${p.top} 50%, ${p.bottom} 50%)` }}
              onClick={() => {
                setOpen(null);
                onChange({ top: p.top, bottom: p.bottom });
              }}
            />
          );
        })}
      </div>
      {surface && (
        <div className={`pte-contrast${surface.ok ? ' ok' : ' warn'}`}>
          <span className="pte-contrast-badge" aria-hidden="true">
            {surface.ok ? '✓' : '!'}
          </span>
          <span>
            Контраст текста {surface.ratio.toFixed(1).replace('.', ',')}:1 — {surface.ok ? (surface.ratio >= 7 ? 'отлично' : 'хорошо') : 'подложка усилена до максимума'}
            <span className="muted small">
              {' '}
              · {surface.light ? 'светлая' : 'тёмная'} подложка {Math.round(surface.alpha * 100)}%
            </span>
          </span>
        </div>
      )}
      {value && (
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setOpen(null);
            onChange(null);
          }}
        >
          Без темы
        </button>
      )}
    </div>
  );
}
