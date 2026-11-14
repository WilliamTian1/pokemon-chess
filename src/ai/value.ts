/**
 * Value network: the probability that the Attacker wins from a position, learned from self-play
 * (scripts/arena.ts --states makes the positions, scripts/featurize.ts turns them into numbers,
 * scripts/train_value.py fits the network on a GPU and writes src/ai/models/value.json).
 *
 * Each live Pokémon is encoded on its own (a learned vector per card plus its numeric features, see
 * positionFeatures in bot.ts); each team is pooled by sum and max, so the order of the Pokémon doesn't
 * matter; hidden layers then combine both teams with the position's own features (clock, map traits,
 * trainers). A file may hold several networks trained from different seeds; their outputs are
 * averaged, which steadies the comparison of similar positions.
 *
 * The file is laid out to be read by people (the trainer always writes it this way): notes and a
 * summary of what the network learned first, then each network's weights in the order the numbers
 * flow through it, one named row per line. Cards and features are stored by name, so a model keeps
 * working when cards or features are added later (an unknown card gets no card vector; an unknown
 * feature is ignored).
 */
import type { Side } from '../engine';

/** One network's weights. A row of a layer lists its weights to every unit of the next layer. */
export interface ValueNetwork {
  /** Per card: its learned vector (added to the Pokémon's first-layer sum). */
  cardVectors: Record<string, number[]>;
  /** Per Pokémon feature: its weights into the Pokémon's first layer. */
  pokemonFeatureWeights: Record<string, number[]>;
  pokemonBias: number[];
  sideBias: { attacker: number[]; defender: number[] };
  /** Optional second per-Pokémon layer. */
  pokemonLayer2?: { weights: number[][]; bias: number[] };
  /** First hidden layer: from each team's pooled Pokémon vectors (sum ÷ 4, and max) and the position features. */
  hidden1: {
    attackerSum: number[][];
    attackerMax: number[][];
    defenderSum: number[][];
    defenderMax: number[][];
    positionFeatures: Record<string, number[]>;
    bias: number[];
  };
  hidden2: { weights: number[][]; bias: number[] };
  /** Output: log-odds that the Attacker wins. */
  output: { weights: number[]; bias: number };
}

export interface ValueModel {
  about: string[];
  version: 3;
  /** What it was trained on (for the record). */
  training: Record<string, unknown>;
  /** A summary for readers; the bot doesn't use it. */
  whatItLearned?: unknown;
  /** Layer sizes: Pokémon vector, optional second Pokémon layer (0 = none), then the hidden layers. */
  layers: { pokemonVector: number; pokemonLayer2: number; hidden1: number; hidden2: number };
  /** No networks = untrained: the bot uses the hand evaluation only. */
  networks: ValueNetwork[];
}

export interface ValueInput {
  units: Record<Side, { card: string; x: number[] }[]>;
  global: number[];
}

interface CompiledNet {
  emb: Float32Array;
  wu: Float32Array;
  bu: Float32Array;
  bs: Float32Array;
  wu2: Float32Array | null;
  bu2: Float32Array | null;
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  w3: Float32Array;
  b3: number;
}

/** A model prepared for fast evaluation against the bot's current feature order. */
export interface CompiledValue {
  h: number;
  /** Width of a pooled Pokémon vector (the second Pokémon layer's size, or the first's). */
  p: number;
  h2: number;
  h3: number;
  card: Map<string, number>;
  /** For each model feature, its index in the bot's feature list (-1: the bot no longer has it). */
  uIdx: Int32Array;
  gIdx: Int32Array;
  nets: CompiledNet[];
  /** Scratch buffers. */
  z: Float32Array;
  a: Float32Array;
  input: Float32Array;
  a1: Float32Array;
}

export function compileValue(m: ValueModel, unitFeatures: readonly string[], globalFeatures: readonly string[]): CompiledValue {
  const h = m.layers.pokemonVector;
  const p = m.layers.pokemonLayer2 || h;
  const first = m.networks[0];
  // Names and their order come from the first network; the others are read by name.
  const cards = Object.keys(first.cardVectors);
  const unitNames = Object.keys(first.pokemonFeatureWeights);
  const globalNames = Object.keys(first.hidden1.positionFeatures);
  const flat = (rows: number[][]): Float32Array => Float32Array.from(rows.flat());
  return {
    h, p, h2: m.layers.hidden1, h3: m.layers.hidden2,
    card: new Map(cards.map((id, i) => [id, i])),
    uIdx: Int32Array.from(unitNames.map((n) => unitFeatures.indexOf(n))),
    gIdx: Int32Array.from(globalNames.map((n) => globalFeatures.indexOf(n))),
    nets: m.networks.map((n) => ({
      emb: flat(cards.map((id) => n.cardVectors[id])),
      wu: flat(unitNames.map((f) => n.pokemonFeatureWeights[f])),
      bu: Float32Array.from(n.pokemonBias),
      bs: Float32Array.from([...n.sideBias.attacker, ...n.sideBias.defender]),
      wu2: n.pokemonLayer2 ? flat(n.pokemonLayer2.weights) : null,
      bu2: n.pokemonLayer2 ? Float32Array.from(n.pokemonLayer2.bias) : null,
      w1: flat([
        ...n.hidden1.attackerSum, ...n.hidden1.attackerMax, ...n.hidden1.defenderSum, ...n.hidden1.defenderMax,
        ...globalNames.map((g) => n.hidden1.positionFeatures[g]),
      ]),
      b1: Float32Array.from(n.hidden1.bias),
      w2: flat(n.hidden2.weights),
      b2: Float32Array.from(n.hidden2.bias),
      w3: Float32Array.from(n.output.weights),
      b3: n.output.bias,
    })),
    z: new Float32Array(h),
    a: new Float32Array(p),
    input: new Float32Array(4 * p + globalNames.length),
    a1: new Float32Array(m.layers.hidden1),
  };
}

/** The network's output before the sigmoid: log-odds that the Attacker wins. */
export function valueLogit(c: CompiledValue, f: ValueInput): number {
  const { h, p, h2, h3, z, a, input, a1 } = c;
  const nu = c.uIdx.length;
  const ng = c.gIdx.length;
  let total = 0;
  for (const n of c.nets) {
    input.fill(0);
    for (let si = 0; si < 2; si++) {
      const sum = si * 2 * p;
      const max = sum + p;
      for (const u of f.units[si === 0 ? 'A' : 'D']) {
        const ci = c.card.get(u.card);
        for (let j = 0; j < h; j++) z[j] = (ci === undefined ? 0 : n.emb[ci * h + j]) + n.bu[j] + n.bs[si * h + j];
        for (let i = 0; i < nu; i++) {
          const k = c.uIdx[i];
          const xi = k < 0 ? 0 : u.x[k];
          if (!xi) continue;
          const row = i * h;
          for (let j = 0; j < h; j++) z[j] += n.wu[row + j] * xi;
        }
        if (n.wu2 && n.bu2) {
          for (let k = 0; k < p; k++) a[k] = n.bu2[k];
          for (let j = 0; j < h; j++) {
            const v = z[j];
            if (v <= 0) continue;
            const row = j * p;
            for (let k = 0; k < p; k++) a[k] += n.wu2[row + k] * v;
          }
        } else {
          for (let j = 0; j < h; j++) a[j] = z[j];
        }
        for (let k = 0; k < p; k++) {
          const v = a[k];
          if (v <= 0) continue;
          input[sum + k] += v / 4;
          if (v > input[max + k]) input[max + k] = v;
        }
      }
    }
    for (let i = 0; i < ng; i++) {
      const k = c.gIdx[i];
      input[4 * p + i] = k < 0 ? 0 : f.global[k];
    }
    const n0 = input.length;
    for (let j = 0; j < h2; j++) a1[j] = n.b1[j];
    for (let i = 0; i < n0; i++) {
      const v = input[i];
      if (!v) continue;
      const row = i * h2;
      for (let j = 0; j < h2; j++) a1[j] += n.w1[row + j] * v;
    }
    let out = n.b3;
    for (let k = 0; k < h3; k++) {
      let t = n.b2[k];
      for (let j = 0; j < h2; j++) if (a1[j] > 0) t += n.w2[j * h3 + k] * a1[j];
      if (t > 0) out += n.w3[k] * t;
    }
    total += out;
  }
  return total / c.nets.length;
}
