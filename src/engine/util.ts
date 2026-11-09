import type { Dir, Pos, Rng } from './types';

export const posKey = (p: Pos): string => `${p.x},${p.y}`;
export const samePos = (a: Pos | null | undefined, b: Pos | null | undefined): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y;
export const addPos = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y });
/** Chebyshev distance: adjacency ("next to", "up close") is 8-way, diagonals included (rules p.2). */
export const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** Steps between tiles counted like movement (no diagonals): "within N tiles / spaces". */
export const steps = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const roundUp5 = (v: number): number => Math.ceil(v / 5 - 1e-9) * 5;

export const DIR_VEC: Record<Dir, Pos> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};
export const ORTHO: Pos[] = [DIR_VEC.N, DIR_VEC.E, DIR_VEC.S, DIR_VEC.W];

/** Card-grid offsets: f = tiles forward, s = tiles to the user's right. */
export function rotate(f: number, s: number, dir: Dir): Pos {
  switch (dir) {
    case 'N': return { x: s, y: -f };
    case 'E': return { x: f, y: s };
    case 'S': return { x: -s, y: f };
    case 'W': return { x: -f, y: -s };
  }
}

/** Direction from `from` towards `to` along the dominant axis (ties favour vertical). */
export function dirToward(from: Pos, to: Pos): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'N' : 'S';
  return dx > 0 ? 'E' : 'W';
}

export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    chance: (p) => (p >= 1 ? true : p <= 0 ? false : next() < p),
    d6: () => 1 + Math.floor(next() * 6),
    int: (n) => Math.floor(next() * n),
  };
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 32);
}

/** Deterministic "most likely outcome" RNG used by the AI for look-ahead. */
export const expectedRng: Rng = {
  chance: (p) => p >= 0.5,
  d6: () => 3.5,
  int: () => 0,
};
