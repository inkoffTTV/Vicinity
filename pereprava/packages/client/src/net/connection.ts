// Соединение с сервером игры: WebSocket на /ws того же адреса, автоматическое переподключение
// с паузой 1→2→4…→10 с, токен игрока в localStorage — по нему сервер возвращает в ту же комнату.
import type { ClientMsg, ServerMsg } from '@pereprava/shared';
import { store } from '../ui/store';

type Listener = (m: ServerMsg) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private backoff = 1000;
  private timer = 0;
  private pingTimer = 0;
  private closedByUser = false;
  id = 0;
  /** Время туда-обратно, мс */
  rtt = 0;
  status: 'idle' | 'connecting' | 'online' | 'offline' = 'idle';
  onStatus?: (s: Connection['status']) => void;

  constructor(private getName: () => string) {}

  get url() {
    const env = import.meta.env.VITE_SERVER_URL as string | undefined;
    if (env) return env;
    // ws рядом со страницей: /ws на своём сайте, /activities/pereprava/ws — внутри звонка Vicinity
    const u = new URL('ws', location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    u.hash = '';
    return u.toString();
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closedByUser = false;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.send({ t: 'hello', name: this.getName(), token: store.get<string | undefined>('token', undefined) });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.id = m.id;
        store.set('token', m.token);
        this.setStatus('online');
      } else if (m.t === 'pong') {
        const r = performance.now() - m.ts;
        this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
        return;
      }
      for (const fn of this.listeners) fn(m);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) this.setStatus('idle');
      else this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry() {
    this.setStatus('offline');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(10_000, this.backoff * 2);
  }

  private setStatus(s: Connection['status']) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}
