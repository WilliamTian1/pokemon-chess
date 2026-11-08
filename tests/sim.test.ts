import { describe, expect, it } from 'vitest';
import { type Difficulty, decide } from '../src/ai/bot';
import {
  type GameState, RuleError, applyAction, canStand, decider, getMap, newGame, posKey, seededRng, terrainAt,
} from '../src/engine';

function checkInvariants(s: GameState): void {
  const m = getMap(s.mapId);
  const seen = new Set<string>();
  for (const u of s.units) {
    expect(u.hp).toBeGreaterThanOrEqual(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    for (const k of ['atk', 'def', 'mov'] as const) expect(Math.abs(u.stages[k])).toBeLessThanOrEqual(3);
    if (s.phase === 'battle' || s.phase === 'over') {
      if (u.fainted) {
        expect(u.pos).toBeNull();
      } else {
        expect(u.pos, `${u.id} must be on the board`).not.toBeNull();
        expect(u.hp).toBeGreaterThan(0);
      }
    }
    if (u.pos) {
      expect(u.pos.x >= 0 && u.pos.y >= 0 && u.pos.x < m.width && u.pos.y < m.height).toBe(true);
      expect(canStand(u, terrainAt(s, u.pos)), `${u.cardId} standing on ${terrainAt(s, u.pos)}`).toBe(true);
      const k = posKey(u.pos);
      expect(seen.has(k), `two units on ${k}`).toBe(false);
      seen.add(k);
    }
  }
  expect(s.round).toBeLessThanOrEqual(s.maxRounds);
  expect(s.hazards.filter((h) => h.kind === 'spikes').length).toBeLessThanOrEqual(5);
}

export function playGame(levelA: Difficulty, levelD: Difficulty, seed: number, mapId = 'meadow'): { state: GameState; replans: number; actions: number } {
  const rng = seededRng(seed);
  const botRng = seededRng(seed * 7919 + 1);
  let s = newGame({ rng, mapId });
  let actions = 0;
  let replans = 0;
  while (s.phase !== 'over') {
    const side = decider(s)!;
    const plan = decide(s, side, side === 'A' ? levelA : levelD, botRng);
    expect(plan.length, `bot produced no action in phase ${s.phase}`).toBeGreaterThan(0);
    for (const a of plan) {
      if (decider(s) !== side) break;
      try {
        s = applyAction(s, a, rng).state;
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        // A plan computed with "expected" rolls can be invalidated by real rolls; re-plan.
        replans += 1;
        break;
      }
      actions += 1;
      checkInvariants(s);
    }
    expect(actions, 'game should terminate').toBeLessThan(2500);
    expect(replans, 'too many invalid bot actions').toBeLessThan(40);
  }
  return { state: s, replans, actions };
}

describe('bot vs bot', () => {
  const pairs: [Difficulty, Difficulty][] = [
    ['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'], ['hard', 'easy'], ['easy', 'hard'], ['medium', 'hard'],
  ];
  for (const [a, d] of pairs) {
    it(`${a} attacker vs ${d} defender plays to completion on both maps`, () => {
      for (const [seed, map] of [[11, 'meadow'], [23, 'river']] as const) {
        const { state } = playGame(a, d, seed, map);
        expect(state.phase).toBe('over');
        expect(state.winner === 'A' || state.winner === 'D').toBe(true);
      }
    });
  }
});
