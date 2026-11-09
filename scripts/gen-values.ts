/**
 * Training data for the value network (src/ai/value.ts): positions from Hard self-play, labelled
 * with the game's result (and optionally with playouts).
 *
 *   npx tsx scripts/gen-values.ts --games 20000 --out values.jsonl [--threads 30] [--seed 1]
 *
 * Each game picks its map, legendaries on/off, a random or Hard draft, and Hard or random placement
 * from its seed. The battle is played by the Hard search, which plays its 2nd–4th choice
 * `--explore` of the time (default 0.15) so the positions vary. Recorded per game:
 *  - 'turn': the position at the start of every team turn,
 *  - 'leaf' (with --leaves n): n of the positions the search compared before choosing.
 * Every position gets the game's actual result `z`; with `--rollouts n` it also gets `y`, the
 * Attacker's win rate over n Medium-vs-Medium playouts (otherwise y = z).
 */
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  type GameState, type Side, RuleError, applyAction, decider, draftOptions, getMap, liveUnits, newGame, seededRng,
} from '../src/engine';
import { SEARCH, decide, positionFeatures, rolloutValue, searchHooks } from '../src/ai/bot';

export interface ValueRecord {
  /** Game seed (train/validation split by game), kind, round. */
  g: number;
  k: 'turn' | 'leaf';
  r: number;
  /** Attacker win rate over `n` playouts (the game's result when n = 0), and the actual result (1 = Attacker won). */
  y: number;
  n: number;
  z: number;
  f: ReturnType<typeof positionFeatures>;
}

const here = fileURLToPath(import.meta.url);

/** Four decimals are plenty for features and keep the files small. */
const round4 = (_k: string, v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

interface Opts {
  rollouts: number;
  leaves: number;
  explore: number;
}

function playGame(seed: number, o: Opts): ValueRecord[] {
  const rng = seededRng(seed);
  const botRng = seededRng(seed * 7919 + 13);
  const cfg = seededRng(seed * 104729 + 7);
  const mapId = cfg.chance(0.5) ? 'river' : 'meadow';
  const randomDraft = cfg.chance(0.5);
  const randomPlacement = cfg.chance(1 / 3);
  let s = newGame({ rng, mapId, legendaries: cfg.chance(0.5) });
  const positions: { k: 'turn' | 'leaf'; s: GameState }[] = [];
  searchHooks.pick = (n) => (botRng.chance(o.explore) ? 1 + botRng.int(Math.min(3, n - 1)) : 0);
  searchHooks.onLeaves = o.leaves > 0 ? (_side: Side, leaves: GameState[]) => {
    const live = leaves.filter((l) => l.phase === 'battle');
    for (let i = 0; i < o.leaves && live.length; i++) positions.push({ k: 'leaf', s: live.splice(botRng.int(live.length), 1)[0] });
  } : null;
  for (let steps = 0; s.phase !== 'over' && steps < 3000; steps++) {
    const side = decider(s)!;
    if (s.phase === 'draft' && randomDraft) {
      const free = draftOptions(s);
      s = applyAction(s, { type: 'draftPick', cardId: free[botRng.int(free.length)] }, rng).state;
      continue;
    }
    if (s.phase === 'placement' && randomPlacement) {
      const spawns = getMap(s.mapId).spawns[side].filter((p) => !liveUnits(s).some((u) => u.pos && u.pos.x === p.x && u.pos.y === p.y));
      const units = s.units.filter((u) => u.side === side && !u.pos);
      const u = units[botRng.int(units.length)];
      s = applyAction(s, { type: 'place', unitId: u.id, pos: spawns[botRng.int(spawns.length)] }, rng).state;
      continue;
    }
    if (s.phase === 'battle' && !s.active && !s.pending.length && liveUnits(s, side).every((u) => !u.activated)) {
      positions.push({ k: 'turn', s });
    }
    const plan = decide(s, side, 'hard', botRng);
    let moved = false;
    for (const a of plan) {
      if (decider(s) !== side) break;
      try {
        s = applyAction(s, a, rng).state;
        moved = true;
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        break;
      }
    }
    if (!moved) s = applyAction(s, { type: 'concede', side }, rng).state;
  }
  searchHooks.onLeaves = null;
  searchHooks.pick = null;
  const z = s.winner === 'A' ? 1 : 0;
  return positions.map(({ k, s: p }) => ({
    g: seed, k, r: p.round, y: o.rollouts > 0 ? rolloutValue(p, 'A', o.rollouts) : z, n: o.rollouts, z, f: positionFeatures(p),
  }));
}

if (!isMainThread) {
  const { seeds, opts, search } = workerData as { seeds: number[]; opts: Opts; search: object };
  Object.assign(SEARCH, search);
  for (const seed of seeds) parentPort!.postMessage(playGame(seed, opts));
} else {
  const games = Number(arg('games', '100'));
  const start = Number(arg('seed', '1'));
  const opts: Opts = { rollouts: Number(arg('rollouts', '0')), leaves: Number(arg('leaves', '0')), explore: Number(arg('explore', '0.15')) };
  const threads = Math.min(games, Number(arg('threads', String(os.cpus().length - 2))));
  const search = JSON.parse(arg('search', '{}'));
  const out = fs.createWriteStream(arg('out', 'values.jsonl'));
  const buckets: number[][] = Array.from({ length: threads }, () => []);
  for (let i = 0; i < games; i++) buckets[i % threads].push(start + i);
  let done = 0;
  let records = 0;
  const t0 = Date.now();
  await Promise.all(buckets.map((seeds) => new Promise<void>((resolve, reject) => {
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { seeds, opts, search } });
    w.on('message', (rs: ValueRecord[]) => {
      for (const r of rs) out.write(`${JSON.stringify(r, round4)}\n`);
      records += rs.length;
      done += 1;
      if (done % 100 === 0) process.stderr.write(`  ${done}/${games} games, ${records} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    });
    w.on('error', reject);
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
  })));
  out.end();
  console.log(`${done} games, ${records} positions in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
