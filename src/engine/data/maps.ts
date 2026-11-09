import type { MapDef, Pos, Terrain } from '../types';
import { isProcMapId, procMap } from './procmap';

// Legend: . normal  w water  d dirt (cosmetic)  g grass (cosmetic land bridge)
//         f flower (+30 HP)  b berry bush (-30 damage taken)  T trebuchet (on dirt)  t trebuchet (on grass)
// Row 0 is always the Defenders' edge. Both maps are transcribed from the user's hand-drawn maps.
const MEADOW_ROWS = [
  '......w...d...',
  '......g...d...',
  '.ww...w...d.b.',
  'www.f.w..ddd..',
  '.wwf.wwb.dTd..',
  '.....wb..ddd..',
  '..........d...',
  'ww...w....d...',
  '.w...w....d...',
];

// Second hand-drawn map (12 × 10). A river winds across the middle; its bridges ('=') are drawn
// as wood but are ordinary ground. The grey stone left of centre is read as the trebuchet.
const RIVER_ROWS = [
  '............',
  '.........w=w',
  '..ww=ww=ww..',
  'w=w...b..bf.',
  'w.b.t.......',
  'w=w...f..b..',
  '..ww=ww.b.f.',
  '......w==ww.',
  '..........=.',
  '..........w.',
];

const CHAR_TERRAIN: Record<string, Terrain> = {
  '.': 'normal',
  w: 'water',
  d: 'dirt',
  g: 'grass',
  '=': 'bridge',
  f: 'flower',
  b: 'bush',
  T: 'dirt',
  t: 'normal',
  '#': 'wall',
  m: 'magma',
  i: 'ice',
  p: 'pit',
};

function parseRows(rows: string[]): { tiles: Terrain[][]; trebuchets: Pos[] } {
  const trebuchets: Pos[] = [];
  const tiles = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'T' || ch === 't') trebuchets.push({ x, y });
      const t = CHAR_TERRAIN[ch];
      if (!t) throw new Error(`Bad map char ${ch}`);
      return t;
    }),
  );
  return { tiles, trebuchets };
}

const meadow = parseRows(MEADOW_ROWS);
const river = parseRows(RIVER_ROWS);

export const MAPS: Record<string, MapDef> = {
  meadow: {
    id: 'meadow',
    name: 'Trebuchet Meadow',
    width: MEADOW_ROWS[0].length,
    height: MEADOW_ROWS.length,
    tiles: meadow.tiles,
    trebuchets: meadow.trebuchets,
    spawns: {
      D: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 11, y: 0 }],
      A: [{ x: 4, y: 8 }, { x: 6, y: 8 }, { x: 9, y: 8 }, { x: 11, y: 8 }],
    },
    decor: {
      // Green hedge scribbles along the paper map's border.
      hedges: [
        { x: 0, y: 0, edge: 'N' }, { x: 1, y: 0, edge: 'N' }, { x: 0, y: 0, edge: 'W' }, { x: 0, y: 1, edge: 'W' },
        { x: 0, y: 2, edge: 'W' }, { x: 0, y: 4, edge: 'W' }, { x: 0, y: 5, edge: 'W' }, { x: 0, y: 6, edge: 'W' },
        { x: 0, y: 8, edge: 'W' }, { x: 0, y: 8, edge: 'S' }, { x: 2, y: 8, edge: 'S' }, { x: 7, y: 0, edge: 'N' },
        { x: 7, y: 8, edge: 'S' }, { x: 8, y: 8, edge: 'S' }, { x: 12, y: 0, edge: 'N' }, { x: 13, y: 0, edge: 'N' },
        { x: 13, y: 0, edge: 'E' }, { x: 13, y: 1, edge: 'E' }, { x: 13, y: 4, edge: 'E' }, { x: 13, y: 7, edge: 'E' },
        { x: 13, y: 8, edge: 'E' }, { x: 13, y: 8, edge: 'S' },
      ],
    },
  },
  river: {
    id: 'river',
    name: 'Winding River',
    width: RIVER_ROWS[0].length,
    height: RIVER_ROWS.length,
    tiles: river.tiles,
    trebuchets: river.trebuchets,
    spawns: {
      D: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 7, y: 0 }, { x: 10, y: 0 }],
      A: [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 7, y: 9 }, { x: 8, y: 9 }],
    },
  },
};

export const MAP_LIST = Object.values(MAPS);
export const DEFAULT_MAP_ID = 'meadow';

export function getMap(id: string): MapDef {
  if (isProcMapId(id)) return procMap(id);
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}
