import { useEffect, useState } from 'react';
import { type GameState, type Side, type Unit, cardOf, getTrainer } from '../../engine';
import { useBoxSize, useFitGrid, useTouch } from '../hooks';
import { CardImage, HpBar, Modal } from './bits';
import { PokeBallIcon } from './icons';
import { CardDetail, UnitChips, VsList, vsTable } from './CardView';
import { CardMagnifier, type Region } from './CardMagnifier';
import type { EventBatch } from '../controller';
import { CardFx, CardTags, shakeClass, useCardFx } from './StatusIcons';
import { TrainerZoom, trainerImg } from './Trainers';

/** A side's trainer card in its team column (trainer mode). */
export interface TrainerSlot {
  id: string;
  used: boolean;
  /** This screen's player can use the Special Move right now. */
  canUse: boolean;
  /** Picking the Pokémon for Nobunaga's special. */
  aiming: boolean;
  onUse: () => void;
  onCancel: () => void;
}

/** Height of the live strip under each card (HP, status, stat changes), gap included. */
const STRIP = 24;

/**
 * One team's printed cards beside the board. With `fill`, the cards are sized so all of them fit
 * the column's height and width at once; hovering one shows it enlarged with its live details.
 */
export function TeamCards({ state, events, side, name, mine, fill, magnifyRegion, selectedId, focusId, onPick, onHover, trainer, trainerApart, trainerInner, onCardArea }: {
  state: GameState;
  /** Latest game events, for the hit effects played on the cards. */
  events: EventBatch;
  /** The side's trainer (trainer mode), shown under its Pokémon. */
  trainer?: TrainerSlot | null;
  /** The trainer is shown elsewhere (beside the board): the Pokémon get the whole column. */
  trainerApart?: boolean;
  /**
   * One-screen layouts with room to spare: the trainer is a third column beside the inner bottom card
   * (right of the Pokémon for the left team, left of them for the right team), at the cards' size.
   */
  trainerInner?: 'right' | 'left';
  /** Reports the height available to the cards (it doesn't depend on the column's width). */
  onCardArea?: (h: number) => void;
  side: Side;
  name: string;
  mine: boolean;
  /** Fit every card in the available height (one-screen layout). */
  fill: boolean;
  /** Where on screen the enlarged card may go without covering other cards (null: nowhere). */
  magnifyRegion: () => Region | null;
  selectedId: string | null;
  focusId: string | null;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const units = state.units.filter((u) => u.side === side);
  const active = state.phase === 'battle' && state.side === side;
  const touch = useTouch();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const inner = fill && trainer && trainerInner ? trainerInner : null;
  const ownTrainer = trainer && !trainerApart && !inner ? trainer : null;
  const fit = useFitGrid(box, units.length, { aspect: 265 / 204, gap: 8, extra: STRIP, below: ownTrainer ? 1 : 0 });
  // Trainer beside the cards: three columns, two rows.
  const boxSize = useBoxSize(box);
  const innerWidth = inner ? Math.floor(Math.min((boxSize.w - 16) / 3, ((boxSize.h - 8) / 2 - STRIP) / (265 / 204))) : 0;
  const cardCol = (i: number) => (inner === 'left' ? (i % 2) + 2 : (i % 2) + 1);
  useEffect(() => {
    if (fill && boxSize.h > 0) onCardArea?.(boxSize.h);
  }, [fill, boxSize.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mag, setMag] = useState<{ id: string; region: Region } | null>(null);
  const [detail, setDetail] = useState<Unit | null>(null);
  const magUnit = mag ? units.find((u) => u.id === mag.id) : undefined;
  const fx = useCardFx(events);

  return (
    <div className={`panel relative flex flex-col gap-2 p-2 ${fill ? 'h-full min-h-0' : ''} ${fill && trainerApart ? 'team-crest' : ''} ${active ? (side === 'A' ? 'ring-1 ring-rose-500/60' : 'ring-1 ring-sky-500/60') : ''}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`sash shrink-0 !text-sm ${side === 'A' ? 'sash-a' : 'sash-d'}`}>{side === 'A' ? 'Attacker' : 'Defender'}</span>
          <span className="truncate text-sm font-extrabold text-slate-200">{name}</span>
          {mine && <span className="chip bg-amber-400 text-slate-950">You</span>}
        </div>
        {/* A Poké Ball per Pokémon, greyed out once it has fainted. */}
        <div className="flex shrink-0 items-center gap-0.5" title={`${units.filter((u) => !u.fainted).length} of ${units.length} Pokémon left`}>
          {units.map((u) => <PokeBallIcon key={u.id} className={`h-4 w-4 ${u.fainted ? 'opacity-30 grayscale' : ''}`} />)}
        </div>
      </div>
      <div ref={setBox} className={fill ? 'min-h-0 flex-1' : ''}>
        <div
          className={fill ? `grid h-full justify-center gap-2 ${trainerApart || inner ? 'content-end' : 'content-center'}` : 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2'}
          style={inner && innerWidth > 0
            ? { gridTemplateColumns: `repeat(3, ${innerWidth}px)` }
            : fill && fit.width > 0 ? { gridTemplateColumns: `repeat(${fit.cols}, ${fit.width}px)` } : undefined}
        >
          {units.map((u, i) => {
            const c = cardOf(u);
            const done = active && u.activated && !u.fainted;
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                aria-label={`${c.name}, ${u.hp} of ${u.maxHp} HP`}
                onClick={() => onPick(u.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(u.id);
                  }
                }}
                onMouseEnter={() => {
                  onHover(u.id);
                  const region = magnifyRegion();
                  setMag(region ? { id: u.id, region } : null);
                }}
                onMouseLeave={() => {
                  onHover(null);
                  setMag(null);
                }}
                style={inner ? { gridColumn: cardCol(i), gridRow: Math.floor(i / 2) + 1 } : undefined}
                className={`relative flex cursor-pointer flex-col gap-1 rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  u.id === selectedId ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-900' : u.id === focusId ? 'ring-1 ring-white/70 ring-offset-2 ring-offset-slate-900' : ''
                } ${u.fainted ? 'opacity-35 grayscale' : done || !u.pos ? 'opacity-60' : ''}`}
              >
                <div className={`relative [container-type:inline-size] ${shakeClass(fx[u.id])}`}>
                  <CardImage id={c.id} name={c.name} />
                  <CardTags state={state} unit={u} />
                  <CardFx list={fx[u.id]} />
                </div>
                <LiveStrip unit={u} />
                {touch && (
                  <button
                    type="button"
                    aria-label={`Enlarge ${c.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetail(u);
                    }}
                    className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-sm text-white"
                  >
                    ⤢
                  </button>
                )}
              </div>
            );
          })}
          {inner && trainer && (
            <TrainerCard slot={trainer} side={side} className="self-end" style={{ gridColumn: inner === 'left' ? 1 : 3, gridRow: 2 }} />
          )}
          {ownTrainer && (
            <TrainerCard slot={ownTrainer} side={side} style={fill && fit.width > 0 ? { gridColumn: '1 / -1', justifySelf: 'center', width: fit.width } : undefined} />
          )}
        </div>
      </div>
      {magUnit && mag && !touch && (
        <CardMagnifier cardId={cardOf(magUnit).id} name={cardOf(magUnit).name} region={mag.region} overlay={<CardTags state={state} unit={magUnit} />}>
          <UnitDetails state={state} unit={magUnit} active={active} />
        </CardMagnifier>
      )}
      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <CardDetail card={cardOf(detail)} unit={detail} extra={<UnitDetails state={state} unit={detail} active={active} />} />
          <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setDetail(null)}>Close</button>
        </Modal>
      )}
    </div>
  );
}

/** One line under a card: HP bar and numbers (status and stat changes are on the card itself). */
function LiveStrip({ unit }: { unit: Unit }) {
  if (unit.fainted) return <div className="h-5 text-center text-[11px] font-semibold text-slate-400">Fainted</div>;
  return (
    <div className="flex h-5 items-center gap-1.5 overflow-hidden">
      <HpBar hp={unit.hp} max={unit.maxHp} className="h-2 min-w-[24px] flex-1" />
      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-100">{unit.hp}/{unit.maxHp}</span>
    </div>
  );
}

/** Live details shown with an enlarged card: HP, effects, turn notes and damage from its tile. */
function UnitDetails({ state, unit, active }: { state: GameState; unit: Unit; active: boolean }) {
  const notes = [
    !unit.fainted && !unit.pos ? 'Not placed yet' : null,
    active && unit.activated && !unit.fainted ? 'Done this turn' : null,
    ...(active && !unit.fainted && !unit.activated ? unit.turn.reasons : []),
  ].filter((x): x is string => !!x);
  const chips = unit.fainted ? undefined : vsTable(state, unit);
  return (
    <div className="space-y-1.5 text-xs">
      {unit.fainted ? (
        <div className="font-semibold text-slate-400">Fainted</div>
      ) : (
        <div className="flex items-center gap-2">
          <HpBar hp={unit.hp} max={unit.maxHp} className="flex-1" />
          <b className="tabular-nums">{unit.hp}/{unit.maxHp} HP</b>
        </div>
      )}
      <UnitChips unit={unit} />
      {notes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {notes.map((n) => <span key={n} className="chip bg-slate-700 normal-case text-slate-200">{n}</span>)}
        </div>
      )}
      {chips?.some(Boolean) && cardOf(unit).moves.map((m, i) => (chips[i] ? (
        <div key={m.name}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.name}: damage from here</div>
          <VsList list={chips[i]!} />
        </div>
      ) : null))}
    </div>
  );
}

/** A trainer's card (under its team, or beside the board): hover to read it; the Special Move button sits underneath. */
export function TrainerCard({ slot, side, style, className = '' }: { slot: TrainerSlot; side: Side; style?: React.CSSProperties; className?: string }) {
  const t = getTrainer(slot.id);
  const [zoom, setZoom] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [slot.canUse, slot.used]);
  return (
    <div className={`flex flex-col gap-1 ${className}`} style={style}>
      <button
        type="button"
        className="relative [container-type:inline-size]"
        onMouseEnter={() => setZoom(true)}
        onMouseLeave={() => setZoom(false)}
        onClick={() => setZoom((z) => !z)}
        aria-label={`${t.name}: ${t.passive} Special Move: ${t.special}`}
      >
        <img src={trainerImg(slot.id)} alt="" className={`block aspect-[204/265] w-full rounded-lg object-cover shadow-md shadow-black/40 ring-2 ${side === 'A' ? 'ring-rose-500/70' : 'ring-sky-500/70'} ${slot.used ? 'grayscale-[60%]' : ''}`} />
        {slot.used && (
          <span className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded border-2 border-rose-400 bg-slate-950/70 px-[3cqw] py-[1cqw] text-[9cqw] font-black uppercase tracking-wider text-rose-300">
            Special used
          </span>
        )}
      </button>
      <div className="flex h-5 items-center justify-center gap-1.5 text-xs">
        {slot.aiming ? (
          <>
            <span className="truncate text-amber-200">Pick a Pokémon</span>
            <button type="button" className="chip bg-slate-700 normal-case text-slate-100" onClick={slot.onCancel}>Cancel</button>
          </>
        ) : slot.canUse ? (
          <button
            type="button"
            className={`chip normal-case ${confirm ? 'bg-rose-500 text-white' : 'bg-amber-400 text-slate-950 hover:bg-amber-300'}`}
            title={t.special}
            onClick={() => (confirm ? slot.onUse() : setConfirm(true))}
          >
            {confirm ? `Use ${t.name}’s Special?` : '★ Special Move'}
          </button>
        ) : (
          <span className={slot.used ? 'text-slate-500' : 'text-emerald-300'}>{slot.used ? 'Special used' : 'Special ready'}</span>
        )}
      </div>
      {zoom && <TrainerZoom id={slot.id} />}
    </div>
  );
}

