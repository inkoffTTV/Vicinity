import { ArrowLeft, Bot as BotIcon, Check, Link2, Menu, MessageSquare, Plus, Search, ServerCog, SearchX, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, BLOCKS_CHANGED, BotCard, DirectoryBot } from '../lib/api';
import { useBotStart } from '../lib/botStart';
import { copyText } from '../lib/clipboard';
import { botLink } from '../lib/routes';
import { openSettingsAt } from '../lib/settingsNav';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ServerIcon } from './ServerRail';

const PAGE = 50;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Раздел «Боты» (docs/API.md §21.9): каталог с поиском, а с @именем в адресе — страница бота */
export function BotsDirectory({ onMenu }: { onMenu: () => void }) {
  const username = useStore((s) => (s.view.kind === 'bots' ? s.view.username : null));
  return username ? <BotPage key={username} username={username} onMenu={onMenu} /> : <Directory onMenu={onMenu} />;
}

function Directory({ onMenu }: { onMenu: () => void }) {
  const open = useStore((s) => s.open);
  const [query, setQuery] = useState('');
  const [bots, setBots] = useState<DirectoryBot[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  // Поиск с паузой после ввода: сервер ограничивает частоту поиска
  useEffect(() => {
    const n = ++seq.current;
    const q = query.trim();
    const t = window.setTimeout(
      () => {
        api.botDirectory(q).then(
          (r) => {
            if (n !== seq.current) return;
            setBots(r.bots);
            setMore(r.has_more);
            setError('');
          },
          (e) => n === seq.current && setError(errText(e, 'Не удалось загрузить ботов — проверьте связь и попробуйте ещё раз')),
        );
      },
      q ? 300 : 0,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  const loadMore = async () => {
    if (!bots || loadingMore) return;
    setLoadingMore(true);
    const n = seq.current;
    try {
      const r = await api.botDirectory(query.trim(), bots.length, PAGE);
      if (n === seq.current) {
        setBots([...bots, ...r.bots.filter((b) => !bots.some((x) => x.id === b.id))]);
        setMore(r.has_more);
      }
    } catch (e) {
      useStore.getState().toast(errText(e, 'Не удалось загрузить ещё'), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const list = bots ?? [];
  const sections: { title: string; items: DirectoryBot[] }[] = [
    { title: 'Ваши боты', items: list.filter((b) => b.mine) },
    { title: 'На ваших серверах', items: list.filter((b) => !b.mine && b.servers.length > 0) },
    { title: 'Есть личка', items: list.filter((b) => !b.mine && b.servers.length === 0 && b.has_dm) },
    { title: 'Каталог', items: list.filter((b) => !b.mine && b.servers.length === 0 && !b.has_dm) },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="chat bots-dir">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню" title="Меню">
          <Icon icon={Menu} size={22} />
        </button>
        <strong className="chat-title">
          <Icon icon={BotIcon} size={18} className="chat-title-icon" />
          Боты
        </strong>
        <div className="grow" />
        <button type="button" className="btn small bots-dir-create" aria-label="Создать бота" onClick={() => openSettingsAt('bots')}>
          <Icon icon={Plus} size={16} />
          <span>Создать бота</span>
        </button>
      </header>
      <div className="bots-dir-body">
        <div className="bots-dir-inner">
          <label className="bots-dir-search">
            <Icon icon={Search} size={16} />
            <input
              type="search"
              placeholder="Имя, @имя или описание"
              aria-label="Поиск ботов"
              value={query}
              maxLength={64}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {bots === null && !error && <span className="muted small">Загрузка…</span>}
          {bots !== null && list.length === 0 && (
            <div className="bots-dir-empty">
              <Icon icon={query.trim() ? SearchX : BotIcon} size={22} />
              <span>{query.trim() ? 'Таких ботов не нашлось — попробуйте другое имя.' : 'Здесь появятся боты: ваши, с ваших серверов и из каталога.'}</span>
              <button type="button" className="btn primary" onClick={() => openSettingsAt('bots')}>
                <Icon icon={Plus} size={16} />
                Создать бота
              </button>
            </div>
          )}
          {sections.map((sec) => (
            <section key={sec.title} className="bots-dir-section" aria-label={sec.title}>
              <h2 className="bots-dir-title">
                {sec.title} <span className="muted">· {sec.items.length}</span>
              </h2>
              <ul className="bots-dir-list">
                {sec.items.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="bots-dir-card"
                      aria-label={`${b.display_name}, @${b.username}`}
                      onClick={() => open({ kind: 'bots', username: b.username })}
                    >
                      <Avatar name={b.display_name} src={b.avatar_path} id={b.id} size={40} />
                      <span className="bots-dir-card-text">
                        <span className="bots-dir-card-name">
                          <strong className="ellipsis">{b.display_name}</strong>
                          <span className="bot-tag">Бот</span>
                        </span>
                        <span className="muted small ellipsis">@{b.username}</span>
                        {b.short_description && <span className="bots-dir-about small">{b.short_description}</span>}
                        <BotMarks bot={b} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <div className="bots-dir-more">
              <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            </div>
          )}
          <p className="muted small bots-dir-foot">
            Хотите своего бота? Создайте его в{' '}
            <button type="button" className="link-btn" onClick={() => openSettingsAt('bots')}>
              Настройках → Боты
            </button>{' '}
            и включите «Показывать в каталоге», чтобы его нашли другие.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Отметки «Ваш бот» и «На сервере X» */
function BotMarks({ bot }: { bot: DirectoryBot }) {
  if (!bot.mine && bot.servers.length === 0) return null;
  const first = bot.servers[0];
  return (
    <span className="bots-dir-marks">
      {bot.mine && <span className="bots-dir-mark">Ваш бот</span>}
      {first && (
        <span className="bots-dir-mark ellipsis" title={bot.servers.map((s) => s.name).join(', ')}>
          На сервере {first.name}
          {bot.servers.length > 1 ? ` и ещё ${bot.servers.length - 1}` : ''}
        </span>
      )}
    </span>
  );
}

function BotPage({ username, onMenu }: { username: string; onMenu: () => void }) {
  const open = useStore((s) => s.open);
  const toast = useStore((s) => s.toast);
  const me = useStore((s) => s.me!);
  const ownServers = useStore((s) => s.servers.filter((x) => x.owner_id === s.me?.user_id));
  const payload = useBotStart((s) => s.payloads[username]);
  const [card, setCard] = useState<BotCard | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.botCard(username).then(
      (c) => (setCard(c), setError('')),
      (e) =>
        setError(
          e instanceof ApiError && e.status === 404
            ? `Бот @${username} не найден. Возможно, его удалили или он виден только участникам его серверов.`
            : errText(e, 'Не удалось загрузить бота — проверьте связь и попробуйте ещё раз'),
        ),
    );
  useEffect(() => {
    void load();
    // Разблокировали бота в профиле поверх страницы — «Написать» становится доступна сразу
    const reload = () => void load();
    window.addEventListener(BLOCKS_CHANGED, reload);
    return () => window.removeEventListener(BLOCKS_CHANGED, reload);
  }, [username]);

  const write = async () => {
    if (!card || busy) return;
    setBusy(true);
    await useStore.getState().openDmWith(card.id, { username: card.username });
    setBusy(false);
  };

  const share = async () => {
    if (await copyText(botLink(username))) toast('Ссылка на бота скопирована');
    else toast('Не удалось скопировать — выделите ссылку вручную', 'error');
  };

  const back = () => open({ kind: 'bots', username: null });

  return (
    <div className="chat bots-dir">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню" title="Меню">
          <Icon icon={Menu} size={22} />
        </button>
        <button type="button" className="icon-btn" onClick={back} aria-label="Все боты" title="Все боты">
          <Icon icon={ArrowLeft} size={18} />
        </button>
        <strong className="chat-title ellipsis">{card ? card.display_name : `@${username}`}</strong>
      </header>
      <div className="bots-dir-body">
        <div className="bots-dir-inner">
          {error && (
            <div className="bots-dir-empty" role="alert">
              <Icon icon={SearchX} size={22} />
              <span>{error}</span>
              <button type="button" className="btn" onClick={back}>
                Все боты
              </button>
            </div>
          )}
          {!card && !error && <span className="muted small">Загрузка…</span>}
          {card && (
            <article className="bot-page" aria-label={`Бот ${card.display_name}`}>
              <div className="bot-page-head">
                <Avatar name={card.display_name} src={card.avatar_path} id={card.id} size={72} />
                <div className="bot-page-names">
                  <h1 className="bot-page-name">
                    <span className="ellipsis">{card.display_name}</span>
                    <span className="bot-tag">Бот</span>
                  </h1>
                  <span className="muted ellipsis">@{card.username}</span>
                  <BotMarks bot={card} />
                </div>
              </div>
              <div className="bot-page-actions">
                <button type="button" className="btn primary" disabled={busy || card.blocked} onClick={() => void write()}>
                  <Icon icon={MessageSquare} size={16} />
                  Написать
                </button>
                {ownServers.length > 0 && (
                  <button type="button" className="btn" onClick={() => setAdding(true)}>
                    <Icon icon={ServerCog} size={16} />
                    Добавить на сервер
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void share()}>
                  <Icon icon={Link2} size={16} />
                  Поделиться
                </button>
              </div>
              {card.blocked && (
                <div className="bot-page-blocked">
                  <p className="bot-page-note small">Вы заблокировали этого бота — разблокируйте его в профиле, чтобы написать.</p>
                  <button type="button" className="btn small" onClick={() => useStore.getState().showProfile(card.id)}>
                    <Icon icon={UserRound} size={16} />
                    Открыть профиль
                  </button>
                </div>
              )}
              {payload && !card.blocked && (
                <p className="bot-page-note small">
                  Вы перешли по ссылке с параметром: после «Написать» нажмите «Начать», и бот получит <code>/start {payload}</code>.
                </p>
              )}
              <section className="bot-page-section" aria-label="Описание">
                <h2>Что умеет этот бот?</h2>
                {card.description ? (
                  <p className="bot-page-desc">{card.description}</p>
                ) : (
                  <p className="muted">Бот пока ничего о себе не рассказал.</p>
                )}
              </section>
              {card.commands.length > 0 && (
                <section className="bot-page-section" aria-label="Команды">
                  <h2>Команды</h2>
                  <ul className="bot-commands">
                    {card.commands.map((c) => (
                      <li key={c.command}>
                        <code>/{c.command}</code>
                        <span className="muted">{c.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {card.owner && (
                <section className="bot-page-section" aria-label="Владелец">
                  <h2>Владелец</h2>
                  <button type="button" className="bot-page-owner" onClick={() => useStore.getState().showProfile(card.owner!.id)}>
                    <Avatar name={card.owner.display_name} id={card.owner.id} size={32} />
                    <span className="ellipsis">
                      {card.owner.id === me.user_id ? 'Вы' : card.owner.display_name}
                      <span className="muted"> · @{card.owner.username}</span>
                    </span>
                  </button>
                </section>
              )}
            </article>
          )}
        </div>
      </div>
      {adding && card && (
        <AddToServer
          card={card}
          onClose={() => setAdding(false)}
          onAdded={() => void load()}
        />
      )}
    </div>
  );
}

/** «Добавить на сервер»: только серверы, где вы владелец (POST /servers/{id}/bots) */
function AddToServer({ card, onClose, onAdded }: { card: BotCard; onClose: () => void; onAdded: () => void }) {
  const servers = useStore((s) => s.servers.filter((x) => x.owner_id === s.me?.user_id));
  const toast = useStore((s) => s.toast);
  const [done, setDone] = useState<Set<number>>(() => new Set(card.servers.map((s) => s.id)));
  const [busy, setBusy] = useState<number | null>(null);

  const add = async (id: number, name: string) => {
    setBusy(id);
    try {
      await api.addServerBot(id, card.username);
      setDone((d) => new Set(d).add(id));
      toast(`@${card.username} добавлен на сервер «${name}»`);
      onAdded();
    } catch (e) {
      toast(errText(e, 'Не удалось добавить бота — попробуйте ещё раз'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Добавить @${card.username} на сервер`} onClose={onClose}>
      <p className="muted small no-margin">Бот вступит сразу и будет видеть команды, упоминания и ответы на свои сообщения.</p>
      <ul className="bot-servers">
        {servers.map((s) => (
          <li key={s.id}>
            <span className="bot-servers-icon" aria-hidden="true">
              <ServerIcon name={s.name} icon={s.icon} />
            </span>
            <span className="grow ellipsis">{s.name}</span>
            {done.has(s.id) ? (
              <span className="bot-servers-done small">
                <Icon icon={Check} size={16} />
                На сервере
              </span>
            ) : (
              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void add(s.id, s.name)}>
                Добавить
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
