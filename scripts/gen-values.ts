/**
 * Training data for the value network (src/ai/value.ts): self-play positions labelled by how often
 * the Attacker wins when the game is played out from them.
 *
 *   npx tsx scripts/gen-values.ts --games 2000 --rollouts 8 --out values.jsonl [--threads 30] [--seed 1]
 *
 * Games use random drafts (both maps, with and without legendaries), Hard placement or random
 * placement, and the Hard battle search with a light budget that sometimes plays its 2nd–4th choice,
 * so positions vary. Recorded per game:
 *  - 'turn': the position at the start of every team turn,
 *  - 'leaf': a few of the positions the search compared before choosing (what the value network
 *    has to rank in play).
 * Each is labelled by `--rollouts` playouts to the end of the game (Medium policy, real dice), and
 * with the game's actual result.
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
  /** Attacker win rate over `n` playouts, and the actual game result (1 = Attacker won). */
  y: number;
  n: number;
  z: number;
  f: ReturnType<typeof positionFeatures>;
}

const here = fileURLToPath(import.meta.url);

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

function playGame(seed: number, rollouts: number, leavesPerDecision: number): ValueRecord[] {
  const rng = seededRng(seed);
  const botRng = seededRng(seed * 7919 + 13);
  const mapId = seed % 2 ? 'river' : 'meadow';
  let s = newGame({ rng, mapId, legendaries: seed % 4 < 2 });
  const positions: { k: 'turn' | 'leaf'; s: GameState }[] = [];
  searchHooks.pick = (n) => (botRng.chance(0.15) ? 1 + botRng.int(Math.min(3, n - 1)) : 0);
  searchHooks.onLeaves = (_side: Side, leaves: GameState[]) => {
    const live = leaves.filter((l) => l.phase === 'battle');
    for (let i = 0; i < leavesPerDecision && live.length; i++) positions.push({ k: 'leaf', s: live.splice(botRng.int(live.length), 1)[0] });
  };
  const randomPlacement = seed % 3 === 0;
  for (let steps = 0; s.phase !== 'over' && steps < 3000; steps++) {
    const side = decider(s)!;
    if (s.phase === 'draft') {
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
  return positions.map(({ k, s: p }) => ({ g: seed, k, r: p.round, y: rolloutValue(p, 'A', rollouts), n: rollouts, z, f: positionFeatures(p) }));
}

if (!isMainThread) {
  const { seeds, rollouts, leaves, search } = workerData as { seeds: number[]; rollouts: number; leaves: number; search: object };
  Object.assign(SEARCH, search);
  for (const seed of seeds) parentPort!.postMessage(playGame(seed, rollouts, leaves));
} else {
  const games = Number(arg('games', '100'));
  const start = Number(arg('seed', '1'));
  const rollouts = Number(arg('rollouts', '8'));
  const leaves = Number(arg('leaves', '2'));
  const threads = Math.min(games, Number(arg('threads', String(os.cpus().length - 2))));
  const search = JSON.parse(arg('search', '{"beam":8,"perUnit":3,"replies":8,"replyBeam":2}'));
  const out = fs.createWriteStream(arg('out', 'values.jsonl'));
  const buckets: number[][] = Array.from({ length: threads }, () => []);
  for (let i = 0; i < games; i++) buckets[i % threads].push(start + i);
  let done = 0;
  let records = 0;
  const t0 = Date.now();
  await Promise.all(buckets.map((seeds) => new Promise<void>((resolve, reject) => {
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { seeds, rollouts, leaves, search } });
    w.on('message', (rs: ValueRecord[]) => {
      for (const r of rs) out.write(`${JSON.stringify(r)}\n`);
      records += rs.length;
      done += 1;
      if (done % 20 === 0) process.stderr.write(`  ${done}/${games} games, ${records} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    });
    w.on('error', reject);
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
  })));
  out.end();
  console.log(`${done} games, ${records} positions in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
