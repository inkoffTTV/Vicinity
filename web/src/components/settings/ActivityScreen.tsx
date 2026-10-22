import { Flame, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActivitySummary, api, ApiError, Award, LeaderboardRow } from '../../lib/api';
import { EMBLEM_ICONS, levelProgress, plural, RARITY_LABEL, useActivity } from '../../lib/awards';
import { useStore } from '../../lib/store';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

/** Настройки → Уровень и награды (docs/API.md §16): опыт, серия, титулы и эмблемы, таблица друзей */
export function ActivityScreen() {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const live = useActivity((s) => s.me);
  const [data, setData] = useState<ActivitySummary | null>(null);
  const [catalog, setCatalog] = useState<Award[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.activityMe().then(
      (r) => {
        setData(r.activity);
        setCatalog(r.catalog);
      },
      (e) => setError(e instanceof ApiError ? e.message : 'Сервер не отдаёт активность'),
    );
    api.activityLeaderboard().then(setBoard, () => {});
  }, []);
  // Событие по WS (новый уровень, награда) — подхватываем без перезагрузки
  useEffect(() => {
    if (live && data) setData({ ...data, ...live, awards: data.awards });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const equip = async (kind: 'title' | 'emblem', id: string) => {
    if (!data) return;
    const title = kind === 'title' ? (data.title === id ? '' : id) : data.title;
    const emblem = kind === 'emblem' ? (data.emblem === id ? '' : id) : data.emblem;
    try {
      const r = await api.activityEquip(title, emblem);
      setData(r.activity);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось', 'error');
    }
  };

  if (error) return <div className="settings">{error}</div>;
  if (!data)
    return (
      <div className="settings">
        <header className="settings-head">
          <h1>Уровень и награды</h1>
        </header>
        <div className="muted">Загрузка…</div>
      </div>
    );

  const earned = new Set(data.awards.map((a) => a.id));
  const titles = catalog.filter((a) => a.kind === 'title');
  const emblems = catalog.filter((a) => a.kind === 'emblem');
  const pct = levelProgress(data);

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>Уровень и награды</h1>
        <p className="muted">Опыт идёт за сообщения, звонки, голосовые каналы и игры в Активностях. Серия растёт, если заходить каждый день.</p>
      </header>

      <section className="settings-card lvl-card" aria-label="Уровень">
        <div className="lvl-ring" style={{ ['--p' as string]: `${pct}%` }} data-testid="level">
          <span className="lvl-num">{data.level}</span>
          <span className="muted small">уровень</span>
        </div>
        <div className="grow stack">
          <div className="lvl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Опыт до следующего уровня">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="muted small">
            {data.xp - data.level_xp} из {data.next_xp - data.level_xp} опыта до уровня {data.level + 1}
          </div>
          <div className="lvl-stats">
            <span className={`lvl-streak${data.streak > 0 ? ' on' : ''}`} title="Дней подряд">
              <Icon icon={Flame} size={14} /> {data.streak} {plural(data.streak, 'день', 'дня', 'дней')} подряд
              {data.best_streak > data.streak && <span className="muted"> · рекорд {data.best_streak}</span>}
            </span>
            <span className="muted small">
              {data.msgs} {plural(data.msgs, 'сообщение', 'сообщения', 'сообщений')} · {data.call_min + data.voice_min} мин в голосе · {data.games}{' '}
              {plural(data.games, 'игра', 'игры', 'игр')}
              {data.wins > 0 && <>, побед: {data.wins}</>}
            </span>
          </div>
        </div>
      </section>

      <section className="settings-card stack" aria-label="Титулы">
        <h3>Титулы</h3>
        <span className="muted small">Титул виден под именем в карточке профиля. Нажмите на заработанный, чтобы надеть или снять.</span>
        <div className="award-grid">
          {titles.map((a) => (
            <AwardTile key={a.id} a={a} earned={earned.has(a.id)} active={data.title === a.id} onClick={() => void equip('title', a.id)} />
          ))}
        </div>
      </section>

      <section className="settings-card stack" aria-label="Эмблемы">
        <h3>Эмблемы</h3>
        <span className="muted small">Эмблема стоит рядом с ником в сообщениях и списках.</span>
        <div className="award-grid">
          {emblems.map((a) => (
            <AwardTile key={a.id} a={a} earned={earned.has(a.id)} active={data.emblem === a.id} onClick={() => void equip('emblem', a.id)} />
          ))}
        </div>
      </section>

      {board.length > 1 && (
        <section className="settings-card stack" aria-label="Среди друзей">
          <h3>Среди друзей</h3>
          <ol className="lvl-board">
            {board.map((u, i) => (
              <li key={u.id} className={u.id === me.user_id ? 'me' : undefined}>
                <span className="lvl-rank">{i + 1}</span>
                <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={28} />
                <span className="grow ellipsis">
                  {u.display_name}
                  {u.emblem && EMBLEM_ICONS[u.emblem] && <Icon icon={EMBLEM_ICONS[u.emblem]} size={13} className="inline-ico" />}
                </span>
                {u.streak > 0 && (
                  <span className="muted small" title="Дней подряд">
                    <Icon icon={Flame} size={12} className="inline-ico" />
                    {u.streak}
                  </span>
                )}
                <span className="lvl-pill">{u.level} ур.</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function AwardTile({ a, earned, active, onClick }: { a: Award; earned: boolean; active: boolean; onClick: () => void }) {
  const Ico = a.kind === 'emblem' ? EMBLEM_ICONS[a.id] : undefined;
  return (
    <button
      type="button"
      className={`award-tile r-${a.rarity}${earned ? '' : ' locked'}${active ? ' active' : ''}`}
      disabled={!earned}
      onClick={onClick}
      aria-pressed={active}
      title={earned ? (active ? 'Снять' : 'Надеть') : 'Ещё не заработано'}
    >
      <span className="award-ico" aria-hidden="true">{Ico ? <Icon icon={Ico} size={20} /> : earned ? a.name.charAt(0) : <Icon icon={Lock} size={16} />}</span>
      <span className="award-name">{a.name}</span>
      <span className="award-desc muted small">{a.desc}</span>
      <span className="award-rarity">{RARITY_LABEL[a.rarity]}</span>
    </button>
  );
}
