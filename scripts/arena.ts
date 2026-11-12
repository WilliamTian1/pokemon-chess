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
 * `--map river` plays on another map (default meadow). `--legends off` drafts without legendaries, and
 * `--legends mix` alternates (training data for both modes); `--trainers on|off|mix` does the same for
 * trainer mode (random drafts pick trainers at random too). `--usage` records how often each move is
 * chosen when it is usable (in --out records).
 * `--tune '{"weights":{"clock":0},"search":{"beam":3},"eval":{"ko":1.2}}'` overrides the repo bot's Hard
 * settings, and `--tune-other` the --other bot's (if it exports them). `--value model.json` gives the repo
 * bot that value network (scripts/train_value.py) to score its search leaves with, and `--value none` takes
 * the built-in one away (`--value-other` does the same for the --other bot, if it has setValueModel). `--states file.jsonl` writes the position at the start of every team turn as a raw
 * game state (without the log) with the game's result: training data for the value network, turned into
 * numbers by scripts/featurize.ts. `--explore p`: the repo's Hard search plays its 2nd–4th choice that share of its
 * turns, and `--random-placement p` places both teams at random in that share of the games (both make the
 * recorded positions more varied).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  type Action, DRAFTABLE, type GameState, type Rng, type Side, RuleError, applyAction, cardOf, decider, draftOptions, gameFromTeams, hiddenView, liveUnits,
  getMap, moveOptions, newGame,
  seededRng, trebuchetOption,
} from '../src/engine';
import { searchHooks } from '../src/ai/bot';

type Decide = (s: GameState, side: Side, level: string, rng: Rng) => Action[];

interface Job {
  seed: number;
  players: Record<Side, string>;
  draft: 'bot' | 'random' | 'teams';
  mapId: string;
  legends: boolean;
  /** `--draft teams --legends mix`: each side independently with or without a legendary. */
  legendMix?: boolean;
  /** `--style secret|auction`: the draft style (bots draft that way). */
  style?: 'classic' | 'secret' | 'auction';
  trainers: boolean;
  usage: boolean;
  states?: boolean;
  explore?: number;
  randomPlacement?: number;
}

/** A turn-start position as a raw state (no log) with its game's result (training data for the value network). */
export interface StateRecord {
  g: number;
  /** 1 = the Attacker won; the round the game ended in; fainted and HP fraction per side at the end. */
  z: number;
  end: number;
  fainted: Record<Side, number>;
  hpFrac: Record<Side, number>;
  /**
   * The Hard search's own value of the position, from the Attacker's point of view (leaf score of the
   * best line it found: hand-evaluation points × SEARCH.handScale, or log-odds with a value network;
   * ±1e6 for a forced result). Missing when no search ran from this position.
   */
  v?: number;
  s: GameState;
}

export interface GameRecord {
  seed: number;
  players: Record<Side, string>;
  winner: Side;
  round: number;
  teams: Record<Side, string[]>;
  pool: string[];
  /** The map (older records don't have it: scripts/train-draft-general.ts takes it from `file@map`). */
  mapId?: string;
  /** Game mode, and each side's trainer in trainer mode. */
  legends?: boolean;
  trainers?: Record<Side, string | null>;
  /** Fainted Pokémon per side and remaining HP fraction per side at the end. */
  fainted: Record<Side, number>;
  hpFrac: Record<Side, number>;
  ms: Record<Side, number>;
  decisions: Record<Side, number>;
  replans: number;
  /**
   * With --usage: per "card|move" (moves named, plus Trebuchet and wait), how often it was usable
   * when that card acted, and how often it was chosen.
   */
  usage?: Record<string, { avail: number; used: number }>;
  /** With --states: the start of every team turn (written to that file, not to --out). */
  states?: StateRecord[];
  /** Data-generation settings of this game (--explore, --random-placement). */
  explore?: number;
  randomPlacement?: boolean;
}

const here = fileURLToPath(import.meta.url);

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

type Tune = { weights?: object; search?: object; eval?: object };
let tune: Tune | null = null;
let tuneOther: Tune | null = null;
let valueFile: string | undefined;
let valueOtherFile: string | undefined;

function applyTune(mod: Record<string, unknown>, t: Tune | null): void {
  if (!t) return;
  const target = (name: string) => mod[name] as Record<string, unknown> | undefined;
  if (t.weights) Object.assign((target('WEIGHTS') as Record<string, object>).hard, t.weights);
  if (t.search) Object.assign(target('SEARCH')!, t.search);
  if (t.eval) Object.assign(target('EVAL')!, t.eval);
}

async function loadDecide(spec: string, other: string | undefined): Promise<{ decide: Decide; level: string }> {
  if (spec.startsWith('other:')) {
    if (!other) throw new Error('--other is required for other:<level> players');
    const mod = await import(pathToFileURL(path.resolve(other)).href);
    applyTune(mod, tuneOther);
    if (valueOtherFile && mod.setValueModel) mod.setValueModel(valueOtherFile === 'none' ? null : JSON.parse(fs.readFileSync(valueOtherFile, 'utf8')));
    return { decide: mod.decide as Decide, level: spec.slice(6) };
  }
  const mod = await import('../src/ai/bot');
  applyTune(mod as unknown as Record<string, unknown>, tune);
  if (valueFile) mod.setValueModel(valueFile === 'none' ? null : JSON.parse(fs.readFileSync(valueFile, 'utf8')));
  return { decide: mod.decide as Decide, level: spec };
}

/**
 * Random teams for `--draft teams` (training data for every draft style): four distinct cards a side,
 * with one legendary each, none, or (with --legends mix) one side only.
 */
function randomTeams(r: Rng, job: Job): Record<Side, string[]> {
  const normals = DRAFTABLE.filter((c) => !c.legendary).map((c) => c.id);
  const legends = DRAFTABLE.filter((c) => c.legendary).map((c) => c.id);
  const shuffle = (xs: string[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  let withLegend = { A: job.legends, D: job.legends };
  if (job.legendMix) {
    const k = r.int(10);
    withLegend = k < 5 ? { A: true, D: true } : k < 8 ? { A: false, D: false } : k < 9 ? { A: true, D: false } : { A: false, D: true };
  }
  const n = shuffle(normals);
  const l = shuffle(legends);
  const team = (side: Side, i: number) => (withLegend[side] ? [...n.slice(i, i + 3), l[side === 'A' ? 0 : 1]] : n.slice(i, i + 4));
  return { A: team('A', 0), D: team('D', 4) };
}

async function playGame(job: Job, other: string | undefined): Promise<GameRecord> {
  const players = { A: await loadDecide(job.players.A, other), D: await loadDecide(job.players.D, other) };
  const rng = seededRng(job.seed);
  const botRng = seededRng(job.seed * 7919 + 13);
  let s = job.draft === 'teams'
    ? gameFromTeams(randomTeams(seededRng(job.seed * 31 + 7), job), { rng, mapId: job.mapId, trainers: job.trainers })
    : newGame({ rng, mapId: job.mapId, legendaries: job.legends, trainers: job.trainers, style: job.style });
  const ms = { A: 0, D: 0 };
  const decisions = { A: 0, D: 0 };
  let replans = 0;
  let steps = 0;
  const usage: Record<string, { avail: number; used: number }> = {};
  const turns: GameState[] = [];
  const turnValues: (number | undefined)[] = [];
  let searched: { side: Side; v: number } | null = null;
  searchHooks.onSearch = job.states ? (side, best) => { searched = { side, v: best }; } : null;
  // Data generation: some turns play the search's 2nd–4th choice; some games place at random.
  const cfg = seededRng(job.seed * 104729 + 7);
  const randomPlacement = (job.randomPlacement ?? 0) > 0 && cfg.chance(job.randomPlacement!);
  const explore = job.explore ?? 0;
  searchHooks.pick = explore > 0 ? (n) => (n > 1 && cfg.chance(explore) ? 1 + cfg.int(Math.min(3, n - 1)) : 0) : null;
  const note = (key: string, field: 'avail' | 'used') => {
    usage[key] ??= { avail: 0, used: 0 };
    usage[key][field] += 1;
  };
  while (s.phase !== 'over') {
    if (++steps > 4000) throw new Error(`seed ${job.seed}: game did not terminate`);
    const side = decider(s)!;
    if (s.phase === 'draft' && job.draft !== 'bot') {
      const free = draftOptions(s);
      s = applyAction(s, { type: 'draftPick', cardId: free[botRng.int(free.length)] }, rng).state;
      continue;
    }
    if (s.phase === 'placement' && randomPlacement) {
      const spawns = getMap(s.mapId).spawns[side].filter((p) => !liveUnits(s).some((u) => u.pos && u.pos.x === p.x && u.pos.y === p.y));
      const units = s.units.filter((u) => u.side === side && !u.pos);
      s = applyAction(s, { type: 'place', unitId: units[cfg.int(units.length)].id, pos: spawns[cfg.int(spawns.length)] }, rng).state;
      continue;
    }
    const turnStart = !!job.states && s.phase === 'battle' && !s.active && !s.pending.length && liveUnits(s, side).every((u) => !u.activated);
    if (turnStart) turns.push(s);
    searched = null;
    const p = players[side];
    const t0 = performance.now();
    // Bots see what a player would: in Secret not the other side's pool, picks or placement, in an
    // Auction not the deck (the same hidden view the server gives its bots).
    const plan = p.decide(hiddenView(s, side), side, p.level, botRng);
    ms[side] += performance.now() - t0;
    decisions[side] += 1;
    const found = searched as { side: Side; v: number } | null;
    if (turnStart && found) turnValues[turns.length - 1] = found.side === 'A' ? found.v : -found.v;
    if (!plan.length) throw new Error(`seed ${job.seed}: ${job.players[side]} returned no action in ${s.phase}`);
    for (const a of plan) {
      if (decider(s) !== side) break;
      if (job.usage && s.phase === 'battle' && (a.type === 'useMove' || a.type === 'trebuchet' || a.type === 'wait')) {
        const u = s.units.find((x) => x.id === a.unitId)!;
        const c = cardOf(u);
        const usable = moveOptions(s, u).filter((o) => o.usable);
        for (const o of usable) note(`${c.name}|${o.move.name}`, 'avail');
        if (trebuchetOption(s, u).usable) note(`${c.name}|Trebuchet`, 'avail');
        if (usable.length) note(`${c.name}|wait`, 'avail');
        if (a.type === 'useMove') note(`${c.name}|${c.moves[a.moveIndex].name}`, 'used');
        else if (a.type === 'trebuchet') note(`${c.name}|Trebuchet`, 'used');
        else if (usable.length) note(`${c.name}|wait`, 'used');
      }
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
  const z = s.winner === 'A' ? 1 : 0;
  searchHooks.pick = null;
  searchHooks.onSearch = null;
  return {
    seed: job.seed, players: job.players, winner: s.winner!, round: s.round, teams: { A: s.draft.picks.A, D: s.draft.picks.D }, mapId: job.mapId,
    pool: s.draft.pool, legends: job.legendMix ? undefined : job.legends, ...(s.trainers ? { trainers: { ...s.trainers.picks } } : {}), fainted: { A: a.fainted, D: d.fainted }, hpFrac: { A: a.hpFrac, D: d.hpFrac }, ms, decisions, replans,
    ...(job.usage ? { usage } : {}),
    ...(job.states ? {
      states: turns.map((t, i): StateRecord => ({
        g: job.seed, z, end: s.round, fainted: { A: a.fainted, D: d.fainted }, hpFrac: { A: a.hpFrac, D: d.hpFrac },
        ...(turnValues[i] !== undefined ? { v: +turnValues[i]!.toFixed(4) } : {}), s: { ...t, log: [] },
      })),
    } : {}),
    ...(explore > 0 ? { explore } : {}), ...(randomPlacement ? { randomPlacement } : {}),
  };
}

if (!isMainThread) {
  const { jobs, other, tuneJson, tuneOtherJson, value, valueOther } = workerData as {
    jobs: Job[]; other?: string; tuneJson?: string; tuneOtherJson?: string; value?: string; valueOther?: string;
  };
  valueFile = value;
  valueOtherFile = valueOther;
  tune = tuneJson ? JSON.parse(tuneJson) : null;
  tuneOther = tuneOtherJson ? JSON.parse(tuneOtherJson) : null;
  for (const job of jobs) parentPort!.postMessage(await playGame(job, other));
} else {
  const a = arg('a', 'hard')!;
  const d = arg('d', 'hard')!;
  const games = Number(arg('games', '32'));
  const start = Number(arg('seed', '1'));
  const swap = arg('swap') === 'true';
  const draft = (arg('draft', 'bot') as Job['draft']);
  // `--map proc`: a different procedurally generated map for every seed (both roles of a swapped pair share it).
  const mapArg = arg('map', 'meadow')!;
  const usage = arg('usage') === 'true';
  const legendMode = arg('legends', 'on')!;
  const trainerMode = arg('trainers', 'off')!;
  const other = arg('other');
  const out = arg('out');
  const statesOut = arg('states');
  const explore = Number(arg('explore', '0'));
  const randomPlacement = Number(arg('random-placement', '0'));
  const threads = Math.max(1, Math.min(Number(arg('threads', String(os.cpus().length - 2))), games * (swap ? 2 : 1)));

  const jobs: Job[] = [];
  for (let i = 0; i < games; i++) {
    const legends = legendMode === 'mix' ? i % 2 === 0 : legendMode !== 'off';
    const legendMix = draft === 'teams' && legendMode === 'mix';
    const style = (arg('style', 'classic') as Job['style']);
    const mapId = mapArg === 'proc' ? `proc-${start + i}` : mapArg;
    const trainers = trainerMode === 'mix' ? Math.floor(i / 2) % 2 === 0 : trainerMode === 'on';
    const extra = { states: statesOut !== undefined, explore, randomPlacement };
    jobs.push({ seed: start + i, players: { A: a, D: d }, draft, mapId, legends, legendMix, style, trainers, usage, ...extra });
    if (swap) jobs.push({ seed: start + i, players: { A: d, D: a }, draft, mapId, legends, legendMix, style, trainers, usage, ...extra });
  }
  const buckets: Job[][] = Array.from({ length: threads }, () => []);
  jobs.forEach((j, i) => buckets[i % threads].push(j));
  const sink = out ? fs.createWriteStream(out) : null;
  const stateSink = statesOut ? fs.createWriteStream(statesOut) : null;
  const records: GameRecord[] = [];
  const t0 = Date.now();
  await Promise.all(buckets.map((bucket) => new Promise<void>((resolve, reject) => {
    // Workers don't inherit tsx's loader, so each one registers it before loading this file.
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { jobs: bucket, other, tuneJson: arg('tune'), tuneOtherJson: arg('tune-other'), value: arg('value'), valueOther: arg('value-other') } });
    w.on('message', (r: GameRecord) => {
      for (const v of r.states ?? []) stateSink?.write(`${JSON.stringify(v)}\n`);
      delete r.states;
      records.push(r);
      sink?.write(`${JSON.stringify(r)}\n`);
      if (records.length % 50 === 0) process.stderr.write(`  ${records.length}/${jobs.length} games\n`);
    });
    w.on('error', reject);
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
  })));
  sink?.end();
  stateSink?.end();

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
