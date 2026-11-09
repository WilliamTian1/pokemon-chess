import { type CardDef, type MapDef, type Pos, type Terrain, parseGrid } from '../engine';

/**
 * Traits of a map and of a card that the general draft model crosses with each other, so it can value
 * cards on maps it has never seen (a swimmer on a watery map, a slow card on a big one…). All roughly
 * 0–1 on the hand-made maps.
 */
export const MAP_FEATURES = ['area', 'spawnDist', 'water', 'detour', 'bush', 'flower', 'treb', 'ice', 'wall', 'magma'] as const;
export const CARD_FEATURES = ['mov', 'hp', 'swim', 'fly', 'reach', 'waterAb', 'ice', 'fire', 'terrainAb', 'artillery', 'legend'] as const;

const cache = new Map<string, number[]>();

export function mapFeatures(m: MapDef): number[] {
  const hit = cache.get(m.id);
  if (hit) return hit;
  const tiles = m.tiles.flat();
  const frac = (t: Terrain) => tiles.filter((x) => x === t).length / tiles.length;
  const count = (t: Terrain) => tiles.filter((x) => x === t).length;
  const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const near = (p: Pos) => Math.min(...m.spawns.D.map((d) => manhattan(p, d)));
  const straight = m.spawns.A.reduce((a, p) => a + near(p), 0) / m.spawns.A.length;
  const walked = m.spawns.A.reduce((a, p) => a + walkDistance(m, p), 0) / m.spawns.A.length;
  const f = [
    (m.width * m.height) / 126,
    straight / 9,
    frac('water') * 4,
    Number.isFinite(walked) ? walked / Math.max(1, straight) - 1 : 1,
    count('bush') / 4,
    count('flower') / 4,
    m.trebuchets.length,
    frac('ice') * 5,
    frac('wall') * 5,
    frac('magma') * 5,
  ];
  cache.set(m.id, f);
  return f;
}

/** Steps from `from` to the nearest Defender spawn for a Pokémon that can't swim or fly. */
function walkDistance(m: MapDef, from: Pos): number {
  const walk = (t: Terrain) => t !== 'water' && t !== 'wall' && t !== 'pit' && t !== 'magma';
  const goal = new Set(m.spawns.D.map((p) => `${p.x},${p.y}`));
  const dist = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const queue: Pos[] = [from];
  while (queue.length) {
    const p = queue.shift()!;
    const d = dist.get(`${p.x},${p.y}`)!;
    if (goal.has(`${p.x},${p.y}`)) return d;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = `${x},${y}`;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height || dist.has(k) || !walk(m.tiles[y][x])) continue;
      dist.set(k, d + 1);
      queue.push({ x, y });
    }
  }
  return Infinity;
}

const cardCache = new Map<string, number[]>();

export function cardFeatures(c: CardDef): number[] {
  const hit = cardCache.get(c.id);
  if (hit) return hit;
  const reach = Math.max(0, ...c.moves.map((mv) => {
    const t = mv.target;
    if (t.kind === 'range') return t.range;
    if (t.kind === 'grid') return Math.max(0, ...parseGrid(t.grid).targets.map((g) => g.f));
    return 0;
  }));
  const has = (...abs: string[]) => (abs.includes(c.ability) ? 1 : 0);
  const f = [
    c.mov / 3,
    c.hp / 150,
    c.types.includes('Water') ? 1 : 0,
    c.types.includes('Flying') || c.ability === 'levitate' ? 1 : 0,
    reach / 4,
    has('rainDish', 'waveRider'),
    c.types.includes('Ice') || c.ability === 'slushRush' ? 1 : 0,
    c.types.includes('Fire') ? 1 : 0,
    has('leafGuard', 'snowCloak'),
    has('artilleryExpertise'),
    c.legendary ? 1 : 0,
  ];
  cardCache.set(c.id, f);
  return f;
}
