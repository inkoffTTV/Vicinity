// WebSocket к /ws с авто-переподключением. Токен передаётся через ?token=,
// т.к. браузерный WebSocket не умеет ставить заголовок Authorization.

export type WsEvent = { type: string; [k: string]: any };

type Listener = (ev: WsEvent) => void;
type BinaryListener = (data: ArrayBuffer) => void;
type StatusListener = (connected: boolean) => void;

const PING_EVERY = 25_000;
// Нет ответа на ping за это время — соединение «полуоткрыто» (NAT, смена сети, спящая вкладка)
const PONG_TIMEOUT = 10_000;
const MAX_DELAY = 30_000;
// Столько неудачных рукопожатий подряд — повод проверить токен через REST (истёкший даёт 401)
const AUTH_CHECK_AFTER = 3;
// Голос не копим: если в сокете уже столько неотправленного, кадр выбрасывается
const MAX_BINARY_BACKLOG = 64 * 1024;

export class Socket {
  private ws: WebSocket | null = null;
  private token = '';
  private wanted = false;
  private connected = false;
  private delay = 1000;
  private failures = 0;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;
  private listeners = new Set<Listener>();
  private binaryListeners = new Set<BinaryListener>();
  private statusListeners = new Set<StatusListener>();
  private authCheck: (() => void) | null = null;

  constructor() {
    // Сеть вернулась или вкладка снова на экране — не ждём таймер переподключения
    window.addEventListener('online', () => this.wake());
    document.addEventListener('visibilitychange', () => !document.hidden && this.wake());
  }

  connect(token: string) {
    this.token = token;
    this.wanted = true;
    this.delay = 1000;
    this.failures = 0;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    window.clearTimeout(this.reconnectTimer);
    this.drop();
    this.setConnected(false);
  }

  send(obj: WsEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Бинарный кадр (голос). false — не отправлен: нет связи или сокет не успевает. */
  sendBinary(data: ArrayBuffer): boolean {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BINARY_BACKLOG) return false;
    ws.send(data);
    return true;
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onBinary(fn: BinaryListener) {
    this.binaryListeners.add(fn);
    return () => this.binaryListeners.delete(fn);
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  setAuthCheck(fn: () => void) {
    this.authCheck = fn;
  }

  private open() {
    window.clearTimeout(this.reconnectTimer);
    this.drop();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.delay = 1000;
      this.failures = 0;
      this.pingTimer = window.setInterval(() => this.ping(), PING_EVERY);
      this.setConnected(true);
    };
    ws.onmessage = (e) => {
      // Любой входящий кадр подтверждает, что соединение живо
      window.clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      if (e.data instanceof ArrayBuffer) {
        this.binaryListeners.forEach((f) => f(e.data));
        return;
      }
      if (typeof e.data !== 'string') return;
      let ev: WsEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev && typeof ev.type === 'string' && ev.type !== 'pong') this.listeners.forEach((f) => f(ev));
    };
    ws.onclose = () => {
      if (!opened) this.failures++;
      this.lost();
    };
  }

  private ping() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'ping' }));
    if (this.pongTimer === undefined) this.pongTimer = window.setTimeout(() => this.lost(), PONG_TIMEOUT);
  }

  // Соединение закрылось или перестало отвечать — переподключаемся с бэкоффом и разбросом
  private lost() {
    this.drop();
    this.setConnected(false);
    if (!this.wanted) return;
    if (this.failures > 0 && this.failures % AUTH_CHECK_AFTER === 0) this.authCheck?.();
    this.reconnectTimer = window.setTimeout(() => this.open(), this.delay * (0.8 + Math.random() * 0.4));
    this.delay = Math.min(this.delay * 2, MAX_DELAY);
  }

  // Проверить связь сейчас: открыто — ping, ждём переподключения — подключиться без паузы
  private wake() {
    if (!this.wanted) return;
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) this.ping();
      return;
    }
    this.delay = 1000;
    this.open();
  }

  // Отцепить текущий сокет: его поздние события уже не относятся к нашему соединению
  private drop() {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    this.statusListeners.forEach((f) => f(v));
  }
}

export const socket = new Socket();
