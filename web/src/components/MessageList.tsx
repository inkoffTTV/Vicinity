import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Message, parseTs } from '../lib/api';
import { canManagePins, usePins } from '../lib/pins';
import { useStore } from '../lib/store';
import { MessageRow } from './Message';
import { Modal } from './Modal';

// Сообщения одного автора подряд с промежутком меньше этого — одной группой
const GROUP_GAP = 5 * 60_000;
// Ближе этого к низу — лента «прилипает» к новым сообщениям
const STICK_ZONE = 120;
// У самого низа: последнее сообщение на экране — канал прочитан
const READ_ZONE = 40;

const smooth = (): ScrollBehavior =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const newestId = (list: Message[] | undefined) => (list ?? []).reduce((a, m) => (m.local ? a : Math.max(a, m.id)), 0);

export function MessageList({ channelId }: { channelId: number }) {
  const messages = useStore((s) => s.messages[channelId]);
  const loading = useStore((s) => !!s.loadingChannel[channelId]);
  const hasMore = useStore((s) => s.hasMore[channelId]);
  const hasNewer = useStore((s) => !!s.hasNewer[channelId]);
  const loadingOlder = useStore((s) => !!s.loadingOlder[channelId]);
  const loadingNewer = useStore((s) => !!s.loadingNewer[channelId]);
  const loadOlder = useStore((s) => s.loadOlder);
  const loadNewer = useStore((s) => s.loadNewer);
  const jumpToPresent = useStore((s) => s.jumpToPresent);
  const markRead = useStore((s) => s.markRead);
  const focus = useStore((s) => (s.focusMessage?.channelId === channelId ? s.focusMessage : null));
  const opened = useStore((s) => (s.unreadAtOpen?.channelId === channelId ? s.unreadAtOpen : null));
  const meId = useStore((s) => s.me!.user_id);
  const canModerate = useStore((s) => {
    const v = s.view;
    return v.kind === 'server' && s.servers.find((x) => x.id === v.serverId)?.owner_id === s.me?.user_id;
  });
  const pins = usePins((s) => s.byChannel[channelId]);
  const canPin = pins !== undefined && canManagePins(channelId);
  const pinned = useMemo(() => new Set((pins ?? []).map((p) => p.id)), [pins]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Позиция от низа до подгрузки старых сообщений — чтобы видимое не прыгало
  const anchor = useRef<{ firstId: number; fromBottom: number } | null>(null);
  const lastRef = useRef<Message>();
  const focusDone = useRef(0);
  const openedDone = useRef<object | null>(null);
  // Последнее сообщение, которое было на экране, когда вкладку скрыли
  const seenBeforeHide = useRef<number | null>(null);
  const readTimer = useRef<number>();
  // Пролистали дальше экрана вверх — показать «Перейти к последним»
  const [scrolledAway, setScrolledAway] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [firstUnread, setFirstUnread] = useState<number | null>(null);
  const [unreadAbove, setUnreadAbove] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // На тач-экране панель действий открывается тапом по одному сообщению
  const [tapped, setTapped] = useState<number | null>(null);

  useEffect(() => {
    void usePins.getState().load(channelId);
  }, [channelId]);

  // Прочитано, когда последнее сообщение на экране и вкладка видна (с задержкой: не на каждый пиксель прокрутки)
  const scheduleRead = useCallback(() => {
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el || document.hidden || useStore.getState().hasNewer[channelId]) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= READ_ZONE) markRead(channelId);
    }, 400);
  }, [channelId, markRead]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) seenBeforeHide.current = newestId(useStore.getState().messages[channelId]);
      else {
        seenBeforeHide.current = null;
        scheduleRead();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', scheduleRead);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', scheduleRead);
      window.clearTimeout(readTimer.current);
    };
  }, [channelId, scheduleRead]);

  // Черта «Новые»: при открытии — перед первым из непрочитанных; пока вкладка скрыта — перед первым пришедшим
  useEffect(() => {
    if (!messages) return;
    // В окне старой истории (переход к сообщению) черту по счётчику не ставим — там не последние сообщения
    if (opened && opened.count > 0 && !loading && !hasNewer && openedDone.current !== opened) {
      openedDone.current = opened;
      const others = messages.filter((m) => !m.local && m.author_id !== meId);
      setFirstUnread(others[Math.max(0, others.length - opened.count)]?.id ?? null);
    }
    const seen = seenBeforeHide.current;
    if (document.hidden && seen !== null && firstUnread === null) {
      const first = messages.find((m) => !m.local && m.id > seen && m.author_id !== meId);
      if (first) setFirstUnread(first.id);
    }
    scheduleRead();
  }, [messages, opened, loading, hasNewer, meId, firstUnread, scheduleRead]);

  const older = () => {
    const el = scrollRef.current;
    if (!el || !messages?.length || hasMore !== true || loadingOlder) return;
    anchor.current = { firstId: messages[0].id, fromBottom: el.scrollHeight - el.scrollTop };
    void loadOlder(channelId);
  };

  const updateUnreadAbove = () => {
    const el = scrollRef.current;
    const sep = el?.querySelector<HTMLElement>('.unread-sep');
    setUnreadAbove(!!el && !!sep && sep.offsetTop + sep.offsetHeight < el.scrollTop);
  };

  const onScroll = () => {
    const el = scrollRef.current!;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // В окне старой истории не прилипаем: внизу ещё не самые новые сообщения
    stick.current = fromBottom < STICK_ZONE && !hasNewer;
    setScrolledAway(fromBottom > el.clientHeight);
    if (el.scrollTop < 200) older();
    if (hasNewer && fromBottom < 300) void loadNewer(channelId);
    updateUnreadAbove();
    scheduleRead();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !messages) return;
    // Своё новое сообщение — всегда прокручиваем к нему, даже если листали историю
    const last = messages[messages.length - 1];
    if (last !== lastRef.current && last?.local === 'sending') stick.current = true;
    lastRef.current = last;
    // Переход к сообщению (ответ, закреп, поиск): к нему и подсветить
    if (focus && focusDone.current !== focus.key) {
      const target = el.querySelector<HTMLElement>(`[data-mid="${focus.id}"]`);
      if (target) {
        focusDone.current = focus.key;
        stick.current = false;
        anchor.current = null;
        target.scrollIntoView({ block: 'center', behavior: smooth() });
        // Повторный переход к тому же сообщению снова запускает подсветку
        setFlash(null);
        requestAnimationFrame(() => setFlash(focus.id));
        return;
      }
    }
    const a = anchor.current;
    if (a && messages.length && messages[0].id !== a.firstId) {
      el.scrollTop = el.scrollHeight - a.fromBottom;
      anchor.current = null;
    } else {
      if (!loadingOlder) anchor.current = null;
      if (stick.current) el.scrollTop = el.scrollHeight;
    }
    // Снизу догрузились сообщения — кнопка «к последним» по новому расстоянию до низа
    setScrolledAway(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
    updateUnreadAbove();
  }, [messages, loadingOlder, focus, firstUnread]);

  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Поле ввода растёт, появляется превью вложения, открывается клавиатура — низ ленты остаётся на виду
  const mounted = !!messages;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  // Картинки и видео догружаются позже — держим низ, пока пользователь не листает вверх
  const onMediaLoad = () => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  };

  const toPresent = () => {
    stick.current = true;
    setScrolledAway(false);
    setFlash(null);
    if (hasNewer) void jumpToPresent(channelId);
    else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth() });
  };

  const toFirstUnread = () =>
    scrollRef.current?.querySelector('.unread-sep')?.scrollIntoView({ block: 'start', behavior: smooth() });

  if (!messages) return <div className="messages center muted">{loading ? 'Загрузка…' : ''}</div>;

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scrollRef} onScroll={onScroll} role="log" aria-label="Сообщения">
        {messages.length === 0 && <div className="empty-state">Здесь пока пусто — напишите первым!</div>}
        {hasMore === true && (
          <div className="history-note">
            <button className="link-btn small" onClick={older} disabled={loadingOlder}>
              {loadingOlder ? 'Загрузка…' : 'Показать более ранние сообщения'}
            </button>
          </div>
        )}
        {hasMore == null && messages.length >= 50 && (
          <div className="history-note muted small">Показаны последние 50 сообщений</div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const d = parseTs(m.created_at);
          const newDay = !prev || parseTs(prev.created_at).toDateString() !== d.toDateString();
          const unreadHere = m.id === firstUnread;
          // Ответ всегда с заголовком автора — к нему крепится цитата
          const grouped =
            !newDay &&
            !unreadHere &&
            !m.reply_to &&
            prev.author_id === m.author_id &&
            d.getTime() - parseTs(prev.created_at).getTime() < GROUP_GAP;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day-sep" role="separator">
                  <span>{d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              )}
              {unreadHere && (
                <div className="unread-sep" role="separator" aria-label="Новые сообщения">
                  <span>Новые</span>
                </div>
              )}
              <MessageRow
                msg={m}
                grouped={grouped}
                tapped={tapped === m.id}
                onTap={() => setTapped((t) => (t === m.id ? null : m.id))}
                onImage={setLightbox}
                onMediaLoad={onMediaLoad}
                flash={flash === m.id}
                canModerate={canModerate}
                canPin={canPin}
                pinned={pinned.has(m.id)}
              />
            </Fragment>
          );
        })}
        {hasNewer && (
          <div className="history-note">
            <button className="link-btn small" onClick={() => void loadNewer(channelId)} disabled={loadingNewer}>
              {loadingNewer ? 'Загрузка…' : 'Показать более новые сообщения'}
            </button>
          </div>
        )}
      </div>
      {unreadAbove && (
        <button className="unread-pill" onClick={toFirstUnread}>
          Новые сообщения ↑
        </button>
      )}
      {(hasNewer || scrolledAway) && messages.length > 0 && (
        <div className="jump-present">
          <span className="ellipsis">Вы просматриваете старые сообщения</span>
          <button className="link-btn" onClick={toPresent}>
            Перейти к последним ↓
          </button>
        </div>
      )}
      {lightbox && (
        <Modal onClose={() => setLightbox(null)} bare>
          <img className="lightbox" src={lightbox} alt="" onClick={() => setLightbox(null)} />
        </Modal>
      )}
    </div>
  );
}
