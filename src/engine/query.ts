import { getCard } from './data/cards';
import { getMap } from './data/maps';
import type {
  AbilityId, CardDef, Dir, GameState, Hazard, MapDef, MoveDef, PType, Pos, Side, Terrain, Unit,
} from './types';
import { ORTHO, addPos, cheb, posKey, rotate, samePos, steps } from './util';

// ---------------------------------------------------------------- units & cards

export const cardOf = (u: Unit): CardDef => getCard(u.cardId);
export const abilityOf = (u: Unit): AbilityId => cardOf(u).ability;
export const hasType = (u: Unit, t: PType): boolean => cardOf(u).types.includes(t);
/** Flying types and Levitate users cross water/pits and ignore hazards. */
export const isFlier = (u: Unit): boolean => hasType(u, 'Flying') || abilityOf(u) === 'levitate';
export const isGhost = (u: Unit): boolean => hasType(u, 'Ghost');
export const onBoard = (u: Unit): u is Unit & { pos: Pos } => !u.fainted && u.pos !== null;

export function getUnit(s: GameState, id: string): Unit {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown unit ${id}`);
  return u;
}

export const liveUnits = (s: GameState, side?: Side): Unit[] =>
  s.units.filter((u) => onBoard(u) && (side === undefined || u.side === side));
export const alliesOf = (s: GameState, u: Unit): Unit[] => liveUnits(s, u.side).filter((x) => x.id !== u.id);
export const enemiesOf = (s: GameState, u: Unit): Unit[] => liveUnits(s).filter((x) => x.side !== u.side);
export const adjacentUnits = (s: GameState, u: Unit): Unit[] =>
  u.pos ? liveUnits(s).filter((x) => x.id !== u.id && cheb(x.pos!, u.pos!) === 1) : [];
/** Live units with this ability anywhere on the field. */
export const withAbility = (s: GameState, a: AbilityId): Unit[] => liveUnits(s).filter((u) => abilityOf(u) === a);

/** The trainer `side` picked (trainer mode), or null. */
export const trainerOf = (s: GameState, side: Side): string | null => s.trainers?.picks[side] ?? null;
/** The trainer Special Move in effect for `side`'s current turn, if any. */
export const turnEffect = (s: GameState, side: Side): 'sureHit' | 'rally' | 'push2' | null =>
  s.trainers?.effect?.side === side ? s.trainers.effect.kind : null;
/** Leaf Guard / Snow Cloak double the effect of berry bushes and flowers. */
export const terrainMult = (u: Unit): number => (abilityOf(u) === 'leafGuard' || abilityOf(u) === 'snowCloak' ? 2 : 1);

export function moveOf(u: Unit, index: 0 | 1): MoveDef {
  return cardOf(u).moves[index];
}

// ---------------------------------------------------------------- map

export const mapOf = (s: GameState): MapDef => getMap(s.mapId);
export const inBounds = (s: GameState, p: Pos): boolean => {
  const m = mapOf(s);
  return p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;
};
export const terrainAt = (s: GameState, p: Pos): Terrain => mapOf(s).tiles[p.y][p.x];
/** "Normal" terrain: no bonuses and no movement limitations (dirt, grass and bridges are cosmetic). */
export const isNormalTerrain = (t: Terrain): boolean => t === 'normal' || t === 'dirt' || t === 'grass' || t === 'bridge';
/** Berry bushes and flowers only help Pokémon standing in them: Flying and Levitate Pokémon hover above. */
export function terrainBonus(s: GameState, u: Unit, at?: Pos | null): 'bush' | 'flower' | null {
  const p = at ?? u.pos;
  if (!p || isFlier(u)) return null;
  const t = terrainAt(s, p);
  return t === 'bush' || t === 'flower' ? t : null;
}
export const isTrebuchet = (s: GameState, p: Pos): boolean => mapOf(s).trebuchets.some((t) => samePos(t, p));

export const unitAt = (s: GameState, p: Pos): Unit | undefined =>
  s.units.find((u) => onBoard(u) && u.pos.x === p.x && u.pos.y === p.y);
export const hazardAt = (s: GameState, p: Pos): Hazard | undefined => s.hazards.find((h) => samePos(h.pos, p));
export const substituteAt = (s: GameState, p: Pos): boolean => !!s.substitute && samePos(s.substitute.pos, p);

export function canStand(u: Unit, t: Terrain): boolean {
  switch (t) {
    case 'wall':
    case 'pit':
      return false;
    case 'water':
      return hasType(u, 'Water') || isFlier(u);
    case 'magma':
      return hasType(u, 'Fire') || isFlier(u);
    default:
      return true;
  }
}

export function canPass(u: Unit, t: Terrain): boolean {
  if (t === 'pit') return isFlier(u);
  return canStand(u, t);
}

/** Tiles a hazard / substitute may be placed on. */
export function canPlaceOn(s: GameState, p: Pos): boolean {
  if (!inBounds(s, p)) return false;
  const t = terrainAt(s, p);
  return t !== 'wall' && t !== 'pit' && !isTrebuchet(s, p) && !unitAt(s, p) && !hazardAt(s, p) && !substituteAt(s, p);
}

// ---------------------------------------------------------------- stats

export function adjacentToType(s: GameState, u: Unit, t: PType, at?: Pos): boolean {
  const p = at ?? u.pos;
  if (!p) return false;
  return liveUnits(s).some((x) => x.id !== u.id && cheb(x.pos!, p) === 1 && hasType(x, t));
}

/** Movement allowance from stats, paralysis and positional abilities (not turn restrictions). */
export function effectiveMov(s: GameState, u: Unit, at?: Pos): number {
  const c = cardOf(u);
  const p = at ?? u.pos;
  let m = c.mov + u.stages.mov;
  if (u.status === 'par') m -= 1;
  if (p) {
    switch (c.ability) {
      case 'chlorophyll':
        if (adjacentToType(s, u, 'Fire', p)) m += 2;
        break;
      case 'shadowDash':
        if (!alliesOf(s, u).some((a) => steps(a.pos!, p) <= 3)) m += 2;
        break;
      case 'slushRush':
        if (adjacentToType(s, u, 'Ice', p) || terrainAt(s, p) === 'ice') m += 2;
        break;
    }
  }
  return Math.max(0, m);
}

// ---------------------------------------------------------------- targeting grids

export interface GridCell {
  f: number;
  s: number;
}
export interface ParsedGrid {
  targets: GridCell[];
  dash: GridCell | null;
  knockback: number;
}

const gridCache = new Map<string, ParsedGrid>();

export function parseGrid(grid: string): ParsedGrid {
  const cached = gridCache.get(grid);
  if (cached) return cached;
  const rows = grid.split('/');
  let gr = -1;
  let gc = -1;
  rows.forEach((row, r) => {
    const c = row.indexOf('G');
    if (c >= 0) {
      gr = r;
      gc = c;
    }
  });
  if (gr < 0) throw new Error(`Grid without user: ${grid}`);
  const targets: GridCell[] = [];
  const knocks: GridCell[] = [];
  let dash: GridCell | null = null;
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const cell = { f: gr - r, s: c - gc };
      if (ch === 'O') targets.push(cell);
      else if (ch === 'B') dash = cell;
      else if (ch === 'R') knocks.push(cell);
    }),
  );
  // Red cells mark where targets are knocked to: the gap between a red cell and the nearest
  // target behind it (same column) is the knockback distance.
  let knockback = 0;
  for (const k of knocks) {
    const behind = targets.filter((t) => t.s === k.s && t.f < k.f).map((t) => t.f);
    if (behind.length) knockback = Math.max(knockback, k.f - Math.max(...behind));
  }
  const parsed = { targets, dash, knockback };
  gridCache.set(grid, parsed);
  return parsed;
}

export function moveGrid(m: MoveDef): ParsedGrid | null {
  if (m.target.kind === 'grid' || m.target.kind === 'place') return parseGrid(m.target.grid);
  return null;
}

/** Which tile an attack tile propagates from (rules p.3): adjacent tiles come straight from the
 *  user, the centre column propagates forward, side columns branch sideways from the centre. */
function sourceOf(c: GridCell): GridCell | null {
  if (Math.max(Math.abs(c.f), Math.abs(c.s)) <= 1) return null;
  if (c.s === 0) return { f: c.f - Math.sign(c.f), s: 0 };
  return { f: c.f, s: c.s - Math.sign(c.s) };
}

export function gridTile(origin: Pos, c: GridCell, dir: Dir): Pos {
  return addPos(origin, rotate(c.f, c.s, dir));
}

/** On-board tiles of every cell drawn with `mark` (e.g. 'R' knockback) for a grid aimed `dir`. */
export function markedTiles(s: GameState, grid: string, mark: string, origin: Pos, dir: Dir): Pos[] {
  const rows = grid.split('/');
  const gr = rows.findIndex((r) => r.includes('G'));
  const gc = rows[gr].indexOf('G');
  const out: Pos[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== mark) return;
      const p = gridTile(origin, { f: gr - r, s: c - gc }, dir);
      if (inBounds(s, p)) out.push(p);
    }),
  );
  return out;
}

/** Target tiles of a grid from `origin` facing `dir`, minus tiles off the board or behind walls. */
export function zoneTiles(s: GameState, origin: Pos, grid: ParsedGrid, dir: Dir): Pos[] {
  const memo = new Map<string, boolean>();
  const blocked = (c: GridCell): boolean => {
    const k = `${c.f},${c.s}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const p = gridTile(origin, c, dir);
    let b = !inBounds(s, p) || terrainAt(s, p) === 'wall';
    if (!b) {
      const src = sourceOf(c);
      b = src ? blocked(src) : false;
    }
    memo.set(k, b);
    return b;
  };
  return grid.targets.filter((c) => !blocked(c)).map((c) => gridTile(origin, c, dir));
}

// ---------------------------------------------------------------- movement

export interface ReachInfo {
  pos: Pos;
  cost: number;
  hazards: number;
  path: Pos[];
}

/**
 * Tiles `u` can end on from `from` within `budget` movement. Orthogonal steps cost 1 (Wave Rider:
 * water costs ½). Allies can be passed through; enemies and substitutes only by Ghost types.
 * Among valid paths the one crossing the fewest hazards is chosen.
 */
export function reachable(s: GameState, u: Unit, budget: number, from?: Pos): Map<string, ReachInfo> {
  const start = from ?? u.pos;
  const out = new Map<string, ReachInfo>();
  if (!start || budget <= 0) return out;
  const m = mapOf(s);
  const B = Math.floor(budget * 2);
  const ghost = isGhost(u);
  const flier = isFlier(u);
  const wave = abilityOf(u) === 'waveRider';
  const W = m.width;
  const L = B + 1;
  // best[(idx*L)+c] = hazards (+1 so 0 means unvisited); prev stores predecessor state id
  const best = new Int16Array(m.width * m.height * L);
  const prev = new Int32Array(m.width * m.height * L).fill(-1);
  const buckets: number[][] = Array.from({ length: L }, () => []);
  const startState = (start.y * W + start.x) * L;
  best[startState] = 1;
  buckets[0].push(startState);
  for (let c = 0; c <= B; c++) {
    for (const st of buckets[c]) {
      const idx = Math.floor(st / L);
      const haz = best[st] - 1;
      const px = idx % W;
      const py = Math.floor(idx / W);
      for (const d of ORTHO) {
        const np = { x: px + d.x, y: py + d.y };
        if (np.x < 0 || np.y < 0 || np.x >= m.width || np.y >= m.height) continue;
        const t = m.tiles[np.y][np.x];
        if (!canPass(u, t)) continue;
        const occ = unitAt(s, np);
        if (occ && occ.id !== u.id && occ.side !== u.side && !ghost) continue;
        if (substituteAt(s, np) && !ghost) continue;
        const nc = c + (wave && t === 'water' ? 1 : 2);
        if (nc > B) continue;
        const nh = haz + (!flier && hazardAt(s, np) ? 1 : 0);
        const ns = (np.y * W + np.x) * L + nc;
        if (best[ns] !== 0 && best[ns] - 1 <= nh) continue;
        best[ns] = nh + 1;
        prev[ns] = st;
        buckets[nc].push(ns);
      }
    }
  }
  for (let idx = 0; idx < m.width * m.height; idx++) {
    const p = { x: idx % W, y: Math.floor(idx / W) };
    if (samePos(p, start)) continue;
    const occ = unitAt(s, p);
    if ((occ && occ.id !== u.id) || substituteAt(s, p) || !canStand(u, m.tiles[p.y][p.x])) continue;
    let bestState = -1;
    let bestHaz = Infinity;
    let bestCost = Infinity;
    for (let c = 0; c <= B; c++) {
      const st = idx * L + c;
      if (best[st] === 0) continue;
      const h = best[st] - 1;
      if (h < bestHaz || (h === bestHaz && c < bestCost)) {
        bestHaz = h;
        bestCost = c;
        bestState = st;
      }
    }
    if (bestState < 0) continue;
    const path: Pos[] = [];
    for (let st = bestState; st !== startState && st >= 0; st = prev[st]) {
      const i = Math.floor(st / L);
      path.push({ x: i % W, y: Math.floor(i / W) });
    }
    path.reverse();
    out.set(posKey(p), { pos: p, cost: bestCost / 2, hazards: bestHaz, path });
  }
  return out;
}
