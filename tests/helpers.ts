import {
  type Action, type GameState, type Pos, type Rng, type Unit, applyAction, getUnit, quickGame, seededRng,
} from '../src/engine';

/** RNG with scripted results: `chance` pops booleans (default false), `d6` pops numbers (default 1). */
export function scriptedRng(chances: boolean[] = [], dice: number[] = []): Rng {
  return {
    chance: (p) => (p >= 1 ? true : p <= 0 ? false : chances.length ? chances.shift()! : false),
    d6: () => (dice.length ? dice.shift()! : 1),
    int: () => 0,
  };
}

export const noLuck = (): Rng => scriptedRng();

/** A battle-phase game with the given teams; units are then moved to `positions` (id → pos). */
export function setup(
  teamA: string[], teamD: string[], positions: Record<string, Pos | null> = {}, opts: { mapId?: string } = {},
): GameState {
  const used = new Set([...teamA, ...teamD]);
  const s = quickGame(pad(teamA, used), pad(teamD, used), { rng: seededRng(1), mapId: opts.mapId });
  for (const [id, pos] of Object.entries(positions)) {
    const u = getUnit(s, id);
    if (pos === null) {
      u.fainted = true;
      u.hp = 0;
      u.pos = null;
    } else {
      u.pos = { ...pos };
    }
  }
  // Start-of-battle effects in quickGame can change stages; tests set their own. Tests are set in
  // round 2.
  s.round = 2;
  for (const u of s.units) {
    u.stages = { atk: 0, def: 0, mov: 0 };
    u.turn = { noMove: false, noAct: false, reasons: [] };
  }
  s.log = [];
  return s;
}

const FILLER = ['furret', 'cinccino', 'dodrio', 'snorlax', 'blissey', 'tauros', 'slaking', 'staraptor'];

function pad(team: string[], used: Set<string>): string[] {
  const out = [...team];
  for (const c of FILLER) {
    if (out.length >= 4) break;
    if (!used.has(c)) {
      out.push(c);
      used.add(c);
    }
  }
  return out;
}

export function act(s: GameState, a: Action, rng: Rng = noLuck()): GameState {
  return applyAction(s, a, rng).state;
}

export const unit = (s: GameState, id: string): Unit => getUnit(s, id);

/** Parks every unit not listed far away in a corner column so they don't interfere. */
export function park(s: GameState, keep: string[]): void {
  const spots: Pos[] = [{ x: 13, y: 0 }, { x: 13, y: 1 }, { x: 13, y: 2 }, { x: 13, y: 3 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
  let i = 0;
  for (const u of s.units) if (!keep.includes(u.id)) u.pos = spots[i++];
}
