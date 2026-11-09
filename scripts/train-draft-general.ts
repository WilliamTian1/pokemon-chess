/**
 * Fits ONE draft model for every map and game mode from random-draft self-play games (scripts/arena.ts):
 *
 *   npx tsx scripts/train-draft-general.ts meadow.jsonl@meadow river-t.jsonl@river […]
 *
 * (`@map` is only needed for records written before arena.ts stored the map.)
 *
 * Model: logit P(Attacker wins) = bias + context biases
 *        + Σ Attacker cards (shared value + map correction + no-legendaries correction + trainers correction)
 *        + Σ Defender cards (the same, Defender-side)
 *        + matchup weight × type-matchup balance + prior weights × heuristic ratings
 *        + in trainer mode, each side's trainer value and a weight on its synergy with the team.
 * Corrections are penalised harder than the shared values (strengths chosen by cross-validation), so a
 * context only departs from the shared values where its games say so, and a context that has no data
 * (a new map, or a mode never played on that map) falls back to the shared values plus whichever
 * corrections do apply. src/ai/draftModel.ts adds the parts up into an ordinary DraftModel per context.
 *
 * It also fits a separate model per context on the same folds and prints both held-out log losses.
 * Writes src/ai/models/general.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFTABLE, TRAINER_LIST } from '../src/engine';
import { matchupBalance, priorFeature, trainerSynergy } from '../src/ai/draft';
import type { GeneralDraftModel } from '../src/ai/draftModel';
import type { GameRecord } from './arena';

const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ITERS = Number(flag('iters') ?? 900);
if (!args.length) throw new Error('usage: train-draft-general.ts games.jsonl[@map] […]');

interface Game extends GameRecord {
  map: string;
}
const games: Game[] = [];
for (const a of args) {
  const at = a.lastIndexOf('@');
  const file = at > 0 ? a.slice(0, at) : a;
  const fallbackMap = at > 0 ? a.slice(at + 1) : undefined;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let g: GameRecord;
    try {
      g = JSON.parse(line) as GameRecord;
    } catch {
      continue; // a file still being written can end in a partial line
    }
    const map = g.mapId ?? fallbackMap;
    if (!map) throw new Error(`${file}: records have no map; pass it as ${file}@<map>`);
    games.push({ ...g, map });
  }
}

const ids = DRAFTABLE.map((c) => c.id);
const index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length;
const tids = TRAINER_LIST.map((t) => t.id);
const tindex = new Map(tids.map((id, i) => [id, i]));
const NT = tids.length;
const maps = [...new Set(games.map((g) => g.map))].sort();
const M = maps.length;
const ctxOf = (g: Game): string => {
  const mode = `${g.legends === false ? 'nl' : ''}${g.trainers ? 't' : ''}`;
  return mode ? `${g.map}-${mode}` : g.map;
};
const contexts = [...new Set(games.map(ctxOf))].sort();

// ---------------------------------------------------------------- features
// Card blocks hold N Attacker values then N Defender values.
let F = 0;
const block = (n: number): number => {
  const at = F;
  F += n;
  return at;
};
const BASE = block(2 * N);
const MAP = maps.map(() => block(2 * N));
const NOLEG = block(2 * N);
const TRAIN = block(2 * N);
const TA = block(NT);
const TD = block(NT);
const PENALISED_END = F; // everything above is L2-penalised (cards with λ, corrections with λΔ)
const CTX_MAP = block(M);
const CTX_NOLEG = block(1);
const CTX_TRAIN = block(1);
const MATCH = block(1);
const PRIOR_A = block(1);
const PRIOR_D = block(1);
const SYN_A = block(NT);
const SYN_D = block(NT);
const BIAS = block(1);
const isCorrection = (i: number): boolean => i >= MAP[0] && i < TA;

interface Row {
  sparse: number[];
  dense: [number, number][];
  y: number;
  ctx: string;
}

function encode(g: Game, general: boolean): Row {
  const sparse: number[] = [];
  const m = maps.indexOf(g.map);
  for (const [side, off] of [['A', 0], ['D', N]] as const) {
    for (const id of g.teams[side]) {
      const c = index.get(id)!;
      sparse.push(BASE + off + c);
      if (general) {
        sparse.push(MAP[m] + off + c);
        if (g.legends === false) sparse.push(NOLEG + off + c);
        if (g.trainers) sparse.push(TRAIN + off + c);
      }
    }
  }
  const dense: [number, number][] = [
    [MATCH, matchupBalance(g.teams.A, g.teams.D)], [PRIOR_A, priorFeature(g.teams.A, 'A')], [PRIOR_D, priorFeature(g.teams.D, 'D')],
  ];
  if (general) {
    sparse.push(CTX_MAP + m);
    if (g.legends === false) sparse.push(CTX_NOLEG);
    if (g.trainers) sparse.push(CTX_TRAIN);
  }
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
  return { sparse, dense, y: g.winner === 'A' ? 1 : 0, ctx: ctxOf(g) };
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const predict = (w: Float64Array, r: Row): number => {
  let z = w[BIAS];
  for (const i of r.sparse) z += w[i];
  for (const [i, v] of r.dense) z += w[i] * v;
  return z;
};

/** Full-batch Adam on mean log loss + L2 (λ on card and trainer values, λΔ on corrections). */
function fit(train: Row[], lambda: number, lambdaDelta: number): Float64Array {
  const w = new Float64Array(F);
  const m = new Float64Array(F);
  const v = new Float64Array(F);
  const g = new Float64Array(F);
  const lr = 0.05;
  for (let it = 1; it <= ITERS; it++) {
    g.fill(0);
    for (const r of train) {
      const e = sigmoid(predict(w, r)) - r.y;
      for (const i of r.sparse) g[i] += e;
      for (const [i, x] of r.dense) g[i] += e * x;
      g[BIAS] += e;
    }
    for (let i = 0; i < F; i++) {
      g[i] /= train.length;
      if (i < PENALISED_END) g[i] += (isCorrection(i) ? lambdaDelta : lambda) * w[i];
      m[i] = 0.9 * m[i] + 0.1 * g[i];
      v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i];
      w[i] -= (lr * (m[i] / (1 - 0.9 ** it))) / (Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return w;
}

const logLoss = (w: Float64Array, set: Row[]): number =>
  set.reduce((a, r) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(predict(w, r))));
    return a - (r.y ? Math.log(p) : Math.log(1 - p));
  }, 0) / Math.max(1, set.length);

// ---------------------------------------------------------------- cross-validation
const folds = 5;
const fold = games.map((g) => g.seed % folds);
const general = games.map((g) => encode(g, true));
const separate = games.map((g) => encode(g, false));
console.log(`${games.length} games · maps ${maps.join(', ')} · contexts ${contexts.map((c) => `${c} (${games.filter((g) => ctxOf(g) === c).length})`).join(', ')}`);

/** Held-out log loss per context for the general model at (λ, λΔ). */
function cvGeneral(lambda: number, lambdaDelta: number): Map<string, number> {
  const loss = new Map<string, number>(contexts.map((c) => [c, 0]));
  const count = new Map<string, number>(contexts.map((c) => [c, 0]));
  for (let k = 0; k < folds; k++) {
    const w = fit(general.filter((_, i) => fold[i] !== k), lambda, lambdaDelta);
    general.forEach((r, i) => {
      if (fold[i] !== k) return;
      loss.set(r.ctx, loss.get(r.ctx)! + logLoss(w, [r]));
      count.set(r.ctx, count.get(r.ctx)! + 1);
    });
  }
  return new Map(contexts.map((c) => [c, loss.get(c)! / count.get(c)!]));
}
const overall = (per: Map<string, number>): number =>
  contexts.reduce((a, c) => a + per.get(c)! * games.filter((g) => ctxOf(g) === c).length, 0) / games.length;

let best = { lambda: 0.001, lambdaDelta: 0.01, loss: Infinity, per: new Map<string, number>() };
for (const lambda of [0.0003, 0.001, 0.003]) {
  for (const lambdaDelta of [0.003, 0.01, 0.03]) {
    const per = cvGeneral(lambda, lambdaDelta);
    const loss = overall(per);
    console.log(`  general λ=${lambda} λΔ=${lambdaDelta}: held-out log loss ${loss.toFixed(4)}`);
    if (loss < best.loss) best = { lambda, lambdaDelta, loss, per };
  }
}

// The same folds, one model per context (cards, trainers, matchup and priors; λ chosen per context).
console.log('per context: separate model vs general model (held-out log loss, lower is better)');
for (const c of contexts) {
  const idx = games.map((g, i) => (ctxOf(g) === c ? i : -1)).filter((i) => i >= 0);
  let sepBest = Infinity;
  for (const lambda of [0.0003, 0.001, 0.003]) {
    let l = 0;
    for (let k = 0; k < folds; k++) {
      const w = fit(idx.filter((i) => fold[i] !== k).map((i) => separate[i]), lambda, 0);
      l += idx.filter((i) => fold[i] === k).reduce((a, i) => a + logLoss(w, [separate[i]]), 0);
    }
    sepBest = Math.min(sepBest, l / idx.length);
  }
  const g = best.per.get(c)!;
  console.log(`  ${c.padEnd(12)} separate ${sepBest.toFixed(4)}  general ${g.toFixed(4)}  (${g < sepBest ? 'general better' : 'separate better'} by ${Math.abs(g - sepBest).toFixed(4)})`);
}

// ---------------------------------------------------------------- final fit
const w = fit(general, best.lambda, best.lambdaDelta);
const r4 = (x: number): number => +x.toFixed(4);
const cards = (off: number) => ({
  A: Object.fromEntries(ids.map((id, i) => [id, r4(w[off + i])])),
  D: Object.fromEntries(ids.map((id, i) => [id, r4(w[off + N + i])])),
});
const sparseCards = (off: number) => {
  // Corrections are mostly tiny: keep the ones that matter.
  const keep = (side: 0 | 1) => Object.fromEntries(ids.map((id, i) => [id, r4(w[off + side * N + i])]).filter(([, x]) => Math.abs(x as number) >= 0.005));
  return { A: keep(0), D: keep(1) };
};
const model: GeneralDraftModel = {
  games: games.length,
  lambda: best.lambda,
  lambdaDelta: best.lambdaDelta,
  contexts,
  bias: r4(w[BIAS]),
  matchup: r4(w[MATCH]),
  priorA: r4(w[PRIOR_A]),
  priorD: r4(w[PRIOR_D]),
  ...cards(BASE),
  maps: Object.fromEntries(maps.map((m, i) => [m, { bias: r4(w[CTX_MAP + i]), ...sparseCards(MAP[i]) }])),
  noLegends: { bias: r4(w[CTX_NOLEG]), ...sparseCards(NOLEG) },
  withTrainers: { bias: r4(w[CTX_TRAIN]), ...sparseCards(TRAIN) },
  trainers: Object.fromEntries(tids.map((id, i) => [id, { A: r4(w[TA + i]), D: r4(w[TD + i]), synA: r4(w[SYN_A + i]), synD: r4(w[SYN_D + i]) }])),
};
console.log(`chosen: λ=${best.lambda}, λΔ=${best.lambdaDelta}, held-out log loss ${best.loss.toFixed(4)}`);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), flag('out') ?? '../src/ai/models/general.json');
fs.writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
console.log(`wrote ${out}`);
