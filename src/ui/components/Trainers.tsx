import { useState } from 'react';
import { createPortal } from 'react-dom';
import { type Side, getTrainer } from '../../engine';

/** The printed trainer card (public/trainers, cropped from the expansion sheet). */
export const trainerImg = (id: string): string => `${import.meta.env.BASE_URL}trainers/${id}.jpg`;

/** A trainer card shown large in the middle of the screen with its rules, while hovered or tapped. */
export function TrainerZoom({ id }: { id: string }) {
  const t = getTrainer(id);
  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 w-64 -translate-x-1/2 -translate-y-1/2 space-y-2" aria-hidden="true">
      <img src={trainerImg(id)} alt="" className="w-full rounded-lg shadow-2xl ring-2 ring-white/20" />
      <div className="rounded-lg bg-slate-950/95 p-2 text-xs text-slate-200 ring-1 ring-white/10">
        <div><b>Passive:</b> {t.passive}</div>
        <div className="mt-1"><b>Special (once per game):</b> {t.special}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The trainers on offer as small cards: who took each (if anyone), hover or tap one to read it. With
 * `onPick`, the ones in `pickable` get a pick button.
 */
export function TrainerChips({ ids, owner, pickable, onPick, label }: {
  ids: string[];
  owner: (id: string) => Side | null;
  pickable?: Set<string>;
  onPick?: (id: string) => void;
  label?: (id: string) => string | null;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5" onMouseLeave={() => setZoom(null)}>
      {ids.map((id) => {
        const who = owner(id);
        const extra = label?.(id);
        return (
          <div key={id} className={`flex items-center gap-1 rounded-lg border bg-slate-900/80 py-0.5 pl-0.5 pr-1.5 ${who === 'A' ? 'border-rose-500' : who === 'D' ? 'border-sky-500' : 'border-slate-700'} ${who ? 'opacity-80' : ''}`}>
            <button
              type="button"
              className="flex items-center gap-1.5"
              onMouseEnter={() => setZoom(id)}
              onClick={() => setZoom(zoom === id ? null : id)}
              title={`${getTrainer(id).name}: ${getTrainer(id).passive}`}
            >
              <img src={trainerImg(id)} alt={`${getTrainer(id).name} card`} className="h-10 w-8 rounded object-cover object-top" />
              <span className="text-left text-xs leading-tight">
                <span className="block font-bold text-slate-100">{getTrainer(id).name}</span>
                <span className={`block text-[10px] ${who === 'A' ? 'text-rose-300' : who === 'D' ? 'text-sky-300' : 'text-slate-400'}`}>
                  {who === 'A' ? 'Attacker' : who === 'D' ? 'Defender' : extra ?? 'on offer'}
                </span>
              </span>
            </button>
            {onPick && pickable?.has(id) && (
              <button type="button" className="chip ml-1 bg-amber-400 px-2 py-1 normal-case text-slate-950 hover:bg-amber-300" onClick={() => onPick(id)}>
                Pick
              </button>
            )}
          </div>
        );
      })}
      {zoom && <TrainerZoom id={zoom} />}
    </div>
  );
}
