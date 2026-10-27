import { ChevronDown, ChevronUp, ListMusic, Music, Pause, Play, Search, SkipForward, Trash2, Volume2, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { api, MusicTrack } from '../lib/api';
import { positionNow, useListen } from '../lib/listen';
import { Icon } from './Icon';

/** «Слушать вместе» на сцене голосового канала (docs/CALLS.md §2.7): компактная карточка плеера под плитками;
 *  поиск, очередь и громкость — по «Развернуть» (или кнопке на панели управления) */
export function ListenPanel({ names }: { names: Record<number, string> }) {
  const s = useListen();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MusicTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  const current = s.queue[0];

  // Прогресс обновляем раз в 500 мс, пока играет
  useEffect(() => {
    if (!current || !s.playing) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [current, s.playing]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setError('');
    try {
      setResults(await api.musicSearch(term));
    } catch {
      setError('Поиск недоступен');
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: number) => names[id] ?? '';
  const pos = current ? positionNow(s) : 0;
  const pct = current ? (pos / s.durationMs) * 100 : 0;
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  const expanded = s.open;
  return (
    <section className={`listen-panel${expanded ? '' : ' compact'}`} aria-label="Слушать вместе">
      {current ? (
        <div className="listen-now" data-testid="listen-now">
          {current.artwork ? <img className="listen-art" src={current.artwork} alt="" /> : <span className="listen-art placeholder"><Icon icon={Music} size={18} /></span>}
          <div className="listen-meta">
            <span className="listen-kicker">Слушаем вместе</span>
            <strong className="ellipsis">
              {current.title} <span className="muted">— {current.artist}</span>
            </strong>
            <span className="muted small ellipsis">{current.added_by ? `добавил(а) ${nameOf(current.added_by) || 'участник'}` : ''}</span>
          </div>
          <div className="listen-ctl">
            <button type="button" className="icon-btn" aria-label={s.playing ? 'Пауза' : 'Играть'} aria-pressed={s.playing} onClick={s.toggle}>
              <Icon icon={s.playing ? Pause : Play} size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label="Следующий трек" onClick={s.next}>
              <Icon icon={SkipForward} size={20} />
            </button>
          </div>
          {s.queue.length > 1 && <span className="listen-chip">очередь {s.queue.length - 1}</span>}
          <button type="button" className="icon-btn" aria-label={expanded ? 'Свернуть' : 'Развернуть'} aria-expanded={expanded} onClick={() => s.setOpen(!expanded)}>
            <Icon icon={expanded ? ChevronUp : ChevronDown} size={18} />
          </button>
          <button type="button" className="icon-btn" aria-label="Закрыть панель" onClick={() => s.setOpen(false)}>
            <Icon icon={X} size={18} />
          </button>
        </div>
      ) : (
        <header className="listen-head">
          <Icon icon={ListMusic} size={18} />
          <strong>Слушать вместе</strong>
          <span className="muted small">превью из каталога, 30 секунд, у всех в канале синхронно</span>
          <div className="grow" />
          <button type="button" className="icon-btn" aria-label="Закрыть панель" onClick={() => s.setOpen(false)}>
            <Icon icon={X} size={18} />
          </button>
        </header>
      )}
      {current && (
        <div className="listen-bar">
          <span className="muted small listen-time">{fmt(pos)}</span>
          <div
            className="listen-progress"
            role="slider"
            aria-label="Позиция"
            aria-valuemin={0}
            aria-valuemax={s.durationMs}
            aria-valuenow={Math.round(pos)}
            tabIndex={0}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              s.seek(((e.clientX - r.left) / r.width) * s.durationMs);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') s.seek(Math.min(s.durationMs, pos + 5000));
              if (e.key === 'ArrowLeft') s.seek(Math.max(0, pos - 5000));
            }}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="muted small listen-time">{fmt(s.durationMs)}</span>
          {expanded && (
            <label className="listen-volume" title="Громкость музыки у меня">
              <Icon icon={Volume2} size={16} />
              <input type="range" min={0} max={1} step={0.05} value={s.volume} aria-label="Громкость музыки" onChange={(e) => s.setVolume(Number(e.target.value))} />
            </label>
          )}
        </div>
      )}

      {expanded && (
        <>
          {!current && <div className="muted small listen-empty">Очередь пуста — найдите трек и добавьте его, музыку услышат все в канале.</div>}
          {s.queue.length > 1 && (
            <ol className="listen-queue" aria-label="Очередь">
              {s.queue.slice(1).map((t, i) => (
                <li key={`${t.preview}-${i}`}>
                  <span className="muted small listen-num">{i + 1}</span>
                  <span className="ellipsis grow">
                    {t.title} <span className="muted">— {t.artist}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Убрать «${t.title}» из очереди`} onClick={() => s.remove(i + 1)}>
                    <Icon icon={Trash2} size={15} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <form className="listen-search" onSubmit={(e) => void search(e)}>
            <input type="search" placeholder="Найти трек в каталоге" aria-label="Найти трек" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn small" disabled={busy || !q.trim()}>
              <Icon icon={Search} size={15} /> Найти
            </button>
          </form>
          {error && <div className="form-error small">{error}</div>}
          {results && (
            <ul className="listen-results" aria-label="Результаты поиска">
              {results.length === 0 && <li className="muted small">Ничего не нашлось</li>}
              {results.map((t) => (
                <li key={t.id}>
                  {t.artwork && <img className="listen-art small" src={t.artwork} alt="" />}
                  <span className="ellipsis grow">
                    {t.title} <span className="muted">— {t.artist}</span>
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={!t.preview || s.queue.length >= 50}
                    title={t.preview ? 'Добавить в очередь' : 'У этого трека нет превью'}
                    onClick={() => {
                      s.add(t);
                      setResults(null);
                      setQ('');
                    }}
                  >
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
