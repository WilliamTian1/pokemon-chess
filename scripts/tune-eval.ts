/**
 * Trains the Hard bot's evaluation multipliers (EVAL in src/ai/bot.ts, plus the clock weight) by
 * self-play, maximising win rate directly with SPSA: each iteration perturbs every multiplier up or
 * down at random, plays the "+" bot against the "−" bot (both roles, alternating maps) and moves
 * the multipliers toward whichever side won.
 *
 *   npx tsx scripts/tune-eval.ts --iters 30 --games 120 --out tune.jsonl
 *
 * Prints the final multipliers; paste them into EVAL (and WEIGHTS.hard.clock) and confirm with
 * scripts/arena.ts against the previous version.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL, WEIGHTS } from '../src/ai/bot';

const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const iters = Number(arg('iters', '30'));
const games = Number(arg('games', '120'));
const out = arg('out', 'tune.jsonl');
// A lighter search during training keeps iterations fast; the weights carry over.
const search = JSON.parse(arg('search', '{"beam":8,"perUnit":3,"replies":8,"replyBeam":2}'));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(os.tmpdir(), `tune-bot-${process.pid}.mjs`);
execFileSync('npx', ['esbuild', 'src/ai/bot.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], { cwd: root });

const names = [...Object.keys(EVAL), 'clock'] as const;
const start: Record<string, number> = { ...EVAL, clock: 1 };
let logTheta = names.map((n) => Math.log(start[n]));

// SPSA gain schedules (Spall's recommended exponents).
const a = 0.25;
const c = 0.3;
const A = 3;

const params = (lt: number[]) => {
  const v = Object.fromEntries(names.map((n, i) => [n, +Math.exp(lt[i]).toFixed(4)]));
  const { clock, ...rest } = v;
  return { eval: rest, weights: { clock: +(WEIGHTS.hard.clock * clock).toFixed(2) }, search };
};

const seed = Number(arg('seed', '200000'));
for (let k = 0; k < iters; k++) {
  const ck = c / (k + 1) ** 0.101;
  const ak = a / (k + 1 + A) ** 0.602;
  const delta = names.map(() => (Math.random() < 0.5 ? -1 : 1));
  const plus = logTheta.map((x, i) => x + ck * delta[i]);
  const minus = logTheta.map((x, i) => x - ck * delta[i]);
  const map = k % 2 === 0 ? 'meadow' : 'river';
  const res = execFileSync('npx', [
    'tsx', 'scripts/arena.ts', '--a', 'hard', '--d', 'other:hard', '--other', bundle, '--map', map, '--games', String(games),
    '--swap', '--seed', String(seed + 1000 * k), '--tune', JSON.stringify(params(plus)), '--tune-other', JSON.stringify(params(minus)),
  ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
  const m = /^hard\s+wins (\d+)\/(\d+)/m.exec(res);
  if (!m) throw new Error(`could not read the arena result:\n${res}`);
  const w = Number(m[1]) / Number(m[2]) - 0.5;
  // f(θ+) − f(θ−) ≈ 2w; gradient estimate per coordinate = (2w) / (2 ck · Δi).
  logTheta = logTheta.map((x, i) => Math.max(-1.2, Math.min(1.2, x + ak * (w / ck) * delta[i])));
  const row = { k, map, plusWinRate: +(w + 0.5).toFixed(3), theta: params(logTheta).eval, clock: params(logTheta).weights.clock };
  fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
  console.log(`iter ${k + 1}/${iters} (${map}): + won ${(100 * (w + 0.5)).toFixed(1)}% →`, JSON.stringify(row.theta), `clock ${row.clock}`);
}
const final = params(logTheta);
console.log('\nfinal EVAL multipliers:', JSON.stringify(final.eval), 'clock weight:', final.weights.clock);
fs.rmSync(bundle, { force: true });
