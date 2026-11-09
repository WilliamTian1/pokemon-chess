import { seededRng } from '../util';
import type { MapDef, Pos, Rng, Terrain } from '../types';

/**
 * Procedurally generated battlefields, for training the AI on many terrains (and for random-map play
 * later). `proc-<seed>` always gives the same map. Every map is laid out like the hand-made ones: the
 * Defender spawns on row 0, the Attacker on the last row, four spawns each, and a plain land path
 * always links the two sides (water only blocks Pokémon that can't swim or fly).
 */
export const PROC_PREFIX = 'proc-';

export function isProcMapId(id: string): boolean {
  return id.startsWith(PROC_PREFIX) && /^\d+$/.test(id.slice(PROC_PREFIX.length));
}

const cache = new Map<string, MapDef>();

export function procMap(id: string): MapDef {
  let m = cache.get(id);
  if (!m) {
    m = generate(Number(id.slice(PROC_PREFIX.length)), id);
    cache.set(id, m);
  }
  return m;
}

const pick = <T>(rng: Rng, xs: T[]): T => xs[rng.int(xs.length)];
const between = (rng: Rng, lo: number, hi: number): number => lo + rng.int(hi - lo + 1);

function generate(seed: number, id: string): MapDef {
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = tryGenerate(seededRng(seed * 101 + attempt), id);
    if (m) return m;
  }
  // Practically unreachable: an open field.
  return tryGenerate(seededRng(seed), id, true)!;
}

function tryGenerate(rng: Rng, id: string, plain = false): MapDef | null {
  const width = between(rng, 10, 15);
  const height = between(rng, 8, 11);
  const tiles: Terrain[][] = Array.from({ length: height }, () => Array.from({ length: width }, (): Terrain => 'normal'));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const set = (x: number, y: number, t: Terrain) => {
    if (inside(x, y)) tiles[y][x] = t;
  };
  const midRows = (y: number) => y >= 1 && y <= height - 2;

  if (!plain) {
    // Water: a winding river across the field, ponds, or both.
    const style = pick(rng, ['river', 'ponds', 'both', 'dry', 'river', 'ponds']);
    if (style === 'river' || style === 'both') {
      let y = between(rng, 2, height - 3);
      const thick = rng.chance(0.4) ? 2 : 1;
      for (let x = 0; x < width; x++) {
        for (let k = 0; k < thick; k++) if (midRows(y + k)) set(x, y + k, 'water');
        if (rng.chance(0.35)) {
          const ny = y + (rng.chance(0.5) ? 1 : -1);
          if (ny >= 2 && ny + thick - 1 <= height - 3) {
            for (let k = 0; k < thick; k++) if (midRows(ny + k)) set(x, ny + k, 'water');
            y = ny;
          }
        }
      }
      // Bridges across the river.
      const bridges = between(rng, 1, 3);
      for (let b = 0; b < bridges; b++) {
        const x = rng.int(width);
        for (let yy = 1; yy < height - 1; yy++) if (tiles[yy][x] === 'water') tiles[yy][x] = 'bridge';
      }
    }
    if (style === 'ponds' || style === 'both') {
      const ponds = between(rng, 2, 5);
      for (let p = 0; p < ponds; p++) blob(rng, tiles, between(rng, 0, width - 1), between(rng, 1, height - 2), between(rng, 2, 7), 'water');
    }
    // A cosmetic dirt road and patches of tall grass.
    if (rng.chance(0.6)) {
      let x = rng.int(width);
      for (let y = 0; y < height; y++) {
        if (tiles[y][x] === 'normal') tiles[y][x] = 'dirt';
        if (rng.chance(0.25)) x = Math.max(0, Math.min(width - 1, x + (rng.chance(0.5) ? 1 : -1)));
      }
    }
    for (let g = between(rng, 0, 3); g > 0; g--) blob(rng, tiles, rng.int(width), between(rng, 1, height - 2), between(rng, 1, 4), 'grass', 'normal');
    // Rarer terrain the hand-made maps don't use yet: rocks, ice and magma.
    if (rng.chance(0.3)) for (let w = between(rng, 2, 6); w > 0; w--) set(rng.int(width), between(rng, 2, height - 3), 'wall');
    if (rng.chance(0.2)) blob(rng, tiles, rng.int(width), between(rng, 2, height - 3), between(rng, 2, 6), 'ice', 'normal');
    if (rng.chance(0.15)) blob(rng, tiles, rng.int(width), between(rng, 2, height - 3), between(rng, 1, 4), 'magma', 'normal');
  }

  // Spawns: four per side on their edge row, on plain ground.
  const spawnCols = (): number[] | null => {
    const cols: number[] = [];
    const options = Array.from({ length: width }, (_, i) => i).filter((i) => i > 0 && i < width - 1);
    for (let tries = 0; cols.length < 4 && tries < 100; tries++) {
      const c = pick(rng, options);
      if (!cols.some((x) => Math.abs(x - c) < 2)) cols.push(c);
    }
    return cols.length === 4 ? cols.sort((a, b) => a - b) : null;
  };
  const dCols = spawnCols();
  const aCols = spawnCols();
  if (!dCols || !aCols) return null;
  const spawns = { D: dCols.map((x): Pos => ({ x, y: 0 })), A: aCols.map((x): Pos => ({ x, y: height - 1 })) };
  for (const p of [...spawns.A, ...spawns.D]) tiles[p.y][p.x] = 'normal';

  // Trebuchets (0–2) on dry ground in the middle rows, and the bonus tiles.
  const trebuchets: Pos[] = [];
  const free = (x: number, y: number) =>
    midRows(y) && y >= 2 && y <= height - 3 && (tiles[y][x] === 'normal' || tiles[y][x] === 'dirt') && !trebuchets.some((t) => t.x === x && t.y === y);
  const nTreb = plain ? 1 : pick(rng, [0, 1, 1, 1, 2]);
  for (let tries = 0; trebuchets.length < nTreb && tries < 200; tries++) {
    const x = between(rng, 1, width - 2);
    const y = between(rng, Math.floor(height / 3), Math.ceil((2 * height) / 3));
    if (free(x, y)) trebuchets.push({ x, y });
  }
  for (const [t, n] of [['bush', between(rng, 1, 5)], ['flower', between(rng, 1, 5)]] as const) {
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const x = rng.int(width);
      const y = between(rng, 1, height - 2);
      if (tiles[y][x] === 'normal' && free(x, y)) {
        tiles[y][x] = t;
        k++;
      }
    }
  }

  const map: MapDef = { id, name: `Random field ${id.slice(PROC_PREFIX.length)}`, width, height, tiles, trebuchets, spawns };
  return linked(map) ? map : null;
}

/** Grows a blob of terrain `t` from (x, y), only over tiles of type `over` (default: any but spawn rows). */
function blob(rng: Rng, tiles: Terrain[][], x: number, y: number, size: number, t: Terrain, over?: Terrain): void {
  const h = tiles.length;
  const w = tiles[0].length;
  let cx = x;
  let cy = y;
  for (let i = 0; i < size; i++) {
    if (cy >= 1 && cy <= h - 2 && cx >= 0 && cx < w && (!over || tiles[cy][cx] === over)) tiles[cy][cx] = t;
    const d = rng.int(4);
    cx += d === 0 ? 1 : d === 1 ? -1 : 0;
    cy += d === 2 ? 1 : d === 3 ? -1 : 0;
    cx = Math.max(0, Math.min(w - 1, cx));
    cy = Math.max(1, Math.min(h - 2, cy));
  }
}

/** Whether every spawn can reach every other side's spawn on foot (no swimming or flying). */
function linked(m: MapDef): boolean {
  const walk = (t: Terrain) => t !== 'water' && t !== 'wall' && t !== 'pit' && t !== 'magma';
  const seen = new Set<string>();
  const start = m.spawns.A[0];
  const queue: Pos[] = [start];
  seen.add(`${start.x},${start.y}`);
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = `${x},${y}`;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height || seen.has(k) || !walk(m.tiles[y][x])) continue;
      seen.add(k);
      queue.push({ x, y });
    }
  }
  return [...m.spawns.A, ...m.spawns.D].every((p) => seen.has(`${p.x},${p.y}`));
}
