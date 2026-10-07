// WebSocket к /ws с авто-переподключением. Токен передаётся через ?token=,
// т.к. браузерный WebSocket не умеет ставить заголовок Authorization.

export type WsEvent = { type: string; [k: string]: any };

type Listener = (ev: WsEvent) => void;
type StatusListener = (connected: boolean) => void;

export class Socket {
  private ws: WebSocket | null = null;
  private token = '';
  private wanted = false;
  private delay = 1000;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();

  connect(token: string) {
    this.token = token;
    this.wanted = true;
    this.delay = 1000;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(obj: WsEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private open() {
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.delay = 1000;
      this.statusListeners.forEach((f) => f(true));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return; // бинарные кадры — голос десктоп-клиента
      let ev: WsEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev && typeof ev.type === 'string') this.listeners.forEach((f) => f(ev));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      this.statusListeners.forEach((f) => f(false));
      if (!this.wanted) return;
      this.reconnectTimer = window.setTimeout(() => this.open(), this.delay);
      this.delay = Math.min(this.delay * 2, 30000);
    };
  }
}

export const socket = new Socket();
