import type { Action, GameEvent, GameState, Side } from '../engine/types';

export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'seat'; side: Side | null }
  | { t: 'start'; randomRoles: boolean; mapId?: string }
  | { t: 'action'; action: Action }
  | { t: 'rematch'; swapRoles: boolean }
  | { t: 'leave' };

export interface PlayerView {
  id: string;
  name: string;
  side: Side | null;
  connected: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  players: PlayerView[];
  game: GameState | null;
  /** Map for the next match (the host's choice). */
  mapId: string;
  events: GameEvent[];
  eventSeq: number;
}

export type ServerMsg =
  | { t: 'welcome'; id: string }
  | { t: 'room'; room: RoomView }
  | { t: 'left' }
  | { t: 'error'; message: string };

export const ROOM_CODE_RE = /^[A-Z]{4}$/;
