import { typeMultiplier } from './data/typechart';
import { canActNow, movementAllowance } from './engine';
import { isSupportOnly, targeting, truantRests } from './moves';
import { effectiveMov, inBounds, isTrebuchet, liveUnits, mapOf, moveOf, reachable } from './query';
import type { AbilityId, CardDef, GameState, MoveDef, PType, Pos, Side, Unit } from './types';
import { DIRS, TYPES } from './types';
import { posKey } from './util';

// ---------------------------------------------------------------- type matchups (card level)

const IGNORES_ABILITIES: AbilityId[] = ['teravolt', 'turboblaze'];

/** Type multiplier of a `moveType` hit on `def`, including type-based defensive abilities. */
export function hitMultiplier(moveType: PType, def: CardDef, attacker?: CardDef): number {
  const ab = attacker && IGNORES_ABILITIES.includes(attacker.ability) ? null : def.ability;
  if (ab === 'levitate' && moveType === 'Ground') return 0;
  if (ab === 'stormDrain' && moveType === 'Water') return 0;
  let m = typeMultiplier(moveType, def.types);
  if (attacker?.ability === 'tintedLens' && m > 0 && m < 1) m = 1;
  if (ab === 'thickFat' && (moveType === 'Fire' || moveType === 'Ice')) m *= 0.5;
  return m;
}

export interface TypeMult {
  type: PType;
  mult: number;
}

/** Every attacking type that doesn't deal neutral damage to `card`, most dangerous first. */
export function defenseProfile(card: CardDef): TypeMult[] {
  return TYPES.map((type) => ({ type, mult: hitMultiplier(type, card) }))
    .filter((x) => x.mult !== 1)
    .sort((a, b) => b.mult - a.mult);
}

/** Distinct types of the card's damaging moves. */
export function attackTypes(card: CardDef): PType[] {
  return [...new Set(card.moves.filter((m) => m.kind === 'attack' && m.type).map((m) => m.type as PType))];
}

/** The best multiplier `attacker`'s damaging moves get against `def` (null if it has none). */
export function bestHit(attacker: CardDef, def: CardDef): TypeMult | null {
  let best: TypeMult | null = null;
  for (const type of attackTypes(attacker)) {
    const mult = hitMultiplier(type, def, attacker);
    if (!best || mult > best.mult) best = { type, mult };
  }
  return best;
}

export function multLabel(m: number): string {
  if (m === 0) return '0×';
  if (m === 0.25) return '¼×';
  if (m === 0.5) return '½×';
  return `${m}×`;
}

// ---------------------------------------------------------------- danger zone

/** Moves that can hurt or hinder an opponent standing in their zone. */
export function isThreatMove(m: MoveDef): boolean {
  if (m.target.kind !== 'grid' && m.target.kind !== 'range') return false;
  if (isSupportOnly(m)) return false;
  return m.kind === 'attack' || !m.fx.heal;
}

export interface DangerSource {
  unitId: string;
  moveIndex: 0 | 1;
}

export interface DangerZone {
  /** Tile key → every (Pokémon, move) pair that could hit it. */
  tiles: Map<string, DangerSource[]>;
  /** Pokémon of `side` that could reach the trebuchet (which can hit anywhere). */
  trebuchet: string[];
}

/** Movement and whether `e` can act in its side's next activation (null if it can't act). */
function nextActivation(s: GameState, e: Unit): number | null {
  if (s.phase === 'battle' && s.side === e.side) {
    // Its turn is under way: only Pokémon that haven't finished can still strike.
    if (e.activated) return null;
    if (s.active?.unitId === e.id) return s.active.stage === 'moved' && canActNow(e) ? 0 : null;
    if (s.active) return null;
    return canActNow(e) ? movementAllowance(s, e) : null;
  }
  if (e.flinched || e.nextTurn.noAct) return null;
  // Its next turn: D moves after A in the same round, A in the next one.
  const round = s.phase !== 'battle' ? 1 : e.side === 'D' ? s.round : s.round + 1;
  if (truantRests(s, e, round)) return null;
  if (e.nextTurn.noMove) return 0;
  return effectiveMov(s, e);
}

/**
 * Every tile `side`'s Pokémon could hit with either of their moves in their next activation:
 * from any tile they can walk to, aimed in any direction. `onlyId` limits it to one Pokémon.
 */
export function dangerZone(s: GameState, side: Side, onlyId?: string): DangerZone {
  const tiles = new Map<string, DangerSource[]>();
  const trebuchet: string[] = [];
  const m = mapOf(s);
  const add = (p: Pos, src: DangerSource, seen: Set<string>): void => {
    const k = posKey(p);
    if (seen.has(k)) return;
    seen.add(k);
    const list = tiles.get(k);
    if (list) list.push(src);
    else tiles.set(k, [src]);
  };
  for (const e of liveUnits(s, side)) {
    if (onlyId && e.id !== onlyId) continue;
    const budget = nextActivation(s, e);
    if (budget === null || (s.phase === 'battle' && s.side === e.side && truantRests(s, e))) continue;
    const origins: Pos[] = [e.pos!, ...[...reachable(s, e, budget).values()].map((r) => r.pos)];
    if (origins.some((p) => isTrebuchet(s, p))) trebuchet.push(e.id);
    // Its next activation's round (Gigaton Hammer only works in even rounds).
    const round = s.phase !== 'battle' ? 1 : e.side === s.side ? s.round : e.side === 'D' ? s.round : s.round + 1;
    for (const moveIndex of [0, 1] as const) {
      const mv = moveOf(e, moveIndex);
      if (!isThreatMove(mv) || e.locked.includes(mv.name) || (mv.fx.evenRoundsOnly && round % 2 !== 0)) continue;
      const src = { unitId: e.id, moveIndex };
      const seen = new Set<string>();
      if (mv.target.kind === 'range') {
        const r = mv.target.range;
        const min = Math.max(1, mv.target.min ?? 1);
        for (let y = 0; y < m.height; y++) {
          for (let x = 0; x < m.width; x++) {
            if (origins.some((o) => {
              const d = Math.abs(o.x - x) + Math.abs(o.y - y);
              return d <= r && d >= min;
            })) add({ x, y }, src, seen);
          }
        }
        continue;
      }
      for (const origin of origins) {
        for (const dir of DIRS) {
          // Moves need a Pokémon in their zone to be used, but the danger zone is where they
          // *would* land, so empty zones count (a blocked charge still yields no zone).
          const tg = targeting(s, e, mv, { dir, origin });
          for (const p of tg.zone) if (inBounds(s, p)) add(p, src, seen);
        }
      }
    }
  }
  return { tiles, trebuchet };
}
