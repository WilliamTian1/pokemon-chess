import { useState } from 'react';
import { type GameState, type Side, type Unit, cardOf } from '../../engine';
import { useFitGrid, useTouch } from '../hooks';
import { CardImage, HpBar, Modal, SIDE_TEXT } from './bits';
import { CardDetail, UnitChips, VsList, vsTable } from './CardView';
import { CardMagnifier, type Region } from './CardMagnifier';
import type { EventBatch } from '../controller';
import { CardFx, CardTags, shakeClass, useCardFx } from './StatusIcons';

/** Height of the live strip under each card (HP, status, stat changes), gap included. */
const STRIP = 24;

/**
 * One team's printed cards beside the board. With `fill`, the cards are sized so all of them fit
 * the column's height and width at once; hovering one shows it enlarged with its live details.
 */
export function TeamCards({ state, events, side, name, mine, fill, magnifyRegion, selectedId, focusId, onPick, onHover }: {
  state: GameState;
  /** Latest game events, for the hit effects played on the cards. */
  events: EventBatch;
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
  const fit = useFitGrid(box, units.length, { aspect: 265 / 204, gap: 8, extra: STRIP });
  const [mag, setMag] = useState<{ id: string; region: Region } | null>(null);
  const [detail, setDetail] = useState<Unit | null>(null);
  const magUnit = mag ? units.find((u) => u.id === mag.id) : undefined;
  const fx = useCardFx(events);

  return (
    <div className={`panel flex flex-col gap-2 p-2 ${fill ? 'h-full min-h-0' : ''} ${active ? (side === 'A' ? 'ring-1 ring-rose-500/60' : 'ring-1 ring-sky-500/60') : ''}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <div className={`truncate text-sm font-bold ${SIDE_TEXT[side]}`}>
          {side === 'A' ? 'Attacker' : 'Defender'} <span className="font-medium text-slate-300">· {name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400">{units.filter((u) => !u.fainted).length}/{units.length} left</span>
          {mine && <span className="chip bg-amber-400 text-slate-900">You</span>}
        </div>
      </div>
      <div ref={setBox} className={fill ? 'min-h-0 flex-1' : ''}>
        <div
          className={fill ? 'grid h-full content-center justify-center gap-2' : 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2'}
          style={fill && fit.width > 0 ? { gridTemplateColumns: `repeat(${fit.cols}, ${fit.width}px)` } : undefined}
        >
          {units.map((u) => {
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
