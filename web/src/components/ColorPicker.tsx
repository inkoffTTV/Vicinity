import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { hexToHsv, Hsv, hsvToHex } from '../lib/profileTheme';

const HEX = /^#[0-9a-f]{6}$/i;

/** Свой выбор цвета (макет 11): поле насыщенность/яркость, полоса оттенка, HEX и недавние цвета */
export function ColorPicker({ value, onChange, recent = [], title }: { value: string; onChange: (hex: string) => void; recent?: string[]; title?: string }) {
  // Оттенок храним отдельно: у серого и чёрного он из HEX не восстанавливается
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value.toUpperCase());
  const last = useRef(value);

  useEffect(() => {
    if (value.toLowerCase() === last.current.toLowerCase()) return;
    last.current = value;
    const next = hexToHsv(value);
    setHsv((cur) => (next.s === 0 || next.v === 0 ? { ...next, h: cur.h } : next));
    setText(value.toUpperCase());
  }, [value]);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    last.current = hex;
    setText(hex.toUpperCase());
    onChange(hex);
  };

  const drag = (el: HTMLElement, e: ReactPointerEvent, apply: (x: number, y: number) => void) => {
    const r = el.getBoundingClientRect();
    const at = (cx: number, cy: number) => apply(Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height)));
    at(e.clientX, e.clientY);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => at(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const key = (e: React.KeyboardEvent, dx: number, dy: number, kind: 'sv' | 'hue') => {
    e.preventDefault();
    if (kind === 'hue') emit({ ...hsv, h: Math.min(359, Math.max(0, hsv.h + dx * 4)) });
    else emit({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + dx * 0.03)), v: Math.min(1, Math.max(0, hsv.v - dy * 0.03)) });
  };
  const arrows = (kind: 'sv' | 'hue') => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') key(e, -1, 0, kind);
    else if (e.key === 'ArrowRight') key(e, 1, 0, kind);
    else if (e.key === 'ArrowUp' && kind === 'sv') key(e, 0, -1, kind);
    else if (e.key === 'ArrowDown' && kind === 'sv') key(e, 0, 1, kind);
  };

  const hue = `hsl(${Math.round(hsv.h)}, 100%, 50%)`;
  return (
    <div className="cpick" role="group" aria-label={title ?? 'Выбор цвета'}>
      {title && <div className="cpick-title">{title}</div>}
      <div
        className="cpick-sv"
        style={{ background: hue }}
        role="slider"
        tabIndex={0}
        aria-label="Насыщенность и яркость"
        aria-valuetext={`насыщенность ${Math.round(hsv.s * 100)}%, яркость ${Math.round(hsv.v * 100)}%`}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => emit({ ...hsv, s: x, v: 1 - y }))}
        onKeyDown={arrows('sv')}
      >
        <span className="cpick-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <div
        className="cpick-hue"
        role="slider"
        tabIndex={0}
        aria-label="Оттенок"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(e) => drag(e.currentTarget, e, (x) => emit({ ...hsv, h: Math.min(359, x * 360) }))}
        onKeyDown={arrows('hue')}
      >
        <span className="cpick-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
      </div>
      <label className="cpick-hex">
        <span>HEX</span>
        <input
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            let t = e.target.value.trim();
            if (t && !t.startsWith('#')) t = '#' + t;
            setText(t.toUpperCase());
            if (HEX.test(t)) {
              last.current = t.toLowerCase();
              setHsv(hexToHsv(t));
              onChange(t.toLowerCase());
            }
          }}
          onBlur={() => setText(value.toUpperCase())}
        />
        <span className="cpick-swatch" style={{ background: value }} aria-hidden="true" />
      </label>
      {recent.length > 0 && (
        <div className="cpick-recent">
          <span className="muted small">Недавние</span>
          <div>
            {recent.map((c) => (
              <button key={c} type="button" style={{ background: c }} aria-label={c.toUpperCase()} title={c.toUpperCase()} onClick={() => onChange(c)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
