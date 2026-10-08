import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Emoji, emojiCategories, findEmoji, recentEmoji, rememberEmoji, searchEmoji } from '../lib/emoji';

const WIDTH = 344;
const HEIGHT = 384;
const COLUMNS = 8;

interface Props {
  /** Кнопка, у которой открылась палитра: рядом с ней палитра встаёт и туда возвращается фокус */
  anchor: HTMLElement;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Закрываться после выбора (реакция) или оставаться открытой (вставка в поле ввода) */
  closeOnPick?: boolean;
}

/** Палитра эмодзи: категории, поиск по-русски и по-английски, недавние */
export function EmojiPicker({ anchor, onPick, onClose, closeOnPick = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<Emoji | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [recent, setRecent] = useState(recentEmoji);
  const categories = emojiCategories();
  const results = useMemo(() => (query.trim() ? searchEmoji(query) : null), [query]);

  // Над кнопкой, если снизу не помещается; по горизонтали — в пределах окна
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - 16);
      const below = window.innerHeight - r.bottom - 8 >= HEIGHT;
      const top = below ? r.bottom + 4 : Math.max(8, r.top - HEIGHT - 4);
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  const close = () => {
    onClose();
    if (ref.current?.contains(document.activeElement)) anchor.focus();
  };

  // Щелчок мимо палитры и её кнопки закрывает её
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);

  const pick = (char: string) => {
    rememberEmoji(char);
    setRecent(recentEmoji());
    onPick(char);
    if (closeOnPick) close();
  };

  // Стрелки двигают фокус по сетке, Enter в поиске выбирает первый найденный
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button.emoji-cell') ?? []);
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Enter' && buttons[0]) {
        e.preventDefault();
        pick(buttons[0].dataset.emoji!);
      } else if (e.key === 'ArrowDown' && buttons[0]) {
        e.preventDefault();
        buttons[0].focus();
      }
      return;
    }
    if (idx < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = idx + step;
    if (next < 0) ref.current?.querySelector('input')?.focus();
    else buttons[Math.min(next, buttons.length - 1)].focus();
  };

  const jump = (id: string) => {
    gridRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' });
  };

  const cell = (e: Emoji, key: string) => (
    <button
      key={key}
      type="button"
      className="emoji-cell"
      data-emoji={e.char}
      title={`:${e.name}:`}
      aria-label={e.keywords.join(', ')}
      onClick={() => pick(e.char)}
      onMouseEnter={() => setHover(e)}
      onFocus={() => setHover(e)}
    >
      {e.char}
    </button>
  );

  const recentList = recent.map((c) => findEmoji(c) ?? { char: c, name: c, keywords: [c] });
  const preview = hover ?? results?.[0] ?? null;

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="emoji-panel"
      role="dialog"
      aria-label="Эмодзи"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      onKeyDown={onKeyDown}
    >
      <div className="emoji-panel-search">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти эмодзи"
          aria-label="Найти эмодзи"
        />
      </div>
      {!results && (
        <div className="emoji-panel-tabs" role="toolbar" aria-label="Разделы">
          {recentList.length > 0 && (
            <button type="button" title="Недавние" aria-label="Недавние" onClick={() => jump('recent')}>
              🕘
            </button>
          )}
          {categories.map((c) => (
            <button key={c.id} type="button" title={c.name} aria-label={c.name} onClick={() => jump(c.id)}>
              {c.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-panel-grid" ref={gridRef}>
        {results ? (
          results.length ? (
            <div className="emoji-grid">{results.map((e) => cell(e, e.char))}</div>
          ) : (
            <div className="emoji-panel-empty muted">Ничего не найдено</div>
          )
        ) : (
          <>
            {recentList.length > 0 && (
              <section data-section="recent">
                <h5>Недавние</h5>
                <div className="emoji-grid">{recentList.map((e) => cell(e, `r${e.char}`))}</div>
              </section>
            )}
            {categories.map((c) => (
              <section key={c.id} data-section={c.id}>
                <h5>{c.name}</h5>
                <div className="emoji-grid">{c.emojis.map((e) => cell(e, e.char))}</div>
              </section>
            ))}
          </>
        )}
      </div>
      <div className="emoji-panel-foot">
        {preview ? (
          <>
            <span className="emoji-panel-big">{preview.char}</span>
            <span className="ellipsis">
              :{preview.name}: <span className="muted small">{preview.keywords.slice(1).join(', ')}</span>
            </span>
          </>
        ) : (
          <span className="muted small">Наведите на эмодзи</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
