import { AppWindow, ArrowLeft, ExternalLink, RotateCw, Settings2, TriangleAlert, X } from 'lucide-react';
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, WebAppLaunch } from '../lib/api';
import { safeUrl, useBots } from '../lib/bots';
import { desktop } from '../lib/desktop';
import { contrast, isHex, sameOriginApp, themeParams, useWebApp, WebAppTarget, webAppUrl } from '../lib/webapp';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Modal } from './Modal';

// Мини-приложение бота (docs/API.md §21.8): окно с iframe и протокол telegram-web-app.js — JSON {eventType, eventData}
// через postMessage. Принимаем только от окна этого iframe (его origin может смениться редиректом, например на www.),
// отвечаем на origin, с которого оно последним написало; страницы с origin самого Vicinity не слушаем вовсе.

/** Кнопка внизу панели (MainButton / SecondaryButton) */
interface BottomButton {
  text: string;
  active: boolean;
  progress: boolean;
  color?: string;
  textColor?: string;
}

type PopupKind = 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
interface Popup {
  title: string;
  message: string;
  buttons: { id: string; type: PopupKind; text: string }[];
}

type Data = Record<string, unknown>;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const POPUP_LABEL: Partial<Record<PopupKind, string>> = { ok: 'OK', close: 'Закрыть', cancel: 'Отмена' };

// Не больше стольких событий в секунду от мини-приложения, попапов — за 10 с, ссылок — раз в секунду
const EVENTS_PER_SECOND = 60;
const POPUPS_PER_10S = 3;
// На телефоне окно на весь экран и модальное: остальное приложение недоступно с клавиатуры и для чтения с экрана
const FULLSCREEN = '(max-width: 600px)';
// Шапка, перекрашенная мини-приложением, — только если текст на ней читается (как везде в Vicinity, ≥ 4.5:1)
const MIN_CONTRAST = 4.5;

/** Цвет шапки, который просило мини-приложение: свой #rrggbb или цвет темы Vicinity по ключу */
type HeadRequest = { color: string } | { key: 'bg_color' | 'secondary_bg_color' };

/** Цвет шапки и цвет текста на ней для текущей темы; null — цвет не годится (мало контраста) */
function headColors(req: HeadRequest, theme: Record<string, string>): { bg: string; inverse: boolean } | null {
  const bg = 'color' in req ? req.color : theme[req.key];
  const text = theme.text_color;
  const ground = theme.secondary_bg_color;
  if (!isHex(bg) || !isHex(text) || !isHex(ground)) return null;
  // Текст шапки — цветом текста Vicinity или цветом фона приложения: что контрастнее на выбранном цвете
  const [onText, onGround] = [contrast(bg, text), contrast(bg, ground)];
  if (Math.max(onText, onGround) < MIN_CONTRAST) return null;
  return { bg, inverse: onGround > onText };
}

function bottomButton(d: Data): BottomButton | null {
  const text = str(d.text, 64);
  if (!d.is_visible || !text) return null;
  return {
    text,
    active: d.is_active !== false,
    progress: !!d.is_progress_visible,
    color: isHex(d.color) ? d.color : undefined,
    textColor: isHex(d.text_color) ? d.text_color : undefined,
  };
}

function parsePopup(d: Data): Popup | null {
  const message = str(d.message, 257);
  if (!message || message.length > 256) return null;
  const buttons: Popup['buttons'] = [];
  for (const b of Array.isArray(d.buttons) ? d.buttons.slice(0, 3) : []) {
    if (!b || typeof b !== 'object') return null;
    const raw = b as Data;
    const type: PopupKind = ['ok', 'close', 'cancel', 'destructive'].includes(raw.type as string) ? (raw.type as PopupKind) : 'default';
    const text = str(raw.text, 64) || POPUP_LABEL[type] || '';
    if (!text) return null;
    buttons.push({ id: str(raw.id, 64), type, text });
  }
  if (!buttons.length) buttons.push({ id: '', type: 'close', text: 'Закрыть' });
  return { title: str(d.title, 64), message, buttons };
}

export function WebAppPanel() {
  const app = useWebApp((s) => s.app);
  const seq = useWebApp((s) => s.seq);
  if (!app) return null;
  return <Panel key={seq} app={app} />;
}

function Panel({ app }: { app: WebAppTarget }) {
  const closePanel = useWebApp((s) => s.close);
  const frame = useRef<HTMLIFrameElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [launch, setLaunch] = useState<WebAppLaunch | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<'loading' | 'loaded' | 'ready'>('loading');
  const [reload, setReload] = useState(0);
  const [main, setMain] = useState<BottomButton | null>(null);
  const [secondary, setSecondary] = useState<BottomButton | null>(null);
  const [back, setBack] = useState(false);
  const [settings, setSettings] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [asking, setAsking] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [headReq, setHeadReq] = useState<HeadRequest | null>(null);
  // Сменилось оформление Vicinity — цвет шапки и текста на ней пересчитываются
  const [themeTick, setThemeTick] = useState(0);
  const [fullscreen, setFullscreen] = useState(() => window.matchMedia(FULLSCREEN).matches);
  const [bg, setBg] = useState<string | null>(null);
  const [bar, setBar] = useState<string | null>(null);

  const target = webAppUrl(app.url);
  const embeddable = !!target && !sameOriginApp(target);
  // Куда отвечать: сначала origin адреса кнопки, потом — origin, с которого iframe действительно пишет
  const replyOrigin = useRef(target?.origin ?? '');

  // Открытие и «Обновить»: каждый раз новый initData (свежий auth_date и query_id) и тема на этот момент
  useEffect(() => {
    if (!embeddable) return;
    let alive = true;
    setLaunch(null);
    setError('');
    setState('loading');
    setMain(null);
    setSecondary(null);
    setBack(false);
    setSettings(false);
    setNeedConfirm(false);
    setPopup(null);
    popupOpen.current = false;
    setHeadReq(null);
    setBg(null);
    replyOrigin.current = target?.origin ?? '';
    setBar(null);
    api
      .openWebApp(app.botId, {
        url: app.url,
        channel_id: app.channelId,
        message_id: app.messageId,
        ephemeral_id: app.ephemeralId,
        theme_params: themeParams(),
      })
      .then((r) => alive && setLaunch(r))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Не удалось открыть мини-приложение — проверьте связь'));
    return () => {
      alive = false;
    };
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Фокус — в окно; после закрытия — туда, откуда открыли (кнопка бота, шапка лички)
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const send = useCallback((eventType: string, eventData: Data = {}) => {
    const w = frame.current?.contentWindow;
    if (w && replyOrigin.current) w.postMessage(JSON.stringify({ eventType, eventData }), replyOrigin.current);
  }, []);

  const viewport = useCallback(() => {
    const el = body.current;
    if (!el) return;
    send('viewport_changed', { height: el.clientHeight, width: el.clientWidth, is_expanded: true, is_state_stable: true });
  }, [send]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => viewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport, launch]);

  // Сменилось оформление Vicinity (тема, акцент) — мини-приложение получает новые цвета
  useEffect(() => {
    let t = 0;
    const mo = new MutationObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        send('theme_changed', { theme_params: themeParams() });
        setThemeTick((n) => n + 1);
      }, 100);
    });
    mo.observe(document.documentElement, { attributes: true });
    return () => {
      mo.disconnect();
      window.clearTimeout(t);
    };
  }, [send]);

  // Телефон: окно на весь экран — остальное приложение inert (Tab и чтение с экрана не уходят в скрытый чат);
  // входящий звонок, тосты и уведомления остаются доступными
  useEffect(() => {
    const mq = window.matchMedia(FULLSCREEN);
    const on = () => setFullscreen(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    const el = root.current;
    const parent = el?.parentElement;
    if (!fullscreen || !el || !parent) return;
    const keep = '.call-banner, .toasts, .notify-popups';
    const hidden = [...parent.children].filter((c) => c !== el && !c.matches(keep) && !c.hasAttribute('inert'));
    for (const c of hidden) c.setAttribute('inert', '');
    return () => {
      for (const c of hidden) c.removeAttribute('inert');
    };
  }, [fullscreen]);

  const requestClose = () => (needConfirm ? setAsking(true) : closePanel());

  const popupTimes = useRef<number[]>([]);
  // Попап открыт — ref, а не состояние: несколько сообщений подряд приходят раньше, чем React перерисует окно
  const popupOpen = useRef(false);
  const lastLink = useRef(0);

  function openLink(raw: unknown) {
    const u = safeUrl(typeof raw === 'string' ? raw : undefined);
    if (!u || Date.now() - lastLink.current < 1000) return;
    lastLink.current = Date.now();
    // Без жеста в нашем окне браузер может не открыть вкладку — тогда ссылка в окне, по нажатию
    const w = window.open(u.href, '_blank');
    if (w) {
      w.opener = null;
      return;
    }
    if (desktop) return;
    useBots.setState({ alert: { text: 'Мини-приложение предлагает открыть ссылку', url: u.href } });
  }

  // Отказ в попапе — всё равно popup_closed без button_id: telegram-web-app.js до ответа считает попап открытым
  // и бросает ошибку на каждом следующем showAlert/showPopup
  function openPopup(d: Data) {
    const now = Date.now();
    popupTimes.current = popupTimes.current.filter((t) => now - t < 10_000);
    const p = popupOpen.current || popupTimes.current.length >= POPUPS_PER_10S ? null : parsePopup(d);
    if (!p) return void send('popup_closed', {});
    popupTimes.current.push(now);
    popupOpen.current = true;
    setPopup(p);
  }

  function closePopup(buttonId?: string) {
    popupOpen.current = false;
    setPopup(null);
    send('popup_closed', buttonId !== undefined ? { button_id: buttonId } : {});
  }

  function headerColor(d: Data) {
    if (isHex(d.color)) setHeadReq({ color: d.color });
    else if (d.color_key === 'bg_color' || d.color_key === 'secondary_bg_color') setHeadReq({ key: d.color_key });
  }
  // Цвет по ключу и цвет текста — из темы на этот момент: после смены темы шапка остаётся читаемой
  const head = useMemo(() => (headReq ? headColors(headReq, themeParams()) : null), [headReq, themeTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Обработчик пересоздаётся каждый рендер — видит текущее состояние (открытый попап и т. п.)
  const handle = useRef<(type: string, d: Data) => void>(() => undefined);
  handle.current = (type, d) => {
    switch (type) {
      case 'web_app_ready':
        setState('ready');
        break;
      case 'web_app_expand':
      case 'web_app_request_viewport':
        viewport();
        break;
      case 'web_app_close':
        closePanel();
        break;
      case 'web_app_request_theme':
        send('theme_changed', { theme_params: themeParams() });
        break;
      case 'web_app_request_safe_area':
        send('safe_area_changed', { top: 0, bottom: 0, left: 0, right: 0 });
        break;
      case 'web_app_request_content_safe_area':
        send('content_safe_area_changed', { top: 0, bottom: 0, left: 0, right: 0 });
        break;
      case 'web_app_setup_main_button':
        setMain(bottomButton(d));
        break;
      case 'web_app_setup_secondary_button':
        setSecondary(bottomButton(d));
        break;
      case 'web_app_setup_back_button':
        setBack(!!d.is_visible);
        break;
      case 'web_app_setup_settings_button':
        setSettings(!!d.is_visible);
        break;
      case 'web_app_setup_closing_behavior':
        setNeedConfirm(!!d.need_confirmation);
        break;
      case 'web_app_open_popup':
        openPopup(d);
        break;
      case 'web_app_open_link':
        openLink(d.url);
        break;
      case 'web_app_set_header_color':
        headerColor(d);
        break;
      case 'web_app_set_background_color':
        if (isHex(d.color)) setBg(d.color);
        break;
      case 'web_app_set_bottom_bar_color':
        if (isHex(d.color)) setBar(d.color);
        break;
      // Буфер обмена мини-приложению не отдаём: ответ без данных (data = null)
      case 'web_app_read_text_from_clipboard':
        send('clipboard_text_received', { req_id: str(d.req_id, 128) });
        break;
      // Чего у Vicinity нет — честный отказ, чтобы приложение не ждало ответа вечно
      case 'web_app_invoke_custom_method':
        send('custom_method_invoked', { req_id: str(d.req_id, 128), error: 'UNSUPPORTED' });
        break;
      case 'web_app_request_phone':
        send('phone_requested', { status: 'cancelled' });
        break;
      case 'web_app_request_write_access':
        send('write_access_requested', { status: 'cancelled' });
        break;
      case 'web_app_open_invoice':
        send('invoice_closed', { slug: str(d.slug, 256), status: 'failed' });
        break;
      case 'web_app_open_scan_qr_popup':
        send('scan_qr_popup_closed', {});
        break;
      case 'web_app_request_fullscreen':
        send('fullscreen_failed', { error: 'UNSUPPORTED' });
        break;
      case 'web_app_biometry_get_info':
        send('biometry_info_received', { available: false });
        break;
      case 'web_app_check_home_screen':
        send('home_screen_checked', { status: 'unsupported' });
        break;
      // web_app_data_send, web_app_open_tg_link, web_app_trigger_haptic_feedback и прочее — без ответа
    }
  };

  useEffect(() => {
    let second = 0;
    let count = 0;
    const on = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      // Отправитель — окно нашего iframe; страница без origin или с origin Vicinity (вышла бы из песочницы) — нет
      if (!w || e.source !== w || e.origin === 'null' || e.origin === window.location.origin) return;
      let msg: unknown;
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const { eventType, eventData } = msg as { eventType?: unknown; eventData?: unknown };
      if (typeof eventType !== 'string') return;
      replyOrigin.current = e.origin;
      const now = performance.now();
      if (now - second > 1000) {
        second = now;
        count = 0;
      }
      if (++count > EVENTS_PER_SECOND) {
        // Попап сверх лимита тоже получает ответ, иначе SDK так и считает его открытым
        if (eventType === 'web_app_open_popup') send('popup_closed', {});
        return;
      }
      handle.current(eventType, eventData && typeof eventData === 'object' ? (eventData as Data) : {});
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [send]);

  const host = target?.host ?? '';
  const plainUrl = target ? `${target.origin}${target.pathname}${target.search}` : app.url;
  const headStyle = head ? ({ '--webapp-head-bg': head.bg } as CSSProperties) : undefined;
  const bodyStyle = bg ? ({ '--webapp-bg': bg } as CSSProperties) : undefined;
  const footStyle = bar ? ({ '--webapp-bar': bar } as CSSProperties) : undefined;

  const bottom = (b: BottomButton, kind: 'main' | 'secondary') => {
    const custom = b.color ? ({ background: b.color, color: b.textColor } as CSSProperties) : undefined;
    return (
      <button
        type="button"
        className={`btn webapp-${kind}${kind === 'main' && !custom ? ' primary' : ''}`}
        style={custom}
        disabled={!b.active}
        aria-busy={b.progress || undefined}
        onClick={() => send(kind === 'main' ? 'main_button_pressed' : 'secondary_button_pressed')}
      >
        {b.progress && <span className="bot-kb-spinner" aria-hidden="true" />}
        <span className="ellipsis">{b.text}</span>
      </button>
    );
  };

  return (
    <div
      ref={root}
      className="webapp-panel"
      role="dialog"
      aria-modal={fullscreen}
      aria-label={`Мини-приложение: ${app.botName}`}
      tabIndex={-1}
      data-state={state}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !popup && !asking) {
          e.stopPropagation();
          requestClose();
        }
      }}
    >
      <header className={`webapp-head${head ? ' tinted' : ''}${head?.inverse ? ' inverse' : ''}`} style={headStyle}>
        {back && (
          <button type="button" className="icon-btn" aria-label="Назад" title="Назад" onClick={() => send('back_button_pressed')}>
            <Icon icon={ArrowLeft} size={18} />
          </button>
        )}
        <div className="webapp-title">
          <strong className="ellipsis">{launch?.bot.display_name ?? app.botName}</strong>
          <span className="ellipsis">{host ? `Мини-приложение · ${host}` : 'Мини-приложение'}</span>
        </div>
        {settings && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Настройки мини-приложения"
            title="Настройки мини-приложения"
            onClick={() => send('settings_button_pressed')}
          >
            <Icon icon={Settings2} size={18} />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Обновить" title="Обновить" onClick={() => setReload((n) => n + 1)}>
          <Icon icon={RotateCw} size={18} />
        </button>
        {target && (
          <a className="icon-btn" href={plainUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть в браузере" title="Открыть в браузере">
            <Icon icon={ExternalLink} size={18} />
          </a>
        )}
        <button type="button" className="icon-btn" aria-label="Закрыть" title="Закрыть" onClick={requestClose}>
          <Icon icon={X} size={18} />
        </button>
      </header>
      {launch && !launch.signed && (
        <p className="webapp-warn" role="note">
          <Icon icon={TriangleAlert} size={16} />
          <span>Бот ещё не активировал мини-приложения: оно откроется, но не сможет проверить, кто вы.</span>
        </p>
      )}
      <div ref={body} className="webapp-body" style={bodyStyle}>
        {!embeddable ? (
          <div className="webapp-empty">
            <Icon icon={AppWindow} size={22} />
            <p>Это мини-приложение открывается только в браузере.</p>
            {target && (
              <a className="btn primary" href={plainUrl} target="_blank" rel="noopener noreferrer">
                <Icon icon={ExternalLink} size={16} />
                Открыть в браузере
              </a>
            )}
          </div>
        ) : error ? (
          <div className="webapp-empty" role="alert">
            <Icon icon={AppWindow} size={22} />
            <p>{error}</p>
            <button type="button" className="btn primary" onClick={() => setReload((n) => n + 1)}>
              <Icon icon={RotateCw} size={16} />
              Повторить
            </button>
          </div>
        ) : (
          launch && (
            <iframe
              ref={frame}
              className="webapp-frame"
              src={launch.url_with_fragment}
              title={`Мини-приложение ${launch.bot.display_name}`}
              // allow-same-origin — origin самого мини-приложения: к Vicinity (другой origin) доступа у него нет
              // Без allow-popups: window.open из мини-приложения не обходит лимит web_app_open_link (в ПК-приложении
              // он ушёл бы прямо в системный браузер), ссылки telegram-web-app.js открывает через web_app_open_link
              sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
              allow="clipboard-write"
              referrerPolicy="no-referrer"
              onLoad={() => {
                // Документ iframe нам доступен — значит, он на origin Vicinity (редирект на нас): из песочницы такая
                // страница вышла бы, поэтому убираем её сразу
                let ours = false;
                try {
                  ours = !!frame.current?.contentDocument;
                } catch {
                  /* чужой origin — как и должно быть */
                }
                if (ours) {
                  setLaunch(null);
                  setError('Мини-приложение перенаправило на адрес самого Vicinity — открыть его нельзя');
                  return;
                }
                setState((s) => (s === 'loading' ? 'loaded' : s));
                viewport();
              }}
            />
          )
        )}
        {embeddable && !error && state === 'loading' && (
          <div className="webapp-loading" role="status" aria-label="Загрузка мини-приложения">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
      </div>
      {(main || secondary) && (
        <div className="webapp-foot" style={footStyle}>
          {secondary && bottom(secondary, 'secondary')}
          {main && bottom(main, 'main')}
        </div>
      )}
      {popup && (
        <Modal title={popup.title || app.botName} onClose={() => closePopup()} className="webapp-popup">
          <p className="webapp-popup-text">{popup.message}</p>
          <div className="webapp-popup-buttons">
            {popup.buttons.map((b, i) => (
              <button
                key={i}
                type="button"
                className={`btn${b.type === 'destructive' ? ' danger' : b.type === 'ok' || b.type === 'default' ? ' primary' : ''}`}
                autoFocus={i === popup.buttons.length - 1}
                onClick={() => closePopup(b.id)}
              >
                {b.text}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {asking && (
        <ConfirmDialog
          title="Закрыть мини-приложение?"
          action="Закрыть"
          onConfirm={() => {
            setAsking(false);
            closePanel();
          }}
          onClose={() => setAsking(false)}
        >
          Изменения в нём могут не сохраниться.
        </ConfirmDialog>
      )}
    </div>
  );
}
