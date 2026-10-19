import { Gamepad2, LogOut, Maximize2, Minimize2, Minus, Play, Rocket, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_GAMES, ActivityGame, gameById, onFrameMessage, peerInfo, sendFromFrame, useActivity } from '../lib/activity';
import { api, ApiError } from '../lib/api';
import { useCall } from '../lib/call';
import { useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Обложка игры — градиент её цветов и значок */
function Cover({ game, size = 'md' }: { game: ActivityGame; size?: 'sm' | 'md' }) {
  return (
    <span className={`act-cover ${size}`} style={{ background: `linear-gradient(135deg, ${game.cover[0]}, ${game.cover[1]})` }} aria-hidden="true">
      <Icon icon={Gamepad2} size={size === 'sm' ? 16 : 28} />
    </span>
  );
}

/** Кнопка «Активности» в панели голосового канала и звонка. channelId — голосовой канал или личка звонка */
export function ActivitiesButton({ btnClass, size = 22, channelId }: { btnClass: string; size?: number; channelId: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={btnClass} title="Активности" aria-label="Активности" aria-haspopup="dialog" disabled={!channelId} onClick={() => setOpen(true)}>
        <Icon icon={Rocket} anim="bounce" size={size} />
      </button>
      {open && channelId && <ActivitiesDialog channelId={channelId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ActivitiesDialog({ channelId, onClose }: { channelId: number; onClose: () => void }) {
  const start = useActivity((s) => s.start);
  return (
    <Modal title="Активности" onClose={onClose} className="activities-modal">
      <div className="stack">
        <p className="muted">Игры, в которые можно играть вместе, не выходя из звонка. Остальные увидят приглашение.</p>
        <div className="act-grid">
          {ACTIVITY_GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              className="act-card"
              onClick={() => {
                start(channelId, g.id);
                onClose();
              }}
            >
              <Cover game={g} />
              <strong>{g.name}</strong>
              <span className="muted small">{g.description}</span>
              <span className="act-players muted small">
                <Icon icon={Users} size={12} /> {g.players}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Куда отправлять итоги забега: личка/беседа звонка — туда же, голосовой канал — в первый текстовый канал сервера */
function shareChannel(ch: number): number {
  const s = useStore.getState();
  if (s.dms.some((d) => d.channel_id === ch) || s.groups.some((g) => g.id === ch)) return ch;
  for (const chs of Object.values(s.channelsByServer))
    if (chs.some((c) => c.id === ch)) return chs.find((c) => !c.is_voice)?.id ?? 0;
  return 0;
}

let lastShare = 0;

/** Запрос игры к мессенджеру (Net.api): рекорды, награды, таблица дня, «поделиться итогами» */
async function frameApi(game: string, channelId: number, kind: string, data: Record<string, unknown>): Promise<unknown> {
  switch (kind) {
    case 'me':
      return api.play.me(game);
    case 'result':
      return api.play.result(game, data);
    case 'cosmetic':
      return api.play.cosmetic(game, data);
    case 'daily':
      return api.play.daily(game, String(data.day ?? ''));
    case 'share': {
      const text = String(data.text ?? '').trim().slice(0, 400);
      const ch = shareChannel(channelId);
      if (!text || !ch) throw new ApiError(400, 'Некуда отправить');
      if (Date.now() - lastShare < 20000) throw new ApiError(429, 'Подождите немного');
      lastShare = Date.now();
      useStore.getState().sendMessage(ch, text, null);
      return { ok: true };
    }
  }
  throw new ApiError(400, 'Неизвестный запрос');
}

/** Окно игры поверх приложения: фрейм /activities/<id>/ и мост сообщений с сервером */
export function ActivityFrame() {
  const session = useActivity((s) => s.session);
  const leave = useActivity((s) => s.leave);
  const me = useStore((s) => s.me);
  const ref = useRef<HTMLIFrameElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<() => void>(() => undefined);
  const game = session ? gameById(session.game) : undefined;
  // Три состояния окна игры (5б/фаза 0):
  //  «в окне» — по центру поверх приложения;
  //  «на весь экран» — requestFullscreen, а где браузер не даёт (iPhone, WebView, Electron без поддержки) —
  //    окно растягивается на всё окно приложения с учётом safe-area; на телефоне игра сразу так;
  //  «свёрнуто» — слой прозрачный и не ловит нажатия, iframe живёт (не размонтируется и не перезагружается).
  const view = useActivity((s) => s.view);
  const setView = useActivity((s) => s.setView);
  const minimized = useActivity((s) => s.minimized);
  const setMinimized = useActivity((s) => s.setMinimized);
  const canFs = typeof document.documentElement.requestFullscreen === 'function';
  const focusGame = () => setTimeout(() => ref.current?.focus(), 60);
  useEffect(() => {
    const onChange = () => {
      // Esc вышел из полноэкранного режима (это делает браузер) — остаёмся в окне
      if (!document.fullscreenElement && !window.matchMedia('(max-width: 700px)').matches && !useActivity.getState().minimized)
        useActivity.getState().setView('window');
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enterFull = () => {
    setView('full');
    if (canFs && layerRef.current && !document.fullscreenElement) layerRef.current.requestFullscreen().catch(() => undefined);
  };
  const toWindow = () => {
    setView('window');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  };
  const toggleFull = () => {
    if (view === 'full') toWindow();
    else enterFull();
    focusGame();
  };
  const minimize = () => {
    // Полноэкранный режим скрытым быть не может — выходим из него, но «весь экран» помним для разворачивания
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    setMinimized(true);
  };
  // Развернуть (нажатие на плашку — жест пользователя, поэтому полноэкранный режим можно включить снова)
  useEffect(() => {
    restoreRef.current = () => {
      setMinimized(false);
      if (useActivity.getState().view === 'full') enterFull();
      focusGame();
    };
  });
  const isFull = view === 'full';
  // Свёрнутая игра не забирает фокус и нажатия — звонок и чат работают как обычно
  // (inert ставим вручную: в типах React 18 этого атрибута нет)
  useEffect(() => {
    layerRef.current?.toggleAttribute('inert', minimized);
  }, [minimized, session?.game]);

  useEffect(() => {
    if (!session) return;
    const post = (msg: unknown) => ref.current?.contentWindow?.postMessage(msg, '*');
    // Пока игра грузится, её сообщения (состояние ведущего, входы игроков) копятся — иначе пропали бы
    let ready = false;
    const queue: unknown[] = [];
    const off = onFrameMessage((msg) => (ready ? post(msg) : queue.push(msg)));
    const onMsg = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const m = e.data as { type?: string; data?: unknown; to?: number; id?: number; kind?: string } | null;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'send') sendFromFrame(m.data, typeof m.to === 'number' ? m.to : undefined);
      else if (m.type === 'api' && typeof m.id === 'number' && typeof m.kind === 'string') {
        const data = m.data && typeof m.data === 'object' ? (m.data as Record<string, unknown>) : {};
        frameApi(session.game, session.channelId, m.kind, data).then(
          (res) => post({ type: 'api_res', id: m.id, ok: true, data: res }),
          (err) => post({ type: 'api_res', id: m.id, ok: false, error: err instanceof Error ? err.message : 'Ошибка' }),
        );
      }
      else if (m.type === 'exit') useActivity.getState().leave();
      else if (m.type === 'ready') {
        ready = true;
        const s = useActivity.getState().session;
        if (s?.peerId) post({ type: 'init', self: peerInfo(s.peerId, useStore.getState().me?.user_id ?? 0), peers: s.peers });
        for (const q of queue.splice(0)) post(q);
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      off();
      window.removeEventListener('message', onMsg);
    };
    // Мост живёт, пока открыта эта игра
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.channelId, session?.game]);

  // Звонок закончился или вышли из голосового канала — игра закрывается
  const voiceCh = useVoice((s) => s.channelId);
  const callPeer = useCall((s) => (s.phase === 'idle' ? 0 : s.peerId));
  const dmCh = useStore((s) => (callPeer ? s.dms.find((d) => d.user_id === callPeer)?.channel_id ?? 0 : 0));
  useEffect(() => {
    if (session && session.channelId !== voiceCh && session.channelId !== dmCh) leave();
  }, [session, voiceCh, dmCh, leave]);

  if (!session || !game) return null;
  return (
    <div
      ref={layerRef}
      className={`act-layer${isFull ? ' full' : ''}${minimized ? ' min' : ''}`}
      role="dialog"
      aria-label={`Игра «${game.name}»`}
      aria-hidden={minimized || undefined}
      data-view={minimized ? 'min' : view}
    >
      <RestoreBridge restore={() => restoreRef.current()} />
      <div className="act-window">
        <header className="act-head" onDoubleClick={toggleFull} title="Двойной клик — весь экран / в окно">
          <Cover game={game} size="sm" />
          <strong>{game.name}</strong>
          <span className="act-peers">
            {me && <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={24} />}
            {session.peers.map((p) => (
              <span key={p.peerId} title={p.name}>
                <Avatar name={p.name} src={p.avatar} id={p.userId} size={24} />
              </span>
            ))}
          </span>
          <span className="muted small">{session.peerId ? `Игроков: ${session.peers.length + 1}` : 'Подключение…'}</span>
          <span className="grow" />
          <button type="button" className="btn small" onClick={minimize} title="Свернуть — игра продолжится" aria-label="Свернуть игру">
            <Icon icon={Minus} size={14} />
            <span className="act-btn-label">Свернуть</span>
          </button>
          <button
            type="button"
            className="btn small"
            onClick={toggleFull}
            aria-pressed={isFull}
            title={isFull ? 'В окно' : 'На весь экран'}
            aria-label={isFull ? 'В окно' : 'На весь экран'}
          >
            <Icon icon={isFull ? Minimize2 : Maximize2} size={14} />
            <span className="act-btn-label">{isFull ? 'В окно' : 'На весь экран'}</span>
          </button>
          <button type="button" className="btn small" onClick={leave} aria-label="Выйти из игры">
            <Icon icon={LogOut} size={14} />
            <span className="act-btn-label">Выйти из игры</span>
          </button>
        </header>
        <iframe
          ref={ref}
          className="act-frame"
          title={game.name}
          src={`/activities/${game.id}/index.html`}
          sandbox="allow-scripts allow-pointer-lock"
          // Клавиши сразу идут в игру
          onLoad={() => ref.current?.focus()}
          allow="autoplay"
        />
      </div>
    </div>
  );
}

let restoreGame: () => void = () => useActivity.getState().setMinimized(false);
/** Окно игры отдаёт плашке свою функцию «развернуть» (с полноэкранным режимом и фокусом в игру) */
function RestoreBridge({ restore }: { restore: () => void }) {
  useEffect(() => {
    restoreGame = restore;
    return () => {
      restoreGame = () => useActivity.getState().setMinimized(false);
    };
  });
  return null;
}

/** Плашка свёрнутой игры: «Переправа · идёт игра», значок, число игроков; нажатие — развернуть */
function MinimizedGame() {
  const session = useActivity((s) => s.session);
  const minimized = useActivity((s) => s.minimized);
  const game = session ? gameById(session.game) : undefined;
  if (!session || !game || !minimized) return null;
  const players = session.peerId ? session.peers.length + 1 : 1;
  return (
    <button type="button" className="act-mini" onClick={() => restoreGame()} aria-label={`${game.name}: идёт игра, игроков ${players}. Развернуть`}>
      <Cover game={game} size="sm" />
      <span className="grow">
        <strong>{game.name}</strong> · идёт игра
      </span>
      <span className="act-players muted small">
        <Icon icon={Users} size={12} /> {players}
      </span>
      <Icon icon={Maximize2} size={14} />
    </button>
  );
}

/** Приглашения в игру от тех, с кем вы сейчас в голосовом канале или звонке, и плашка свёрнутой игры */
export function ActivityInvites() {
  const invites = useActivity((s) => s.invites);
  const start = useActivity((s) => s.start);
  const dismiss = useActivity((s) => s.dismissInvite);
  const voiceCh = useVoice((s) => s.channelId);
  const callPeer = useCall((s) => (s.phase === 'idle' ? 0 : s.peerId));
  const dmCh = useStore((s) => (callPeer ? s.dms.find((d) => d.user_id === callPeer)?.channel_id ?? 0 : 0));
  const visible = invites.filter((i) => i.channelId === voiceCh || i.channelId === dmCh);
  const mini = useActivity((s) => !!s.session && s.minimized);
  if (!visible.length && !mini) return null;
  return (
    <div className="act-invites" aria-live="polite">
      <MinimizedGame />
      {visible.map((i) => {
        const g = gameById(i.game)!;
        return (
          <div key={i.channelId} className="act-invite">
            <Cover game={g} size="sm" />
            <span className="grow">
              <strong>{i.name}</strong> запустил(а) «{g.name}»
            </span>
            <button type="button" className="btn small primary" onClick={() => start(i.channelId, i.game)}>
              <Icon icon={Play} size={14} /> Играть
            </button>
            <button type="button" className="icon-btn small" aria-label="Не сейчас" onClick={() => dismiss(i.channelId)}>
              <Icon icon={X} size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
