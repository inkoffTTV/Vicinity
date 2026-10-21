import { Search } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, ApiError, MusicTrack } from '../../lib/api';
import { Icon } from '../Icon';

/** Поиск трека по каталогу для карточки профиля: ввод → результаты → «Выбрать» */
export function MusicSearch({ onPick }: { onPick: (t: MusicTrack) => void }) {
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    setBusy(true);
    setError('');
    try {
      setTracks(await api.musicSearch(term));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Каталог не отвечает');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="music-search" onSubmit={search}>
      <div className="studio-cta">
        <input
          className="grow"
          placeholder="Исполнитель или название трека"
          aria-label="Поиск трека"
          maxLength={80}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={busy || q.trim().length < 2}>
          <Icon icon={Search} size={16} />
          Найти
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {tracks && tracks.length === 0 && <p className="muted small">Ничего не нашлось — попробуйте иначе.</p>}
      {tracks && tracks.length > 0 && (
        <ul className="music-results" aria-label="Найденные треки">
          {tracks.map((t) => (
            <li key={t.id}>
              {t.artwork ? <img src={t.artwork} alt="" loading="lazy" /> : <span />}
              <span className="grow">
                <span className="ellipsis">{t.title}</span>
                <span className="muted small ellipsis">
                  {t.artist}
                  {t.album ? ` · ${t.album}` : ''}
                </span>
              </span>
              <button type="button" className="btn small" onClick={() => onPick(t)}>
                Выбрать
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
