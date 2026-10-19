// Сетевой протокол (JSON по WebSocket /ws). Сервер авторитарный: клиент шлёт только намерения
// (приказы, выбор героя, готовность), а сервер — снимки мира с учётом тумана войны.
import type { Snapshot } from './snapshot';
import type { Command, Team } from './types';

export type GameMode = '1v1' | '2v2';
export const MODE_SIZE: Record<GameMode, number> = { '1v1': 1, '2v2': 2 };
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
  | { t: 'start'; slot: number; tick: number; players: { name: string; team: Team; hero: string; bot: boolean }[] }
  | { t: 'snap'; s: Snapshot; ack: number }
  | { t: 'pong'; ts: number };
