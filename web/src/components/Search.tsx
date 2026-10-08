import { MouseEvent, useEffect, useRef } from 'react';
import { parseTs, SearchResult } from '../lib/api';
import { SearchScope, scopesFor, useSearch } from '../lib/search';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { formatTime } from './Message';

const SCOPE_LABEL: Record<SearchScope, string> = {
  channel: 'В канале',
  server: 'На сервере',
  all: 'Везде',
};

/** Поле поиска в шапке; Ctrl+F (⌘F) переводит в него фокус */
export function SearchBox() {
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);
  const run = useSearch((s) => s.run);
  const close = useSearch((s) => s.close);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrlF = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF';
      // Поверх открытого окна (настройки, профиль) поиск не перехватываем
      if (ctrlF && !document.querySelector('.modal-backdrop')) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="search-box" role="search">
      <input
        ref={ref}
        type="search"
        placeholder="Поиск"
        aria-label="Поиск по сообщениям"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void run();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setQuery('');
            close();
            ref.current?.blur();
          }
        }}
      />
      <span className="search-box-icon" aria-hidden="true">
        🔍
      </span>
    </div>
  );
}

const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Результаты поиска справа от ленты: где искать, найденные сообщения с подсветкой, переход к ним */
export function SearchPanel() {
  const results = useSearch((s) => s.results);
  const loading = useSearch((s) => s.loading);
  const error = useSearch((s) => s.error);
  const shown = useSearch((s) => s.shown);
  const scope = useSearch((s) => s.scope);
  const setScope = useSearch((s) => s.setScope);
  const close = useSearch((s) => s.close);
  const view = useStore((s) => s.view);
  const jumpTo = useStore((s) => s.jumpTo);
  const scopes = scopesFor(view);
  const current = scopes.includes(scope) ? scope : scopes[0];

  const title = loading
    ? 'Ищем…'
    : results
      ? results.length
        ? `${results.length} ${plural(results.length, ['результат', 'результата', 'результатов'])}`
        : 'Ничего не найдено'
      : 'Поиск';

  return (
    <aside className="search-panel" aria-label="Поиск по сообщениям">
      <div className="search-panel-head">
        <strong aria-live="polite">{title}</strong>
        <button className="icon-btn small" onClick={close} title="Закрыть поиск" aria-label="Закрыть поиск">
          ✕
        </button>
      </div>
      {scopes.length > 1 && (
        <div className="search-scopes" role="radiogroup" aria-label="Где искать">
          {scopes.map((sc) => (
            <button
              key={sc}
              role="radio"
              aria-checked={sc === current}
              className={sc === current ? 'on' : ''}
              onClick={() => setScope(sc)}
            >
              {SCOPE_LABEL[sc]}
            </button>
          ))}
        </div>
      )}
      {error && <div className="form-error search-error">{error}</div>}
      <div className="search-results">
        {results?.length === 0 && <div className="empty-state">По запросу «{shown}» ничего не нашлось</div>}
        {results?.map((r) => <SearchHit key={`${r.channel_id}:${r.id}`} r={r} query={shown} onOpen={() => void jumpTo(r.channel_id, r.id)} />)}
      </div>
    </aside>
  );
}

function SearchHit({ r, query, onOpen }: { r: SearchResult; query: string; onOpen: () => void }) {
  const where = useStore((s) => {
    if (r.server_id) {
      const server = s.servers.find((x) => x.id === r.server_id);
      return `${server ? `${server.name} › ` : ''}#${r.channel_name}`;
    }
    return s.dms.some((d) => d.channel_id === r.channel_id) ? `@${r.channel_name}` : `💬 ${r.channel_name}`;
  });
  // Ссылка или упоминание в тексте делают своё; щелчок по остальному — переход к сообщению
  const onClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('a, button')) onOpen();
  };
  return (
    <div className="search-hit" onClick={onClick}>
      <div className="search-hit-where muted small">
        <span className="ellipsis">{where}</span>
        <button className="link-btn small" onClick={onOpen}>
          Перейти
        </button>
      </div>
      <div className="search-hit-main">
        <Avatar name={r.author_name} src={r.author_avatar} id={r.author_id} size={32} />
        <div className="grow">
          <div className="search-hit-meta">
            <strong className="ellipsis">{r.author_name}</strong>
            <span className="muted small">{formatTime(parseTs(r.created_at))}</span>
          </div>
          {r.text && (
            <div className="search-hit-text">
              <Markdown text={r.text} highlight={query} />
            </div>
          )}
          {r.attachment && <div className="muted small">📎 {r.attachment_name || 'Вложение'}</div>}
        </div>
      </div>
    </div>
  );
}
