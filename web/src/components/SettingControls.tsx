import type React from 'react';
// Общие элементы вкладок настроек: переключатель-сегменты и строка с тумблером

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label" id={`seg-${label || 'sort'}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label || 'sort'}`}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {hint && <span className="muted small toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Ползунок с подписью и значением (прозрачность, размытие) */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = '',
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={`toggle-row slider-row${disabled ? ' disabled' : ''}`}>
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {hint && <span className="muted small toggle-hint">{hint}</span>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-value">
        {value}
        {unit}
      </span>
    </label>
  );
}

/** Ряд карточек-вариантов (скругление, стиль) */
export function Cards<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { id: T; name: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting-block">
      <span className="toggle-label">{label}</span>
      {hint && <span className="muted small toggle-hint">{hint}</span>}
      <div className="choice-cards" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`choice-card${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}>
            {o.icon && <span className="choice-icon" aria-hidden="true">{o.icon}</span>}
            <span>{o.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
