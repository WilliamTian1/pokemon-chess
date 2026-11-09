import {
  type Action, CARDS, DRAFTABLE, type GameState, LEGEND_POOL_SIZE, type Rng, type Side, TEAM_SIZE, canBidFor, draftOptions,
  otherSide, seededRng,
} from '../engine';
import type { Difficulty } from './bot';
import { type DraftModel, priorFeature, teamLogit, trainerSynergy } from './draft';
import { draftModelFor, modeOf } from './draftModel';
import { rateCard } from './rating';

/**
 * Bot play for the Secret draft and the Auction. Both use the same win model as the classic draft (one
 * model of who wins with which teams on which map); only the search on top differs. Neither looks at
 * hidden information: the opponent's secret pool and picks, or the order of the auction's lots.
 */

/** A card's logit contribution for `side`, as a gain for that side (positive = good for it). */
function gain(m: DraftModel, id: string, side: Side): number {
  const raw = side === 'A' ? (m.A[id] ?? 0) + m.priorA * priorFeature([id], 'A') : (m.D[id] ?? 0) + m.priorD * priorFeature([id], 'D');
  return side === 'A' ? raw : -raw;
}

/** `side`'s view of a final matchup: the logit, signed so that higher is better for `side`. */
const forSide = (m: DraftModel, side: Side, own: string[], opp: string[]): number => {
  const z = side === 'A' ? teamLogit(m, own, opp) : teamLogit(m, opp, own);
  return side === 'A' ? z : -z;
};

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const legendary = (id: string): boolean => CARDS[id].legendary;

// ---------------------------------------------------------------- secret draft

/**
 * The best card to pick next from `side`'s own pool: the whole team that does best on average against
 * likely opponent teams (random pools from the cards it can't see, the opponent taking the strongest),
 * then its next card. No denial: the opponent never picks from the same pool.
 */
export function bestSecretPick(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): string {
  return analyzeSecretPick(s, side, m).lines[0]?.id ?? draftOptions(s, side)[0];
}

/** One option of a Secret pick: the best full team that includes it, and how it fares on average. */
export interface SecretLine {
  id: string;
  /** Average logit P(Attacker wins) of `team` against the sampled opponent teams. */
  value: number;
  /** The rest of that team (the predicted remaining picks, this one first). */
  team: string[];
}

/**
 * Secret draft: every option for `side`'s next Pokémon pick, valued by the best whole team that includes
 * it against likely opponents (what bestSecretPick plays: the first line). The opponent's pool and picks
 * aren't used, as the bot can't see them.
 */
export function analyzeSecretPick(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): { side: Side; lines: SecretLine[] } {
  const sp = s.draft.secret!;
  const have = s.draft.picks[side];
  const pool = sp.pools[side].filter((id) => !have.includes(id));
  const legends = sp.legendPools[side];
  const needLegend = legends.length > 0 && !have.some(legendary);
  const normalsNeeded = TEAM_SIZE - have.length - (needLegend ? 1 : 0);
  const rng = seededRng(hash(`${s.mapId}|${side}|${have.join(',')}|${pool.join(',')}`));
  const opponents = sampleOpponents(s, side, m, rng, 40);
  const options = new Set(draftOptions(s, side));
  const best = new Map<string, { v: number; team: string[] }>();
  for (const combo of combinations(pool, Math.max(0, normalsNeeded))) {
    for (const l of needLegend ? legends : [null]) {
      const rest = [...combo, ...(l ? [l] : [])];
      const team = [...have, ...rest];
      let v = 0;
      for (const opp of opponents) v += forSide(m, side, team, opp);
      for (const id of rest) {
        if (!options.has(id)) continue;
        const b = best.get(id);
        if (!b || v > b.v) best.set(id, { v, team: [id, ...rest.filter((x) => x !== id)] });
      }
    }
  }
  const n = opponents.length || 1;
  // forSide is `side`'s view; lines carry the Attacker's logit like the classic analysis.
  // Cards of the same best team tie; the stronger card on its own goes first.
  const lines = [...best].map(([id, b]) => ({ id, value: side === 'A' ? b.v / n : -b.v / n, team: b.team }))
    .sort((x, y) => (side === 'A' ? y.value - x.value : x.value - y.value) || gain(m, y.id, side) - gain(m, x.id, side));
  return { side, lines };
}

/**
 * Secret draft, trainer mode: every trainer option for `side` with its complete team, valued against the
 * same likely opponents (the trainer's value and the part of its synergy that doesn't depend on them).
 */
export function analyzeSecretTrainer(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): { side: Side; lines: SecretLine[] } {
  const team = s.draft.picks[side];
  const rng = seededRng(hash(`${s.mapId}|${side}|${team.join(',')}|trainer`));
  const opponents = sampleOpponents(s, side, m, rng, 40);
  const base = opponents.reduce((a, opp) => a + (side === 'A' ? teamLogit(m, team, opp) : teamLogit(m, opp, team)), 0) / (opponents.length || 1);
  const term = (id: string) => {
    const t = m.trainers?.[id];
    if (!t) return 0;
    return side === 'A' ? t.A + t.synA * trainerSynergy(id, team, []) : t.D + t.synD * trainerSynergy(id, team, []);
  };
  const lines = draftOptions(s, side).map((id) => ({ id, value: base + term(id), team: [] as string[] }))
    .sort((x, y) => (side === 'A' ? y.value - x.value : x.value - y.value));
  return { side, lines };
}

/**
 * Secret draft, trainer mode: the trainer from `side`'s own options that suits its (now complete) team
 * best, by the model's trainer values and synergy terms. The opponent's team is unknown, so the part of
 * the synergy that depends on it is left out.
 */
export function secretTrainerPick(s: GameState, side: Side, level: Difficulty, rng: Rng, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): string {
  const options = draftOptions(s, side);
  if (level === 'easy' || !m.trainers) return options[rng.int(options.length)];
  const team = s.draft.picks[side];
  const score = (id: string) => {
    const t = m.trainers![id];
    if (!t) return 0;
    const v = side === 'A' ? t.A + t.synA * trainerSynergy(id, team, []) : -(t.D + t.synD * trainerSynergy(id, team, []));
    return v + (level === 'medium' ? (rng.int(1000) / 1000 - 0.5) * 0.2 : 0);
  };
  return [...options].sort((a, b) => score(b) - score(a))[0];
}

/** Plausible opponent teams: a random pool of cards `side` can't see, from which it takes the best by value. */
function sampleOpponents(s: GameState, side: Side, m: DraftModel, rng: Rng, n: number): string[][] {
  const opp = otherSide(side);
  const mine = new Set([...s.draft.secret!.pools[side], ...s.draft.secret!.legendPools[side]]);
  const unseen = DRAFTABLE.filter((c) => !mine.has(c.id));
  const normals = unseen.filter((c) => !c.legendary).map((c) => c.id);
  const legends = unseen.filter((c) => c.legendary).map((c) => c.id);
  // The opponent's pools are hidden, but they are the same size as ours.
  const k = s.draft.secret!.legendPools[side].length;
  const size = s.draft.secret!.pools[side].length;
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const pool = shuffle(normals, rng).slice(0, size).sort((a, b) => gain(m, b, opp) - gain(m, a, opp));
    const team = pool.slice(0, k ? TEAM_SIZE - 1 : TEAM_SIZE);
    if (k) team.push(shuffle(legends, rng).slice(0, k).sort((a, b) => gain(m, b, opp) - gain(m, a, opp))[0]);
    out.push(team);
  }
  return out;
}

function* combinations<T>(xs: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i <= xs.length - (k - acc.length); i++) {
    acc.push(xs[i]);
    yield* combinations(xs, k, i + 1, acc);
    acc.pop();
  }
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Medium and Easy in the secret draft: the classic heuristic, with the opponent's picks hidden. */
export function simpleSecretPick(s: GameState, side: Side, level: Difficulty, rng: Rng): string {
  const options = draftOptions(s, side).map((id) => CARDS[id]);
  const scored = options.map((c) => ({ c, v: rateCard(c, side).total * (1 + (rng.int(1000) / 1000 - 0.5) * (level === 'easy' ? 0.6 : 0.2)) }))
    .sort((a, b) => b.v - a.v);
  return scored[level === 'easy' ? rng.int(Math.min(6, scored.length)) : 0].c.id;
}

// ---------------------------------------------------------------- auction

/** Reservation prices, per decision point, so a bot doesn't redo the rollouts for every raise. */
const reserveCache = new Map<string, number>();

/** The bot's bid or pass in an auction. */
export function auctionAction(s: GameState, side: Side, level: Difficulty, rng: Rng): Action {
  const a = s.draft.auction!;
  const lot = a.lot!;
  const key = `${s.mapId}|${side}|${lot}|${s.draft.picks.A.join(',')}|${s.draft.picks.D.join(',')}|${a.coins.A}|${a.coins.D}|${a.history.length}|${level}`;
  let reserve = reserveCache.get(key);
  if (reserve === undefined) {
    reserve = level === 'hard' ? hardReserve(s, side) : simpleReserve(s, side, level, rng);
    if (reserveCache.size > 5000) reserveCache.clear();
    reserveCache.set(key, reserve);
  }
  const ask = a.high ? a.high.amount + 1 : 0;
  return ask <= reserve && ask <= a.coins[side] ? { type: 'bid', amount: ask } : { type: 'passBid' };
}

/** Easy/Medium: a share of coins per open slot, scaled by how good the card looks. */
function simpleReserve(s: GameState, side: Side, level: Difficulty, rng: Rng): number {
  const a = s.draft.auction!;
  const slots = TEAM_SIZE - s.draft.picks[side].length;
  const card = CARDS[a.lot!];
  const rating = rateCard(card, side).total;
  const avg = DRAFTABLE.reduce((t, c) => t + rateCard(c, side).total, 0) / DRAFTABLE.length;
  const per = a.coins[side] / Math.max(1, slots);
  const factor = Math.max(0, Math.min(2.5, 1 + (rating - avg) / 40)) * (1 + (rng.int(1000) / 1000 - 0.5) * (level === 'easy' ? 0.8 : 0.3));
  const r = Math.floor(per * factor);
  return rating < avg - 15 && slots < a.deck.length ? -1 : Math.min(a.coins[side], r);
}

interface Sim {
  teams: Record<Side, string[]>;
  coins: Record<Side, number>;
}

/**
 * Hard: the highest price at which winning this lot beats letting the opponent have it, estimated by
 * playing the rest of the auction out many times (unknown future lots drawn from the cards not yet
 * seen; both sides bidding by card value) and scoring the final teams with the win model.
 */
function hardReserve(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): number {
  return lotOutlook(s, side, m).reserve;
}

/**
 * Rollouts of the rest of the auction from the lot on offer, as `side` sees it: `ev(winner, price)` is
 * the average final logit for `side` (higher = better for it) if `winner` takes the lot at `price`
 * (null: nobody), and `reserve` the highest price at which taking it beats letting the opponent have
 * it (-1: not worth a bid).
 */
function lotOutlook(s: GameState, side: Side, m: DraftModel): { reserve: number; ev: (winner: Side | null, price: number) => number } {
  const a = s.draft.auction!;
  const lot = a.lot!;
  const opp = otherSide(side);
  const rng = seededRng(hash(`${lot}|${a.history.length}|${side}|${a.coins.A}|${a.coins.D}`));
  const seen = new Set([...s.draft.picks.A, ...s.draft.picks.D, ...a.history.map((h) => h.cardId), lot]);
  const unseen = DRAFTABLE.filter((c) => !seen.has(c.id));
  const legendsLeft = Math.max(0, (s.draft.legendPool.length ? LEGEND_POOL_SIZE : 0) - [...seen].filter(legendary).length);
  const decks: string[][] = [];
  for (let i = 0; i < 32; i++) {
    const l = shuffle(unseen.filter((c) => c.legendary), rng).slice(0, Math.min(legendsLeft, a.deck.length)).map((c) => c.id);
    const n = shuffle(unseen.filter((c) => !c.legendary), rng).slice(0, a.deck.length - l.length).map((c) => c.id);
    decks.push(shuffle([...l, ...n], rng));
  }
  const values = valueTables(m, unseen.map((c) => c.id).concat(lot));
  const memo = new Map<string, number>();
  const ev = (winner: Side | null, price: number): number => {
    const key = `${winner}|${price}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let t = 0;
    decks.forEach((deck, i) => {
      const sim: Sim = { teams: { A: [...s.draft.picks.A], D: [...s.draft.picks.D] }, coins: { ...a.coins } };
      if (winner) {
        sim.teams[winner].push(lot);
        sim.coins[winner] -= price;
      }
      rollout(sim, deck, values, seededRng(i * 7919 + 1), otherSide(a.opener));
      t += forSide(m, side, sim.teams[side], sim.teams[opp]);
    });
    memo.set(key, t / decks.length);
    return t / decks.length;
  };
  if (!canBidFor(s, side, lot)) return { reserve: -1, ev };
  const none = ev(null, 0);
  if (ev(side, 0) <= none) return { reserve: -1, ev };
  const oppCan = canBidFor(s, opp, lot);
  let reserve = 0;
  for (let p = 1; p <= a.coins[side]; p++) {
    const alt = oppCan && a.coins[opp] >= p ? ev(opp, p) : none;
    if (ev(side, p) >= alt) reserve = p;
    else break;
  }
  return { reserve, ev };
}

/** The Auction as the Hard bot reads the lot on offer (draft analysis). */
export interface AuctionAnalysis {
  /** The most each side would bid for the lot (-1: it wouldn't bid). */
  reserve: Record<Side, number>;
  /** Logit P(Attacker wins) after the rest of the auction if this side takes the lot for nothing, or nobody does. */
  ifTaken: Record<Side, number>;
  ifNobody: number;
  /** Where open bidding between the two reserves ends: the higher bidder pays one more than the other's limit. */
  predicted: { winner: Side | null; price: number; value: number };
}

export function analyzeAuction(s: GameState, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): AuctionAnalysis {
  const a = s.draft.auction!;
  const look = { A: lotOutlook(s, 'A', m), D: lotOutlook(s, 'D', m) };
  const reserve = { A: Math.min(look.A.reserve, a.coins.A), D: Math.min(look.D.reserve, a.coins.D) };
  // Attacker's logit, from the Attacker's rollouts.
  const ev = (winner: Side | null, price: number) => look.A.ev(winner, price);
  let winner: Side | null = null;
  if (reserve.A >= 0 || reserve.D >= 0) winner = reserve.A === reserve.D ? a.opener : reserve.A > reserve.D ? 'A' : 'D';
  const price = winner ? Math.min(reserve[winner], Math.max(0, reserve[otherSide(winner)] + 1)) : 0;
  return {
    reserve,
    ifTaken: { A: ev('A', 0), D: ev('D', 0) },
    ifNobody: ev(null, 0),
    predicted: { winner, price, value: ev(winner, price) },
  };
}

interface Values {
  /** Card value for each side, as a gain for that side. */
  v: Record<Side, Map<string, number>>;
  /** Average and spread of those values. */
  mean: Record<Side, number>;
  spread: Record<Side, number>;
}

function valueTables(m: DraftModel, ids: string[]): Values {
  const v = { A: new Map<string, number>(), D: new Map<string, number>() };
  const mean = { A: 0, D: 0 };
  const spread = { A: 1, D: 1 };
  for (const side of ['A', 'D'] as const) {
    for (const id of ids) v[side].set(id, gain(m, id, side));
    const xs = [...v[side].values()];
    mean[side] = xs.reduce((a, x) => a + x, 0) / xs.length;
    spread[side] = Math.sqrt(xs.reduce((a, x) => a + (x - mean[side]) ** 2, 0) / xs.length) || 1;
  }
  return { v, mean, spread };
}

/** Plays the remaining lots out: each side bids up to its coins-per-slot share scaled by the card's value. */
function rollout(sim: Sim, deck: string[], vals: Values, rng: Rng, firstOpener: Side): void {
  let opener = firstOpener;
  const hasL = (side: Side) => sim.teams[side].some(legendary);
  const can = (side: Side, id: string) => sim.teams[side].length < TEAM_SIZE && !(legendary(id) && hasL(side));
  const fill = (side: Side, rest: string[]) => {
    for (const id of rest) {
      if (sim.teams[side].length >= TEAM_SIZE) break;
      if (can(side, id)) sim.teams[side].push(id);
    }
  };
  let i = 0;
  for (; i < deck.length; i++) {
    if (sim.teams.A.length >= TEAM_SIZE && sim.teams.D.length >= TEAM_SIZE) return;
    const id = deck[i];
    const reserve = (side: Side): number => {
      if (!can(side, id)) return -1;
      const slots = TEAM_SIZE - sim.teams[side].length;
      const z = ((vals.v[side].get(id) ?? vals.mean[side]) - vals.mean[side]) / vals.spread[side];
      if (z < -0.5 && deck.length - i > 2 * slots) return -1;
      return Math.min(sim.coins[side], Math.floor((sim.coins[side] / slots) * Math.max(0, Math.min(2.5, 1 + 0.6 * z))));
    };
    const r = { A: reserve('A'), D: reserve('D') };
    const winner: Side | null = r.A < 0 && r.D < 0 ? null : r.A === r.D ? opener : r.A > r.D ? 'A' : 'D';
    if (winner) {
      const loser = otherSide(winner);
      sim.teams[winner].push(id);
      sim.coins[winner] -= Math.min(r[winner], Math.max(0, r[loser] + 1));
    }
    opener = otherSide(opener);
    for (const side of ['A', 'D'] as const) if (sim.coins[side] <= 0) fill(side, shuffle(deck.slice(i + 1), rng));
  }
  // Lots ran out: the rest at random from what's left.
  for (const side of ['A', 'D'] as const) fill(side, shuffle(deck, rng).filter((id) => !sim.teams.A.includes(id) && !sim.teams.D.includes(id)));
}

