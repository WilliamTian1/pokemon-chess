import type { GameEvent } from '../engine';

/**
 * How long a bot waits after one of its actions before the next, so a person watching can follow:
 * long enough to read the move's name, see where it landed and what it did.
 */
export function botPause(events: readonly GameEvent[]): number {
  if (events.some((e) => e.t === 'special')) return 2800;
  if (events.some((e) => e.t === 'attack' || e.t === 'field' || e.t === 'transform')) return 1900;
  if (events.some((e) => e.t === 'damage' || e.t === 'heal' || e.t === 'faint' || e.t === 'status' || e.t === 'stage')) return 1300;
  if (events.some((e) => e.t === 'move')) return 750;
  return 450;
}

/** The pause before a bot's first action of a turn (the new-turn notice has gone by then). */
export const BOT_TURN_START_MS = 1100;
