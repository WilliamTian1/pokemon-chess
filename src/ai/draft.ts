import {
  type CardDef, type GameState, type Side, TEAM_SIZE, bestHit, draftOptions, getCard, isLegendPick, parseGrid, typeMultiplier,
} from '../engine';
import { draftModelFor, modeOf } from './draftModel';
import { rateCard } from './rating';

/**
 * Team-strength model fitted by scripts/train-draft.ts:
 * logit P(Attacker wins) = bias + Σ A[c] over the Attacker's cards + Σ D[c] over the Defender's
 * + matchup × matchupBalance + priorA × priorFeature(A team) + priorD × priorFeature(D team).
 */
export interface DraftModel {
  games: number;
  lambda: number;
  bias: number;
  matchup: number;
  priorA: number;
  priorD: number;
  A: Record<string, number>;
  D: Record<string, number>;
  /**
   * Optional pair terms (a factorization machine of rank `k`): same-team synergy is the dot product
   * of two cards' syn vectors, and Attacker-vs-Defender interaction is crossA · crossD.
   */
  k?: number;
  synA?: Record<string, number[]>;
  synD?: Record<string, number[]>;
  crossA?: Record<string, number[]>;
  crossD?: Record<string, number[]>;
  /**
   * Trainer mode: each trainer's value for the Attacker (A) and the Defender (D), plus a weight on
   * how well it suits the team that picks it (synA / synD × trainerSynergy).
   */
  trainers?: Record<string, { A: number; D: number; synA: number; synD: number }>;
}

/**
 * How much a trainer's passive has to work with in `team` (against `opp`): recoil moves for N,
 * one-tile pushes for Blue, cooldown moves for Lance, Pikachu for Red, weather that would hurt the
 * team for Mitsuhide, attacks the team is immune to (plus Artillery Expertise) for Nobunaga.
 */
export function trainerSynergy(trainer: string, team: string[], opp: string[]): number {
  const cards = team.map(getCard);
  const moves = cards.flatMap((c) => c.moves);
  switch (trainer) {
    case 'n':
      return moves.filter((m) => m.fx.recoil || m.fx.recoilPerTarget).length / 2;
    case 'blue':
      return moves.filter((m) => m.target.kind === 'grid' && parseGrid(m.target.grid).knockback === 1).length / 2;
    case 'lance':
      return moves.filter((m) => m.fx.nextTurn || m.fx.lockUntilFar).length / 2;
    case 'red':
      return team.includes('pikachu') ? 1 : 0;
    case 'mitsuhide': {
      const all = [...team, ...opp].map(getCard);
      const has = (sp: string, ab?: string) => all.some((c) => c.ability === ab || c.moves.some((m) => m.fx.special === sp));
      let hurt = 0;
      for (const c of cards) {
        if ((has('sunnyDay', 'drought') && c.types.includes('Water')) || (has('rainDance', 'drizzle') && c.types.includes('Fire'))) hurt += 1;
        if (has('sandstorm') && !c.types.some((t) => t === 'Rock' || t === 'Ground' || t === 'Steel')) hurt += 1;
        if (has('hail') && !c.types.includes('Ice')) hurt += 1;
      }
      return hurt / 2;
    }
    case 'nobunaga': {
      const attacks = opp.map(getCard).flatMap((c) => c.moves.filter((m) => m.kind === 'attack' && m.type));
      const immune = cards.reduce((a, c) => a + attacks.filter((m) => typeMultiplier(m.type!, c.types) === 0).length, 0);
      return immune / 2 + cards.filter((c) => c.ability === 'artilleryExpertise').length;
    }
    default:
      return 0;
  }
}

/** Untrained trainer terms: no preference beyond a small pull towards trainers that suit the team. */
const TRAINER_PRIOR = { A: 0, D: 0, synA: 0.15, synD: -0.15 };

/** Logit change from `side` having `trainer` (teams complete). */
export function trainerGain(m: DraftModel, trainer: string, side: Side, team: string[], opp: string[]): number {
  const t = m.trainers?.[trainer] ?? TRAINER_PRIOR;
  return side === 'A' ? t.A + t.synA * trainerSynergy(trainer, team, opp) : t.D + t.synD * trainerSynergy(trainer, team, opp);
}

/**
 * The trainer pick: exact minimax over the offered trainers (the Attacker picks first, then the
 * Defender from the rest), scoring each pairing with the model's trainer terms.
 */
export function bestTrainerPick(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): string {
  const options = draftOptions(s);
  const { A, D } = s.draft.picks;
  const gA = (t: string) => trainerGain(m, t, 'A', A, D);
  const gD = (t: string) => trainerGain(m, t, 'D', D, A);
  if (side === 'D') return [...options].sort((x, y) => gD(x) - gD(y))[0];
  const value = (t: string) => gA(t) + Math.min(...options.filter((o) => o !== t).map(gD), 0);
  return [...options].sort((x, y) => value(y) - value(x))[0];
}

const hitCache = new Map<string, number>();

/** log2 of the best multiplier `a`'s attacks get on `b` (floored at ¼ so immunities stay finite). */
function hitLog(a: CardDef, b: CardDef): number {
  const k = `${a.id}>${b.id}`;
  let v = hitCache.get(k);
  if (v === undefined) {
    v = Math.log2(Math.max(0.25, bestHit(a, b)?.mult ?? 0.5));
    hitCache.set(k, v);
  }
  return v;
}

/** Average type advantage of the Attacker's team over the Defender's (both directions). */
export function matchupBalance(teamA: string[], teamD: string[]): number {
  let t = 0;
  for (const a of teamA) {
    for (const d of teamD) t += hitLog(getCard(a), getCard(d)) - hitLog(getCard(d), getCard(a));
  }
  return t / 16;
}

/** The hand-made rating, scaled, as a fallback signal for rarely seen cards. */
export function priorFeature(team: string[], side: Side): number {
  return team.reduce((a, id) => a + rateCard(getCard(id), side).total, 0) / 100;
}

/** Logit change of adding card `id` to `side`'s team, ignoring matchups. */
function cardGain(m: DraftModel, id: string, side: Side): number {
  return side === 'A'
    ? (m.A[id] ?? 0) + m.priorA * priorFeature([id], 'A')
    : (m.D[id] ?? 0) + m.priorD * priorFeature([id], 'D');
}

/** Sum of pairwise dot products of the cards' vectors in `table` (same-team synergy). */
function pairSum(table: Record<string, number[]>, team: string[]): number {
  let z = 0;
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const a = table[team[i]];
      const b = table[team[j]];
      if (a && b) for (let k = 0; k < a.length; k++) z += a[k] * b[k];
    }
  }
  return z;
}

/** Model estimate of logit P(Attacker wins) for two complete (or partial) teams. */
export function teamLogit(m: DraftModel, teamA: string[], teamD: string[]): number {
  let z = m.bias;
  for (const id of teamA) z += cardGain(m, id, 'A');
  for (const id of teamD) z += cardGain(m, id, 'D');
  z += m.matchup * matchupBalance(teamA, teamD);
  if (m.k && m.synA && m.synD && m.crossA && m.crossD) {
    z += pairSum(m.synA, teamA) + pairSum(m.synD, teamD);
    for (const a of teamA) {
      for (const d of teamD) {
        const x = m.crossA[a];
        const y = m.crossD[d];
        if (x && y) for (let k = 0; k < x.length; k++) z += x[k] * y[k];
      }
    }
  }
  return z;
}

export const hasDraftModel = (mapId: string): boolean => draftModelFor(mapId).games > 0;

/** Logit P(Attacker wins) → probability. */
export const winChance = (logit: number): number => 1 / (1 + Math.exp(-logit));

/** Why a pick is worth what it is, in logit points that favour the side making the pick. */
export interface PickBreakdown {
  /** The card's own value for this role. */
  card: number;
  /** Type matchups against the opponent's picks so far. */
  matchup: number;
  /** Learned synergy with this side's picks and interactions with the opponent's. */
  synergy: number;
  /** What the opponent would have gained by taking this card instead. */
  denial: number;
}

export interface PickLine {
  id: string;
  /** Logit P(Attacker wins) if both sides then draft per the model. */
  value: number;
  /** The predicted rest of the draft after this pick. */
  pv: { side: Side; id: string }[];
  why: PickBreakdown;
}

export interface DraftAnalysis {
  side: Side;
  /** Value of the best line (logit P(Attacker wins)). */
  value: number;
  /** Options best-first for the side on the clock. */
  lines: PickLine[];
}

const NODE_CAP = 600_000;

/**
 * Numeric form of the model for one draft: every card-pair interaction is precomputed, so adding a
 * card costs a few additions. logit = bias + Σ lin + Σ_{a∈A,d∈D} vs[a][d] + Σ same-team pairs.
 */
function compile(m: DraftModel, ids: string[]) {
  const n = ids.length;
  const dot = (x?: number[], y?: number[]) => (x && y ? x.reduce((a, v, k) => a + v * y[k], 0) : 0);
  const lin = { A: ids.map((id) => cardGain(m, id, 'A')), D: ids.map((id) => cardGain(m, id, 'D')) };
  const vs = ids.map((a) => ids.map((d) => (m.matchup * (hitLog(getCard(a), getCard(d)) - hitLog(getCard(d), getCard(a)))) / 16 + dot(m.crossA?.[a], m.crossD?.[d])));
  const vsType = ids.map((a) => ids.map((d) => (m.matchup * (hitLog(getCard(a), getCard(d)) - hitLog(getCard(d), getCard(a)))) / 16));
  const syn = {
    A: ids.map((x) => ids.map((y) => dot(m.synA?.[x], m.synA?.[y]))),
    D: ids.map((x) => ids.map((y) => dot(m.synD?.[x], m.synD?.[y]))),
  };
  /** Logit change of `side` adding card i to the teams (card indices). */
  const gain = (i: number, side: Side, A: number[], D: number[]): number => {
    let g = lin[side][i];
    if (side === 'A') {
      for (const d of D) g += vs[i][d];
      for (const a of A) g += syn.A[i][a];
    } else {
      for (const a of A) g += vs[a][i];
      for (const d of D) g += syn.D[i][d];
    }
    return g;
  };
  const logit = (A: number[], D: number[]): number => {
    let z = m.bias;
    const a2: number[] = [];
    const d2: number[] = [];
    for (const a of A) {
      z += gain(a, 'A', a2, d2);
      a2.push(a);
    }
    for (const d of D) {
      z += gain(d, 'D', a2, d2);
      d2.push(d);
    }
    return z;
  };
  return { n, lin, vsType, gain, logit };
}

/**
 * Draft search: alpha-beta over the remaining picks (the Attacker maximises the model's win logit,
 * the Defender minimises it). At each pick the options are ordered by their full effect on the
 * current teams (card value, matchups, synergy) for whoever takes them, so denial is valued too.
 * By default every option is searched (exact minimax over the model; about 0.2 s at the first
 * pick), with good ordering for pruning and a table so positions reached by the same picks in
 * another order are searched once. `width` limits the options per pick; `all` scores every first
 * pick in full (analysis), otherwise the line found is enough (play).
 */
export function analyzeDraft(s: GameState, m: DraftModel = draftModelFor(s.mapId, modeOf(s)), opts: { width?: number; all?: boolean } = {}): DraftAnalysis {
  const width = opts.width ?? Infinity;
  const ids = [...new Set([...s.draft.pool, ...s.draft.legendPool, ...s.draft.picks.A, ...s.draft.picks.D])];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const M = compile(m, ids);
  const taken = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
  // The Pokémon picks still to come (a trainer pick afterwards is chosen separately).
  const order = s.draft.order.slice(s.draft.index, 2 * TEAM_SIZE);
  const teams: Record<Side, number[]> = { A: s.draft.picks.A.map((id) => idx.get(id)!), D: s.draft.picks.D.map((id) => idx.get(id)!) };
  // The normal pool and the legendary pool are drafted separately (legendaries last).
  const free = {
    normal: s.draft.pool.filter((id) => !taken.has(id)).map((id) => idx.get(id)!),
    legend: s.draft.legendPool.filter((id) => !taken.has(id)).map((id) => idx.get(id)!),
  };
  const kind = (k: number): 'normal' | 'legend' => (isLegendPick(s, s.draft.index + k) ? 'legend' : 'normal');
  // It matters who gets a card by (logit if the Attacker takes it) − (logit if the Defender does):
  // the stake is the same for both players, so both look at the biggest stakes first.
  const ranked = (list: number[]): number[] => {
    const stake = new Map(list.map((i) => [i, M.gain(i, 'A', teams.A, teams.D) - M.gain(i, 'D', teams.A, teams.D)]));
    return [...list].sort((x, y) => stake.get(y)! - stake.get(x)!);
  };
  const withPick = <T,>(k: number, who: Side, i: number, f: () => T): T => {
    const list = free[kind(k)];
    const at = list.indexOf(i);
    list.splice(at, 1);
    teams[who].push(i);
    const v = f();
    teams[who].pop();
    list.splice(at, 0, i);
    return v;
  };

  // Transposition table: value bounds per (pick number, A's set, D's set).
  const tt = new Map<string, { v: number; flag: 0 | 1 | -1; pv: number[] }>();
  const key = (k: number) => `${k}|${[...teams.A].sort((a, b) => a - b).join(',')}|${[...teams.D].sort((a, b) => a - b).join(',')}`;
  let nodes = 0;
  const search = (k: number, alpha: number, beta: number): { v: number; pv: number[] } => {
    nodes += 1;
    const options = k < order.length ? free[kind(k)] : [];
    if (!options.length || nodes > NODE_CAP) return { v: M.logit(teams.A, teams.D), pv: [] };
    const tk = key(k);
    const hit = tt.get(tk);
    if (hit && (hit.flag === 0 || (hit.flag === 1 && hit.v >= beta) || (hit.flag === -1 && hit.v <= alpha))) return hit;
    const a0 = alpha;
    const b0 = beta;
    const who = order[k];
    let best = { v: who === 'A' ? -Infinity : Infinity, pv: [] as number[] };
    for (const i of ranked(options).slice(0, width)) {
      const r = withPick(k, who, i, () => search(k + 1, alpha, beta));
      if (who === 'A' ? r.v > best.v : r.v < best.v) best = { v: r.v, pv: [i, ...r.pv] };
      if (who === 'A') alpha = Math.max(alpha, r.v);
      else beta = Math.min(beta, r.v);
      if (beta <= alpha) break;
    }
    // Lower bound if the search was cut off above, upper bound if below, exact otherwise.
    const flag = best.v >= b0 ? 1 : best.v <= a0 ? -1 : 0;
    tt.set(tk, { ...best, flag });
    return best;
  };

  const side = order[0];
  const other: Side = side === 'A' ? 'D' : 'A';
  const sign = side === 'A' ? 1 : -1;
  const options = free[kind(0)];
  const roots = opts.all ? options : ranked(options).slice(0, Math.min(options.length, width + 2));
  const lines: PickLine[] = roots.map((i) => {
    const linear = M.lin[side][i];
    const typeMatchup = side === 'A'
      ? teams.D.reduce((a, d) => a + M.vsType[i][d], 0)
      : teams.A.reduce((a, x) => a + M.vsType[x][i], 0);
    const total = M.gain(i, side, teams.A, teams.D);
    const why: PickBreakdown = {
      card: sign * linear,
      matchup: sign * typeMatchup,
      synergy: sign * (total - linear - typeMatchup),
      denial: -sign * M.gain(i, other, teams.A, teams.D),
    };
    const r = withPick(0, side, i, () => search(1, -Infinity, Infinity));
    return { id: ids[i], value: r.v, pv: r.pv.map((pi, n) => ({ side: order[n + 1], id: ids[pi] })), why };
  });
  lines.sort((a, b) => sign * (b.value - a.value));
  return { side, value: lines[0]?.value ?? M.logit(teams.A, teams.D), lines };
}

/** The pick the Hard bot makes: the top line of the draft search. */
export function bestDraftPick(s: GameState, _side: Side, m: DraftModel = draftModelFor(s.mapId, modeOf(s))): string {
  return analyzeDraft(s, m).lines[0].id;
}
