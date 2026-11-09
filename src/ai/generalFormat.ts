/**
 * The on-disk layout of src/ai/models/general.json, made to be read by people.
 *
 * In memory the general model is `GeneralDraftModel` (draftModel.ts): every number is a term of
 * logit P(Attacker wins), so a strong Defender card has a negative value. On disk every Attacker /
 * Defender pair is "higher = better for the side that drafts it" (Defender numbers are flipped), names
 * replace array positions, cards are listed strongest first, and each card, trainer or trait row sits on
 * one line with its columns lined up. `toReadable` / `fromReadable` convert between the two, and
 * `formatReadable` prints the file; scripts/train-draft-general.ts always writes it this way.
 */
import type { GeneralDraftModel } from './draftModel';

type Pair = { attacker: number; defender: number };
type Cards = Record<string, Pair>;
type Grid = Record<string, Record<string, number>>;

export interface ReadableGeneralModel {
  about: string[];
  version: 3;
  training: { games: number; heldOutLogLoss: number | null; penalties: GeneralDraftModel['penalties'] };
  baseline: { attackerEdge: number; typeMatchup: number; heuristicPrior: Pair };
  cards: Cards;
  trainers: Record<string, Pair & { synergyAttacker: number; synergyDefender: number }>;
  mapTraits: { attackerEdge: Record<string, number>; attacker: Grid; defender: Grid };
  namedMaps: Record<string, { attackerEdge: number; cards: Cards }>;
  trainerMode: { attackerEdge: number; cards: Cards };
}

const ABOUT = [
  'One draft model for every map, mode and draft style. Written by scripts/train-draft-general.ts: retrain rather than edit.',
  'All numbers are log-odds. In every attacker/defender pair, higher = better for the side that drafts it.',
  'Rule of thumb near an even game: +0.10 is about +2.5 points of win chance, +0.40 about +10.',
  'Score of a draft = baseline.attackerEdge + mapTraits.attackerEdge·(map traits)',
  '  + the Attacker cards\' values − the Defender cards\' values (each: cards + namedMaps[map] + trainerMode + mapTraits terms)',
  '  + typeMatchup × type-matchup balance + heuristicPrior × the heuristic team ratings + (trainer mode) the trainer terms.',
  'mapTraits.attacker[cardTrait][mapTrait]: extra value per unit of card trait on a map with that much of the map trait',
  '  (src/ai/mapFeatures.ts), which is how maps never trained on, like generated ones, still get sensible values.',
  'namedMaps and trainerMode list only corrections of 0.005 or more. Cards are listed strongest first (mean of both columns).',
];

const flip = (x: number): number => (x === 0 ? 0 : -x);
const byStrength = (c: Cards): Cards =>
  Object.fromEntries(Object.entries(c).sort(([, a], [, b]) => b.attacker + b.defender - (a.attacker + a.defender)));
const bySize = (c: Cards): Cards =>
  Object.fromEntries(Object.entries(c).sort(([, a], [, b]) => Math.abs(b.attacker) + Math.abs(b.defender) - (Math.abs(a.attacker) + Math.abs(a.defender))));

function pairs(A: Record<string, number>, D: Record<string, number>): Cards {
  const ids = [...new Set([...Object.keys(A), ...Object.keys(D)])];
  return Object.fromEntries(ids.map((id) => [id, { attacker: A[id] ?? 0, defender: flip(D[id] ?? 0) }]));
}

function unpair(c: Cards): { A: Record<string, number>; D: Record<string, number> } {
  const A: Record<string, number> = {};
  const D: Record<string, number> = {};
  for (const [id, p] of Object.entries(c)) {
    if (p.attacker) A[id] = p.attacker;
    if (p.defender) D[id] = flip(p.defender);
  }
  return { A, D };
}

const grid = (m: number[][], rows: string[], cols: string[], sign: 1 | -1): Grid =>
  Object.fromEntries(rows.map((r, f) => [r, Object.fromEntries(cols.map((c, k) => [c, sign * (m[f]?.[k] ?? 0) || 0]))]));
const ungrid = (g: Grid, rows: string[], cols: string[], sign: 1 | -1): number[][] =>
  rows.map((r) => cols.map((c) => sign * (g[r]?.[c] ?? 0) || 0));

export function toReadable(g: GeneralDraftModel, heldOutLogLoss: number | null = null): ReadableGeneralModel {
  return {
    about: ABOUT,
    version: 3,
    training: { games: g.games, heldOutLogLoss, penalties: g.penalties },
    baseline: { attackerEdge: g.bias, typeMatchup: g.matchup, heuristicPrior: { attacker: g.priorA, defender: flip(g.priorD) } },
    cards: byStrength(pairs(g.A, g.D)),
    trainers: Object.fromEntries(Object.entries(g.trainers)
      .map(([id, t]) => [id, { attacker: t.A, defender: flip(t.D), synergyAttacker: t.synA, synergyDefender: flip(t.synD) }] as const)
      .sort(([, a], [, b]) => b.attacker + b.defender - (a.attacker + a.defender))),
    mapTraits: {
      attackerEdge: Object.fromEntries(g.mapFeatures.map((k, j) => [k, g.mapW[j] ?? 0])),
      attacker: grid(g.interA, g.cardFeatures, g.mapFeatures, 1),
      defender: grid(g.interD, g.cardFeatures, g.mapFeatures, -1),
    },
    namedMaps: Object.fromEntries(Object.entries(g.maps).map(([id, c]) => [id, { attackerEdge: c.bias, cards: bySize(pairs(c.A, c.D)) }])),
    trainerMode: { attackerEdge: g.withTrainers.bias, cards: bySize(pairs(g.withTrainers.A, g.withTrainers.D)) },
  };
}

/** The in-memory model from the file (either layout: version 2 files are already in memory form). */
export function fromReadable(r: ReadableGeneralModel | GeneralDraftModel): GeneralDraftModel {
  if (r.version === 2) return r;
  const cardFeatures = Object.keys(r.mapTraits.attacker);
  const mapFeatures = Object.keys(r.mapTraits.attackerEdge);
  const corr = (x: { attackerEdge: number; cards: Cards }) => ({ bias: x.attackerEdge, ...unpair(x.cards) });
  return {
    version: 2,
    games: r.training.games,
    penalties: r.training.penalties,
    cardFeatures,
    mapFeatures,
    bias: r.baseline.attackerEdge,
    matchup: r.baseline.typeMatchup,
    priorA: r.baseline.heuristicPrior.attacker,
    priorD: flip(r.baseline.heuristicPrior.defender),
    ...unpair(r.cards),
    mapW: mapFeatures.map((k) => r.mapTraits.attackerEdge[k]),
    interA: ungrid(r.mapTraits.attacker, cardFeatures, mapFeatures, 1),
    interD: ungrid(r.mapTraits.defender, cardFeatures, mapFeatures, -1),
    maps: Object.fromEntries(Object.entries(r.namedMaps).map(([id, c]) => [id, corr(c)])),
    withTrainers: corr(r.trainerMode),
    trainers: Object.fromEntries(Object.entries(r.trainers).map(([id, t]) => [id, { A: t.attacker, D: flip(t.defender), synA: t.synergyAttacker, synD: flip(t.synergyDefender) }])),
  };
}

// ---------------------------------------------------------------- printing

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Numbers with a fractional part get 4 decimals and a leading space when positive, so columns line up. */
function num(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) >= 1) return String(x);
  const f = Math.abs(+x.toFixed(4) - x) < 1e-12 ? x.toFixed(4) : String(x);
  return `${x < 0 ? '' : ' '}${f}`;
}
const leaf = (v: unknown): string => (typeof v === 'number' ? num(v) : JSON.stringify(v));

/** An object of numbers on one line, or null if it has anything else or would be too long. */
function inline(v: unknown, max: number): string | null {
  if (!isPlain(v)) return null;
  const vals = Object.values(v);
  if (!vals.length || vals.some((x) => typeof x === 'object' && x !== null)) return null;
  const s = `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${leaf(x)}`).join(', ')} }`;
  return s.length <= max ? s : null;
}

function print(v: unknown, indent: string): string {
  if (!isPlain(v) && !Array.isArray(v)) return leaf(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null) && v.every((x) => typeof x === 'string')) {
      return `[\n${v.map((x) => `${inner}${JSON.stringify(x)}`).join(',\n')}\n${indent}]`;
    }
    return `[\n${v.map((x) => `${inner}${print(x, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(v);
  if (!entries.length) return '{}';
  const rows = entries.map(([k, x]) => [JSON.stringify(k), inline(x, 200) ?? print(x, inner)] as const);
  // Line the values up when every row is a one-liner (a table of cards, trainers or traits).
  const table = rows.every(([, s]) => !s.includes('\n'));
  const width = table ? Math.max(...rows.map(([k]) => k.length)) : 0;
  return `{\n${rows.map(([k, s]) => `${inner}${k}:${' '.repeat(table ? width - k.length + 1 : 1)}${s}`).join(',\n')}\n${indent}}`;
}

export const formatReadable = (r: ReadableGeneralModel): string => `${print(r, '')}\n`;
