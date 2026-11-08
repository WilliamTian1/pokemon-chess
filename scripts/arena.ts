/**
 * Bot-vs-bot arena. Plays many seeded games in parallel worker threads and reports win rates.
 *
 *   npx tsx scripts/arena.ts --a hard --d medium --games 64
 *   npx tsx scripts/arena.ts --a hard --d other:hard --other ./path/to/bot.ts --games 64 --swap
 *   npx tsx scripts/arena.ts --a hard --d hard --draft random --games 4000 --out games.jsonl
 *
 * A player is `<level>` (the repo bot) or `other:<level>` (the module given by --other, which must
 * export `decide` with the same signature). `--swap` also plays every seed with the roles
 * reversed, which cancels out the side's own advantage. `--draft random` replaces both drafts
 * with uniform random picks from the pool, which is what scripts/train-draft.ts learns from.
 * `--map river` plays on another map (default meadow).
 * `--tune '{"weights":{"clock":0},"search":{"beam":3}}'` overrides the repo bot's Hard settings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  type Action, type GameState, type Rng, type Side, RuleError, applyAction, decider, draftOptions, newGame, seededRng,
} from '../src/engine';

type Decide = (s: GameState, side: Side, level: string, rng: Rng) => Action[];

interface Job {
  seed: number;
  players: Record<Side, string>;
  draft: 'bot' | 'random';
  mapId: string;
}

export interface GameRecord {
  seed: number;
  players: Record<Side, string>;
  winner: Side;
  round: number;
  teams: Record<Side, string[]>;
  pool: string[];
  /** Fainted Pokémon per side and remaining HP fraction per side at the end. */
  fainted: Record<Side, number>;
  hpFrac: Record<Side, number>;
  ms: Record<Side, number>;
  decisions: Record<Side, number>;
  replans: number;
}

const here = fileURLToPath(import.meta.url);

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

let tune: { weights?: object; search?: object } | null = null;

async function loadDecide(spec: string, other: string | undefined): Promise<{ decide: Decide; level: string }> {
  if (spec.startsWith('other:')) {
    if (!other) throw new Error('--other is required for other:<level> players');
    const mod = await import(pathToFileURL(path.resolve(other)).href);
    return { decide: mod.decide as Decide, level: spec.slice(6) };
  }
  const mod = await import('../src/ai/bot');
  if (tune) {
    Object.assign(mod.WEIGHTS.hard, tune.weights ?? {});
    Object.assign(mod.SEARCH, tune.search ?? {});
  }
  return { decide: mod.decide as Decide, level: spec };
}

async function playGame(job: Job, other: string | undefined): Promise<GameRecord> {
  const players = { A: await loadDecide(job.players.A, other), D: await loadDecide(job.players.D, other) };
  const rng = seededRng(job.seed);
  const botRng = seededRng(job.seed * 7919 + 13);
  let s = newGame({ rng, mapId: job.mapId });
  const ms = { A: 0, D: 0 };
  const decisions = { A: 0, D: 0 };
  let replans = 0;
  let steps = 0;
  while (s.phase !== 'over') {
    if (++steps > 4000) throw new Error(`seed ${job.seed}: game did not terminate`);
    const side = decider(s)!;
    if (s.phase === 'draft' && job.draft === 'random') {
      const free = draftOptions(s);
      s = applyAction(s, { type: 'draftPick', cardId: free[botRng.int(free.length)] }, rng).state;
      continue;
    }
    const p = players[side];
    const t0 = performance.now();
    const plan = p.decide(s, side, p.level, botRng);
    ms[side] += performance.now() - t0;
    decisions[side] += 1;
    if (!plan.length) throw new Error(`seed ${job.seed}: ${job.players[side]} returned no action in ${s.phase}`);
    for (const a of plan) {
      if (decider(s) !== side) break;
      try {
        s = applyAction(s, a, rng).state;
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        replans += 1;
        if (replans > 200) throw new Error(`seed ${job.seed}: too many illegal bot actions (${e.message})`);
        break;
      }
    }
  }
  const stat = (side: Side) => {
    const us = s.units.filter((u) => u.side === side);
    return {
      fainted: us.filter((u) => u.fainted).length,
      hpFrac: us.reduce((a, u) => a + u.hp, 0) / us.reduce((a, u) => a + u.maxHp, 0),
    };
  };
  const a = stat('A');
  const d = stat('D');
  return {
    seed: job.seed, players: job.players, winner: s.winner!, round: s.round, teams: { A: s.draft.picks.A, D: s.draft.picks.D },
    pool: s.draft.pool, fainted: { A: a.fainted, D: d.fainted }, hpFrac: { A: a.hpFrac, D: d.hpFrac }, ms, decisions, replans,
  };
}

if (!isMainThread) {
  const { jobs, other, tuneJson } = workerData as { jobs: Job[]; other?: string; tuneJson?: string };
  tune = tuneJson ? JSON.parse(tuneJson) : null;
  for (const job of jobs) parentPort!.postMessage(await playGame(job, other));
} else {
  const a = arg('a', 'hard')!;
  const d = arg('d', 'hard')!;
  const games = Number(arg('games', '32'));
  const start = Number(arg('seed', '1'));
  const swap = arg('swap') === 'true';
  const draft = (arg('draft', 'bot') as Job['draft']);
  const mapId = arg('map', 'meadow')!;
  const other = arg('other');
  const out = arg('out');
  const threads = Math.max(1, Math.min(Number(arg('threads', String(os.cpus().length - 2))), games * (swap ? 2 : 1)));

  const jobs: Job[] = [];
  for (let i = 0; i < games; i++) {
    jobs.push({ seed: start + i, players: { A: a, D: d }, draft, mapId });
    if (swap) jobs.push({ seed: start + i, players: { A: d, D: a }, draft, mapId });
  }
  const buckets: Job[][] = Array.from({ length: threads }, () => []);
  jobs.forEach((j, i) => buckets[i % threads].push(j));
  const sink = out ? fs.createWriteStream(out) : null;
  const records: GameRecord[] = [];
  const t0 = Date.now();
  await Promise.all(buckets.map((bucket) => new Promise<void>((resolve, reject) => {
    // Workers don't inherit tsx's loader, so each one registers it before loading this file.
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { jobs: bucket, other, tuneJson: arg('tune') } });
    w.on('message', (r: GameRecord) => {
      records.push(r);
      sink?.write(`${JSON.stringify(r)}\n`);
      if (records.length % 50 === 0) process.stderr.write(`  ${records.length}/${jobs.length} games\n`);
    });
    w.on('error', reject);
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
  })));
  sink?.end();

  // Results per player (a player's wins across both roles when --swap).
  const byPlayer = new Map<string, { games: number; wins: number; asA: [number, number]; asD: [number, number]; ms: number; dec: number }>();
  const entry = (p: string) => {
    let e = byPlayer.get(p);
    if (!e) byPlayer.set(p, (e = { games: 0, wins: 0, asA: [0, 0], asD: [0, 0], ms: 0, dec: 0 }));
    return e;
  };
  for (const r of records) {
    for (const side of ['A', 'D'] as const) {
      const e = entry(r.players[side]);
      e.games += 1;
      const won = r.winner === side ? 1 : 0;
      e.wins += won;
      const slot = side === 'A' ? e.asA : e.asD;
      slot[0] += won;
      slot[1] += 1;
      e.ms += r.ms[side];
      e.dec += r.decisions[side];
    }
  }
  const sameName = a === d;
  console.log(`${records.length} games in ${((Date.now() - t0) / 1000).toFixed(1)}s on ${threads} threads`);
  if (sameName) {
    const aw = records.filter((r) => r.winner === 'A').length;
    console.log(`${a} vs itself: Attacker won ${aw}/${records.length}`);
  } else {
    for (const [p, e] of byPlayer) {
      console.log(
        `${p.padEnd(14)} wins ${e.wins}/${e.games} (${((100 * e.wins) / e.games).toFixed(1)}%) · as Attacker ${e.asA[0]}/${e.asA[1]} · as Defender ${e.asD[0]}/${e.asD[1]} · ${(e.ms / Math.max(1, e.dec)).toFixed(0)} ms/decision`,
      );
    }
  }
  const avgRound = records.reduce((x, r) => x + r.round, 0) / records.length;
  console.log(`average final round ${avgRound.toFixed(2)} · illegal bot actions ${records.reduce((x, r) => x + r.replans, 0)}`);
}
