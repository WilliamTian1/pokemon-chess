/**
 * Fits the Hard bot's draft model from random-draft self-play games (see scripts/arena.ts):
 *
 *   npx tsx scripts/arena.ts --a hard --d hard --draft random --map river --games 6000 --out games.jsonl
 *   npx tsx scripts/train-draft.ts --map river games.jsonl [more.jsonl…]
 *
 * Model: logit P(Attacker wins) = bias + Σ attacker-card values + Σ defender-card values
 *        + matchup weight × type-matchup balance + prior weights × heuristic ratings.
 * Card values are L2-regularised (strength picked by cross-validation), so a card that was rarely
 * seen falls back to the heuristic rating. Writes src/ai/models/<map>.json (one model per map).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFTABLE } from '../src/engine';
import { type DraftModel, matchupBalance, priorFeature } from '../src/ai/draft';
import type { GameRecord } from './arena';

const mapIdx = process.argv.indexOf('--map');
const mapId = mapIdx > 0 ? process.argv[mapIdx + 1] : 'meadow';
const files = process.argv.slice(2).filter((a, i, all) => a !== '--map' && all[i - 1] !== '--map');
if (!files.length) throw new Error('usage: train-draft.ts --map <id> games.jsonl […]');
const games: GameRecord[] = files.flatMap((f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as GameRecord));

const ids = DRAFTABLE.map((c) => c.id);
const index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length;
// Feature layout: [A cards (N), D cards (N), matchup, priorA, priorD]; bias is separate.
const F = 2 * N + 3;
const MATCH = 2 * N;
const PRIOR_A = 2 * N + 1;
const PRIOR_D = 2 * N + 2;

interface Row {
  sparse: number[];
  dense: [number, number, number];
  y: number;
}

const rows: Row[] = games.map((g) => ({
  sparse: [...g.teams.A.map((id) => index.get(id)!), ...g.teams.D.map((id) => N + index.get(id)!)],
  dense: [matchupBalance(g.teams.A, g.teams.D), priorFeature(g.teams.A, 'A'), priorFeature(g.teams.D, 'D')],
  y: g.winner === 'A' ? 1 : 0,
}));

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function predict(w: Float64Array, b: number, r: Row): number {
  let z = b;
  for (const i of r.sparse) z += w[i];
  z += w[MATCH] * r.dense[0] + w[PRIOR_A] * r.dense[1] + w[PRIOR_D] * r.dense[2];
  return z;
}

/** Full-batch Adam on mean log loss + λ/2·|card weights|² (dense weights unregularised). */
function fit(train: Row[], lambda: number): { w: Float64Array; b: number } {
  const w = new Float64Array(F);
  let b = 0;
  const m = new Float64Array(F + 1);
  const v = new Float64Array(F + 1);
  const g = new Float64Array(F + 1);
  const lr = 0.05;
  for (let it = 1; it <= 1500; it++) {
    g.fill(0);
    for (const r of train) {
      const e = sigmoid(predict(w, b, r)) - r.y;
      for (const i of r.sparse) g[i] += e;
      g[MATCH] += e * r.dense[0];
      g[PRIOR_A] += e * r.dense[1];
      g[PRIOR_D] += e * r.dense[2];
      g[F] += e;
    }
    for (let i = 0; i <= F; i++) {
      g[i] /= train.length;
      if (i < 2 * N) g[i] += lambda * w[i];
      m[i] = 0.9 * m[i] + 0.1 * g[i];
      v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i];
      const step = (lr * (m[i] / (1 - 0.9 ** it))) / (Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
      if (i === F) b -= step;
      else w[i] -= step;
    }
  }
  return { w, b };
}

const logLoss = (w: Float64Array, b: number, set: Row[]): number =>
  set.reduce((a, r) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(predict(w, b, r))));
    return a - (r.y ? Math.log(p) : Math.log(1 - p));
  }, 0) / set.length;

// 5-fold cross-validation for λ.
const folds = 5;
const lambdas = [0.0001, 0.0003, 0.001, 0.003, 0.01];
let bestLambda = lambdas[0];
let bestLoss = Infinity;
const baseRate = rows.reduce((a, r) => a + r.y, 0) / rows.length;
const constLoss = -(baseRate * Math.log(baseRate) + (1 - baseRate) * Math.log(1 - baseRate));
console.log(`${rows.length} games, Attacker win rate ${(100 * baseRate).toFixed(1)}%, constant-model log loss ${constLoss.toFixed(4)}`);
for (const lambda of lambdas) {
  let loss = 0;
  for (let k = 0; k < folds; k++) {
    const train = rows.filter((_, i) => i % folds !== k);
    const test = rows.filter((_, i) => i % folds === k);
    const { w, b } = fit(train, lambda);
    loss += logLoss(w, b, test) / folds;
  }
  console.log(`  λ=${lambda}: held-out log loss ${loss.toFixed(4)}`);
  if (loss < bestLoss) {
    bestLoss = loss;
    bestLambda = lambda;
  }
}
const { w, b } = fit(rows, bestLambda);
const model: DraftModel = {
  games: rows.length,
  lambda: bestLambda,
  bias: +b.toFixed(4),
  matchup: +w[MATCH].toFixed(4),
  priorA: +w[PRIOR_A].toFixed(4),
  priorD: +w[PRIOR_D].toFixed(4),
  A: Object.fromEntries(ids.map((id, i) => [id, +w[i].toFixed(4)])),
  D: Object.fromEntries(ids.map((id, i) => [id, +w[N + i].toFixed(4)])),
};
console.log(`chosen λ=${bestLambda}; matchup ${model.matchup}, priorA ${model.priorA}, priorD ${model.priorD}`);
const total = (id: string, side: 'A' | 'D') => model[side][id] + (side === 'A' ? model.priorA : model.priorD) * priorFeature([id], side);
for (const side of ['A', 'D'] as const) {
  // For the Attacker a higher logit is better; for the Defender a lower one.
  const sorted = [...ids].sort((x, y) => (side === 'A' ? total(y, side) - total(x, side) : total(x, side) - total(y, side)));
  console.log(`best as ${side}: ${sorted.slice(0, 10).map((id) => `${id} ${total(id, side).toFixed(2)}`).join(', ')}`);
  console.log(`worst as ${side}: ${sorted.slice(-6).map((id) => `${id} ${total(id, side).toFixed(2)}`).join(', ')}`);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../src/ai/models/${mapId}.json`);
fs.writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
console.log(`wrote ${out}`);
