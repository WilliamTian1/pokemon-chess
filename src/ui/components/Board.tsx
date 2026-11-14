import { type CSSProperties, Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type Dir, type GameState, type Pos, type Side, type TargetPreview, type Terrain, type Unit, cardOf, cliffDirections, getMap, multLabel, onBoard, posKey,
} from '../../engine';
import type { EventBatch } from '../controller';
import { Art, HpBar, StatusBadge } from './bits';
import { BushIcon, DollIcon, ElectricIcon, FlowerIcon, SpikesIcon, TrebuchetIcon, WebIcon, WonderIcon } from './icons';

export interface Overlay {
  reach?: Set<string>;
  post?: Set<string>;
  zone?: Pos[];
  dash?: Pos | null;
  knock?: Pos[];
  targetable?: Set<string>;
  spawns?: { tiles: Pos[]; side: 'A' | 'D' };
  arrows?: { dir: Dir; pos: Pos; active: boolean }[];
  /** One opposing Pokémon's reach: tile key → which of its moves reach it (bit 1: first move, bit 2: second). */
  danger?: Map<string, number>;
  /** Valid open tiles for the pending Teleport choice. */
  teleport?: Set<string>;
  /** Everything a hovered move could hit from here, over all directions. */
  hoverZone?: Set<string>;
  /** Unit id → type multiplier of the focused Pokémon's best attack on it. */
  matchups?: Map<string, number>;
  /** Units to ring (e.g. a hovered matchup-table cell). */
  highlight?: Set<string>;
  /** A short note drawn over the board, on the half away from `avoid` (e.g. the hovered tile). */
  note?: { text: string; avoid: Pos | null };
}

interface Props {
  state: GameState;
  view: BoardView;
  overlay: Overlay;
  previews: Map<string, TargetPreview>;
  selectedId: string | null;
  hoverId?: string | null;
  events: EventBatch;
  onTile: (p: Pos) => void;
  onHover: (p: Pos | null) => void;
}

const TERRAIN_LABEL: Record<Terrain, string> = {
  normal: 'Grass', dirt: 'Dirt path', grass: 'Grass bridge', bridge: 'Bridge — ordinary ground', water: 'Water — only Water, Flying and Levitate Pokémon',
  flower: 'Flowers — +30 HP at the end of a Pokémon’s activation (not Flying or Levitate)', bush: 'Berry bush — takes 30 less damage (not Flying or Levitate)',
  wonder: 'Wonder tile — resets stat changes when entered or pushed onto',
  wall: 'Wall', electric: 'Electric terrain', magma: 'Magma — only Fire, Flying and Levitate Pokémon can enter', ice: 'Ice — Pokémon slide when they enter (except Ice types, Flying and Levitate)', pit: 'Pit',
};

/**
 * How the board is turned on screen. `flipped`: half a turn, so the Defender sees its own side at the
 * bottom (like chess). `rotated`: a further quarter turn clockwise for portrait phones.
 */
export interface BoardView {
  rotated: boolean;
  flipped: boolean;
}

/**
 * A Pokémon's reach, one style per move so both read on any terrain: the first move fills tiles red,
 * the second outlines them in bright yellow, and a tile both reach gets both.
 */
export const MOVE_RANGE: [CSSProperties, CSSProperties, CSSProperties] = [
  { backgroundColor: 'rgba(239, 68, 68, 0.55)', boxShadow: 'inset 0 0 0 1px rgba(254, 202, 202, 0.8)' },
  { backgroundColor: 'rgba(253, 224, 71, 0.16)', boxShadow: 'inset 0 0 0 3px rgba(253, 224, 71, 0.95)' },
  { backgroundColor: 'rgba(59, 130, 246, 0.38)', boxShadow: 'inset 0 0 0 3px rgba(147, 197, 253, 0.95)' },
];

function rangeStyle(mask: number): CSSProperties {
  if (mask & 4) return MOVE_RANGE[2];
  if (mask === 3) return { backgroundColor: MOVE_RANGE[0].backgroundColor, boxShadow: MOVE_RANGE[1].boxShadow };
  return MOVE_RANGE[mask === 2 ? 1 : 0];
}

const DIR_ORDER: Dir[] = ['N', 'E', 'S', 'W'];
export const ARROW: Record<Dir, string> = { N: '▲', E: '▶', S: '▼', W: '◀' };

/** The on-screen direction that map direction `dir` points in. */
export function screenDir(dir: Dir, v: BoardView): Dir {
  return DIR_ORDER[(DIR_ORDER.indexOf(dir) + (v.rotated ? 1 : 0) + (v.flipped ? 2 : 0)) % 4];
}

interface Floater {
  key: string;
  unitId: string;
  text: string;
  cls: string;
  pos: Pos;
}

/** The name(s) of the move a Pokémon just used, shown over it; `tiles` is where the move landed. */
interface Callout {
  key: string;
  pos: Pos;
  side: Side;
  names: string[];
  tiles: Pos[];
}

function BoardImpl({ state, view, overlay, previews, selectedId, hoverId, events, onTile, onHover }: Props) {
  const { rotated, flipped } = view;
  const map = getMap(state.mapId);
  const W = map.width;
  const H = map.height;
  const cols = rotated ? H : W;
  const rows = rotated ? W : H;
  const disp = (p: Pos): Pos => {
    const f = flipped ? { x: W - 1 - p.x, y: H - 1 - p.y } : p;
    return rotated ? { x: H - 1 - f.y, y: f.x } : f;
  };

  // Floating numbers and attack flashes from the latest event batch.
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [flash, setFlash] = useState<{ key: string; tiles: Pos[] } | null>(null);
  // A fainted Pokémon's puff of smoke, and the trebuchet's boulder in flight.
  const [poofs, setPoofs] = useState<{ key: string; pos: Pos }[]>([]);
  const [boulder, setBoulder] = useState<{ key: string; from: Pos; to: Pos } | null>(null);
  // The move just used, named over the Pokémon that used it.
  const [callouts, setCallouts] = useState<Callout[]>([]);
  useEffect(() => {
    const out: Floater[] = [];
    const puffs: { key: string; pos: Pos }[] = [];
    let shot: { key: string; from: Pos; to: Pos } | null = null;
    let lastAttack: Pos[] | null = null;
    const lastPos = new Map<string, Pos>();
    const used = new Map<string, Callout>();
    const prev = prevPos.current;
    for (const u of state.units) if (u.pos) lastPos.set(u.id, u.pos);
    events.list.forEach((e, i) => {
      if (e.t === 'attack' && e.name === 'Trebuchet' && e.tiles.length) {
        const from = state.units.find((u) => u.id === e.unitId)?.pos ?? prev.get(e.unitId);
        if (from) shot = { key: `${events.seq}-${i}`, from, to: e.tiles[0] };
      }
      if (e.t === 'faint') {
        const pos = prev.get(e.unitId) ?? lastPos.get(e.unitId);
        if (pos) puffs.push({ key: `${events.seq}-${i}`, pos });
      }
      if (e.t === 'attack' && e.tiles.length) lastAttack = e.tiles;
      if (e.t === 'attack') {
        const unit = state.units.find((u) => u.id === e.unitId);
        const pos = unit?.pos ?? prev.get(e.unitId);
        const had = used.get(e.unitId);
        if (had) had.names.push(e.name);
        else if (unit && pos) used.set(e.unitId, { key: `${events.seq}-${i}`, pos, side: unit.side, names: [e.name], tiles: e.tiles });
      }
      if (e.t === 'move' && e.path.length) lastPos.set(e.unitId, e.path[e.path.length - 1]);
      if (e.t === 'damage' || e.t === 'heal' || e.t === 'miss') {
        const unit = state.units.find((u) => u.id === e.unitId);
        const pos = unit?.pos ?? lastPos.get(e.unitId);
        if (!pos) return;
        const text = e.t === 'damage' ? `-${e.amount}` : e.t === 'heal' ? `+${e.amount}` : 'miss';
        const cls = e.t === 'damage' ? 'text-rose-300' : e.t === 'heal' ? 'text-emerald-300' : 'text-slate-200';
        out.push({ key: `${events.seq}-${i}`, unitId: e.unitId, text, cls, pos });
      }
    });
    setFloaters(out);
    setFlash(lastAttack ? { key: `f${events.seq}`, tiles: lastAttack } : null);
    setPoofs(puffs);
    setBoulder(shot);
    setCallouts([...used.values()]);
  }, [events.seq]);
  // Where every Pokémon stood before the latest action (a fainted one has no position any more).
  const prevPos = useRef(new Map<string, Pos>());
  useEffect(() => {
    prevPos.current = new Map(state.units.flatMap((u) => (u.pos ? [[u.id, u.pos] as const] : [])));
  }, [state]);

  // Moving Pokémon walk their path tile by tile, so it's clear they went around whatever blocked them.
  const [walk, setWalk] = useState<{ at: Map<string, Pos>; sliding: Set<string>; stepMs: number } | null>(null);
  // Layout effect: the first step is in place before paint, so the token never flashes to the end tile.
  useLayoutEffect(() => {
    const walks = events.list.flatMap((e) => (e.t === 'move' && e.path.length > 1 ? [e] : []));
    if (!walks.length) {
      setWalk(null);
      return;
    }
    const longest = Math.max(...walks.map((w) => w.path.length));
    const stepMs = Math.min(110, Math.floor(480 / longest));
    let step = 0;
    let done: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = new Map<string, Pos>();
      const sliding = new Set<string>();
      for (const w of walks) {
        if (step < w.path.length - 1) at.set(w.unitId, w.path[step]);
        if (w.iceSlideFrom !== undefined && step >= w.iceSlideFrom) sliding.add(w.unitId);
      }
      setWalk({ at, sliding, stepMs });
      step += 1;
    };
    tick();
    const id = setInterval(() => {
      tick();
      if (step >= longest) {
        clearInterval(id);
        done = setTimeout(() => setWalk(null), stepMs);
      }
    }, stepMs);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [events.seq]);

  const zoneKeys = useMemo(() => new Set((overlay.zone ?? []).map(posKey)), [overlay.zone]);
  const knockKeys = useMemo(() => new Set((overlay.knock ?? []).map(posKey)), [overlay.knock]);
  const spawnKeys = useMemo(() => new Set((overlay.spawns?.tiles ?? []).map(posKey)), [overlay.spawns]);
  const hazardAt = useMemo(() => new Map(state.hazards.map((h) => [posKey(h.pos), h.kind])), [state.hazards]);
  const treb = useMemo(() => new Set(map.trebuchets.map(posKey)), [map]);
  const arrowAt = useMemo(() => new Map((overlay.arrows ?? []).map((a) => [posKey(a.pos), a])), [overlay.arrows]);
  const fsUsers = new Set(state.futureSight.map((f) => f.userId));

  const tiles = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = { x, y };
      const k = posKey(p);
      const d = disp(p);
      const t = map.tiles[y][x];
      const base = t === 'flower' || t === 'bush' || t === 'wonder' ? 'normal' : t;
      const alt = (x + y) % 2 === 1 ? 'alt' : '';
      // Bridge planks run across the crossing: a bridge (possibly several tiles wide) with water to its
      // left and right is crossed vertically (on screen, after any quarter turn of the board).
      const beyond = (dx: number): Terrain | undefined => {
        let bx = x + dx;
        while (map.tiles[y][bx] === 'bridge') bx += dx;
        return map.tiles[y][bx];
      };
      const crossedVertically = t === 'bridge' && beyond(-1) === 'water' && beyond(1) === 'water';
      const across = t === 'bridge' && crossedVertically === rotated ? 'across' : '';
      const hz = hazardAt.get(k);
      const arrow = arrowAt.get(k);
      const cliffDirs = cliffDirections(map.cliffs?.[y]?.[x]);
      const tileLabel = `${TERRAIN_LABEL[t]}${cliffDirs.length ? ` Cliff edge${cliffDirs.length > 1 ? 's' : ''} ${cliffDirs.join(' and ')} points downhill.` : ''}`;
      tiles.push(
        <button
          key={k}
          type="button"
          title={overlay.teleport?.has(k) ? 'Teleport here — open tile adjacent to an ally' : treb.has(k) ? 'Trebuchet — stand here to fire at any Pokémon (40 power)' : tileLabel}
          aria-label={overlay.teleport?.has(k) ? `Teleport destination at ${x + 1},${y + 1}: open tile adjacent to an ally` : `Tile ${x},${y}: ${tileLabel}`}
          onClick={() => onTile(p)}
          onMouseEnter={() => onHover(p)}
          className={`${t === 'wonder' ? 'tile-wonder' : `tile-${base}`} ${alt} ${across} relative flex items-center justify-center outline-none ring-inset ring-black/10 focus-visible:ring-2 focus-visible:ring-amber-300`}
          style={{ gridColumn: d.x + 1, gridRow: d.y + 1, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.18)' }}
        >
          {t === 'flower' && <FlowerIcon />}
          {t === 'bush' && <BushIcon />}
          {t === 'wonder' && <WonderIcon />}
          {t === 'electric' && <ElectricIcon />}
          {treb.has(k) && <TrebuchetIcon />}
          {hz === 'spikes' && <span className="absolute inset-0 flex items-center justify-center"><SpikesIcon /></span>}
          {hz === 'web' && <span className="absolute inset-0 flex items-center justify-center"><WebIcon /></span>}
          {state.substitute && posKey(state.substitute.pos) === k && (
            <span className="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-amber-200/80 bg-amber-900/30"><DollIcon /></span>
          )}
          {spawnKeys.has(k) && (
            <span className={`absolute inset-[6%] flex animate-pulse items-center justify-center rounded-md border-2 ${overlay.spawns!.side === 'A' ? 'border-rose-300 bg-rose-500/35' : 'border-sky-300 bg-sky-500/35'} text-lg font-black text-white`}>
              {ARROW[screenDir(overlay.spawns!.side === 'A' ? 'N' : 'S', view)]}
            </span>
          )}
          {overlay.danger?.has(k) && (
            <span className="pointer-events-none absolute inset-0" style={rangeStyle(overlay.danger.get(k)!)} />
          )}
          {overlay.hoverZone?.has(k) && <span className="pointer-events-none absolute inset-[4%] rounded-sm border-2 border-dashed border-orange-200/90 bg-orange-400/30" />}
          {overlay.reach?.has(k) && <span className="pointer-events-none absolute inset-0 bg-sky-400/35 shadow-[inset_0_0_0_1.5px_rgba(186,230,253,.8)]" />}
          {overlay.post?.has(k) && <span className="pointer-events-none absolute inset-0 bg-emerald-400/35 shadow-[inset_0_0_0_1.5px_rgba(167,243,208,.85)]" />}
          {overlay.teleport?.has(k) && <span className="pointer-events-none absolute inset-[5%] animate-pulse rounded border-2 border-emerald-200 bg-emerald-400/40 shadow-[inset_0_0_0_1px_rgba(236,253,245,.8)]" />}
          {zoneKeys.has(k) && <span className="pointer-events-none absolute inset-0 bg-orange-500/50 shadow-[inset_0_0_0_2px_rgba(253,186,116,.95)]" />}
          {overlay.dash && posKey(overlay.dash) === k && <span className="pointer-events-none absolute inset-[8%] rounded border-2 border-sky-200 bg-sky-500/40" />}
          {knockKeys.has(k) && <span className="pointer-events-none absolute inset-[10%] rounded border-2 border-dashed border-red-400" />}
          {arrow && (
            <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-base font-black ${arrow.active ? 'text-white' : 'text-white/60'}`} style={{ textShadow: '0 0 4px rgba(0,0,0,.9)' }}>
              {ARROW[screenDir(arrow.dir, view)]}
            </span>
          )}
          {flash?.tiles.some((f) => posKey(f) === k) && (
            <span key={flash.key} className="pointer-events-none absolute inset-0 animate-zoneFlash bg-orange-400" />
          )}
        </button>,
      );
    }
  }

  const hedges = map.decor?.hedges ?? [];
  const cliffs = map.cliffs?.flatMap((row, y) => [...row].flatMap((edges, x) =>
    cliffDirections(edges).map((dir) => ({ pos: { x, y }, dir })),
  )) ?? [];

  return (
    <div
      className={`board-frame relative mx-auto w-full select-none overflow-hidden rounded-lg ${map.theme ? `map-${map.theme}` : ''}`}
      style={{ aspectRatio: `${cols} / ${rows}` }}
      onMouseLeave={() => onHover(null)}
    >
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {tiles}
      </div>
      {cliffs.map(({ pos, dir }, i) => {
        const d = disp(pos);
        const edge = screenDir(dir, view);
        const left = (d.x / cols) * 100;
        const top = (d.y / rows) * 100;
        const width = `${100 / cols}%`;
        const height = `${100 / rows}%`;
        const horizontal = edge === 'N' || edge === 'S';
        const style = edge === 'N'
          ? { left: `${left}%`, top: `${top}%`, width, height: '7px', transform: 'translateY(-50%)' }
          : edge === 'S'
            ? { left: `${left}%`, top: `${((d.y + 1) / rows) * 100}%`, width, height: '7px', transform: 'translateY(-50%)' }
            : edge === 'W'
              ? { left: `${left}%`, top: `${top}%`, width: '7px', height, transform: 'translateX(-50%)' }
              : { left: `${((d.x + 1) / cols) * 100}%`, top: `${top}%`, width: '7px', height, transform: 'translateX(-50%)' };
        return (
          <span
            key={`${posKey(pos)}-${dir}-${i}`}
            aria-hidden="true"
            className={`pointer-events-none absolute z-10 flex items-center justify-center bg-slate-950/90 ${horizontal ? 'border-y-2 border-white' : 'border-x-2 border-white'}`}
            style={style}
          >
            <span className="text-[9px] font-black leading-none text-amber-200 drop-shadow">{ARROW[edge]}</span>
          </span>
        );
      })}
      {hedges.map((h, i) => {
        const d = disp(h);
        const edge = screenDir(h.edge, view);
        const left = (d.x / cols) * 100;
        const top = (d.y / rows) * 100;
        const style =
          edge === 'N' ? { left: `${left}%`, top: 0, width: `${100 / cols}%`, height: '5px' }
          : edge === 'S' ? { left: `${left}%`, bottom: 0, width: `${100 / cols}%`, height: '5px' }
          : edge === 'W' ? { left: 0, top: `${top}%`, width: '5px', height: `${100 / rows}%` }
          : { right: 0, top: `${top}%`, width: '5px', height: `${100 / rows}%` };
        return <span key={i} className="pointer-events-none absolute rounded-full bg-gradient-to-r from-green-600 to-green-500 opacity-90" style={style} />;
      })}
      {overlay.note && (
        <div className={`pointer-events-none absolute inset-x-0 z-40 flex justify-center px-2 ${overlay.note.avoid && disp(overlay.note.avoid).y < rows / 2 ? 'bottom-1' : 'top-1'}`}>
          <span className="max-w-full rounded-md bg-slate-950/85 px-2 py-0.5 text-center text-xs leading-snug text-slate-100 shadow-lg">{overlay.note.text}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        {state.units.filter(onBoard).map((u) => (
          <Token
            key={u.id}
            unit={u}
            pos={disp(walk?.at.get(u.id) ?? u.pos!)}
            stepMs={walk ? walk.stepMs : undefined}
            cols={cols}
            rows={rows}
            selected={u.id === selectedId}
            iceSliding={walk?.sliding.has(u.id) ?? false}
            hovered={u.id === hoverId}
            targetable={overlay.targetable?.has(u.id) ?? false}
            preview={previews.get(u.id)}
            matchup={overlay.matchups?.get(u.id)}
            highlighted={overlay.highlight?.has(u.id) ?? false}
            done={state.phase === 'battle' && u.side === state.side && u.activated}
            foresight={fsUsers.has(u.id)}
          />
        ))}
        {poofs.map((p) => {
          const d = disp(p.pos);
          return (
            <span
              key={p.key}
              className="pointer-events-none absolute z-20 aspect-square animate-poof rounded-full bg-[radial-gradient(circle,rgba(226,232,240,.9),rgba(148,163,184,.5)_45%,transparent_70%)]"
              style={{ left: `${(d.x / cols) * 100}%`, top: `${(d.y / rows) * 100}%`, width: `${100 / cols}%` }}
            />
          );
        })}
        {boulder && (() => {
          const a = disp(boulder.from);
          const b = disp(boulder.to);
          const pct = (v: number, n: number) => `${((v + 0.5) / n) * 100}%`;
          // The outer box flies across (left); the boulder inside it arcs up and down (top).
          return (
            <span
              key={boulder.key}
              className="pointer-events-none absolute top-0 z-30 h-full w-0 animate-boulderX"
              style={{ ['--x0' as string]: pct(a.x, cols), ['--x1' as string]: pct(b.x, cols), ['--y0' as string]: pct(a.y, rows), ['--y1' as string]: pct(b.y, rows) }}
            >
              <span className="absolute aspect-square h-[7%] -translate-x-1/2 -translate-y-1/2 animate-boulderY rounded-full bg-gradient-to-br from-stone-300 to-stone-700 shadow-lg ring-1 ring-black/40" />
            </span>
          );
        })()}
        {callouts.map((c) => {
          const d = disp(c.pos);
          // The label sits on the side of its user away from where the move landed, so it never hides the
          // targets or their damage numbers (above by default), and leans inward near the side edges.
          const ys = c.tiles.map((t) => disp(t).y);
          const above = ys.filter((y) => y < d.y).length;
          const under = ys.filter((y) => y > d.y).length;
          const below = d.y === 0 || (above > under && d.y < rows - 1);
          const shift = d.x < 2 ? '0%' : d.x > cols - 3 ? '-100%' : '-50%';
          const left = d.x < 2 ? d.x / cols : d.x > cols - 3 ? (d.x + 1) / cols : (d.x + 0.5) / cols;
          return (
            <Fragment key={c.key}>
              <span
                className={`absolute z-20 animate-userRing rounded-full border-[3px] ${c.side === 'A' ? 'border-rose-300 shadow-[0_0_12px_3px_rgba(244,63,94,.8)]' : 'border-sky-300 shadow-[0_0_12px_3px_rgba(56,189,248,.8)]'}`}
                style={{ left: `${((d.x + 0.04) / cols) * 100}%`, top: `${((d.y + 0.04) / rows) * 100}%`, width: `${92 / cols}%`, height: `${92 / rows}%` }}
              />
              <span
                className={`absolute z-40 animate-moveCallout whitespace-nowrap rounded-md border-2 border-[#e6bd55] px-2 py-0.5 font-display text-sm leading-tight text-[#fff3d6] shadow-lg shadow-black/60 sm:text-base ${c.side === 'A' ? 'bg-[#8a1c15]' : 'bg-[#1c3a78]'}`}
                style={{
                  left: `${left * 100}%`, top: `${((below ? d.y + 1 : d.y) / rows) * 100}%`,
                  ['--shift' as string]: `translate(${shift}, ${below ? '15%' : '-115%'})`,
                }}
              >
                {c.names.join(' + ')}!
              </span>
            </Fragment>
          );
        })}
        {floaters.map((f) => {
          const d = disp(f.pos);
          return (
            <span
              key={f.key}
              className={`absolute z-30 animate-floatUp whitespace-nowrap text-base font-black sm:text-xl ${f.cls}`}
              style={{ left: `${((d.x + 0.5) / cols) * 100}%`, top: `${(d.y / rows) * 100}%`, textShadow: '0 1px 3px #000, 0 0 2px #000' }}
            >
              {f.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Token({ unit, pos, stepMs, cols, rows, selected, iceSliding, hovered, targetable, preview, matchup, highlighted, done, foresight }: {
  unit: Unit;
  pos: Pos;
  /** While Pokémon are walking a path: the time per tile (linear steps instead of one slide). */
  stepMs?: number;
  cols: number;
  rows: number;
  selected: boolean;
  iceSliding: boolean;
  hovered: boolean;
  targetable: boolean;
  preview?: TargetPreview;
  matchup?: number;
  highlighted: boolean;
  done: boolean;
  foresight: boolean;
}) {
  const c = cardOf(unit);
  const ring = unit.side === 'A' ? 'ring-rose-500' : 'ring-sky-500';
  const stages = (['atk', 'def', 'mov'] as const).filter((k) => unit.stages[k] !== 0);
  return (
    <div
      className="absolute z-10 flex flex-col items-center justify-center transition-[left,top] duration-300 ease-out"
      style={{
        left: `${(pos.x / cols) * 100}%`, top: `${(pos.y / rows) * 100}%`, width: `${100 / cols}%`, height: `${100 / rows}%`,
        ...(stepMs ? { transitionDuration: `${stepMs}ms`, transitionTimingFunction: 'linear' } : {}),
      }}
    >
      <div
        className={`relative aspect-square w-[80%] rounded-full ring-[2.5px] ${ring} ${done ? 'opacity-55 grayscale-[60%]' : ''} ${selected ? 'animate-pulseRing !ring-amber-300' : ''} ${iceSliding ? 'ice-glide' : ''} ${(hovered || highlighted) && !selected ? 'ring-white' : ''} ${targetable ? 'outline outline-2 outline-offset-1 outline-amber-300' : ''} bg-slate-800 shadow-md shadow-black/50`}
        title={`${c.name} — ${unit.hp}/${unit.maxHp} HP`}
      >
        <Art id={unit.cardId} className="h-full w-full rounded-full" alt={c.name} />
        {unit.status && (
          <span className="absolute -left-1 -top-1 scale-75 sm:scale-90">
            <StatusBadge status={unit.status} />
          </span>
        )}
        {stages.length > 0 && (
          <span className="absolute -right-1.5 -top-1 hidden flex-col gap-px sm:flex">
            {stages.map((k) => (
              <span key={k} className={`rounded px-0.5 text-[8px] font-black leading-[10px] ${unit.stages[k] > 0 ? 'bg-emerald-600' : 'bg-rose-700'} text-white`}>
                {k[0].toUpperCase()}{unit.stages[k] > 0 ? '+' : ''}{unit.stages[k]}
              </span>
            ))}
          </span>
        )}
        {matchup !== undefined && (
          <span
            className={`absolute -bottom-1 -left-1.5 z-10 rounded px-0.5 text-[9px] font-black leading-[12px] shadow sm:text-[10px] ${matchup > 1 ? 'bg-emerald-500 text-slate-950' : matchup === 0 ? 'bg-slate-500 text-white' : 'bg-amber-500 text-slate-950'}`}
            title={`Best attack of the focused Pokémon: ${multLabel(matchup)}`}
          >
            {multLabel(matchup)}
          </span>
        )}
        {(unit.followMe || foresight) && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 px-1 text-[9px] font-black text-slate-900">{foresight ? '◉' : '!'}</span>
        )}
      </div>
      <HpBar hp={unit.hp} max={unit.maxHp} className="mt-[3%] w-[76%]" />
      {preview && <PreviewPill p={preview} />}
    </div>
  );
}

function PreviewPill({ p }: { p: TargetPreview }) {
  let text: string;
  let cls = 'bg-slate-900/90 text-white';
  if (p.kind === 'damage') {
    text = p.min === p.max ? `${p.max}` : `${p.min}–${p.max}`;
    if (p.koChance > 0) {
      text += p.koChance >= 0.995 ? ' KO' : ` KO ${Math.round(p.koChance * 100)}%`;
      cls = 'bg-rose-600 text-white';
    }
  } else if (p.kind === 'heal') {
    text = `+${p.max}`;
    cls = 'bg-emerald-600 text-white';
  } else if (p.kind === 'immune' || p.kind === 'absorb') {
    text = p.kind === 'absorb' ? 'absorbs' : 'immune';
    cls = 'bg-slate-600 text-white';
  } else {
    text = p.notes[0] ?? 'effect';
    cls = 'bg-violet-600 text-white';
  }
  return (
    <span className={`absolute -top-[22%] z-20 whitespace-nowrap rounded px-1 py-px text-[9px] font-bold shadow sm:text-[11px] ${cls}`}>
      {text}
    </span>
  );
}

export const Board = memo(BoardImpl);
