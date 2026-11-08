import { type CardDef, type GameState, type Side, bestHit, getCard, isLegendPick } from '../engine';
import { draftModelFor } from './draftModel';
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

/** Model estimate of logit P(Attacker wins) for two complete (or partial) teams. */
export function teamLogit(m: DraftModel, teamA: string[], teamD: string[]): number {
  let z = m.bias;
  for (const id of teamA) z += cardGain(m, id, 'A');
  for (const id of teamD) z += cardGain(m, id, 'D');
  return z + m.matchup * matchupBalance(teamA, teamD);
}

export const hasDraftModel = (mapId: string): boolean => draftModelFor(mapId).games > 0;

/**
 * Exact-ish draft: alpha-beta over the remaining picks (the Attacker maximises the model's win
 * logit, the Defender minimises it), trying the few cards with the biggest swing at each pick.
 * Taking a card the opponent wants is valued automatically.
 */
export function bestDraftPick(s: GameState, side: Side, m: DraftModel = draftModelFor(s.mapId), width = 6): string {
  const taken = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
  const order = s.draft.order.slice(s.draft.index);
  const teams: Record<Side, string[]> = { A: [...s.draft.picks.A], D: [...s.draft.picks.D] };
  // The normal pool and the legendary pool are drafted separately (legendaries last).
  const free = {
    normal: s.draft.pool.filter((id) => !taken.has(id)),
    legend: s.draft.legendPool.filter((id) => !taken.has(id)),
  };
  // How much it matters who gets each card: the logit if the Attacker takes it minus the logit if
  // the Defender does. It is the stake for both players, so both look at the biggest swings first.
  const swing = new Map([...free.normal, ...free.legend].map((id) => [id, cardGain(m, id, 'A') - cardGain(m, id, 'D')]));
  const byStake = (list: string[]): string[] => [...list].sort((x, y) => swing.get(y)! - swing.get(x)!);
  const kind = (k: number): 'normal' | 'legend' => (isLegendPick(s.draft.index + k) ? 'legend' : 'normal');
  let nodes = 0;

  const search = (k: number, alpha: number, beta: number): number => {
    nodes += 1;
    const options = k < order.length ? free[kind(k)] : [];
    if (!options.length || nodes > 400_000) return teamLogit(m, teams.A, teams.D);
    const who = order[k];
    let best = who === 'A' ? -Infinity : Infinity;
    for (const id of byStake(options).slice(0, width)) {
      const v = withPick(k, who, id, () => search(k + 1, alpha, beta));
      if (who === 'A') {
        best = Math.max(best, v);
        alpha = Math.max(alpha, v);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, v);
      }
      if (beta <= alpha) break;
    }
    return best;
  };

  const withPick = (k: number, who: Side, id: string, f: () => number): number => {
    const list = free[kind(k)];
    const i = list.indexOf(id);
    list.splice(i, 1);
    teams[who].push(id);
    const v = f();
    teams[who].pop();
    list.splice(i, 0, id);
    return v;
  };

  const options = free[kind(0)];
  let pick = options[0];
  let bestV = side === 'A' ? -Infinity : Infinity;
  for (const id of byStake(options).slice(0, Math.max(width, 8))) {
    const v = withPick(0, side, id, () => search(1, -Infinity, Infinity));
    if (side === 'A' ? v > bestV : v < bestV) {
      bestV = v;
      pick = id;
    }
  }
  return pick;
}
