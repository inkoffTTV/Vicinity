import { AppWindow, AudioLines, Bell, BellOff, Hash, Menu, NotebookPen, Phone, PhoneOff, Pin, Play, UserPlus, Users, Wallpaper } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, BLOCKS_CHANGED, BotCard, MenuButton } from '../lib/api';
import { useBots } from '../lib/bots';
import { useBotStart } from '../lib/botStart';
import { useCall } from '../lib/call';
import { useChannelMembers } from '../lib/channelMembers';
import { useNotifySettings } from '../lib/notify';
import { activeChannelId, useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { useVoice } from '../lib/voice';
import { useWebApp } from '../lib/webapp';
import { socket, WsEvent } from '../lib/ws';
import { AddMemberDialog } from './AddMemberDialog';
import { ChatBgDialog } from './ChatBackground';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { MessageList } from './MessageList';
import { NotifyMenu } from './NotifyMenu';
import { PinsPanel } from './PinsPanel';
import { SearchBox } from './Search';
import { VoiceRoom } from './VoiceRoom';

interface Props {
  onMenu: () => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
}

export function Chat({ onMenu, membersOpen, onToggleMembers }: Props) {
  const view = useStore((s) => s.view);
  const channelId = activeChannelId(view);
  const dm = useStore((s) => (view.kind === 'dm' ? s.dms.find((d) => d.channel_id === view.channelId) : undefined));
  const group = useStore((s) => (view.kind === 'group' ? s.groups.find((g) => g.id === view.channelId) : undefined));
  const serverChannel = useStore((s) =>
    view.kind === 'server' ? (s.channelsByServer[view.serverId] ?? []).find((c) => c.id === view.channelId) : undefined,
  );
  const presence = useStore((s) => (dm ? s.presence[dm.user_id] : undefined));
  const showProfile = useStore((s) => s.showProfile);
  const callIdle = useCall((s) => s.phase === 'idle');
  const startCall = useCall((s) => s.start);
  const inGroupRoom = useVoice((s) => group !== undefined && s.channelId === group.id);
  const joinVoice = useVoice((s) => s.join);
  const leaveVoice = useVoice((s) => s.leave);
  const [adding, setAdding] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  // Фон канала сервера меняет только владелец; в личке и беседе фон — личный
  const amOwner = useStore((s) => view.kind === 'server' && s.servers.find((x) => x.id === view.serverId)?.owner_id === s.me?.user_id);
  const [panel, setPanel] = useState<'pins' | 'notify' | null>(null);
  const pinsBtn = useRef<HTMLButtonElement>(null);
  const notifyBtn = useRef<HTMLButtonElement>(null);
  const muted = useNotifySettings((s) => channelId !== null && s.muted.includes(channelId));
  const serverId = view.kind === 'server' ? view.serverId : null;

  // Участники беседы — для @упоминаний в ленте и подсказок в поле ввода
  useEffect(() => {
    if (group) void useChannelMembers.getState().load(group.id);
  }, [group?.id]);

  // Сменился канал — панели прежнего закрываются
  useEffect(() => setPanel(null), [channelId]);

  // Кнопка меню бота (setChatMenuButton, docs/API.md §21.8): мини-приложение открывается из шапки лички с ботом
  const [menu, setMenu] = useState<MenuButton | null>(null);
  const botId = dm?.is_bot && !dm.notes ? dm.user_id : null;
  useEffect(() => {
    setMenu(null);
    if (botId === null || channelId === null) return;
    let alive = true;
    let req = 0;
    const load = () => {
      const n = ++req;
      api
        .botMenuButton(botId, channelId)
        .then((m) => alive && n === req && setMenu(m))
        .catch(() => undefined); // старый сервер или нет доступа — просто без кнопки
    };
    load();
    // Бот поменял кнопку (setChatMenuButton, обычно в ответ на /start) — шапка обновляется сразу
    const off = socket.on((ev: WsEvent) => {
      if (ev.type === 'bot_menu_button_changed' && ev.bot_id === botId && (ev.channel_id === 0 || ev.channel_id === channelId)) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [botId, channelId]);

  // Личка с ботом, которому вы ещё не писали (docs/API.md §21.9): карточка бота над лентой и «Начать» вместо поля ввода
  const [botCard, setBotCard] = useState<BotCard | null>(null);
  const [botGone, setBotGone] = useState(false);
  // Карточка загрузилась или запрос завершился ошибкой; до этого — ни поля ввода, ни «Начать» (без мигания)
  const [botSettled, setBotSettled] = useState(false);
  const [composeAnyway, setComposeAnyway] = useState(false);
  const [pressed, setPressed] = useState(false);
  const botUsername = botId !== null ? dm?.username ?? null : null;
  useEffect(() => {
    setBotCard(null);
    setBotGone(false);
    setBotSettled(false);
    setComposeAnyway(false);
    setPressed(false);
    if (!botUsername) return;
    let alive = true;
    const load = () =>
      api.botCard(botUsername).then(
        (c) => {
          if (!alive) return;
          setBotCard(c);
          setBotGone(false);
          setBotSettled(true);
        },
        (e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 404) setBotGone(true);
          setBotSettled(true);
        },
      );
    void load();
    // Разблокировали или заблокировали бота из профиля поверх лички — подсказка и «Начать» обновляются сразу
    window.addEventListener(BLOCKS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(BLOCKS_CHANGED, load);
    };
  }, [botUsername, channelId]);
  const wroteHere = useStore((s) => channelId !== null && !!s.messages[channelId]?.some((m) => m.author_id === s.me?.user_id));
  // Нажатие кнопки бота тоже считается началом разговора
  const pressing = useBots((s) => channelId !== null && Object.keys(s.pending).some((k) => k.startsWith(`${channelId}:`)));
  useEffect(() => {
    if (pressing) setPressed(true);
  }, [pressing]);
  const fresh = !!botCard && !botCard.dm_started && !wroteHere && !pressed;
  // Пришли по ссылке /bots/<имя>?start=<payload>: «Начать» нужна и в начатом диалоге, чтобы бот получил /start <payload>
  const payload = useBotStart((s) => (botUsername ? s.payloads[botUsername.toLowerCase()] : undefined));
  const showStart = !!botCard && !botCard.blocked && !composeAnyway && (fresh || !!payload);
  const botLoading = botUsername !== null && !botSettled;
  const start = () => {
    if (!dm || channelId === null) return;
    useStore.getState().sendMessage(channelId, useBotStart.getState().take(dm.username), null, null);
  };

  let title = '';
  let placeholder = '';
  if (dm?.notes) {
    title = 'Заметки';
    placeholder = 'Заметка для себя';
  } else if (dm) {
    title = dm.display_name;
    placeholder = `Написать @${dm.display_name}`;
  } else if (group) {
    title = group.name;
    placeholder = `Написать в «${group.name}»`;
  } else if (serverChannel) {
    title = serverChannel.name;
    placeholder = `Написать в #${serverChannel.name}`;
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню" title="Меню">
          <Icon icon={Menu} size={24} />
        </button>
        {dm?.notes ? (
          <div className="chat-title">
            <Icon icon={NotebookPen} size={20} className="chat-title-icon" />
            <strong className="ellipsis">Заметки</strong>
          </div>
        ) : dm ? (
          <button className="chat-title clickable" onClick={() => showProfile(dm.user_id)} {...userMenuProps(dm.user_id)}>
            <Avatar name={dm.display_name} src={dm.avatar_path} id={dm.user_id} size={26} presence={dm.is_bot ? undefined : presence ?? 'offline'} />
            <strong className="ellipsis">{dm.display_name}</strong>
            {dm.is_bot && <span className="bot-tag">Бот</span>}
          </button>
        ) : (
          <div className="chat-title">
            <Icon icon={Hash} size={20} className="chat-title-icon" />
            <strong className="ellipsis">{title}</strong>
          </div>
        )}
        <div className="grow" />
        {dm && menu?.type === 'web_app' && menu.web_app && (
          <button
            className="btn small primary webapp-open"
            aria-label={`Открыть мини-приложение: ${menu.text ?? ''}`}
            title={`Открыть мини-приложение: ${menu.text ?? ''}`}
            onClick={() =>
              useWebApp.getState().open({ botId: dm.user_id, botName: dm.display_name, url: menu.web_app!.url, channelId: dm.channel_id })
            }
          >
            <Icon icon={AppWindow} size={14} />
            <span className="ellipsis">{menu.text}</span>
          </button>
        )}
        {/* Боту не позвонить: голоса у него нет */}
        {dm && !dm.notes && !dm.is_bot && (
          <button
            className="icon-btn"
            title="Позвонить"
            aria-label="Позвонить"
            disabled={!callIdle}
            onClick={() => void startCall(dm.user_id, dm.display_name)}
          >
            <Icon icon={Phone} anim="ring" />
          </button>
        )}
        {group && (
          <button
            className={`icon-btn${inGroupRoom ? ' on' : ''}`}
            title={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-label={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-pressed={inGroupRoom}
            onClick={() => (inGroupRoom ? leaveVoice() : void joinVoice(group.id))}
          >
            <Icon icon={inGroupRoom ? PhoneOff : AudioLines} anim={inGroupRoom ? 'ring' : 'wiggle'} />
          </button>
        )}
        {(view.kind === 'group' || view.kind === 'server') && (
          <button className="icon-btn" title="Добавить участника" aria-label="Добавить участника" onClick={() => setAdding(true)}>
            <Icon icon={UserPlus} anim="bounce" />
          </button>
        )}
        {channelId !== null && (dm || group || amOwner) && (
          <button className="icon-btn" title="Фон чата" aria-label="Фон чата" onClick={() => setBgOpen(true)}>
            <Icon icon={Wallpaper} />
          </button>
        )}
        {(view.kind === 'server' || view.kind === 'group') && (
          <button
            className={`icon-btn${membersOpen ? ' on' : ''}`}
            title="Участники"
            aria-label="Участники"
            aria-pressed={membersOpen}
            onClick={onToggleMembers}
          >
            <Icon icon={Users} anim="bounce" />
          </button>
        )}
        {channelId && (
          <>
            <button
              ref={pinsBtn}
              className={`icon-btn${panel === 'pins' ? ' on' : ''}`}
              title="Закреплённые сообщения"
              aria-label="Закреплённые сообщения"
              aria-haspopup="dialog"
              aria-expanded={panel === 'pins'}
              onClick={() => setPanel((p) => (p === 'pins' ? null : 'pins'))}
            >
              <Icon icon={Pin} anim="wiggle" />
            </button>
            <button
              ref={notifyBtn}
              className={`icon-btn${panel === 'notify' ? ' on' : ''}${muted ? ' muted-bell' : ''}`}
              title={muted ? 'Уведомления канала выключены' : 'Уведомления'}
              aria-label="Уведомления"
              aria-haspopup="menu"
              aria-expanded={panel === 'notify'}
              onClick={() => setPanel((p) => (p === 'notify' ? null : 'notify'))}
            >
              <Icon key={muted ? 'off' : 'on'} icon={muted ? BellOff : Bell} anim="pop" />
            </button>
          </>
        )}
        <SearchBox />
      </header>
      {(dm || group) && channelId && <VoiceRoom channelId={channelId} />}
      {channelId ? (
        <>
          <MessageList
            key={channelId}
            channelId={channelId}
            intro={fresh && botCard ? <BotIntro card={botCard} canStart={showStart} /> : botLoading ? null : undefined}
          />
          {botGone && <p className="bot-start-note small bot-gone">Бот недоступен: его отключили или удалили. Сообщения ему не дойдут.</p>}
          {botCard?.blocked && (
            <p className="bot-start-note small">Вы заблокировали этого бота — разблокируйте его в профиле, чтобы написать.</p>
          )}
          {botLoading ? (
            <div className="bot-start" aria-busy="true">
              <div className="bot-start-wait" />
            </div>
          ) : showStart ? (
            <div className="bot-start">
              <button type="button" className="btn primary bot-start-btn" onClick={start}>
                <Icon icon={Play} size={16} />
                Начать
              </button>
              <button type="button" className="link-btn small" onClick={() => setComposeAnyway(true)}>
                Написать своё сообщение
              </button>
            </div>
          ) : (
            <Composer key={`c${channelId}`} channelId={channelId} placeholder={placeholder} autoFocus={!pressed} />
          )}
        </>
      ) : (
        <div className="empty-state">В этом сервере пока нет текстовых каналов</div>
      )}
      {bgOpen && channelId !== null && (
        <ChatBgDialog channelId={channelId} mode={serverChannel ? 'channel' : 'personal'} canPropose={!!dm || !!group} onClose={() => setBgOpen(false)} />
      )}
      {adding && view.kind === 'group' && (
        <AddMemberDialog target={{ kind: 'group', channelId: view.channelId }} onClose={() => setAdding(false)} />
      )}
      {adding && view.kind === 'server' && (
        <AddMemberDialog target={{ kind: 'server', serverId: view.serverId }} onClose={() => setAdding(false)} />
      )}
      {panel === 'pins' && channelId && pinsBtn.current && (
        <PinsPanel channelId={channelId} anchor={pinsBtn.current} onClose={() => setPanel(null)} />
      )}
      {panel === 'notify' && channelId && notifyBtn.current && (
        <NotifyMenu channelId={channelId} serverId={serverId} anchor={notifyBtn.current} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

/** Карточка бота над пустой личкой: кто это, что умеет, какие команды знает */
function BotIntro({ card, canStart }: { card: BotCard; canStart: boolean }) {
  return (
    <section className="bot-intro" aria-label={`О боте ${card.display_name}`}>
      <Avatar name={card.display_name} src={card.avatar_path} id={card.id} size={64} />
      <strong className="bot-intro-name">
        <span className="ellipsis">{card.display_name}</span>
        <span className="bot-tag">Бот</span>
      </strong>
      <span className="muted small">@{card.username}</span>
      <div className="bot-intro-block">
        <h3>Что умеет этот бот?</h3>
        <p className="bot-intro-desc">
          {card.description ||
            card.short_description ||
            (canStart ? 'Бот пока ничего о себе не рассказал. Нажмите «Начать», чтобы узнать.' : 'Бот пока ничего о себе не рассказал.')}
        </p>
      </div>
      {card.commands.length > 0 && (
        <div className="bot-intro-block">
          <h3>Команды</h3>
          <ul className="bot-commands small">
            {card.commands.map((c) => (
              <li key={c.command}>
                <code>/{c.command}</code>
                <span className="muted">{c.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
