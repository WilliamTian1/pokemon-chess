import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/bot';
import { type DraftModel, bestDraftPick, teamLogit } from '../src/ai/draft';
import { applyAction, draftOptions, newGame, seededRng } from '../src/engine';
import { setup } from './helpers';

const flat = (over: Partial<DraftModel> = {}): DraftModel => ({
  games: 1, lambda: 0, bias: 0, matchup: 0, priorA: 0, priorD: 0, A: {}, D: {}, ...over,
});

describe('hard draft search', () => {
  it('lets the hard bot pick quickly from the full Freeplay roster', () => {
    const s = newGame({ rng: seededRng(12), style: 'freeplay' });
    const action = decide(s, 'D', 'hard', seededRng(13))[0];
    expect(action.type).toBe('draftPick');
    if (action.type === 'draftPick') expect(draftOptions(s, 'D')).toContain(action.cardId);
  });

  it('takes the card the model rates highest for its role', () => {
    const s = newGame({ rng: seededRng(5) });
    const star = s.draft.pool[7];
    expect(bestDraftPick(s, 'A', flat({ A: { [star]: 2 } }))).toBe(star);
  });

  it('denies the opponent a card that is worth more to them than anything is to itself', () => {
    const s = newGame({ rng: seededRng(9) });
    const [mine, theirs] = [s.draft.pool[2], s.draft.pool[11]];
    const m = flat({ A: { [mine]: 0.2 }, D: { [theirs]: -3 } });
    expect(bestDraftPick(s, 'A', m)).toBe(theirs);
    expect(teamLogit(m, [mine], [theirs])).toBeCloseTo(-2.8);
  });
});

describe('hard battle search', () => {
  it('always produces a legal action, including under Follow Me', () => {
    const s = setup(['tauros', 'furret'], ['cherrim'], { A0: { x: 9, y: 4 }, A1: { x: 7, y: 4 }, D0: { x: 5, y: 0 } });
    s.side = 'D';
    s.units.find((u) => u.id === 'A1')!.followMe = { kind: 'followMe', duringTurnOf: 'D' };
    const acts = decide(s, 'D', 'hard', seededRng(1));
    expect(acts.length).toBeGreaterThan(0);
    let n = s;
    for (const a of acts) n = applyAction(n, a, seededRng(2)).state;
    expect(n.seq).toBeGreaterThan(s.seq);
  });
});
