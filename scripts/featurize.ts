/**
 * Turns recorded positions (scripts/arena.ts --states) into numbers for the value-network trainer:
 *
 *   npx tsx scripts/featurize.ts states-0.jsonl states-1.jsonl … [--threads 16]
 *
 * For each input it writes `<name>.f32` next to it: one row of 32-bit floats per position,
 *   [game seed, Attacker won, final round, fainted A, fainted D, final HP fraction A, D, round,
 *    whether the search's value was recorded, that value (clamped to ±50)]                       (META)
 *   + the global features + 8 Pokémon slots (4 Attacker, 4 Defender) of [card index + 1 (0 = empty), features…],
 * and once `features.json` (in the first input's folder) with the names behind every column.
 * scripts/train_value.py reads these.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CARD_LIST } from '../src/engine';
import { GLOBAL_FEATURES, UNIT_FEATURES, positionFeatures } from '../src/ai/bot';
import type { StateRecord } from './arena';

const META = ['seed', 'z', 'end', 'faintedA', 'faintedD', 'hpFracA', 'hpFracD', 'round', 'hasSearch', 'search'];
const NU = UNIT_FEATURES.length;
const NG = GLOBAL_FEATURES.length;
const WIDTH = META.length + NG + 8 * (1 + NU);
const here = fileURLToPath(import.meta.url);

async function featurize(file: string): Promise<number> {
  const cardIndex = new Map(CARD_LIST.map((c, i) => [c.id, i]));
  const out = fs.createWriteStream(file.replace(/\.jsonl$/, '') + '.f32');
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line) as StateRecord;
    const f = positionFeatures(r.s);
    const row = new Float32Array(WIDTH);
    row.set([r.g, r.z, r.end, r.fainted.A, r.fainted.D, r.hpFrac.A, r.hpFrac.D, r.s.round, r.v === undefined ? 0 : 1, Math.max(-50, Math.min(50, r.v ?? 0))]);
    row.set(f.global, META.length);
    (['A', 'D'] as const).forEach((side, si) => {
      f.units[side].slice(0, 4).forEach((u, k) => {
        const at = META.length + NG + (si * 4 + k) * (1 + NU);
        row[at] = (cardIndex.get(u.card) ?? -1) + 1;
        row.set(u.x, at + 1);
      });
    });
    if (!out.write(Buffer.from(row.buffer))) await new Promise((res) => out.once('drain', res));
    n += 1;
  }
  await new Promise((res) => out.end(res));
  return n;
}

if (!isMainThread) {
  for (const f of (workerData as { files: string[] }).files) parentPort!.postMessage({ file: f, n: await featurize(f) });
} else {
  const argv = process.argv.slice(2);
  const ti = argv.indexOf('--threads');
  const files = argv.filter((a, i) => !a.startsWith('--') && i !== ti + 1);
  const threads = Math.max(1, Math.min(files.length, ti >= 0 ? Number(argv[ti + 1]) : os.cpus().length - 2));
  if (!files.length) throw new Error('usage: featurize.ts states.jsonl […]');
  fs.writeFileSync(path.join(path.dirname(files[0]), 'features.json'), JSON.stringify({
    meta: META, global: GLOBAL_FEATURES, unit: UNIT_FEATURES, cards: CARD_LIST.map((c) => c.id), width: WIDTH,
  }));
  const buckets: string[][] = Array.from({ length: threads }, () => []);
  files.forEach((f, i) => buckets[i % threads].push(f));
  let total = 0;
  await Promise.all(buckets.map((bucket) => new Promise<void>((resolve, reject) => {
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { files: bucket } });
    w.on('message', (r: { file: string; n: number }) => {
      total += r.n;
      console.log(`${r.file}: ${r.n} positions`);
    });
    w.on('error', reject);
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
  })));
  console.log(`${total} positions × ${WIDTH} columns`);
}
