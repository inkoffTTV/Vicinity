import { ReactNode, useState } from 'react';
import { Game, ProfileExt } from '../../lib/api';
import { GAME_TAGS } from '../../lib/cosmetics';
import { Popover } from '../Popover';
import { GameCover, GamePicker } from './GamePicker';

type Tab = 'board' | 'activity' | 'wishlist';
type WidgetId = 'favorite_game' | 'games';

const WIDGET_NAMES: Record<WidgetId, string> = { favorite_game: 'Любимая игра', games: 'Мои любимые игры' };

/** Какие виджеты на доске и в каком порядке */
export function boardWidgets(ext: ProfileExt): WidgetId[] {
  const list = ext.widgets.order.filter((w, i, a) => a.indexOf(w) === i);
  if (ext.widgets.favorite_game && !list.includes('favorite_game')) list.push('favorite_game');
  if (ext.widgets.games.length && !list.includes('games')) list.push('games');
  return list;
}

/** Правая часть профиля: «Доска» (виджеты), «Активность», «Вишлист». editable — свой профиль в редакторе */
export function ProfileBoard({
  ext,
  editable,
  onChange,
  activity,
}: {
  ext: ProfileExt;
  editable?: boolean;
  onChange?: (ext: ProfileExt) => void;
  activity: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('board');
  const [picker, setPicker] = useState<null | 'favorite_game' | 'games' | 'wishlist'>(null);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const [tagMenu, setTagMenu] = useState<HTMLElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  const w = ext.widgets;
  const widgets = boardWidgets(ext);
  const missing = (['favorite_game', 'games'] as WidgetId[]).filter((x) => !widgets.includes(x));

  const patch = (next: Partial<ProfileExt['widgets']>) => onChange?.({ ...ext, widgets: { ...w, ...next } });
  const removeWidget = (id: WidgetId) =>
    patch({ order: widgets.filter((x) => x !== id), ...(id === 'favorite_game' ? { favorite_game: null } : { games: [] }) });

  const pick = (g: Game) => {
    if (picker === 'favorite_game') patch({ favorite_game: { ...g, note: w.favorite_game?.note ?? '', tags: w.favorite_game?.tags ?? [] }, order: [...widgets.filter((x) => x !== 'favorite_game'), 'favorite_game'] });
    if (picker === 'games') patch({ games: [...w.games, g].slice(0, 20), order: widgets.includes('games') ? widgets : [...widgets, 'games'] });
    if (picker === 'wishlist') patch({ wishlist: [...w.wishlist, g].slice(0, 20) });
    setPicker(null);
  };

  const grid = (games: Game[], list: 'games' | 'wishlist') => {
    const visible = showAll ? games : games.slice(0, 8);
    return (
      <>
        <div className="game-grid">
          {visible.map((g) => (
            <figure key={g.appid} className="game-tile" title={g.name}>
              <GameCover game={g} />
              {editable && (
                <button type="button" className="game-remove" aria-label={`Убрать ${g.name}`} onClick={() => patch({ [list]: games.filter((x) => x.appid !== g.appid) })}>
                  ✕
                </button>
              )}
            </figure>
          ))}
        </div>
        {games.length > 8 && (
          <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Свернуть' : `Показать больше (${games.length - 8})`}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="pboard">
      <div className="pboard-tabs" role="tablist" aria-label="Разделы профиля">
        {(
          [
            ['board', 'Доска'],
            ['activity', 'Активность'],
            ['wishlist', 'Вишлист'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <div className="pboard-body">
          {editable && (
            <div className="row-between center-y">
              <span className="muted small">Ваши виджеты</span>
              <button type="button" className="btn small" disabled={missing.length === 0} onClick={(e) => setAddMenu(e.currentTarget)}>
                ＋ Добавить виджет
              </button>
            </div>
          )}
          {widgets.length === 0 && <div className="pboard-empty muted">{editable ? 'Добавьте виджет — например, любимую игру.' : 'Здесь пока пусто.'}</div>}

          {widgets.map((id) =>
            id === 'favorite_game' ? (
              <section key={id} className="widget">
                <div className="widget-head">
                  <div>
                    <strong>Любимая игра</strong>
                    {editable && <span className="muted small">Выберите 1 игру</span>}
                  </div>
                  {editable && (
                    <button type="button" className="icon-btn small" aria-label="Убрать виджет" onClick={() => removeWidget(id)}>
                      ✕
                    </button>
                  )}
                </div>
                {w.favorite_game ? (
                  <div className="fav-game">
                    <button type="button" className="fav-cover" disabled={!editable} onClick={() => setPicker('favorite_game')} aria-label="Сменить игру">
                      <GameCover game={w.favorite_game} />
                    </button>
                    <div className="fav-info">
                      <strong>{w.favorite_game.name}</strong>
                      {editable ? (
                        <input
                          className="fav-note"
                          placeholder="Расскажите, почему она любимая"
                          maxLength={120}
                          value={w.favorite_game.note}
                          onChange={(e) => patch({ favorite_game: { ...w.favorite_game!, note: e.target.value } })}
                        />
                      ) : (
                        w.favorite_game.note && <p className="fav-note-text">{w.favorite_game.note}</p>
                      )}
                      <div className="fav-tags">
                        {w.favorite_game.tags.map((t) => (
                          <span key={t} className="tag-chip">
                            {t}
                            {editable && (
                              <button type="button" aria-label={`Убрать тег ${t}`} onClick={() => patch({ favorite_game: { ...w.favorite_game!, tags: w.favorite_game!.tags.filter((x) => x !== t) } })}>
                                ✕
                              </button>
                            )}
                          </span>
                        ))}
                        {editable && w.favorite_game.tags.length < 6 && (
                          <button type="button" className="tag-chip add" onClick={(e) => setTagMenu(e.currentTarget)}>
                            ＋ теги
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  editable && (
                    <button type="button" className="btn" onClick={() => setPicker('favorite_game')}>
                      Выбрать игру
                    </button>
                  )
                )}
              </section>
            ) : (
              <section key={id} className="widget">
                <div className="widget-head">
                  <div>
                    <strong>Мои любимые игры</strong>
                    {editable && <span className="muted small">Добавьте до 20 игр</span>}
                  </div>
                  {editable && (
                    <div className="stack-row">
                      <button type="button" className="icon-btn small" aria-label="Добавить игру" disabled={w.games.length >= 20} onClick={() => setPicker('games')}>
                        ＋
                      </button>
                      <button type="button" className="icon-btn small" aria-label="Убрать виджет" onClick={() => removeWidget(id)}>
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                {w.games.length ? grid(w.games, 'games') : <div className="muted small">Игр пока нет</div>}
              </section>
            ),
          )}
        </div>
      )}

      {tab === 'activity' && <div className="pboard-body">{activity}</div>}

      {tab === 'wishlist' && (
        <div className="pboard-body">
          <section className="widget">
            <div className="widget-head">
              <div>
                <strong>Вишлист</strong>
                <span className="muted small">Игры, которые хочется получить или попробовать</span>
              </div>
              {editable && (
                <button type="button" className="icon-btn small" aria-label="Добавить игру" disabled={w.wishlist.length >= 20} onClick={() => setPicker('wishlist')}>
                  ＋
                </button>
              )}
            </div>
            {w.wishlist.length ? grid(w.wishlist, 'wishlist') : <div className="muted small">{editable ? 'Добавьте игры кнопкой ＋' : 'Вишлист пуст'}</div>}
          </section>
        </div>
      )}

      {addMenu && (
        <Popover anchor={addMenu} onClose={() => setAddMenu(null)} className="menu" role="menu" label="Добавить виджет">
          <>
            {missing.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenu(null);
                  if (id === 'favorite_game') setPicker('favorite_game');
                  else patch({ order: [...widgets, 'games'] });
                }}
              >
                {WIDGET_NAMES[id]}
              </button>
            ))}
          </>
        </Popover>
      )}
      {tagMenu && w.favorite_game && (
        <Popover anchor={tagMenu} onClose={() => setTagMenu(null)} className="menu tag-menu" role="menu" label="Теги">
          <>
            {GAME_TAGS.filter((t) => !w.favorite_game!.tags.includes(t)).map((t) => (
              <button
                key={t}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTagMenu(null);
                  patch({ favorite_game: { ...w.favorite_game!, tags: [...w.favorite_game!.tags, t].slice(0, 6) } });
                }}
              >
                {t}
              </button>
            ))}
          </>
        </Popover>
      )}
      {picker && (
        <GamePicker
          title={picker === 'favorite_game' ? 'Любимая игра' : picker === 'games' ? 'Добавить любимую игру' : 'Добавить в вишлист'}
          exclude={(picker === 'wishlist' ? w.wishlist : picker === 'games' ? w.games : []).map((g) => g.appid)}
          onPick={pick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
