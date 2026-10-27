import { ChevronDown, ChevronUp, Flame, Headphones, MessageSquare, Menu, Sparkles, UserPlus, Users, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, HomeData } from '../lib/api';
import { CHANGELOG } from '../lib/changelog';
import { useStore } from '../lib/store';
import { attentionCount } from '../lib/unread';
import { useVoice } from '../lib/voice';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/** Главная: сводка «Пока вас не было», статистика, кто сейчас в голосе, что ждёт ответа, что нового, кого добавить */
export function Home({ onMenu }: { onMenu: () => void }) {
  const me = useStore((s) => s.me)!;
  const open = useStore((s) => s.open);
  const showProfile = useStore((s) => s.showProfile);
  const toast = useStore((s) => s.toast);
  const dms = useStore((s) => s.dms);
  const groups = useStore((s) => s.groups);
  const servers = useStore((s) => s.servers);
  const channelsByServer = useStore((s) => s.channelsByServer);
  const unread = useStore((s) => s.unread);
  const mentions = useStore((s) => s.mentions);
  const invites = useStore((s) => s.invites);
  const incoming = useStore((s) => s.incoming);
  const attention = useStore(attentionCount);
  const join = useVoice((s) => s.join);
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .home()
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Нет связи с сервером'));
    void load();
    // Сводка и «сейчас» обновляются раз в минуту, пока экран открыт
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  // «Стоит внимания» — из того, что уже знает клиент: непрочитанные личные, упоминания, приглашения, заявки
  const unreadDms = dms.filter((d) => (unread[d.channel_id] ?? 0) > 0).slice(0, 4);
  const unreadGroups = groups.filter((g) => (unread[g.id] ?? 0) > 0).slice(0, 3);
  const mentioned = servers
    .flatMap((srv) => (channelsByServer[srv.id] ?? []).filter((c) => (mentions[c.id] ?? 0) > 0).map((c) => ({ srv, c })))
    .slice(0, 3);

  const openVoice = (v: HomeData['voice'][number]) => {
    if (v.kind === 'channel' && v.server_id) open({ kind: 'server', serverId: v.server_id, channelId: null });
    else if (v.kind === 'group') open({ kind: 'group', channelId: v.channel_id });
    else if (v.kind === 'dm') open({ kind: 'dm', channelId: v.channel_id });
    void join(v.channel_id);
  };
  const openChannel = (c: HomeData['channels'][number]) => {
    if (c.kind === 'channel' && c.server_id) open({ kind: 'server', serverId: c.server_id, channelId: c.channel_id });
    else if (c.kind === 'group') open({ kind: 'group', channelId: c.channel_id });
    else open({ kind: 'dm', channelId: c.channel_id });
  };
  const addFriend = async (id: number) => {
    try {
      await api.friendRequest(id);
      toast('Заявка отправлена');
      setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((s) => s.id !== id) } : d));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось отправить заявку', 'error');
    }
  };

  const stats = data?.stats;
  return (
    <div className="home-page" role="region" aria-label="Главная">
      <header className="chat-head home-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню">
          <Icon icon={Menu} size={20} />
        </button>
        <div className="chat-title">
          <strong>Главная</strong>
        </div>
        <div className="grow" />
        {attention > 0 && (
          <span className="home-attention" title="Личные сообщения и упоминания">
            {attention}
          </span>
        )}
      </header>
      <div className="home-body">
        <section className="home-hero" aria-label="Пока вас не было">
          <span className="home-kicker">{greeting}, {me.display_name}</span>
          <h1 className="display">Пока вас не было</h1>
          <div className={`home-digest${expanded ? ' open' : ''}`}>
            <Icon icon={Sparkles} size={18} className="home-digest-icon" />
            <div className="home-digest-text">
              {data ? (
                <p className={expanded ? '' : 'clamp'}>{data.digest.text}</p>
              ) : error ? (
                <p className="muted">{error}</p>
              ) : (
                <p className="muted">Собираем сводку…</p>
              )}
              {data && (
                <div className="home-digest-foot">
                  <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                    <Icon icon={expanded ? ChevronUp : ChevronDown} size={14} />
                    {expanded ? 'Свернуть' : 'Развернуть сводку'}
                  </button>
                  <span className="muted small">{data.digest.source === 'ai' ? 'сводку написал ИИ по фактам из ваших чатов' : `за ${data.window_hours} часа по фактам из ваших чатов`}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="home-stats" aria-label="Статистика за сутки">
          <Stat icon={MessageSquare} value={stats?.messages} label="сообщений за сутки" hint={stats ? `${stats.people} чел. писали` : ''} />
          <Stat icon={Volume2} value={stats?.voice_now} label="сейчас в голосе" hint={stats && stats.voice_now > 0 ? 'в ваших каналах' : 'тихо'} />
          <Stat icon={Users} value={stats?.friends_online} label="друзей в сети" hint={stats ? `из ${stats.friends}` : ''} />
          <Stat icon={Flame} value={stats?.streak} label="дней серии" hint={stats ? `${stats.voice_hours_total} ч в голосе всего` : ''} />
        </section>

        <div className="home-grid">
          <section className="home-card" aria-label="Сейчас">
            <h2 className="heading">Сейчас</h2>
            {!data ? (
              <span className="muted small">…</span>
            ) : data.voice.length === 0 && data.channels.length === 0 ? (
              <Empty icon={Headphones} text="В голосе никого, в чатах тихо." action="Позвать в голос" onAction={() => open({ kind: 'friends' })} />
            ) : (
              <ul className="home-list">
                {data.voice.map((v) => (
                  <li key={`v${v.channel_id}`} className="home-row">
                    <span className="home-row-icon live" aria-hidden="true">
                      <Icon icon={Volume2} size={16} />
                    </span>
                    <div className="home-row-text">
                      <strong className="ellipsis">{v.name}</strong>
                      <span className="muted small ellipsis">
                        {v.server_name ? `${v.server_name} · ` : ''}
                        {v.users.map((u) => u.name).join(', ')}
                      </span>
                    </div>
                    <button type="button" className="btn small primary" onClick={() => openVoice(v)}>
                      Зайти
                    </button>
                  </li>
                ))}
                {data.channels.slice(0, 4).map((c) => (
                  <li key={`c${c.channel_id}`} className="home-row">
                    <span className="home-row-icon" aria-hidden="true">
                      <Icon icon={MessageSquare} size={16} />
                    </span>
                    <div className="home-row-text">
                      <strong className="ellipsis">{c.kind === 'channel' ? `#${c.name}` : c.name}</strong>
                      <span className="muted small ellipsis">
                        {c.server_name ? `${c.server_name} · ` : ''}
                        {c.messages} новых{c.top_author ? ` · больше всех ${c.top_author}` : ''}
                      </span>
                    </div>
                    <button type="button" className="btn small" onClick={() => openChannel(c)}>
                      Открыть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="home-card" aria-label="Стоит внимания">
            <h2 className="heading">Стоит внимания</h2>
            {unreadDms.length + unreadGroups.length + mentioned.length + invites.length + incoming.length === 0 ? (
              <Empty icon={Sparkles} text="Всё прочитано, заявок нет." />
            ) : (
              <ul className="home-list">
                {incoming.length > 0 && (
                  <li className="home-row">
                    <span className="home-row-icon" aria-hidden="true">
                      <Icon icon={UserPlus} size={16} />
                    </span>
                    <div className="home-row-text">
                      <strong>Заявки в друзья: {incoming.length}</strong>
                      <span className="muted small ellipsis">{incoming.map((u) => u.display_name).join(', ')}</span>
                    </div>
                    <button type="button" className="btn small" onClick={() => open({ kind: 'friends' })}>
                      Ответить
                    </button>
                  </li>
                )}
                {invites.length > 0 && (
                  <li className="home-row">
                    <span className="home-row-icon" aria-hidden="true">
                      <Icon icon={Users} size={16} />
                    </span>
                    <div className="home-row-text">
                      <strong>Приглашения: {invites.length}</strong>
                      <span className="muted small">В беседы и на серверы</span>
                    </div>
                    <button type="button" className="btn small" onClick={() => open({ kind: 'friends' })}>
                      Посмотреть
                    </button>
                  </li>
                )}
                {unreadDms.map((d) => (
                  <li key={d.channel_id} className="home-row">
                    <Avatar name={d.display_name} src={d.avatar_path} id={d.user_id} size={32} />
                    <div className="home-row-text">
                      <strong className="ellipsis">{d.display_name}</strong>
                      <span className="muted small">{unread[d.channel_id]} непрочитанных</span>
                    </div>
                    <button type="button" className="btn small" onClick={() => open({ kind: 'dm', channelId: d.channel_id })}>
                      Открыть
                    </button>
                  </li>
                ))}
                {unreadGroups.map((g) => (
                  <li key={g.id} className="home-row">
                    <span className="home-row-icon" aria-hidden="true">
                      <Icon icon={Users} size={16} />
                    </span>
                    <div className="home-row-text">
                      <strong className="ellipsis">{g.name}</strong>
                      <span className="muted small">{unread[g.id]} непрочитанных</span>
                    </div>
                    <button type="button" className="btn small" onClick={() => open({ kind: 'group', channelId: g.id })}>
                      Открыть
                    </button>
                  </li>
                ))}
                {mentioned.map(({ srv, c }) => (
                  <li key={c.id} className="home-row">
                    <span className="home-row-icon mention" aria-hidden="true">
                      @
                    </span>
                    <div className="home-row-text">
                      <strong className="ellipsis">#{c.name}</strong>
                      <span className="muted small ellipsis">
                        {srv.name} · упоминаний: {mentions[c.id]}
                      </span>
                    </div>
                    <button type="button" className="btn small" onClick={() => open({ kind: 'server', serverId: srv.id, channelId: c.id })}>
                      Открыть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="home-card" aria-label="Что нового">
            <h2 className="heading">Что нового</h2>
            <ul className="home-list">
              {CHANGELOG.slice(0, 4).map((e) => (
                <li key={e.date + e.title} className="home-row news">
                  <div className="home-row-text">
                    <strong>{e.title}</strong>
                    <span className="muted small">{e.text}</span>
                  </div>
                  <time className="muted small" dateTime={e.date}>
                    {new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </time>
                </li>
              ))}
            </ul>
          </section>

          <section className="home-card" aria-label="Предложения">
            <h2 className="heading">Предложения</h2>
            {!data ? (
              <span className="muted small">…</span>
            ) : data.suggestions.length === 0 ? (
              <Empty icon={UserPlus} text="Вступите на сервер — здесь появятся люди с общих серверов." />
            ) : (
              <ul className="home-list">
                {data.suggestions.map((u) => (
                  <li key={u.id} className="home-row">
                    <button type="button" className="home-row-avatar" onClick={() => showProfile(u.id)} aria-label={`Профиль: ${u.display_name}`}>
                      <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
                    </button>
                    <div className="home-row-text">
                      <strong className="ellipsis">{u.display_name}</strong>
                      <span className="muted small">
                        {u.shared_servers === 1 ? 'общий сервер' : `общих серверов: ${u.shared_servers}`}
                      </span>
                    </div>
                    <button type="button" className="btn small" onClick={() => void addFriend(u.id)}>
                      В друзья
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, value, label, hint }: { icon: typeof MessageSquare; value: number | undefined; label: string; hint: string }) {
  return (
    <div className="home-stat">
      <span className="home-stat-icon" aria-hidden="true">
        <Icon icon={icon} size={18} />
      </span>
      <span className="home-stat-value">{value ?? '—'}</span>
      <span className="home-stat-label">{label}</span>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

function Empty({ icon, text, action, onAction }: { icon: typeof MessageSquare; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="home-empty">
      <Icon icon={icon} size={22} />
      <span className="muted small">{text}</span>
      {action && onAction && (
        <button type="button" className="btn small" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
