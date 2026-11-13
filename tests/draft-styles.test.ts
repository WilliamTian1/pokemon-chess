import { describe, expect, it } from 'vitest';
import { analyzeAuction, analyzeSecretPick, bestSecretPick } from '../src/ai/styles';
import {
  AUCTION_COINS, type GameState, CARDS, DRAFTABLE, TRAINER_LIST, applyAction, auctionOpen, decider, deciders, draftOptions, getMap, hiddenView, newGame, seededRng,
} from '../src/engine';

const step = (s: GameState, a: Parameters<typeof applyAction>[1]) => applyAction(s, a, seededRng(3)).state;

describe('Secret draft', () => {
  it('both sides pick at the same time from their own pools, in any interleaving', () => {
    let s = newGame({ rng: seededRng(1), style: 'secret' });
    const sp = s.draft.secret!;
    expect(sp.pools.A).toHaveLength(15);
    expect(sp.legendPools.D).toHaveLength(3);
    expect(sp.pools.A.some((id) => sp.pools.D.includes(id))).toBe(false);
    expect(deciders(s)).toEqual(['A', 'D']);
    // The Defender may pick first, and the sides may alternate however they like.
    s = step(s, { type: 'draftPick', cardId: sp.pools.D[0], side: 'D' });
    s = step(s, { type: 'draftPick', cardId: sp.pools.A[0], side: 'A' });
    s = step(s, { type: 'draftPick', cardId: sp.pools.D[1], side: 'D' });
    expect(() => step(s, { type: 'draftPick', cardId: sp.pools.D[2], side: 'A' })).toThrow(/not in your pool/);
    s = step(s, { type: 'draftPick', cardId: sp.pools.D[2], side: 'D' });
    expect(draftOptions(s, 'D')).toEqual(sp.legendPools.D);
    s = step(s, { type: 'draftPick', cardId: sp.legendPools.D[0], side: 'D' });
    expect(deciders(s)).toEqual(['A']);
    expect(() => step(s, { type: 'draftPick', cardId: sp.pools.D[3], side: 'D' })).toThrow(/done/);
    for (let i = 0; i < 3; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, 'A')[0], side: 'A' });
    expect(s.phase).toBe('placement');
  });

  it('trainers are picked in secret too, each side from its own three', () => {
    let s = newGame({ rng: seededRng(4), style: 'secret', trainers: true });
    const tp = s.draft.secret!.trainerPools!;
    expect(tp.A).toHaveLength(3);
    expect(tp.A.some((id) => tp.D.includes(id))).toBe(false);
    for (const side of ['A', 'D'] as const) for (let i = 0; i < 4; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, side)[0], side });
    expect(draftOptions(s, 'A')).toEqual(tp.A);
    s = step(s, { type: 'draftPick', cardId: tp.A[1], side: 'A' });
    expect(s.trainers!.picks.A).toBe(tp.A[1]);
    expect(hiddenView(s, 'D').trainers!.picks.A).toBe('?');
    s = step(s, { type: 'draftPick', cardId: tp.D[0], side: 'D' });
    expect(s.phase).toBe('placement');
  });

  it('nothing of the other side shows until the battle begins, and placement is blind and simultaneous', () => {
    let s = newGame({ rng: seededRng(2), style: 'secret' });
    for (const side of ['A', 'D'] as const) for (let i = 0; i < 4; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, side)[0], side });
    const seenByA = hiddenView(s, 'A');
    expect(seenByA.units.every((u) => u.side === 'A')).toBe(true);
    expect(seenByA.draft.picks.D).toEqual(['?', '?', '?', '?']);
    expect(seenByA.draft.secret!.pools.D).toEqual([]);
    expect(deciders(s)).toEqual(['A', 'D']);
    const spawns = getMap(s.mapId).spawns;
    // Any order: the Defender places twice, then the Attacker.
    s = step(s, { type: 'place', unitId: 'D0', pos: spawns.D[0] });
    s = step(s, { type: 'place', unitId: 'D1', pos: spawns.D[1] });
    expect(s.log.at(-1)!.text).not.toMatch(new RegExp(CARDS[s.units.find((u) => u.id === 'D1')!.cardId].name));
    for (let i = 0; i < 4; i++) s = step(s, { type: 'place', unitId: `A${i}`, pos: spawns.A[i] });
    for (let i = 2; i < 4; i++) s = step(s, { type: 'place', unitId: `D${i}`, pos: spawns.D[i] });
    expect(s.phase).toBe('battle');
    expect(hiddenView(s, 'A').units).toHaveLength(8);
    expect(s.log.some((l) => l.text.startsWith('Revealed!'))).toBe(true);
  });

  it('without legendaries: 20-card pools and four picks each', () => {
    let s = newGame({ rng: seededRng(2), style: 'secret', legendaries: false });
    expect(s.draft.secret!.pools.D).toHaveLength(20);
    for (const side of ['A', 'D'] as const) for (let i = 0; i < 4; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, side)[0], side });
    expect(s.phase).toBe('placement');
    expect(s.units.every((u) => !CARDS[u.cardId].legendary)).toBe(true);
  });
});

describe('Freeplay draft', () => {
  it('lets each side pick any roster card without same-team duplicates, while allowing cross-side duplicates', () => {
    let s = newGame({ rng: seededRng(31), style: 'freeplay' });
    const option = draftOptions(s, 'A')[0];
    s = step(s, { type: 'draftPick', cardId: option, side: 'A' });
    expect(() => step(s, { type: 'draftPick', cardId: option, side: 'A' })).toThrow(/not in your pool/);
    s = step(s, { type: 'draftPick', cardId: option, side: 'D' });
    expect(s.draft.picks.A).toEqual([option]);
    expect(s.draft.picks.D).toEqual([option]);
    expect(new Set(s.draft.secret!.pools.A)).toEqual(new Set(DRAFTABLE.filter((c) => !c.legendary).map((c) => c.id)));
    expect(new Set(s.draft.secret!.legendPools.A)).toEqual(new Set(DRAFTABLE.filter((c) => c.legendary).map((c) => c.id)));
  });

  it('offers the full trainer roster independently to both sides and keeps selections hidden', () => {
    let s = newGame({ rng: seededRng(32), style: 'freeplay', trainers: true });
    for (const side of ['A', 'D'] as const) {
      for (let i = 0; i < 4; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, side)[0], side });
    }
    const allTrainers = TRAINER_LIST.map((t) => t.id);
    expect(s.draft.secret!.trainerPools?.A).toEqual(allTrainers);
    expect(s.draft.secret!.trainerPools?.D).toEqual(allTrainers);
    const trainer = allTrainers[0];
    s = step(s, { type: 'draftPick', cardId: trainer, side: 'A' });
    expect(draftOptions(s, 'D')).toContain(trainer);
    s = step(s, { type: 'draftPick', cardId: trainer, side: 'D' });
    expect(s.trainers!.picks).toEqual({ A: trainer, D: trainer });
    expect(hiddenView(s, 'A').trainers!.picks.D).toBe('?');
    expect(s.phase).toBe('placement');
  });

  it('removes all legendary choices when legendaries are disabled', () => {
    let s = newGame({ rng: seededRng(33), style: 'freeplay', legendaries: false });
    expect(s.draft.secret!.legendPools).toEqual({ A: [], D: [] });
    for (const side of ['A', 'D'] as const) {
      for (let i = 0; i < 4; i++) s = step(s, { type: 'draftPick', cardId: draftOptions(s, side)[0], side });
    }
    expect(s.phase).toBe('placement');
    expect(s.units.every((u) => !CARDS[u.cardId].legendary)).toBe(true);
  });
});

describe('Auction', () => {
  it('hides the deck but not whether legendaries are on or how many it holds', () => {
    const s = newGame({ rng: seededRng(4), style: 'auction' });
    const seen = hiddenView(s, 'A');
    expect(seen.draft.auction!.deck.every((id) => id === '?')).toBe(true);
    expect(seen.draft.pool).toEqual([]);
    expect(seen.draft.legendPool).toHaveLength(s.draft.legendPool.length);
    expect(seen.draft.legendPool.length).toBeGreaterThan(0);
    expect(seen.draft.legendPool.every((id) => id === '?')).toBe(true);
  });

  it('reveals one lot at a time; a raise passes the call, a pass gives the lot to the high bidder', () => {
    let s = newGame({ rng: seededRng(5), style: 'auction' });
    const a = s.draft.auction!;
    expect(a.coins).toEqual({ A: AUCTION_COINS, D: AUCTION_COINS });
    expect(a.lot).not.toBeNull();
    const first = a.lot!;
    const opener = decider(s)!;
    s = step(s, { type: 'bid', amount: 3 });
    expect(decider(s)).not.toBe(opener);
    expect(() => step(s, { type: 'bid', amount: 3 })).toThrow(/more than 3/);
    s = step(s, { type: 'bid', amount: 5 });
    s = step(s, { type: 'passBid' });
    const winner = opener === 'A' ? 'D' : 'A';
    expect(s.draft.picks[winner]).toEqual([first]);
    expect(s.draft.auction!.coins[winner]).toBe(AUCTION_COINS - 5);
    expect(s.draft.auction!.lot).not.toBe(first);
  });

  it('a lot nobody bids for is discarded', () => {
    let s = newGame({ rng: seededRng(6), style: 'auction' });
    const first = s.draft.auction!.lot;
    s = step(step(s, { type: 'passBid' }), { type: 'passBid' });
    expect(s.draft.auction!.history[0]).toMatchObject({ cardId: first, winner: null });
    expect(s.draft.picks.A.length + s.draft.picks.D.length).toBe(0);
  });

  it('running out of coins fills the rest of the team at random, and teams get at most one legendary', () => {
    let s = newGame({ rng: seededRng(7), style: 'auction' });
    // Whoever is on the clock spends everything on the first lot; the other passes.
    const spender = decider(s)!;
    s = step(s, { type: 'bid', amount: AUCTION_COINS });
    expect(s.draft.picks[spender]).toHaveLength(4);
    expect(s.draft.auction!.history.filter((h) => h.random)).toHaveLength(3);
    // The other side now takes lots alone until its team is full.
    for (let guard = 0; auctionOpen(s) && guard < 40; guard++) s = step(s, { type: 'bid', amount: 0 });
    expect(auctionOpen(s)).toBe(false);
    for (const side of ['A', 'D'] as const) {
      expect(s.draft.picks[side]).toHaveLength(4);
      expect(s.draft.picks[side].filter((id) => CARDS[id].legendary).length).toBeLessThanOrEqual(1);
    }
    expect(s.phase).toBe('placement');
  });

  it('with trainers, the trainer picks follow the auction', () => {
    let s = newGame({ rng: seededRng(8), style: 'auction', trainers: true });
    s = step(s, { type: 'bid', amount: AUCTION_COINS });
    for (let guard = 0; auctionOpen(s) && guard < 40; guard++) s = step(s, { type: 'bid', amount: 0 });
    expect(s.phase).toBe('draft');
    expect(decider(s)).toBe('A');
    s = step(s, { type: 'draftPick', cardId: draftOptions(s)[0] });
    s = step(s, { type: 'draftPick', cardId: draftOptions(s)[0] });
    expect(s.phase).toBe('placement');
  });
});

describe('draft analysis for Secret and Auction', () => {
  it('ranks every Secret option, and the bot plays the first', () => {
    const s = newGame({ rng: seededRng(11), style: 'secret' });
    for (const side of ['A', 'D'] as const) {
      const r = analyzeSecretPick(s, side);
      expect(r.lines.map((l) => l.id).sort()).toEqual([...draftOptions(s, side)].sort());
      expect(bestSecretPick(s, side)).toBe(r.lines[0].id);
      // Each line's team is a whole team: this pick and the rest.
      expect(r.lines[0].team).toHaveLength(4);
    }
  });

  it('reads an auction lot: limits within the coins, and nobody wins only if neither would bid', () => {
    const s = newGame({ rng: seededRng(12), style: 'auction' });
    const a = analyzeAuction(s);
    for (const side of ['A', 'D'] as const) expect(a.reserve[side]).toBeLessThanOrEqual(s.draft.auction!.coins[side]);
    expect(a.predicted.winner === null).toBe(a.reserve.A < 0 && a.reserve.D < 0);
    if (a.predicted.winner) expect(a.predicted.price).toBeLessThanOrEqual(a.reserve[a.predicted.winner]);
  });
});
