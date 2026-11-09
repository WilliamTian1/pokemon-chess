/**
 * Value network: the probability that the Attacker wins from a position, learned from self-play
 * (scripts/gen-values.ts makes the data, scripts/train-value.ts fits it).
 *
 * Each live Pokémon is encoded on its own (a learned vector per card plus its numeric features, see
 * positionFeatures in bot.ts); each team is pooled by sum and max, so the order of the Pokémon doesn't
 * matter; two hidden layers combine both teams with the global features.
 */
import type { Side } from '../engine';

export interface ValueModel {
  /** Numeric features per Pokémon, cards, global features, and layer sizes. */
  nu: number;
  nc: number;
  ng: number;
  h: number;
  h2: number;
  h3: number;
  /** Card embeddings (nc × h), numeric weights (nu × h), bias (h), and a bias per side (2 × h). */
  emb: number[];
  wu: number[];
  bu: number[];
  bs: number[];
  /** Hidden layers: (4h + ng) → h2 → h3 → 1. */
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w3: number[];
  b3: number;
}

export interface ValueInput {
  units: Record<Side, { card: number; x: number[] }[]>;
  global: number[];
}

const relu = (v: number): number => (v > 0 ? v : 0);

/** Pooled team vectors and the network input (shared by inference and training). */
export function encodeTeams(m: ValueModel, f: ValueInput): { input: Float64Array; pre: Record<Side, Float64Array[]> } {
  const { h, nu, ng } = m;
  const input = new Float64Array(4 * h + ng);
  const pre: Record<Side, Float64Array[]> = { A: [], D: [] };
  (['A', 'D'] as const).forEach((side, si) => {
    const sum = input.subarray(si * 2 * h, si * 2 * h + h);
    const max = input.subarray(si * 2 * h + h, si * 2 * h + 2 * h);
    for (const u of f.units[side]) {
      const z = new Float64Array(h);
      for (let j = 0; j < h; j++) z[j] = m.emb[u.card * h + j] + m.bu[j] + m.bs[si * h + j];
      for (let i = 0; i < nu; i++) {
        const xi = u.x[i];
        if (xi === 0) continue;
        const row = i * h;
        for (let j = 0; j < h; j++) z[j] += m.wu[row + j] * xi;
      }
      pre[side].push(z);
      for (let j = 0; j < h; j++) {
        const a = relu(z[j]);
        sum[j] += a / 4;
        if (a > max[j]) max[j] = a;
      }
    }
  });
  for (let i = 0; i < ng; i++) input[4 * h + i] = f.global[i];
  return { input, pre };
}

/** P(Attacker wins). */
export function predictValue(m: ValueModel, f: ValueInput): number {
  const { input } = encodeTeams(m, f);
  const n0 = input.length;
  const a1 = new Float64Array(m.h2);
  for (let j = 0; j < m.h2; j++) {
    let z = m.b1[j];
    for (let i = 0; i < n0; i++) z += m.w1[i * m.h2 + j] * input[i];
    a1[j] = relu(z);
  }
  let out = m.b3;
  for (let k = 0; k < m.h3; k++) {
    let z = m.b2[k];
    for (let j = 0; j < m.h2; j++) z += m.w2[j * m.h3 + k] * a1[j];
    out += m.w3[k] * relu(z);
  }
  return 1 / (1 + Math.exp(-out));
}
