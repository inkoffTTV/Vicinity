import { useEffect, useState } from 'react';
import { ApiError, Game, api } from '../../lib/api';
import { Modal } from '../Modal';

/** Поиск игры в каталоге Steam (через наш сервер) */
export function GamePicker({ title, exclude, onPick, onClose }: { title: string; exclude: number[]; onPick: (g: Game) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGames([]);
      setState('idle');
      return;
    }
    setState('loading');
    let alive = true;
    const t = setTimeout(() => {
      api.searchGames(term).then(
        (g) => {
          if (!alive) return;
          setGames(g);
          setState('idle');
        },
        (e) => {
          if (!alive) return;
          setError(e instanceof ApiError ? e.message : 'Ошибка');
          setState('error');
        },
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <Modal title={title} onClose={onClose} className="game-picker">
      <input autoFocus placeholder="Название игры, например Dota 2" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск игры" />
      {state === 'loading' && <div className="muted small">Ищем…</div>}
      {state === 'error' && <div className="form-error">{error}</div>}
      {state === 'idle' && q.trim().length >= 2 && games.length === 0 && <div className="muted small">Ничего не нашлось</div>}
      <ul className="game-results">
        {games.map((g) => {
          const taken = exclude.includes(g.appid);
          return (
            <li key={g.appid}>
              <button type="button" disabled={taken} onClick={() => onPick(g)}>
                <GameCover game={g} small />
                <span className="grow ellipsis">{g.name}</span>
                <span className="muted small">{taken ? 'уже добавлена' : 'Добавить'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="muted small">Каталог — магазин Steam. Обложки хранятся на нашем сервере.</div>
    </Modal>
  );
}

/** Обложка игры; не загрузилась — плитка с названием */
export function GameCover({ game, small }: { game: { name: string; cover: string }; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <span className={`game-cover fallback${small ? ' small' : ''}`}>{game.name}</span>
  ) : (
    <img className={`game-cover${small ? ' small' : ''}`} src={game.cover} alt={game.name} loading="lazy" onError={() => setBroken(true)} />
  );
}
