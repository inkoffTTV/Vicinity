// Подключённый игрок. Объект живёт дольше сокета: по токену из hello игрок возвращается в свою
// комнату и в свой слот после обрыва связи.
import type { WebSocket } from 'ws';
import type { ServerMsg } from '@pereprava/shared';
import type { Room } from './room';

export class Client {
  ws: WebSocket | null = null;
  room: Room | null = null;
  /** Ограничение частоты сообщений: корзина токенов */
  private tokens = 60;
  private refill = Date.now();
  lastSeen = Date.now();

  constructor(
    readonly id: number,
    readonly token: string,
    public name: string,
  ) {}

  get online() {
    return !!this.ws && this.ws.readyState === this.ws.OPEN;
  }

  send(msg: ServerMsg) {
    if (this.online) this.ws!.send(JSON.stringify(msg));
  }

  /** 40 сообщений в секунду с запасом 60 — больше человеку не нужно */
  allow(): boolean {
    const now = Date.now();
    this.tokens = Math.min(60, this.tokens + ((now - this.refill) / 1000) * 40);
    this.refill = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
