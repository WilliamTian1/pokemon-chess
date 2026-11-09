import { DEFAULT_MAP_ID, MAPS, MAP_LIST, type MapDef, type Terrain } from '../../engine';

const TILE: Record<Terrain, string> = {
  normal: 'var(--tile-normal)', dirt: 'var(--tile-dirt)', grass: 'var(--tile-grass)', bridge: 'var(--tile-bridge)', water: 'var(--tile-water)',
  flower: 'var(--tile-normal)', bush: 'var(--tile-normal)', wall: '#57534e', magma: '#c2410c', ice: '#bae6fd', pit: '#1c1917',
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
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-300">Legendaries</div>
      <div className="grid grid-cols-2 gap-2">
        {([true, false] as const).map((on) => (
          <button key={String(on)} type="button" aria-pressed={value === on} onClick={() => choose(on)} className={`btn ${value === on ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700'}`}>
            {on ? 'With legendaries' : 'No legendaries'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {value ? 'Each player drafts 3 Pokémon from the pool of 15, then 1 of 4 random legendaries.' : 'No legendaries: a bigger pool of 20, and each player drafts all 4 Pokémon from it.'}
      </p>
    </div>
  );
}

const TRAINERS_KEY = 'pcc-trainers';

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
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-300">Trainers</div>
      <div className="grid grid-cols-2 gap-2">
        {([false, true] as const).map((on) => (
          <button key={String(on)} type="button" aria-pressed={value === on} onClick={() => choose(on)} className={`btn ${value === on ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700'}`}>
            {on ? 'With trainers' : 'No trainers'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {value
          ? 'After the draft, 4 random trainers are offered: the Attacker picks one, then the Defender. Each has a passive and a once-per-game Special Move.'
          : 'Play without trainer cards.'}
      </p>
    </div>
  );
}

/** A small drawing of a map: terrain, flowers, bushes, the trebuchet and both sides' spawns. */
export function MapPreview({ map, className = '' }: { map: MapDef; className?: string }) {
  const spawn = (x: number, y: number) =>
    map.spawns.A.some((p) => p.x === x && p.y === y) ? 'A' : map.spawns.D.some((p) => p.x === x && p.y === y) ? 'D' : null;
  return (
    <div
      className={`grid overflow-hidden rounded-md border-2 border-[#4b6b2f] ${className}`}
      style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)`, aspectRatio: `${map.width} / ${map.height}` }}
      aria-hidden="true"
    >
      {map.tiles.flatMap((row, y) =>
        row.map((t, x) => {
          const sp = spawn(x, y);
          const treb = map.trebuchets.some((p) => p.x === x && p.y === y);
          return (
            <div key={`${x},${y}`} className="relative flex items-center justify-center text-[clamp(6px,1.4vw,11px)] leading-none" style={{ background: TILE[t], boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.15)' }}>
              {t === 'flower' && <span className="h-[45%] w-[45%] rounded-full bg-pink-400 ring-2 ring-yellow-200/80" />}
              {t === 'bush' && <span className="h-[60%] w-[60%] rounded-full bg-green-800/90" />}
              {treb && <span className="h-[55%] w-[55%] rounded-sm bg-stone-700" />}
              {sp && <span className={`absolute inset-[15%] rounded-full ${sp === 'A' ? 'bg-rose-500' : 'bg-sky-500'} ring-1 ring-white/70`} />}
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
          className={`space-y-2 rounded-xl border p-2.5 text-left transition ${value === m.id ? 'border-amber-300 bg-amber-400/10 ring-1 ring-amber-300' : 'border-slate-700 bg-slate-900/70 hover:border-slate-500'}`}
        >
          <MapPreview map={m} />
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold">{m.name}</span>
            <span className="text-xs text-slate-400">{m.width}×{m.height}</span>
          </div>
        </button>
      ))}
      <p className="text-xs text-slate-400 sm:col-span-2">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-rose-500 align-middle" />Attacker spawns
        <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-sky-500 align-middle" />Defender spawns
        <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-stone-700 align-middle" />Trebuchet
        <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-800 align-middle" />Berry bush
        <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-pink-400 align-middle ring-1 ring-yellow-200/80" />Flowers
      </p>
    </div>
  );
}
