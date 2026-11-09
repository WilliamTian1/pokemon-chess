/**
 * Fits ONE draft model for every map, draft style and mode from random-team self-play games:
 *
 *   npx tsx scripts/arena.ts --a hard --d hard --draft teams --map proc --legends mix --trainers mix --games 12000 --out proc.jsonl
 *   npx tsx scripts/train-draft-general.ts proc.jsonl meadow.jsonl river.jsonl [--iters 500] [--out file]
 *
 * Model: logit P(Attacker wins) =
 *     bias + mapW·g                                      (g = the map's traits, src/ai/mapFeatures.ts)
 *   + Σ Attacker cards [ value + named-map correction + trainer-mode correction + Σ_fk interA[f][k]·card_f·g_k ]
 *   + Σ Defender cards [ the same, Defender-side ]
 *   + matchup weight × type-matchup balance + prior weights × heuristic ratings
 *   + (trainer mode) each side's trainer value and a weight on its synergy with the team.
 * The draft style doesn't change a battle, only how teams are formed, so the same model serves the
 * classic draft, Secret draft and Auction (each with its own search on top). Training on random teams
 * with 0 or 1 legendary a side, and on thousands of procedurally generated maps, lets it value any
 * team on any map: a map it has never seen gets the shared values plus the trait interactions.
 *
 * Penalties (L2) are chosen by 5-fold cross-validation. It also reports, on the same folds, separate
 * per-map models and the model without map interactions, so you can see what the generality buys.
 * Writes src/ai/models/general.json in the readable layout of src/ai/generalFormat.ts (one line per card,
 * every attacker/defender pair as "higher = better for the side that drafts it").
 *
 * Fast path (seconds instead of an hour on big data): the fitting is matrix maths, so it can run in
 * numpy, or PyTorch on a CUDA GPU when one is installed:
 *   npx tsx scripts/train-draft-general.ts games… --export rows.json     # features, no fitting
 *   python3 scripts/train_general.py rows.json weights.json              # CV + final fit
 *   npx tsx scripts/train-draft-general.ts games… --weights weights.json # writes general.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS, DRAFTABLE, TRAINER_LIST, getMap, isProcMapId } from '../src/engine';
import { matchupBalance, priorFeature, trainerSynergy } from '../src/ai/draft';
import type { GeneralDraftModel } from '../src/ai/draftModel';
import { formatReadable, toReadable } from '../src/ai/generalFormat';
import { CARD_FEATURES, MAP_FEATURES, cardFeatures, mapFeatures } from '../src/ai/mapFeatures';
import type { GameRecord } from './arena';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const ITERS = Number(flag('iters') ?? 500);
if (!files.length) throw new Error('usage: train-draft-general.ts games.jsonl[@map] […]');

interface Game extends GameRecord {
  map: string;
}
const games: Game[] = [];
for (const a of files) {
  const at = a.lastIndexOf('@');
  const file = at > 0 ? a.slice(0, at) : a;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let g: GameRecord;
    try {
      g = JSON.parse(line) as GameRecord;
    } catch {
      continue; // a file still being written can end in a partial line
    }
    const map = g.mapId ?? (at > 0 ? a.slice(at + 1) : undefined);
    if (!map) throw new Error(`${file}: records have no map; pass it as ${file}@<map>`);
    if ([...g.teams.A, ...g.teams.D].some((id) => !CARDS[id])) continue;
    games.push({ ...g, map });
  }
}

const ids = DRAFTABLE.map((c) => c.id);
const index = new Map(ids.map((id, i) => [id, i]));
const N = ids.length;
const tids = TRAINER_LIST.map((t) => t.id);
const tindex = new Map(tids.map((id, i) => [id, i]));
const NT = tids.length;
const NF = CARD_FEATURES.length;
const NG = MAP_FEATURES.length;
// Named maps get their own card corrections; procedural maps rely on traits only.
const named = [...new Set(games.filter((g) => !isProcMapId(g.map)).map((g) => g.map))].sort();
const group = (g: Game): string => (isProcMapId(g.map) ? 'proc' : g.map);
const groups = [...new Set(games.map(group))].sort();

// ---------------------------------------------------------------- feature layout
let F = 0;
const block = (n: number): number => {
  const at = F;
  F += n;
  return at;
};
const BASE = block(2 * N);
const TA = block(NT);
const TD = block(NT);
const CARD_END = F; // λ
const MAPC = named.map(() => block(2 * N));
const TRAIN = block(2 * N);
const CORR_END = F; // λΔ
const INTER_A = block(NF * NG);
const INTER_D = block(NF * NG);
const MAPW = block(NG);
const INTER_END = F; // λI
const NAMED_BIAS = block(named.length);
const TRAIN_BIAS = block(1);
const MATCH = block(1);
const PRIOR_A = block(1);
const PRIOR_D = block(1);
const SYN_A = block(NT);
const SYN_D = block(NT);
const BIAS = block(1);

interface Row {
  sparse: number[];
  dense: [number, number][];
  y: number;
  group: string;
  fold: number;
}

function encode(g: Game, opts: { maps: boolean; inter: boolean }): Row {
  const sparse: number[] = [];
  const dense: [number, number][] = [];
  const m = named.indexOf(g.map);
  const mf = mapFeatures(getMap(g.map));
  for (const [side, off, inter] of [['A', 0, INTER_A], ['D', N, INTER_D]] as const) {
    const sum = new Array<number>(NF).fill(0);
    for (const id of g.teams[side]) {
      const c = index.get(id)!;
      sparse.push(BASE + off + c);
      if (opts.maps && m >= 0) sparse.push(MAPC[m] + off + c);
      if (g.trainers) sparse.push(TRAIN + off + c);
      cardFeatures(CARDS[id]).forEach((v, f) => (sum[f] += v));
    }
    if (opts.inter) {
      for (let f = 0; f < NF; f++) {
        if (!sum[f]) continue;
        for (let k = 0; k < NG; k++) if (mf[k]) dense.push([inter + f * NG + k, sum[f] * mf[k]]);
      }
    }
  }
  if (opts.inter) mf.forEach((v, k) => v && dense.push([MAPW + k, v]));
  if (opts.maps && m >= 0) sparse.push(NAMED_BIAS + m);
  if (g.trainers) sparse.push(TRAIN_BIAS);
  dense.push([MATCH, matchupBalance(g.teams.A, g.teams.D)], [PRIOR_A, priorFeature(g.teams.A, 'A')], [PRIOR_D, priorFeature(g.teams.D, 'D')]);
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
  return { sparse, dense, y: g.winner === 'A' ? 1 : 0, group: group(g), fold: g.seed % 5 };
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const predict = (w: Float64Array, r: Row): number => {
  let z = w[BIAS];
  for (const i of r.sparse) z += w[i];
  for (const [i, v] of r.dense) z += w[i] * v;
  return z;
};

interface Pen {
  lambda: number;
  delta: number;
  inter: number;
}

/** Full-batch Adam on mean log loss + L2. */
function fit(train: Row[], pen: Pen): Float64Array {
  const w = new Float64Array(F);
  const m = new Float64Array(F);
  const v = new Float64Array(F);
  const g = new Float64Array(F);
  const lr = 0.05;
  const pens = Float64Array.from({ length: F }, (_, i) => (i < CARD_END ? pen.lambda : i < CORR_END ? pen.delta : i < INTER_END ? pen.inter : 0));
  for (let it = 1; it <= ITERS; it++) {
    g.fill(0);
    for (const r of train) {
      const e = sigmoid(predict(w, r)) - r.y;
      for (const i of r.sparse) g[i] += e;
      for (const [i, x] of r.dense) g[i] += e * x;
      g[BIAS] += e;
    }
    for (let i = 0; i < F; i++) {
      const gi = g[i] / train.length + pens[i] * w[i];
      m[i] = 0.9 * m[i] + 0.1 * gi;
      v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      w[i] -= (lr * (m[i] / (1 - 0.9 ** it))) / (Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return w;
}

const loss = (w: Float64Array, r: Row): number => {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(predict(w, r))));
  return r.y ? -Math.log(p) : -Math.log(1 - p);
};

/** Held-out log loss per group (5-fold). */
function cv(rows: Row[], pen: Pen): Map<string, number> {
  const tot = new Map<string, [number, number]>();
  for (let k = 0; k < 5; k++) {
    const w = fit(rows.filter((r) => r.fold !== k), pen);
    for (const r of rows) {
      if (r.fold !== k) continue;
      const t = tot.get(r.group) ?? [0, 0];
      t[0] += loss(w, r);
      t[1] += 1;
      tot.set(r.group, t);
    }
  }
  return new Map([...tot].map(([g, [l, n]]) => [g, l / n]));
}
const count = (g: string) => games.filter((x) => group(x) === g).length;
const overall = (per: Map<string, number>): number => groups.reduce((a, g) => a + (per.get(g) ?? 0) * count(g), 0) / games.length;
const fmt = (per: Map<string, number>) => groups.map((g) => `${g} ${per.get(g)!.toFixed(4)}`).join(' · ');

const t0 = Date.now();
console.log(`${games.length} games · ${groups.map((g) => `${g} ${count(g)}`).join(', ')} · ${F} parameters`);
const full = games.map((g) => encode(g, { maps: true, inter: true }));

// Each column's role, for the external trainer: its penalty class and whether it's part of the map
// corrections or the map-trait interactions (so it can fit the ablations by masking columns).
const role = (i: number): 'card' | 'corr' | 'mapcorr' | 'inter' | 'free' =>
  i < CARD_END ? 'card' : i < TRAIN ? 'mapcorr' : i < CORR_END ? 'corr' : i < INTER_END ? 'inter' : i >= NAMED_BIAS && i < NAMED_BIAS + named.length ? 'mapcorr' : 'free';
const exportPath = flag('export');
if (exportPath) {
  fs.writeFileSync(exportPath, JSON.stringify({
    F, BIAS, groups, roles: Array.from({ length: F }, (_, i) => role(i)),
    rows: full.map((r) => ({ s: r.sparse, d: r.dense, y: r.y, g: r.group, f: r.fold })),
  }));
  console.log(`exported ${full.length} rows to ${exportPath}`);
  process.exit(0);
}
const weightsPath = flag('weights');
let best: { pen: Pen; loss: number; per: Map<string, number> } | null = null;
for (const pen of weightsPath ? [] : [
  { lambda: 0.001, delta: 0.01, inter: 0.001 }, { lambda: 0.001, delta: 0.01, inter: 0.01 }, { lambda: 0.001, delta: 0.03, inter: 0.003 },
  { lambda: 0.0003, delta: 0.01, inter: 0.003 }, { lambda: 0.003, delta: 0.01, inter: 0.003 },
]) {
  const per = cv(full, pen);
  const l = overall(per);
  console.log(`  λ=${pen.lambda} λΔ=${pen.delta} λI=${pen.inter}: ${l.toFixed(4)}  (${fmt(per)})  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  if (!best || l < best.loss) best = { pen, loss: l, per };
}

let w: Float64Array;
if (weightsPath) {
  // Weights fitted by scripts/train_general.py on the --export of these same games.
  const ext = JSON.parse(fs.readFileSync(weightsPath, 'utf8')) as { w: number[]; pen: Pen; loss: number };
  if (ext.w.length !== F) throw new Error(`weights have ${ext.w.length} entries, expected ${F} (export and train from the same games)`);
  w = Float64Array.from(ext.w);
  best = { pen: ext.pen, loss: ext.loss, per: new Map() };
} else {
  // Comparisons on the same folds.
  const noInter = cv(games.map((g) => encode(g, { maps: true, inter: false })), best!.pen);
  console.log(`without map traits:       ${overall(noInter).toFixed(4)}  (${fmt(noInter)})`);
  const sep = new Map<string, number>();
  for (const gname of groups) {
    const rows = games.filter((g) => group(g) === gname).map((g) => encode(g, { maps: false, inter: false }));
    sep.set(gname, cv(rows, best!.pen).get(gname)!);
  }
  console.log(`separate model per group: ${overall(sep).toFixed(4)}  (${fmt(sep)})`);
  console.log(`general model:            ${best!.loss.toFixed(4)}  (${fmt(best!.per)})`);
  // ---------------------------------------------------------------- final fit
  w = fit(full, best!.pen);
}
const r4 = (x: number): number => +x.toFixed(4);
const cards = (off: number, sparse = false) => {
  const side = (o: number) => Object.fromEntries(ids.map((id, i) => [id, r4(w[off + o + i])]).filter(([, x]) => !sparse || Math.abs(x as number) >= 0.005));
  return { A: side(0), D: side(N) };
};
const matrix = (off: number) => Array.from({ length: NF }, (_, f) => Array.from({ length: NG }, (_, k) => r4(w[off + f * NG + k])));
const model: GeneralDraftModel = {
  version: 2,
  games: games.length,
  penalties: best!.pen,
  cardFeatures: [...CARD_FEATURES],
  mapFeatures: [...MAP_FEATURES],
  bias: r4(w[BIAS]),
  matchup: r4(w[MATCH]),
  priorA: r4(w[PRIOR_A]),
  priorD: r4(w[PRIOR_D]),
  ...cards(BASE),
  mapW: Array.from({ length: NG }, (_, k) => r4(w[MAPW + k])),
  interA: matrix(INTER_A),
  interD: matrix(INTER_D),
  maps: Object.fromEntries(named.map((m, i) => [m, { bias: r4(w[NAMED_BIAS + i]), ...cards(MAPC[i], true) }])),
  withTrainers: { bias: r4(w[TRAIN_BIAS]), ...cards(TRAIN, true) },
  trainers: Object.fromEntries(tids.map((id, i) => [id, { A: r4(w[TA + i]), D: r4(w[TD + i]), synA: r4(w[SYN_A + i]), synD: r4(w[SYN_D + i]) }])),
};
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), flag('out') ?? '../src/ai/models/general.json');
fs.writeFileSync(out, formatReadable(toReadable(model, best!.loss ? +best!.loss.toFixed(4) : null)));
console.log(`wrote ${out} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
