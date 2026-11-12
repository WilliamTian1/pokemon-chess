import type { Action, DraftStyle, GameEvent, GameState, Side } from '../engine/types';

/** Chess-style time controls: minutes on each clock, plus seconds added each time a side hands over the move. */
export interface TimeControl {
  id: string;
  label: string;
  name: string;
  baseMs: number;
  incMs: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: '5+3', label: '5 + 3', name: 'Blitz', baseMs: 5 * 60_000, incMs: 3_000 },
  { id: '10+5', label: '10 + 5', name: 'Rapid', baseMs: 10 * 60_000, incMs: 5_000 },
  { id: '15+10', label: '15 + 10', name: 'Rapid', baseMs: 15 * 60_000, incMs: 10_000 },
  { id: '30+20', label: '30 + 20', name: 'Classical', baseMs: 30 * 60_000, incMs: 20_000 },
];
export const timeControl = (id: string | null | undefined): TimeControl | null => TIME_CONTROLS.find((t) => t.id === id) ?? null;

/** Ranked queue preference: a draft style, or any. */
export type StylePref = DraftStyle | 'any';
/** Ranked queue preference for an optional rule (legendaries, trainers): with it, without it, or either. */
export type RulePref = 'on' | 'off' | 'any';
export const RULE_PREFS: readonly RulePref[] = ['on', 'off', 'any'];

/** A signed-in account as other players see it. */
export interface AccountView {
  id: string;
  username: string;
  /** Elo rating per draft style: each mode is rated separately. */
  ratings: Record<DraftStyle, number>;
  /** Ranked games played per draft style. */
  games: Record<DraftStyle, number>;
  /** Bot accounts (they fill the ranked queue): their difficulty. */
  bot?: 'easy' | 'medium' | 'hard';
}

export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'seat'; side: Side | null }
  | {
      t: 'start'; randomRoles: boolean; mapId?: string; legendaries?: boolean; trainers?: boolean; style?: DraftStyle;
      /** A time control id, or null/absent for untimed. */
      timeControl?: string | null;
    }
  | { t: 'action'; action: Action }
  | { t: 'rematch'; swapRoles: boolean }
  | { t: 'leave' }
  /** Ranked matchmaking (signed-in players only). */
  | { t: 'queue'; timeControl: string; style: StylePref; legendaries?: RulePref; trainers?: RulePref }
  | { t: 'unqueue' };

export interface PlayerView {
  id: string;
  name: string;
  side: Side | null;
  connected: boolean;
}

export interface ClockView {
  /** Milliseconds left for each side when `since` was taken. */
  A: number;
  D: number;
  /** The sides whose clocks are running (both while picking at the same time in a Secret draft). */
  running: Side[];
  /** Server time (ms) of the last update; clients correct with `serverNow`. */
  since: number;
  incMs: number;
}

export interface MatchResult {
  winner: Side | null;
  reason: string;
  /** Rated games: each side's rating change and new rating. */
  deltas?: Record<Side, number>;
  ratings?: Record<Side, number>;
}

export interface RoomView {
  code: string;
  hostId: string;
  players: PlayerView[];
  game: GameState | null;
  /** Map for the next match (the host's choice). */
  mapId: string;
  /** Whether the next match drafts legendaries (the host's choice). */
  legendaries: boolean;
  /** Whether the next match is played with trainers (the host's choice). */
  trainers?: boolean;
  style?: DraftStyle;
  timeControl?: string | null;
  events: GameEvent[];
  eventSeq: number;
  /** A ranked match made by matchmaking. */
  rated?: boolean;
  /** The accounts behind each seat (ranked matches). */
  accounts?: Record<Side, AccountView | null>;
  clock?: ClockView | null;
  result?: MatchResult | null;
  serverNow: number;
}

export interface QueueView {
  timeControl: string;
  style: StylePref;
  legendaries: RulePref;
  trainers: RulePref;
  since: number;
  /** Players currently searching (including you). */
  searching: number;
}

export type ServerMsg =
  | { t: 'welcome'; id: string; account?: AccountView | null }
  | { t: 'room'; room: RoomView }
  | { t: 'left' }
  | { t: 'queue'; queue: QueueView | null }
  | { t: 'error'; message: string };

export const ROOM_CODE_RE = /^[A-Z]{4}$/;

/** What profile pages and the leaderboard get from /api. */
export interface ProfileGame {
  id: string;
  endedAt: number;
  style: DraftStyle;
  mapId: string;
  timeControl: string | null;
  side: Side;
  opponent: { username: string; bot?: string } | null;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  ratingBefore: number;
  ratingAfter: number;
  team: string[];
}

/** One draft style's standing on a profile. */
export interface ModeProfile {
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  history: { t: number; r: number }[];
  /** Rank on that style's leaderboard (1-based), or null for provisional players. */
  rank: number | null;
}

export interface Profile {
  username: string;
  createdAt: number;
  bot?: 'easy' | 'medium' | 'hard';
  modes: Record<DraftStyle, ModeProfile>;
  /** Recent ranked games in every style (each carries its own style). */
  recent: ProfileGame[];
}

export const DRAFT_STYLES: readonly DraftStyle[] = ['classic', 'secret', 'auction'];
