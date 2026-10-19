// Сетевой протокол (JSON по WebSocket /ws). Сервер авторитарный: клиент шлёт только намерения
// (приказы, выбор героя, готовность), а сервер — снимки мира с учётом тумана войны.
import type { Snapshot } from './snapshot';
import type { MapId } from './map';
import type { Command, Team } from './types';

/** Режим: 1v1 — одна линия, 2v2 — две, 3v3 — три (MapDef в map.ts); «Хаос» — 3 на 3 на маленькой карте
 *  с одной линией, случайными героями, вдвое быстрым золотом и опытом — матч на 8–10 минут */
export type GameMode = '1v1' | '2v2' | '3v3' | 'chaos';
export const MODE_SIZE: Record<GameMode, number> = { '1v1': 1, '2v2': 2, '3v3': 3, chaos: 3 };
export const MODE_NAMES: Record<GameMode, string> = {
  '1v1': '1 на 1',
  '2v2': '2 на 2',
  '3v3': '3 на 3',
  chaos: 'Хаос',
};
/** Карта режима */
export const mapOfMode = (m: GameMode): MapId => (m === 'chaos' ? '1v1' : m);
export const isGameMode = (m: unknown): m is GameMode => typeof m === 'string' && m in MODE_SIZE;

/** Колесо фраз: быстрые сообщения союзникам */
export const PHRASES = [
  'Отходим!',
  'Нужна помощь!',
  'Беру эту линию',
  'Иду на помощь',
  'Враг пропал — осторожно!',
  'Берём вышку!',
  'Готовлю ультимейт',
  'Хорошая игра!',
];
/** Сколько ждём вернувшегося игрока, прежде чем отдать его героя боту */
export const RECONNECT_GRACE_S = 60;
/** Частота снимков, Гц (тик симуляции — 30) */
export const SNAPSHOT_RATE = 15;

export interface LobbySlot {
  team: Team;
  /** id клиента; 0 — пусто (займёт бот) */
  client: number;
  name: string;
  hero: string;
  ready: boolean;
  bot: boolean;
  online: boolean;
}

export interface RoomInfo {
  code: string;
  mode: GameMode;
  host: number;
  slots: LobbySlot[];
  /** lobby — выбор героев; game — идёт матч; over — матч окончен */
  state: 'lobby' | 'game' | 'over';
  botDifficulty: string;
}

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; mode: GameMode; difficulty?: string }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'pick'; hero: string }
  | { t: 'team'; team: Team }
  | { t: 'ready'; ready: boolean }
  | { t: 'mode'; mode: GameMode }
  | { t: 'difficulty'; difficulty: string }
  | { t: 'start' }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'ping'; ts: number };

export type ServerMsg =
  | { t: 'welcome'; id: number; token: string; name: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'error'; text: string }
  | {
      t: 'start';
      slot: number;
      tick: number;
      /** Карта матча */
      mode: GameMode;
      players: { name: string; team: Team; hero: string; bot: boolean }[];
    }
  | { t: 'snap'; s: Snapshot; ack: number }
  | { t: 'pong'; ts: number };
