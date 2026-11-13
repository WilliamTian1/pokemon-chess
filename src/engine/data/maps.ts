import type { MapDef, Pos, Terrain } from '../types';
import { isProcMapId, procMap } from './procmap';

// Legend: . normal  w water  d dirt (cosmetic)  g grass (cosmetic land bridge)
//         f flower (+30 HP)  b berry bush (-30 damage taken)  r wonder tile (resets stat stages)
//         T trebuchet (on dirt)  t trebuchet (on grass)
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

const ICE_ROWS = [
  '................',
  '...b..b.iii.....',
  '........iii..b..',
  '..iiiii.iii.....',
  '..ii.ii..b.iiiii',
  'iii.t.iiiiiiiiii',
  'iiii.iiiiii....b',
  '..iiiii..b......',
  '..iiiii.iii.....',
  '........iii.b...',
  '...b............',
  '................',

];

const VOLCANO_ROWS = [
  '..=.............',
  '..m.............',
  'r.m.....mmm.mm..',
  '###..##mmmm.mm##',
  '..m........t....',
  '..=....mmmm.mm..',
  '###..##mmmm.mm##',
  'r.=....mmmm.mmr.',
  '..m.............',
  '..m.............',

];

const AVIA_ROWS = [
  '....b...............',
  '.....r..b..r........',
  'pp=pppp==ppppp..b...',
  'pp=pppp==ppppp=ppppp',
  '.f....f.........pppp',
  '.........t....f.....',
  '...b......f.........',
  'ppp=pppppppppppp=ppp',
  'pp.....b...ppppp=ppp',
  '..b..........ppp=ppp',
  '.................ppp',
  '............b.......',
  '...b...r.....r......',
  '....................',
];
const FARM_ROWS = [
  '#####.......',
  '#f.r#..b....',
  '#...#.....b.',
  '##.##.......',
  '......t.....',
  '..b....b....',
  '...b........',
  '........b...',
  '.r.......f..',
  '.....f......',
];

const CHAR_TERRAIN: Record<string, Terrain> = {
  '.': 'normal',
  w: 'water',
  d: 'dirt',
  g: 'grass',
  '=': 'bridge',
  f: 'flower',
  b: 'bush',
  r: 'wonder',
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
const ice = parseRows(ICE_ROWS);
const volcano = parseRows(VOLCANO_ROWS);
const avia = parseRows(AVIA_ROWS);
const farm = parseRows(FARM_ROWS);
export const MAPS: Record<string, MapDef> = {
  meadow: {
    id: 'meadow',
    name: 'Trebuchet Meadow',
    description: 'Open fields around a central trebuchet, a dirt road and scattered ponds.',
    music: 'battle.mp3',
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
    description: 'A river snakes across the field: bridges and fords decide the fight.',
    music: 'battleRiver.mp3',
    width: RIVER_ROWS[0].length,
    height: RIVER_ROWS.length,
    tiles: river.tiles,
    trebuchets: river.trebuchets,
    spawns: {
      D: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 7, y: 0 }, { x: 10, y: 0 }],
      A: [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 7, y: 9 }, { x: 8, y: 9 }],
    },
  },
  ice: {
    id: 'ice',
    name: 'Nixtorm',
    description: 'A snowy field of slick ice. Pokémon slide until they reach clear ground or an obstacle.',
    theme: 'snow',
    music: 'battleIce.mp3',
    width: ICE_ROWS[0].length,
    height: ICE_ROWS.length,
    tiles: ice.tiles,
    trebuchets: ice.trebuchets,
    spawns: {
      D: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 11, y: 0 }, { x: 13, y: 0 }],
      A: [{ x: 4, y: 11 }, { x: 7, y: 11 }, { x: 10, y: 11 }, { x: 14, y: 11 }],
    },
  },
  volcano: {
    id: 'volcano',
    name: 'Ignis',
    description: 'A volcanic battlefield cut by magma channels and narrow crossings.',
    theme: 'volcano',
    music: 'battleFire.mp3',
    width: VOLCANO_ROWS[0].length,
    height: VOLCANO_ROWS.length,
    tiles: volcano.tiles,
    trebuchets: volcano.trebuchets,
    spawns: {
      D: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 11, y: 0 }],
      A: [{ x: 4, y: 9 }, { x: 6, y: 9 }, { x: 9, y: 9 }, { x: 11, y: 9 }],
    },
  },
  avia: {
    id: 'avia',
    name: 'Avia',
    description: 'An indoor stone arena with pits, bonus tiles, wonder tiles, and a stage mist that clears all Pokémon’s stat changes every four rounds.',
    music: 'battleFlying.mp3',
    stageMist: { everyRounds: 4 },
    width: AVIA_ROWS[0].length,
    height: AVIA_ROWS.length,
    tiles: avia.tiles,
    trebuchets: avia.trebuchets,
    spawns: {
      D: [{ x: 2, y: 0 }, { x: 7, y: 0 }, { x: 12, y: 0 }, { x: 17, y: 0 }],
      A: [{ x: 2, y: 13 }, { x: 7, y: 13 }, { x: 12, y: 13 }, { x: 17, y: 13 }],
    },
  },
  farm: {
    id: 'farm',
    name: 'Outpost',
    description: 'An outpost in the countryside.',
    music: 'battleFarm.mp3',
    width: FARM_ROWS[0].length,
    height: FARM_ROWS.length,
    tiles: farm.tiles,
    trebuchets: farm.trebuchets,
    spawns: {
      D: [{ x: 2, y: 1 }, { x: 5, y: 0 }, { x: 7, y: 0 }, { x: 9, y: 0 }],
      A: [{ x: 2, y: 9 }, { x: 4, y: 9 }, { x: 6, y: 9 }, { x: 9, y: 9 }],
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
