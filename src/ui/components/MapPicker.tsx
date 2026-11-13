import type { ReactNode } from 'react';
import { DEFAULT_MAP_ID, MAPS, MAP_LIST, type MapDef, type Terrain } from '../../engine';
import { Art } from './bits';
import type { DraftStyle } from '../../engine';
import { BushIcon, CardsIcon, CoinIcon, ElectricIcon, FlowerIcon, PokeBallIcon, SealedIcon, TrebuchetIcon, WonderIcon } from './icons';

/** A numbered heading for a step of a setup screen. */
export function SetupHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="setup-num">{n}</span>
      <span className="font-display text-lg text-slate-100">{children}</span>
    </div>
  );
}

export interface OptionDef<T> {
  value: T;
  title: string;
  sub?: string;
  emblem: ReactNode;
}

/** A row of chunky choice tiles: the chosen one turns to red lacquer with a gold rim. */
export function OptionTiles<T>({ options, value, onChange, cols = options.length }: { options: OptionDef<T>[]; value: T; onChange: (v: T) => void; cols?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`opt-tile ${value === o.value ? 'opt-tile-on' : ''}`}>
          <span className="opt-emblem">{o.emblem}</span>
          <span className="min-w-0 text-left">
            <span className="block font-display text-[0.95rem] leading-tight">{o.title}</span>
            {o.sub && <span className="block text-[11px] font-bold leading-snug opacity-80">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

const TILE: Record<Terrain, string> = {
  normal: 'var(--tile-normal)', dirt: 'var(--tile-dirt)', grass: 'var(--tile-grass)', bridge: 'var(--tile-bridge)', water: 'var(--tile-water)',
  flower: 'var(--tile-normal)', bush: 'var(--tile-normal)', wonder: 'var(--tile-normal)', wall: '#57534e', electric: '#454545', magma: 'var(--tile-magma)', ice: '#bae6fd', pit: '#1c1917',
};

const MAP_KEY = 'pcc-map';

/** The map chosen last time on this device (falls back to the default map). */
export function savedMapId(): string {
  try {
    const id = localStorage.getItem(MAP_KEY);
    return id && MAPS[id] ? id : DEFAULT_MAP_ID;
  } catch {
    return DEFAULT_MAP_ID;
  }
}

function saveMapId(id: string): void {
  try {
    localStorage.setItem(MAP_KEY, id);
  } catch {
    // Storage can be unavailable; the choice still applies to this game.
  }
}

const LEGENDS_KEY = 'pcc-legendaries';

/** Whether legendaries were on last time on this device (on by default). */
export function savedLegendaries(): boolean {
  try {
    return localStorage.getItem(LEGENDS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Legendaries on (3 picks from the pool, then 1 legendary each) or off (4 picks from the pool each). */
export function LegendaryToggle({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const choose = (on: boolean) => {
    try {
      localStorage.setItem(LEGENDS_KEY, on ? '1' : '0');
    } catch {
      // Storage can be unavailable; the choice still applies to this game.
    }
    onChange(on);
  };
  return (
    <OptionTiles
      value={value}
      onChange={choose}
      options={[
        { value: true, title: 'With legendaries', sub: '3 Pokémon, then 1 legendary', emblem: <Art id="rayquaza" className="h-full w-full rounded-full" /> },
        { value: false, title: 'No legendaries', sub: 'All 4 picks are non-legendary', emblem: <Art id="pikachu" className="h-full w-full rounded-full" /> },
      ]}
    />
  );
}

const TRAINERS_KEY = 'pcc-trainers';
const STYLE_KEY = 'pcc-style';

/** The draft style chosen last time on this device (classic by default). */
export function savedStyle(): DraftStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return v === 'secret' || v === 'auction' || v === 'freeplay' ? v : 'classic';
  } catch {
    return 'classic';
  }
}

/** Classic, Secret, Auction or Freeplay draft. */
export function StyleToggle({ value, onChange }: { value: DraftStyle; onChange: (s: DraftStyle) => void }) {
  const choose = (v: DraftStyle) => {
    try {
      localStorage.setItem(STYLE_KEY, v);
    } catch {
      // Storage can be unavailable; the choice still applies to this game.
    }
    onChange(v);
  };
  return (
    <OptionTiles
      value={value}
      onChange={choose}
      options={[
        { value: 'classic' as const, title: 'Classic', sub: 'Take turns picking from one pool', emblem: <CardsIcon className="h-full w-full" /> },
        { value: 'secret' as const, title: 'Secret', sub: 'Both pick at once, hidden until battle', emblem: <SealedIcon className="h-full w-full" /> },
        { value: 'auction' as const, title: 'Auction', sub: 'Bid 20 coins, lot by lot', emblem: <CoinIcon className="h-full w-full" /> },
        { value: 'freeplay' as const, title: 'Freeplay', sub: 'Pick any Pokémon and trainer in secret', emblem: <PokeBallIcon className="h-full w-full" /> },
      ]}
    />
  );
}

/** Whether trainer mode was last chosen on this device (off by default). */
export function savedTrainers(): boolean {
  try {
    return localStorage.getItem(TRAINERS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Trainer mode on (each side picks one of four trainers after the draft) or off. */
export function TrainerToggle({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const choose = (on: boolean) => {
    try {
      localStorage.setItem(TRAINERS_KEY, on ? '1' : '0');
    } catch {
      // Storage can be unavailable; the choice still applies to this game.
    }
    onChange(on);
  };
  return (
    <OptionTiles
      value={value}
      onChange={choose}
      options={[
        { value: false, title: 'No trainers', sub: 'Just the Pokémon', emblem: <PokeBallIcon className="h-full w-full" /> },
        { value: true, title: 'With trainers', sub: 'Pick a trainer: a passive and one Special Move', emblem: <img src={`${import.meta.env.BASE_URL}trainers/red-icon.webp`} alt="" className="h-full w-full rounded-full object-cover" /> },
      ]}
    />
  );
}

/** A small drawing of a map: terrain, flowers, bushes, the trebuchet and both sides' spawns. */
/** A small painted copy of a map, using the board's own tile textures and icons, in a wooden frame. */
export function MapPreview({ map, className = '' }: { map: MapDef; className?: string }) {
  const spawn = (x: number, y: number) =>
    map.spawns.A.some((p) => p.x === x && p.y === y) ? 'A' : map.spawns.D.some((p) => p.x === x && p.y === y) ? 'D' : null;
  const BASE: Partial<Record<Terrain, string>> = { flower: 'normal', bush: 'normal', wonder: 'normal' };
  return (
    <div
      className={`map-mini grid overflow-hidden ${map.theme ? `map-${map.theme}` : ''} ${className}`}
      style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)`, aspectRatio: `${map.width} / ${map.height}` }}
      aria-hidden="true"
    >
      {map.tiles.flatMap((row, y) =>
        row.map((t, x) => {
          const sp = spawn(x, y);
          const treb = map.trebuchets.some((p) => p.x === x && p.y === y);
          const base = BASE[t] ?? t;
          const painted = ['normal', 'dirt', 'grass', 'bridge', 'water', 'ice', 'magma', 'electric'].includes(base);
          return (
            <div
              key={`${x},${y}`}
              className={`relative flex items-center justify-center ${t === 'wonder' ? 'tile-wonder' : painted ? `tile-${base} ${(x + y) % 2 ? 'alt' : ''}` : ''}`}
              style={painted ? undefined : { background: TILE[t] }}
            >
              {t === 'flower' && <span className="h-[80%] w-[80%]"><FlowerIcon /></span>}
              {t === 'bush' && <span className="h-[85%] w-[85%]"><BushIcon /></span>}
              {t === 'wonder' && <WonderIcon />}
              {t === 'electric' && <ElectricIcon />}
              {treb && <span className="h-[90%] w-[90%]"><TrebuchetIcon /></span>}
              {sp && <span className={`absolute inset-[18%] rounded-full border-2 border-[#fff3d6] ${sp === 'A' ? 'bg-[#c73a2e]' : 'bg-[#2f62b8]'} shadow`} />}
            </div>
          );
        }),
      )}
    </div>
  );
}

/** Choose the battlefield. Remembers the choice on this device. */
export function MapPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MAP_LIST.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => {
            saveMapId(m.id);
            onChange(m.id);
          }}
          aria-pressed={value === m.id}
          className={`map-card ${value === m.id ? 'map-card-on' : ''}`}
        >
          <MapPreview map={m} />
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-lg leading-tight">{m.name}</span>
            <span className="shrink-0 text-xs font-extrabold opacity-70">{m.width}×{m.height}</span>
          </div>
          <p className="text-left text-xs font-bold leading-snug opacity-80">{m.description}</p>
          {value === m.id && <span className="map-chosen">Chosen</span>}
        </button>
      ))}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-400 sm:col-span-2">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-[#fff3d6] bg-[#c73a2e]" />Attacker spawns</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-[#fff3d6] bg-[#2f62b8]" />Defender spawns</span>
        <span className="flex items-center gap-1"><span className="inline-block h-4 w-4"><TrebuchetIcon /></span>Trebuchet</span>
        <span className="flex items-center gap-1"><span className="inline-block h-4 w-4"><BushIcon /></span>Berry bush</span>
        <span className="flex items-center gap-1"><span className="inline-block h-4 w-4"><FlowerIcon /></span>Flowers</span>
        <span className="flex items-center gap-1"><span className="inline-block h-4 w-4"><WonderIcon /></span>Wonder tile: resets stat changes on entry</span>
        <span className="flex items-center gap-1"><span className="inline-block h-4 w-4"><ElectricIcon /></span>Electric tile: +2 movement for Quark Drive</span>
      </p>
    </div>
  );
}
