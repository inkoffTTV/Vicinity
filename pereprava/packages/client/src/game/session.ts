// Сессия — источник снимков для отображения и приёмник приказов. Одиночная игра (LocalSession)
// и сетевая (NetSession) выглядят для остального клиента одинаково.
import type { Command, Snapshot, Team } from '@pereprava/shared';

export interface Session {
  readonly kind: 'local' | 'net';
  readonly slot: number;
  readonly team: Team;
  /** Продвинуть время на dt (с). Возвращает новые снимки по порядку */
  update(dt: number): Snapshot[];
  /** Доля пути между двумя последними снимками для интерполяции, 0..1 */
  readonly alpha: number;
  /** Дробный тик отрисовки (для анимаций по тикам событий) */
  readonly renderTick: number;
  send(cmd: Command): void;
  dispose(): void;
}
