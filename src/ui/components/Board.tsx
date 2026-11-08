import { memo, useEffect, useMemo, useState } from 'react';
import {
  type Dir, type GameState, type Pos, type TargetPreview, type Terrain, type Unit, cardOf, getMap, multLabel, onBoard, posKey,
} from '../../engine';
import type { EventBatch } from '../controller';
import { Art, HpBar, StatusBadge } from './bits';
import { BushIcon, DollIcon, FlowerIcon, SpikesIcon, TrebuchetIcon, WebIcon } from './icons';

export interface Overlay {
  reach?: Set<string>;
  post?: Set<string>;
  zone?: Pos[];
  dash?: Pos | null;
  knock?: Pos[];
  targetable?: Set<string>;
  spawns?: { tiles: Pos[]; side: 'A' | 'D' };
  arrows?: { dir: Dir; pos: Pos; active: boolean }[];
  /** Opponent danger zone: tile key → number of (Pokémon, move) pairs that reach it. */
  danger?: Map<string, number>;
  /** Everything a hovered move could hit from here, over all directions. */
  hoverZone?: Set<string>;
  /** Unit id → type multiplier of the focused Pokémon's best attack on it. */
  matchups?: Map<string, number>;
  /** Units to ring (e.g. a hovered matchup-table cell). */
  highlight?: Set<string>;
}

interface Props {
  state: GameState;
  rotated: boolean;
  overlay: Overlay;
  previews: Map<string, TargetPreview>;
  selectedId: string | null;
  hoverId?: string | null;
  events: EventBatch;
  onTile: (p: Pos) => void;
  onHover: (p: Pos | null) => void;
}

const TERRAIN_LABEL: Record<Terrain, string> = {
  normal: 'Grass', dirt: 'Dirt path', grass: 'Grass bridge', water: 'Water — only Water, Flying and Levitate Pokémon',
  flower: 'Flowers — +30 HP at the end of a Pokémon’s activation', bush: 'Berry bush — takes 30 less damage',
  wall: 'Wall', magma: 'Magma', ice: 'Ice', pit: 'Pit',
};

const ARROW: Record<Dir, string> = { N: '▲', E: '▶', S: '▼', W: '◀' };
const ROT_ARROW: Record<Dir, string> = { N: '▶', E: '▼', S: '◀', W: '▲' };

interface Floater {
  key: string;
  unitId: string;
  text: string;
  cls: string;
  pos: Pos;
}

function BoardImpl({ state, rotated, overlay, previews, selectedId, hoverId, events, onTile, onHover }: Props) {
  const map = getMap(state.mapId);
  const W = map.width;
  const H = map.height;
  const cols = rotated ? H : W;
  const rows = rotated ? W : H;
  const disp = (p: Pos): Pos => (rotated ? { x: H - 1 - p.y, y: p.x } : p);

  // Floating numbers and attack flashes from the latest event batch.
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [flash, setFlash] = useState<{ key: string; tiles: Pos[] } | null>(null);
  useEffect(() => {
    const out: Floater[] = [];
    let lastAttack: Pos[] | null = null;
    const lastPos = new Map<string, Pos>();
    for (const u of state.units) if (u.pos) lastPos.set(u.id, u.pos);
    events.list.forEach((e, i) => {
      if (e.t === 'attack' && e.tiles.length) lastAttack = e.tiles;
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
      const base = t === 'flower' || t === 'bush' ? 'normal' : t;
      const alt = (x + y) % 2 === 1 ? 'alt' : '';
      const hz = hazardAt.get(k);
      const arrow = arrowAt.get(k);
      tiles.push(
        <button
          key={k}
          type="button"
          title={treb.has(k) ? 'Trebuchet — stand here to fire at any Pokémon (40 power)' : TERRAIN_LABEL[t]}
          aria-label={`Tile ${x},${y}: ${TERRAIN_LABEL[t]}`}
          onClick={() => onTile(p)}
          onMouseEnter={() => onHover(p)}
          className={`tile-${base} ${alt} relative flex items-center justify-center outline-none ring-inset ring-black/10 focus-visible:ring-2 focus-visible:ring-amber-300`}
          style={{ gridColumn: d.x + 1, gridRow: d.y + 1, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.18)' }}
        >
          {t === 'flower' && <FlowerIcon />}
          {t === 'bush' && <BushIcon />}
          {treb.has(k) && <TrebuchetIcon />}
          {hz === 'spikes' && <span className="absolute inset-0 flex items-center justify-center"><SpikesIcon /></span>}
          {hz === 'web' && <span className="absolute inset-0 flex items-center justify-center"><WebIcon /></span>}
          {state.substitute && posKey(state.substitute.pos) === k && (
            <span className="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-amber-200/80 bg-amber-900/30"><DollIcon /></span>
          )}
          {spawnKeys.has(k) && (
            <span className={`absolute inset-[6%] flex animate-pulse items-center justify-center rounded-md border-2 ${overlay.spawns!.side === 'A' ? 'border-rose-300 bg-rose-500/35' : 'border-sky-300 bg-sky-500/35'} text-lg font-black text-white`}>
              {overlay.spawns!.side === 'A' ? (rotated ? '▶' : '▲') : rotated ? '◀' : '▼'}
            </span>
          )}
          {overlay.danger?.has(k) && (
            <span
              className="pointer-events-none absolute inset-0"
              style={{ backgroundColor: `rgba(239, 68, 68, ${Math.min(0.62, 0.2 + 0.1 * (overlay.danger.get(k)! - 1))})`, boxShadow: 'inset 0 0 0 1px rgba(254, 202, 202, .45)' }}
            />
          )}
          {overlay.hoverZone?.has(k) && <span className="pointer-events-none absolute inset-[4%] rounded-sm border-2 border-dashed border-orange-200/90 bg-orange-400/30" />}
          {overlay.reach?.has(k) && <span className="pointer-events-none absolute inset-0 bg-sky-400/35 shadow-[inset_0_0_0_1.5px_rgba(186,230,253,.8)]" />}
          {overlay.post?.has(k) && <span className="pointer-events-none absolute inset-0 bg-emerald-400/35 shadow-[inset_0_0_0_1.5px_rgba(167,243,208,.85)]" />}
          {zoneKeys.has(k) && <span className="pointer-events-none absolute inset-0 bg-orange-500/50 shadow-[inset_0_0_0_2px_rgba(253,186,116,.95)]" />}
          {overlay.dash && posKey(overlay.dash) === k && <span className="pointer-events-none absolute inset-[8%] rounded border-2 border-sky-200 bg-sky-500/40" />}
          {knockKeys.has(k) && <span className="pointer-events-none absolute inset-[10%] rounded border-2 border-dashed border-red-400" />}
          {arrow && (
            <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-base font-black ${arrow.active ? 'text-white' : 'text-white/60'}`} style={{ textShadow: '0 0 4px rgba(0,0,0,.9)' }}>
              {rotated ? ROT_ARROW[arrow.dir] : ARROW[arrow.dir]}
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

  return (
    <div
      className="relative mx-auto w-full select-none overflow-hidden rounded-lg border-4 border-[#4b6b2f] shadow-2xl shadow-black/40"
      style={{ aspectRatio: `${cols} / ${rows}` }}
      onMouseLeave={() => onHover(null)}
    >
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {tiles}
      </div>
      {hedges.map((h, i) => {
        const d = disp(h);
        const edge: Dir = rotated ? ({ N: 'E', E: 'S', S: 'W', W: 'N' } as const)[h.edge] : h.edge;
        const left = (d.x / cols) * 100;
        const top = (d.y / rows) * 100;
        const style =
          edge === 'N' ? { left: `${left}%`, top: 0, width: `${100 / cols}%`, height: '5px' }
          : edge === 'S' ? { left: `${left}%`, bottom: 0, width: `${100 / cols}%`, height: '5px' }
          : edge === 'W' ? { left: 0, top: `${top}%`, width: '5px', height: `${100 / rows}%` }
          : { right: 0, top: `${top}%`, width: '5px', height: `${100 / rows}%` };
        return <span key={i} className="pointer-events-none absolute rounded-full bg-gradient-to-r from-green-600 to-green-500 opacity-90" style={style} />;
      })}
      <div className="pointer-events-none absolute inset-0">
        {state.units.filter(onBoard).map((u) => (
          <Token
            key={u.id}
            unit={u}
            pos={disp(u.pos!)}
            cols={cols}
            rows={rows}
            selected={u.id === selectedId}
            hovered={u.id === hoverId}
            targetable={overlay.targetable?.has(u.id) ?? false}
            preview={previews.get(u.id)}
            matchup={overlay.matchups?.get(u.id)}
            highlighted={overlay.highlight?.has(u.id) ?? false}
            done={state.phase === 'battle' && u.side === state.side && u.activated}
            foresight={fsUsers.has(u.id)}
          />
        ))}
        {floaters.map((f) => {
          const d = disp(f.pos);
          return (
            <span
              key={f.key}
              className={`absolute z-30 animate-floatUp whitespace-nowrap text-sm font-black sm:text-base ${f.cls}`}
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

function Token({ unit, pos, cols, rows, selected, hovered, targetable, preview, matchup, highlighted, done, foresight }: {
  unit: Unit;
  pos: Pos;
  cols: number;
  rows: number;
  selected: boolean;
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
      style={{ left: `${(pos.x / cols) * 100}%`, top: `${(pos.y / rows) * 100}%`, width: `${100 / cols}%`, height: `${100 / rows}%` }}
    >
      <div
        className={`relative aspect-square w-[80%] rounded-full ring-[2.5px] ${ring} ${done ? 'opacity-55 grayscale-[60%]' : ''} ${selected ? 'animate-pulseRing !ring-amber-300' : ''} ${(hovered || highlighted) && !selected ? 'ring-white' : ''} ${targetable ? 'outline outline-2 outline-offset-1 outline-amber-300' : ''} bg-slate-800 shadow-md shadow-black/50`}
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
