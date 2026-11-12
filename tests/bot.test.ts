import { describe, expect, it } from 'vitest';
import { GLOBAL_FEATURES, UNIT_FEATURES, decide, positionFeatures } from '../src/ai/bot';
import { type DraftModel, bestDraftPick, teamLogit } from '../src/ai/draft';
import { type ValueModel, compileValue, valueLogit } from '../src/ai/value';
import { applyAction, newGame, seededRng } from '../src/engine';
import { setup } from './helpers';

const flat = (over: Partial<DraftModel> = {}): DraftModel => ({
  games: 1, lambda: 0, bias: 0, matchup: 0, priorA: 0, priorD: 0, A: {}, D: {}, ...over,
});

describe('hard draft search', () => {
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

describe('value network', () => {
  // A hand-made model with one unit per layer where it matters: output = 8 × (Attacker sum pool) − 3 × round.
  const tiny = (): ValueModel => ({
    about: [], version: 3, training: {},
    layers: { pokemonVector: 1, pokemonLayer2: 0, hidden1: 2, hidden2: 1 },
    networks: [{
      cardVectors: { tauros: [0.5] },
      pokemonFeatureWeights: { hpFrac: [0], noSuchFeature: [9] },
      pokemonBias: [0.5],
      sideBias: { attacker: [0], defender: [-1] },
      hidden1: {
        attackerSum: [[8, 0]], attackerMax: [[0, 0]], defenderSum: [[0, 0]], defenderMax: [[0, 0]],
        positionFeatures: { round: [0, 3] },
        bias: [0, 0],
      },
      hidden2: { weights: [[1], [-1]], bias: [0] },
      output: { weights: [1], bias: 0 },
    }],
  });

  it('pools each team, ignores features the bot no longer has, and gives unknown cards no card vector', () => {
    const c = compileValue(tiny(), ['hpFrac', 'threat'], ['aToMove', 'round']);
    const unit = (card: string) => ({ card, x: [1, 7] });
    // Two known Attacker cards: each encodes to 0.5 + 0.5 = 1, sum/4 = 0.5 → 8 × 0.5 = 4; round 0.5 → −1.5.
    expect(valueLogit(c, { units: { A: [unit('tauros'), unit('tauros')], D: [unit('tauros')] }, global: [1, 0.5] })).toBeCloseTo(2.5);
    // An unknown card has no card vector: 0.5 each instead of 1.
    expect(valueLogit(c, { units: { A: [unit('newcard'), unit('newcard')], D: [] }, global: [0, 0] })).toBeCloseTo(2);
  });

  it('reads every feature the bot computes from a real position', () => {
    const s = setup(['tauros', 'furret'], ['cherrim'], { A0: { x: 9, y: 4 }, A1: { x: 7, y: 4 }, D0: { x: 5, y: 0 } });
    const f = positionFeatures(s);
    expect(f.global).toHaveLength(GLOBAL_FEATURES.length);
    for (const u of [...f.units.A, ...f.units.D]) {
      expect(u.x).toHaveLength(UNIT_FEATURES.length);
      expect(u.x.every(Number.isFinite)).toBe(true);
    }
    expect(f.global.every(Number.isFinite)).toBe(true);
  });
});
