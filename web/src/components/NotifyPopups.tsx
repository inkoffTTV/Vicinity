// Всплывающие уведомления в приложении (lib/popups.ts): баннер о сообщении в другом чате.
// Щелчок открывает чат на сообщении; скрывается сам через 5 с (пауза, пока наведён курсор или фокус внутри),
// закрывается крестиком или свайпом вбок. Фокус не перехватывает: регион только объявляет о новом.
import { X } from 'lucide-react';
import { MouseEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import { Popup, POPUP_TTL, setPopupSurface, usePopups } from '../lib/popups';
import { activeChannelId, useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { useVoiceVideo } from '../lib/voiceVideo';
import { useWebApp } from '../lib/webapp';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

// Свайп дальше этого (px) закрывает баннер
const SWIPE_CLOSE = 72;
// Мини-приложение на телефоне занимает весь экран (WebAppPanel): баннеры закрыли бы его шапку
const FULLSCREEN = '(max-width: 600px)';

const stageShown = () => useVoiceVideo.getState().stageOpen && useVoice.getState().channelId !== null;
const appFullscreen = () => !!useWebApp.getState().app && window.matchMedia(FULLSCREEN).matches;

// Что видно на экране: чат под настройками или сценой звонка не считается открытым
setPopupSurface(() => ({ chatHidden: useStore.getState().settingsOpen || stageShown(), blocked: appFullscreen() }));

export function NotifyPopups() {
  const list = usePopups((s) => s.list);
  const overflow = usePopups((s) => s.overflow);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const stageOpen = useVoiceVideo((s) => s.stageOpen);
  const inVoice = useVoice((s) => s.channelId !== null);
  const stage = stageOpen && inVoice;
  const active = useStore((s) => activeChannelId(s.view));
  const shown = settingsOpen || stage ? null : active;
  const me = useStore((s) => s.me?.user_id);
  const webapp = useWebApp((s) => !!s.app);
  // Откуда фокус пришёл в стопку с клавиатуры — туда он вернётся, когда закроют последний баннер
  const cameFrom = useRef<HTMLElement | null>(null);
  const restoreFocus = () => {
    const back = cameFrom.current;
    if (back?.isConnected) back.focus();
  };

  // Чат открыли сами (и он на экране, а не под настройками) — его баннер больше не нужен
  useEffect(() => {
    const hit = shown !== null && usePopups.getState().list.find((p) => p.channelId === shown);
    if (hit) usePopups.getState().dismiss(hit.id);
  }, [shown, list]);
  // Мини-приложение открылось на весь экран телефона — баннеры не перекрывают его шапку
  useEffect(() => {
    if (webapp && appFullscreen()) usePopups.getState().clear();
  }, [webapp]);
  // Вышли из аккаунта или вошёл другой — чужие баннеры убираем
  useEffect(() => () => usePopups.getState().clear(), [me]);

  return (
    <div
      className="notify-popups"
      role="status"
      aria-live="polite"
      aria-label="Уведомления о сообщениях"
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cameFrom.current = e.relatedTarget as HTMLElement | null;
      }}
    >
      {list.map((p) => (
        <PopupCard key={p.id} p={p} restoreFocus={restoreFocus} />
      ))}
      {overflow > 0 && list.length > 0 && (
        <div className="notify-popups-more">
          <span>И ещё {overflow}</span>
          <button type="button" className="link-btn" onClick={() => usePopups.getState().clear()}>
            Скрыть все
          </button>
        </div>
      )}
    </div>
  );
}

function PopupCard({ p, restoreFocus }: { p: Popup; restoreFocus: () => void }) {
  const dismiss = usePopups((s) => s.dismiss);
  const card = useRef<HTMLDivElement>(null);
  // Отсчёт заново: курсор ушёл, фокус ушёл, палец отпустил
  const [restart, setRestart] = useState(0);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);

  // Автоскрытие через 5 с; пока баннер под курсором, в фокусе или под пальцем — ждёт ещё. Состояние «держат» не
  // считаем событиями: при перестановке стопки браузер теряет фокус без blur, и счётчик бы завис
  useEffect(() => {
    let t = 0;
    const arm = () => {
      t = window.setTimeout(() => {
        if (drag.current || card.current?.matches(':hover, :focus-within')) arm();
        else dismiss(p.id);
      }, POPUP_TTL);
    };
    arm();
    return () => window.clearTimeout(t);
  }, [restart, p.id, p.stamp, dismiss]);
  const again = () => setRestart((n) => n + 1);

  const open = () => {
    dismiss(p.id);
    // Чат откроется под настройками, сценой звонка или мини-приложением на весь экран — их закрываем
    useStore.getState().setSettingsOpen(false);
    useVoiceVideo.getState().closeStage();
    if (appFullscreen()) useWebApp.getState().close();
    p.open();
  };

  // Закрыли с клавиатуры — фокус не падает в body: на соседний баннер или туда, откуда пришёл
  const close = (e: MouseEvent) => {
    const keyboard = e.detail === 0;
    const el = card.current;
    const next = el?.nextElementSibling?.querySelector<HTMLElement>('.notify-popup-open') ?? el?.previousElementSibling?.querySelector<HTMLElement>('.notify-popup-open');
    dismiss(p.id);
    if (!keyboard) return;
    if (next) next.focus();
    else restoreFocus();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX - d.x;
    if (!d.moved && Math.abs(x) > 8 && Math.abs(x) > Math.abs(e.clientY - d.y)) {
      d.moved = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* указатель уже отпущен — свайп доведём без захвата */
      }
    }
    if (d.moved) setDx(x);
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    again();
    if (Math.abs(e.clientX - d.x) > SWIPE_CLOSE && d.moved) return dismiss(p.id);
    setDx(0);
  };

  const more = p.count > 1 ? ` · ${p.count} ${plural(p.count)}` : '';
  return (
    <div
      ref={card}
      className={`notify-popup${p.mentioned ? ' mention' : ''}${dx ? ' dragging' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 240) } : undefined}
      onMouseLeave={again}
      onBlur={(e) => {
        if (!card.current?.contains(e.relatedTarget as Node | null)) again();
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <button
        type="button"
        className="notify-popup-open"
        onClick={(e) => {
          if (dx) return e.preventDefault();
          open();
        }}
        aria-label={`${p.authorName}, ${p.where}${more}: ${p.text}. Открыть чат`}
      >
        <Avatar name={p.authorName} src={p.avatar || undefined} id={p.authorId} size={40} />
        <span className="notify-popup-body">
          <span className="notify-popup-head">
            <span className="notify-popup-name">{p.authorName}</span>
            <span className="notify-popup-where">
              {p.where}
              {more}
            </span>
          </span>
          <span className="notify-popup-text">{p.text}</span>
        </span>
      </button>
      <button type="button" className="notify-popup-close icon-btn" aria-label="Закрыть уведомление" title="Закрыть" onClick={close}>
        <Icon icon={X} size={16} />
      </button>
    </div>
  );
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'сообщение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сообщения';
  return 'сообщений';
}
