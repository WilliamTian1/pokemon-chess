/**
 * Fits the value network (src/ai/value.ts) to positions from scripts/gen-values.ts:
 *
 *   npx tsx scripts/train-value.ts values.jsonl [more.jsonl…] [--epochs 30] [--out src/ai/models/value.json]
 *
 * The target is the rollout win rate (optionally blended with the game's result via --blend). Games
 * are split 90/10 into training and validation, and the held-out loss is compared with a logistic
 * fit of the hand-written evaluation alone, so it's clear whether the network adds anything.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { CARD_COUNT, GLOBAL_FEATURES, UNIT_FEATURES } from '../src/ai/bot';
import { type ValueModel, encodeTeams, predictValue } from '../src/ai/value';
import type { ValueRecord } from './gen-values';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const epochs = Number(arg('epochs', '30'));
const blend = Number(arg('blend', '1'));
const out = arg('out', 'src/ai/models/value.json');
const H = Number(arg('h', '48'));
const H2 = Number(arg('h2', '96'));
const H3 = Number(arg('h3', '32'));
const lr0 = Number(arg('lr', '0.002'));
const decay = Number(arg('l2', '1e-5'));

const rows: ValueRecord[] = [];
for (const f of files) {
  const rl = readline.createInterface({ input: fs.createReadStream(f) });
  for await (const line of rl) if (line) rows.push(JSON.parse(line) as ValueRecord);
}
const target = (r: ValueRecord) => blend * r.y + (1 - blend) * r.z;
const val = rows.filter((r) => r.g % 10 === 0);
const train = rows.filter((r) => r.g % 10 !== 0);
console.log(`${rows.length} positions (${train.length} train / ${val.length} validation), Attacker rollout win rate ${(rows.reduce((a, r) => a + r.y, 0) / rows.length).toFixed(3)}`);

const NU = UNIT_FEATURES.length;
const NG = GLOBAL_FEATURES.length;
const N0 = 4 * H + NG;

// ---------------------------------------------------------------- parameters (flat, with Adam state)

const shapes = { emb: CARD_COUNT * H, wu: NU * H, bu: H, bs: 2 * H, w1: N0 * H2, b1: H2, w2: H2 * H3, b2: H3, w3: H3, b3: 1 };
type Key = keyof typeof shapes;
const keys = Object.keys(shapes) as Key[];
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
const P = Object.fromEntries(keys.map((k) => [k, new Float64Array(shapes[k])])) as Record<Key, Float64Array>;
const init = (k: Key, fanIn: number) => { for (let i = 0; i < P[k].length; i++) P[k][i] = rand() * Math.sqrt(3 / fanIn); };
init('emb', 4); init('wu', NU); init('w1', N0); init('w2', H2); init('w3', H3);
const G = Object.fromEntries(keys.map((k) => [k, new Float64Array(shapes[k])])) as Record<Key, Float64Array>;
const M1 = Object.fromEntries(keys.map((k) => [k, new Float64Array(shapes[k])])) as Record<Key, Float64Array>;
const M2 = Object.fromEntries(keys.map((k) => [k, new Float64Array(shapes[k])])) as Record<Key, Float64Array>;

const model = (): ValueModel => ({
  nu: NU, nc: CARD_COUNT, ng: NG, h: H, h2: H2, h3: H3,
  emb: [...P.emb], wu: [...P.wu], bu: [...P.bu], bs: [...P.bs], w1: [...P.w1], b1: [...P.b1], w2: [...P.w2], b2: [...P.b2], w3: [...P.w3], b3: P.b3[0],
});

// ---------------------------------------------------------------- one sample: forward + backward

function step(r: ValueRecord, y: number): number {
  const m = { nu: NU, nc: CARD_COUNT, ng: NG, h: H, h2: H2, h3: H3, emb: P.emb, wu: P.wu, bu: P.bu, bs: P.bs } as unknown as ValueModel;
  const { input, pre } = encodeTeams(m, r.f);
  const z1 = new Float64Array(H2);
  for (let j = 0; j < H2; j++) z1[j] = P.b1[j];
  for (let i = 0; i < N0; i++) {
    const v = input[i];
    if (v === 0) continue;
    const row = i * H2;
    for (let j = 0; j < H2; j++) z1[j] += P.w1[row + j] * v;
  }
  const a1 = z1.map((v) => (v > 0 ? v : 0));
  const z2 = new Float64Array(H3);
  for (let k = 0; k < H3; k++) z2[k] = P.b2[k];
  for (let j = 0; j < H2; j++) {
    const v = a1[j];
    if (v === 0) continue;
    for (let k = 0; k < H3; k++) z2[k] += P.w2[j * H3 + k] * v;
  }
  let o = P.b3[0];
  for (let k = 0; k < H3; k++) if (z2[k] > 0) o += P.w3[k] * z2[k];
  const p = 1 / (1 + Math.exp(-o));
  const loss = -(y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9)));
  // Backward.
  const dout = p - y;
  G.b3[0] += dout;
  const dz2 = new Float64Array(H3);
  for (let k = 0; k < H3; k++) {
    if (z2[k] <= 0) continue;
    G.w3[k] += dout * z2[k];
    dz2[k] = dout * P.w3[k];
  }
  const dz1 = new Float64Array(H2);
  for (let j = 0; j < H2; j++) {
    let d = 0;
    for (let k = 0; k < H3; k++) {
      if (dz2[k] === 0) continue;
      G.w2[j * H3 + k] += a1[j] * dz2[k];
      d += P.w2[j * H3 + k] * dz2[k];
    }
    dz1[j] = z1[j] > 0 ? d : 0;
  }
  for (let k = 0; k < H3; k++) G.b2[k] += dz2[k];
  for (let j = 0; j < H2; j++) G.b1[j] += dz1[j];
  const dIn = new Float64Array(4 * H);
  for (let i = 0; i < N0; i++) {
    const v = input[i];
    const row = i * H2;
    let d = 0;
    for (let j = 0; j < H2; j++) {
      if (dz1[j] === 0) continue;
      if (v !== 0) G.w1[row + j] += v * dz1[j];
      if (i < 4 * H) d += P.w1[row + j] * dz1[j];
    }
    if (i < 4 * H) dIn[i] = d;
  }
  (['A', 'D'] as const).forEach((side, si) => {
    const zs = pre[side];
    const units = r.f.units[side];
    // Which unit holds each dimension's max (the max pool's gradient goes only there).
    const arg = new Int32Array(H).fill(-1);
    const best = new Float64Array(H);
    zs.forEach((z, ui) => { for (let j = 0; j < H; j++) if (z[j] > best[j]) { best[j] = z[j]; arg[j] = ui; } });
    zs.forEach((z, ui) => {
      const dz = new Float64Array(H);
      for (let j = 0; j < H; j++) {
        if (z[j] <= 0) continue;
        dz[j] = dIn[si * 2 * H + j] / 4 + (arg[j] === ui ? dIn[si * 2 * H + H + j] : 0);
      }
      const c = units[ui].card;
      const x = units[ui].x;
      for (let j = 0; j < H; j++) {
        if (dz[j] === 0) continue;
        G.emb[c * H + j] += dz[j];
        G.bu[j] += dz[j];
        G.bs[si * H + j] += dz[j];
      }
      for (let i = 0; i < NU; i++) {
        if (x[i] === 0) continue;
        for (let j = 0; j < H; j++) if (dz[j] !== 0) G.wu[i * H + j] += x[i] * dz[j];
      }
    });
  });
  return loss;
}

function adam(t: number, lr: number, n: number): void {
  const b1 = 0.9;
  const b2 = 0.999;
  for (const k of keys) {
    const p = P[k];
    const g = G[k];
    const m1 = M1[k];
    const m2 = M2[k];
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] / n + (k.startsWith('b') ? 0 : decay * p[i]);
      m1[i] = b1 * m1[i] + (1 - b1) * gi;
      m2[i] = b2 * m2[i] + (1 - b2) * gi * gi;
      p[i] -= (lr * (m1[i] / (1 - b1 ** t))) / (Math.sqrt(m2[i] / (1 - b2 ** t)) + 1e-8);
      g[i] = 0;
    }
  }
}

const logLoss = (p: number, y: number) => -(y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9)));
function evaluate(set: ValueRecord[]): { loss: number; mse: number; corr: number } {
  const m = model();
  let loss = 0;
  let mse = 0;
  const ps: number[] = [];
  for (const r of set) {
    const p = predictValue(m, r.f);
    ps.push(p);
    loss += logLoss(p, target(r));
    mse += (p - r.y) ** 2;
  }
  const ys = set.map((r) => r.y);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const mp = mean(ps);
  const my = mean(ys);
  let cov = 0;
  let vp = 0;
  let vy = 0;
  ps.forEach((p, i) => { cov += (p - mp) * (ys[i] - my); vp += (p - mp) ** 2; vy += (ys[i] - my) ** 2; });
  return { loss: loss / set.length, mse: mse / set.length, corr: cov / Math.sqrt(vp * vy) };
}

// Baseline: the hand-written evaluation alone (both points of view + clock), fitted logistically.
const gi = ['evalA', 'evalD', 'clockT', 'aToMove'].map((n) => GLOBAL_FEATURES.indexOf(n as (typeof GLOBAL_FEATURES)[number]));
const w = new Float64Array(gi.length + 1);
const basePred = (r: ValueRecord): number => {
  let z = w[gi.length];
  gi.forEach((k, i) => (z += w[i] * r.f.global[k]));
  return 1 / (1 + Math.exp(-z));
};
{
  for (let it = 0; it < 300; it++) {
    const g = new Float64Array(w.length);
    for (const r of train) {
      let z = w[gi.length];
      gi.forEach((k, i) => (z += w[i] * r.f.global[k]));
      const e = 1 / (1 + Math.exp(-z)) - target(r);
      gi.forEach((k, i) => (g[i] += e * r.f.global[k]));
      g[gi.length] += e;
    }
    for (let i = 0; i < w.length; i++) w[i] -= (0.5 * g[i]) / train.length;
  }
  let loss = 0;
  for (const r of val) loss += logLoss(basePred(r), target(r));
  const base = val.reduce((a, r) => a + target(r), 0) / val.length;
  const constLoss = val.reduce((a, r) => a + logLoss(base, target(r)), 0) / val.length;
  console.log(`held-out log loss: constant ${constLoss.toFixed(4)}, hand evaluation (logistic) ${(loss / val.length).toFixed(4)}`);
}

if (process.argv.includes('--gradcheck')) {
  // Compare backprop with finite differences on a few weights of every tensor.
  const r = train[0];
  const y = 0.3;
  for (const g of Object.values(G)) g.fill(0);
  step(r, y);
  const lossAt = () => logLoss(predictValue(model(), r.f), y);
  let worst = 0;
  for (const k of keys) {
    for (let n = 0; n < 6; n++) {
      const i = Math.floor(((rand() + 1) / 2) * P[k].length);
      if (k === 'emb' && !r.f.units.A.concat(r.f.units.D).some((u) => Math.floor(i / H) === u.card)) continue;
      const old = P[k][i];
      P[k][i] = old + 1e-5;
      const up = lossAt();
      P[k][i] = old - 1e-5;
      const down = lossAt();
      P[k][i] = old;
      const num = (up - down) / 2e-5;
      const err = Math.abs(num - G[k][i]) / Math.max(1e-6, Math.abs(num) + Math.abs(G[k][i]));
      if (Math.abs(num) > 1e-7 || Math.abs(G[k][i]) > 1e-7) worst = Math.max(worst, err);
      if (err > 1e-3 && (Math.abs(num) > 1e-7 || Math.abs(G[k][i]) > 1e-7)) console.log(`  ${k}[${i}]: backprop ${G[k][i].toExponential(3)} vs numeric ${num.toExponential(3)}`);
    }
  }
  console.log(`gradient check: worst relative error ${worst.toExponential(2)}`);
  process.exit(0);
}

let t = 0;
let bestLoss = Infinity;
let bestModel = model();
const order = train.map((_, i) => i);
const batch = 128;
for (let ep = 1; ep <= epochs; ep++) {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(((rand() + 1) / 2) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const lr = lr0 * (ep <= 2 ? ep / 2 : 0.5 * (1 + Math.cos((Math.PI * (ep - 1)) / epochs)));
  let trainLoss = 0;
  for (let b = 0; b < order.length; b += batch) {
    const end = Math.min(order.length, b + batch);
    for (let i = b; i < end; i++) trainLoss += step(train[order[i]], target(train[order[i]]));
    adam(++t, lr, end - b);
  }
  const v = evaluate(val);
  const mark = v.loss < bestLoss ? ' *' : '';
  if (v.loss < bestLoss) {
    bestLoss = v.loss;
    bestModel = model();
  }
  console.log(`epoch ${ep}: train ${(trainLoss / order.length).toFixed(4)} · held-out log loss ${v.loss.toFixed(4)}, MSE ${v.mse.toFixed(4)}, corr ${v.corr.toFixed(3)}${mark}`);
}
// Where the network helps: held-out log loss by round, network vs the hand evaluation.
{
  const rounds = [...new Set(val.map((r) => r.r))].sort((a, b) => a - b);
  const line = rounds.map((rd) => {
    const set = val.filter((r) => r.r === rd);
    const net = set.reduce((a, r) => a + logLoss(predictValue(bestModel, r.f), target(r)), 0) / set.length;
    const hand = set.reduce((a, r) => a + logLoss(basePred(r), target(r)), 0) / set.length;
    return `r${rd} ${net.toFixed(3)}/${hand.toFixed(3)} (${set.length})`;
  });
  console.log(`held-out log loss by round, network/hand: ${line.join(' · ')}`);
}
const round = (a: number[]) => a.map((x) => +x.toFixed(5));
const m = bestModel;
fs.writeFileSync(out, `${JSON.stringify({ ...m, emb: round(m.emb), wu: round(m.wu), bu: round(m.bu), bs: round(m.bs), w1: round(m.w1), b1: round(m.b1), w2: round(m.w2), b2: round(m.b2), w3: round(m.w3), b3: +m.b3.toFixed(5) })}\n`);
console.log(`wrote ${out} (best held-out log loss ${bestLoss.toFixed(4)})`);
