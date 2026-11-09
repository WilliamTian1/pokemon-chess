/**
 * Fits the Hard bot's draft model from random-draft self-play games (see scripts/arena.ts):
 *
 *   npx tsx scripts/arena.ts --a hard --d hard --draft random --map river --games 6000 --out games.jsonl
 *   npx tsx scripts/train-draft.ts --map river [--mode nlt] games.jsonl [more.jsonl…]
 *
 * Model: logit P(Attacker wins) = bias + Σ attacker-card values + Σ defender-card values
 *        + matchup weight × type-matchup balance + prior weights × heuristic ratings
 *        (+ in trainer mode, each side's trainer value and a weight on its synergy with the team).
 * Card values are L2-regularised (strength picked by cross-validation), so a card that was rarely
 * seen falls back to the heuristic rating. Writes src/ai/models/<map>[-<mode>].json: one model per map
 * and mode ('' legendaries, 'nl' without, 't' with trainers, 'nlt' both; see src/ai/draftModel.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFTABLE, TRAINER_LIST } from '../src/engine';
import { type DraftModel, matchupBalance, priorFeature, trainerSynergy } from '../src/ai/draft';
import type { GameRecord } from './arena';

const opt = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const mapId = opt('map') ?? 'meadow';
const mode = opt('mode') ?? '';
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!files.length) throw new Error('usage: train-draft.ts --map <id> [--mode nl|t|nlt] games.jsonl […]');
const games: GameRecord[] = files.flatMap((f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as GameRecord));

const ids = DRAFTABLE.map((c) => c.id);
const index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length;
const tids = TRAINER_LIST.map((t) => t.id);
const tindex = new Map(tids.map((id, i) => [id, i]));
const NT = tids.length;
const withTrainers = games.some((g) => g.trainers);
// Feature layout: [A cards (N), D cards (N), A trainer (NT), D trainer (NT), matchup, priorA, priorD,
// A trainer synergy (NT), D trainer synergy (NT)]; bias is separate. Cards and trainers are one-hot.
const TA = 2 * N;
const TD = 2 * N + NT;
const MATCH = 2 * N + 2 * NT;
const PRIOR_A = MATCH + 1;
const PRIOR_D = MATCH + 2;
const SYN_A = MATCH + 3;
const SYN_D = SYN_A + NT;
const F = SYN_D + NT;
/** One-hot features (cards, trainers) are L2-penalised; the rest are not. */
const PENALISED = MATCH;

interface Row {
  sparse: number[];
  /** Real-valued features: [index, value]. */
  dense: [number, number][];
  /** Card indices (0…N-1) of each team, for the pairwise terms. */
  a: number[];
  d: number[];
  y: number;
}

const rows: Row[] = games.map((g) => {
  const sparse = [...g.teams.A.map((id) => index.get(id)!), ...g.teams.D.map((id) => N + index.get(id)!)];
  const dense: [number, number][] = [
    [MATCH, matchupBalance(g.teams.A, g.teams.D)], [PRIOR_A, priorFeature(g.teams.A, 'A')], [PRIOR_D, priorFeature(g.teams.D, 'D')],
  ];
  const tA = g.trainers?.A;
  const tD = g.trainers?.D;
  if (tA) {
    sparse.push(TA + tindex.get(tA)!);
    dense.push([SYN_A + tindex.get(tA)!, trainerSynergy(tA, g.teams.A, g.teams.D)]);
  }
  if (tD) {
    sparse.push(TD + tindex.get(tD)!);
    dense.push([SYN_D + tindex.get(tD)!, trainerSynergy(tD, g.teams.D, g.teams.A)]);
  }
  return { sparse, dense, a: g.teams.A.map((id) => index.get(id)!), d: g.teams.D.map((id) => index.get(id)!), y: g.winner === 'A' ? 1 : 0 };
});

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * Parameters: linear weights (F), bias, then four K-dimensional factor tables of N cards each —
 * Attacker-team synergy, Defender-team synergy, and the two halves of the Attacker × Defender
 * interaction. Pair terms are dot products of factors (a factorization machine), so every pair of
 * cards gets an interaction without needing data for each pair separately.
 */
interface Params {
  K: number;
  p: Float64Array;
}

const BIAS = F;
const factorBase = (K: number, table: 0 | 1 | 2 | 3) => F + 1 + table * N * K;

function predict(P: Params, r: Row, grad?: { e: number; g: Float64Array }): number {
  const { K, p } = P;
  let z = p[BIAS];
  for (const i of r.sparse) z += p[i];
  for (const [i, v] of r.dense) z += p[i] * v;
  if (K > 0) {
    const sum = (table: 0 | 1 | 2 | 3, cards: number[]) => {
      const v = new Float64Array(K);
      let sq = 0;
      const base = factorBase(K, table);
      for (const c of cards) {
        for (let k = 0; k < K; k++) {
          const x = p[base + c * K + k];
          v[k] += x;
          sq += x * x;
        }
      }
      return { v, sq };
    };
    const sA = sum(0, r.a);
    const sD = sum(1, r.d);
    const cA = sum(2, r.a);
    const cD = sum(3, r.d);
    let synA = -sA.sq;
    let synD = -sD.sq;
    let cross = 0;
    for (let k = 0; k < K; k++) {
      synA += sA.v[k] * sA.v[k];
      synD += sD.v[k] * sD.v[k];
      cross += cA.v[k] * cD.v[k];
    }
    z += 0.5 * synA + 0.5 * synD + cross;
    if (grad) {
      const { e, g } = grad;
      for (const [table, cards, own, other] of [[0, r.a, sA.v, null], [1, r.d, sD.v, null], [2, r.a, null, cD.v], [3, r.d, null, cA.v]] as const) {
        const base = factorBase(K, table);
        for (const c of cards) {
          for (let k = 0; k < K; k++) {
            const at = base + c * K + k;
            g[at] += e * (own ? own[k] - p[at] : other![k]);
          }
        }
      }
    }
  }
  if (grad) {
    const { e, g } = grad;
    for (const i of r.sparse) g[i] += e;
    for (const [i, v] of r.dense) g[i] += e * v;
    g[BIAS] += e;
  }
  return z;
}

/** Full-batch Adam on mean log loss + L2 (λ on card weights, λf on factors). */
function fit(train: Row[], lambda: number, K: number, lambdaF: number): Params {
  const size = F + 1 + 4 * N * K;
  const P: Params = { K, p: new Float64Array(size) };
  // Small deterministic random start for the factors so the pair terms can grow apart.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.02;
  for (let i = F + 1; i < size; i++) P.p[i] = rand();
  const m = new Float64Array(size);
  const v = new Float64Array(size);
  const g = new Float64Array(size);
  const lr = 0.05;
  for (let it = 1; it <= 1500; it++) {
    g.fill(0);
    for (const r of train) predict(P, r, { e: sigmoid(predict(P, r)) - r.y, g });
    for (let i = 0; i < size; i++) {
      g[i] /= train.length;
      if (i < PENALISED) g[i] += lambda * P.p[i];
      else if (i > F) g[i] += lambdaF * P.p[i];
      m[i] = 0.9 * m[i] + 0.1 * g[i];
      v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i];
      P.p[i] -= (lr * (m[i] / (1 - 0.9 ** it))) / (Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return P;
}

const logLoss = (P: Params, set: Row[]): number =>
  set.reduce((a, r) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(predict(P, r))));
    return a - (r.y ? Math.log(p) : Math.log(1 - p));
  }, 0) / set.length;

// 5-fold cross-validation over the card-weight penalty, then over pair-term rank and penalty.
const folds = 5;
const cv = (lambda: number, K: number, lambdaF: number): number => {
  let loss = 0;
  for (let k = 0; k < folds; k++) {
    const P = fit(rows.filter((_, i) => i % folds !== k), lambda, K, lambdaF);
    loss += logLoss(P, rows.filter((_, i) => i % folds === k)) / folds;
  }
  return loss;
};
const baseRate = rows.reduce((a, r) => a + r.y, 0) / rows.length;
const constLoss = -(baseRate * Math.log(baseRate) + (1 - baseRate) * Math.log(1 - baseRate));
console.log(`${rows.length} games, Attacker win rate ${(100 * baseRate).toFixed(1)}%, constant-model log loss ${constLoss.toFixed(4)}`);
let best = { lambda: 0.001, K: 0, lambdaF: 0, loss: Infinity };
for (const lambda of [0.0003, 0.001, 0.003]) {
  const loss = cv(lambda, 0, 0);
  console.log(`  cards only, λ=${lambda}: held-out log loss ${loss.toFixed(4)}`);
  if (loss < best.loss) best = { lambda, K: 0, lambdaF: 0, loss };
}
for (const K of [2, 4]) {
  for (const lambdaF of [0.003, 0.01, 0.03]) {
    const loss = cv(best.K === 0 ? best.lambda : 0.001, K, lambdaF);
    console.log(`  + pair terms rank ${K}, λf=${lambdaF}: held-out log loss ${loss.toFixed(4)}`);
    if (loss < best.loss - 0.0005) best = { lambda: best.lambda, K, lambdaF, loss };
  }
}
const bestLambda = best.lambda;
const P = fit(rows, bestLambda, best.K, best.lambdaF);
const w = P.p;
const b = P.p[BIAS];
const factors = (table: 0 | 1 | 2 | 3) =>
  Object.fromEntries(ids.map((id, i) => [id, [...P.p.slice(factorBase(best.K, table) + i * best.K, factorBase(best.K, table) + (i + 1) * best.K)].map((x) => +x.toFixed(4))]));
const model: DraftModel = {
  games: rows.length,
  lambda: bestLambda,
  bias: +b.toFixed(4),
  matchup: +w[MATCH].toFixed(4),
  priorA: +w[PRIOR_A].toFixed(4),
  priorD: +w[PRIOR_D].toFixed(4),
  A: Object.fromEntries(ids.map((id, i) => [id, +w[i].toFixed(4)])),
  D: Object.fromEntries(ids.map((id, i) => [id, +w[N + i].toFixed(4)])),
  ...(best.K > 0 ? { k: best.K, synA: factors(0), synD: factors(1), crossA: factors(2), crossD: factors(3) } : {}),
  ...(withTrainers ? {
    trainers: Object.fromEntries(tids.map((id, i) => [id, {
      A: +w[TA + i].toFixed(4), D: +w[TD + i].toFixed(4), synA: +w[SYN_A + i].toFixed(4), synD: +w[SYN_D + i].toFixed(4),
    }])),
  } : {}),
};
console.log(`chosen: card λ=${bestLambda}, pair rank ${best.K}${best.K ? `, λf=${best.lambdaF}` : ' (pair terms did not help)'}, held-out log loss ${best.loss.toFixed(4)}`);

const total = (id: string, side: 'A' | 'D') => model[side][id] + (side === 'A' ? model.priorA : model.priorD) * priorFeature([id], side);
for (const side of ['A', 'D'] as const) {
  // For the Attacker a higher logit is better; for the Defender a lower one.
  const sorted = [...ids].sort((x, y) => (side === 'A' ? total(y, side) - total(x, side) : total(x, side) - total(y, side)));
  console.log(`best as ${side}: ${sorted.slice(0, 10).map((id) => `${id} ${total(id, side).toFixed(2)}`).join(', ')}`);
  console.log(`worst as ${side}: ${sorted.slice(-6).map((id) => `${id} ${total(id, side).toFixed(2)}`).join(', ')}`);
}
if (model.trainers) {
  console.log(`trainers (A value / syn, D value / syn): ${tids.map((id) => {
    const t = model.trainers![id];
    return `${id} ${t.A.toFixed(2)}/${t.synA.toFixed(2)} ${t.D.toFixed(2)}/${t.synD.toFixed(2)}`;
  }).join(' · ')}`);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../src/ai/models/${mapId}${mode ? `-${mode}` : ''}.json`);
fs.writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
console.log(`wrote ${out}`);
