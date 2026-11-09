import { type ReactNode, useMemo, useState } from 'react';
import {
  type CardDef, type PType, type Side, TRAINERS, TYPES, bestHit, decider, draftOptions, getCard, getTrainer, isLegendPick, isTrainerPick, otherSide,
} from '../../engine';
import { Art, CardImage, Modal, SIDE_TEXT, TypeBadge } from '../components/bits';
import { CardDetail } from '../components/CardView';
import { CounterLists, MultChip, TypeChartModal, matchupTitle } from '../components/Matchups';
import { trainerImg } from '../components/Trainers';
import type { Controller } from '../controller';
import { type FitGrid, useFitGrid, useTouch, useWideLayout } from '../hooks';

type Sort = 'page' | 'name' | 'hp' | 'mov' | 'type' | 'power';

/** The card's strongest printed move power (0 for cards with only status moves). */
const topPower = (c: CardDef): number => Math.max(0, ...c.moves.map((m) => m.power ?? 0));

/** Cards fill as many columns as fit, so zooming in or out changes how many sit in a row. */
const CARD_COLUMNS = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3';

/** The printed cards (card gallery). */
export function CardGrid({ cards, onOpen }: { cards: CardDef[]; onOpen: (c: CardDef) => void }) {
  return (
    <div className={CARD_COLUMNS}>
      {cards.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpen(c)} className="rounded-lg text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          <CardImage id={c.id} name={c.name} />
        </button>
      ))}
    </div>
  );
}

/** Height of the line under each draft card (matchup badges and the Draft chip), gap included. */
const DRAFT_LINE = 26;

/**
 * Draft cards: the printed card, matchup badges and a Draft chip when the card can be taken now.
 * With `fit`, cards are sized so every one of them is on screen at once.
 */
function DraftCards({ cards, fit, takenBy, pickable, canPick, legendTurn, onOpen, onDraft, onHover, focusId, badge }: {
  cards: CardDef[];
  fit: FitGrid | null;
  takenBy: Map<string, Side>;
  pickable: Set<string>;
  canPick: boolean;
  legendTurn: boolean;
  onOpen: (c: CardDef) => void;
  onDraft: (c: CardDef) => void;
  onHover: (id: string | null) => void;
  focusId: string | null;
  badge: (c: CardDef) => ReactNode;
}) {
  return (
    <div
      className={fit ? 'grid content-center justify-center gap-2' : 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-2'}
      style={fit ? { gridTemplateColumns: `repeat(${fit.cols}, ${fit.width}px)` } : undefined}
      onMouseLeave={() => onHover(null)}
    >
      {cards.map((c) => {
        const taken = takenBy.get(c.id);
        const offTurn = !taken && c.legendary !== legendTurn;
        return (
          <div
            key={c.id}
            onMouseEnter={() => onHover(c.id)}
            className={`relative flex flex-col gap-1 rounded-lg transition ${c.id === focusId ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950' : ''} ${taken ? 'opacity-35' : offTurn ? 'opacity-60' : ''}`}
          >
            <button type="button" onClick={() => onOpen(c)} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" title="Open: type matchups and counters">
              <CardImage id={c.id} name={c.name} className={c.legendary ? 'ring-2 ring-amber-400/80' : ''} />
            </button>
            <div className="flex h-[22px] items-center gap-1 overflow-hidden">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{badge(c)}</div>
              {canPick && pickable.has(c.id) && (
                <button type="button" className="chip shrink-0 bg-amber-400 px-2 py-1 normal-case text-slate-950 hover:bg-amber-300" onClick={() => onDraft(c)}>
                  Draft
                </button>
              )}
            </div>
            {/* Tags sit on the card's top edge so they don't hide its name or HP. */}
            {c.legendary && <span className="absolute -top-2 left-2 chip bg-amber-400 text-slate-900 shadow">Legendary</span>}
            {taken && (
              <span className={`absolute -top-2 right-2 chip ${taken === 'A' ? 'bg-rose-500' : 'bg-sky-500'} text-white shadow`}>
                {taken === 'A' ? 'Attacker' : 'Defender'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useCardFilter(all: CardDef[]) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<PType | null>(null);
  const [sort, setSort] = useState<Sort>('page');
  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter((c) =>
      (!type || c.types.includes(type)) &&
      (!needle || c.name.toLowerCase().includes(needle) || c.abilityName.toLowerCase().includes(needle) || c.moves.some((m) => m.name.toLowerCase().includes(needle))),
    );
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'hp') list.sort((a, b) => b.hp - a.hp);
    if (sort === 'mov') list.sort((a, b) => b.mov - a.mov);
    if (sort === 'type') list.sort((a, b) => a.types[0].localeCompare(b.types[0]) || a.name.localeCompare(b.name));
    if (sort === 'power') list.sort((a, b) => topPower(b) - topPower(a));
    return list;
  }, [all, q, type, sort]);
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, move or ability…"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-300 sm:w-64"
      />
      <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm" aria-label="Sort cards">
        <option value="page">Card order</option>
        <option value="name">Name</option>
        <option value="type">Type</option>
        <option value="hp">HP (high first)</option>
        <option value="mov">Movement (high first)</option>
        <option value="power">Strongest move</option>
      </select>
      <div className="no-scrollbar flex min-w-0 max-w-full gap-1 overflow-x-auto">
        <button type="button" onClick={() => setType(null)} className={`chip ${type === null ? 'bg-amber-400 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>All</button>
        {TYPES.map((t) => (
          <button key={t} type="button" onClick={() => setType(type === t ? null : t)} className={`rounded ${type === t ? 'ring-2 ring-amber-300' : 'opacity-75 hover:opacity-100'}`}>
            <TypeBadge type={t} small />
          </button>
        ))}
      </div>
    </div>
  );
  const active = q.trim() !== '' || type !== null;
  return { cards, controls, active, clear: () => { setQ(''); setType(null); } };
}

export function DraftView({ ctl }: { ctl: Controller }) {
  const s = ctl.state;
  const turn = decider(s)!;
  const mine = ctl.mySides.includes(turn);
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [chart, setChart] = useState(false);
  const takenBy = useMemo(() => {
    const m = new Map<string, Side>();
    for (const side of ['A', 'D'] as const) for (const id of s.draft.picks[side]) m.set(id, side);
    return m;
  }, [s.draft.picks]);
  const normals = useMemo(() => s.draft.pool.map(getCard), [s.draft.pool]);
  const legends = useMemo(() => s.draft.legendPool.map(getCard), [s.draft.legendPool]);
  const pool = useMemo(() => [...normals, ...legends], [normals, legends]);
  const pickNo = s.draft.index + 1;
  const legendTurn = isLegendPick(s);
  const trainerTurn = isTrainerPick(s);
  const pickable = new Set(draftOptions(s));

  // Matchups are shown against the hovered or pinned card, or else against the opposing team.
  const focus = hovered ?? pinned;
  const focusCard = focus ? getCard(focus) : null;
  const rival: Side = ctl.mySides.length === 1 ? otherSide(ctl.mySides[0]) : otherSide(turn);
  const rivalPicks = s.draft.picks[rival].map(getCard);
  const badge = (c: CardDef): ReactNode => {
    if (focusCard) {
      if (c.id === focusCard.id) return <span className="chip bg-amber-400 text-slate-900">Comparing</span>;
      const hit = bestHit(c, focusCard);
      const take = bestHit(focusCard, c);
      return (
        <span className="flex min-w-0 gap-1" title={matchupTitle(c, focusCard)}>
          {/* Neutral (1×) matchups are left out so the ones that matter stand out. */}
          {/* Colours follow the focused card's side: what c does to it is bad news, what it does to c is good. */}
          {hit && hit.mult !== 1 && <MultChip mult={hit.mult} kind="take" label="hits" />}
          {take && take.mult !== 1 && <MultChip mult={take.mult} kind="hit" label="takes" />}
        </span>
      );
    }
    if (!rivalPicks.length) return null;
    const strong = rivalPicks.filter((r) => (bestHit(c, r)?.mult ?? 0) >= 2);
    const weak = rivalPicks.filter((r) => (bestHit(r, c)?.mult ?? 0) >= 2);
    return (
      <>
        {strong.length > 0 && <span className="chip normal-case bg-emerald-600 text-white" title={`Super effective against ${strong.map((x) => x.name).join(', ')}`}>beats {strong.length}</span>}
        {weak.length > 0 && <span className="chip normal-case bg-rose-600 text-white" title={`Weak to ${weak.map((x) => x.name).join(', ')}`}>weak to {weak.length}</span>}
      </>
    );
  };
  const byOrder = legendTurn ? [...legends, ...normals] : [...normals, ...legends];
  const filter = useCardFilter(byOrder);
  const ordered = filter.cards;
  const wide = useWideLayout();
  const touch = useTouch();
  const [gridBox, setGridBox] = useState<HTMLDivElement | null>(null);
  // Trainer mode: the trainers on offer sit in a row of their own under the pool, at the same size.
  const offered = s.trainers?.pool ?? [];
  const fit = useFitGrid(gridBox, Math.max(1, ordered.length), { aspect: 265 / 204, gap: 8, extra: DRAFT_LINE, below: offered.length });
  // The reading pane keeps the last card hovered, so the pointer can leave it without losing it.
  const [reading, setReading] = useState<string | null>(null);
  const onHover = (id: string | null) => {
    setHovered(id);
    if (id) setReading(id);
  };
  const readId = reading ?? pinned;
  const draft = (c: CardDef) => ctl.dispatch({ type: 'draftPick', cardId: c.id });

  return (
    <div className="flex flex-col gap-2 wide:h-full wide:min-h-0">
      {/* Pinned on phones so whose pick it is stays in view while scrolling the cards. */}
      <div className="panel sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-slate-900/95 px-3 py-2 wide:static">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            Pick {pickNo} of {s.draft.order.length} · {trainerTurn ? <span className="font-bold text-amber-300">trainer pick</span> : legendTurn ? <span className="font-bold text-amber-300">legendary pick</span> : s.draft.legendPool.length ? '3 each from the pool, then 1 legendary each' : '4 each from the pool, no legendaries'}{s.trainers && !trainerTurn ? ', then a trainer each' : ''}
          </div>
          <div className={`font-bold ${SIDE_TEXT[turn]}`}>
            {mine ? 'Your pick' : ctl.thinking ? `${ctl.names[turn]} is thinking…` : `${ctl.names[turn]} is picking…`}
            <span className="ml-1.5 text-xs font-medium text-slate-400">({turn === 'A' ? 'Attacker' : 'Defender'})</span>
          </div>
        </div>
        {(['A', 'D'] as const).map((side) => (
          <div key={side} className="flex items-center gap-1.5">
            <span className={`text-xs font-bold ${SIDE_TEXT[side]}`}>{side === 'A' ? 'Attacker' : 'Defender'}</span>
            {[0, 1, 2, 3].map((i) => {
              const id = s.draft.picks[side][i];
              const next = turn === side && s.draft.picks[side].length === i;
              return id ? (
                <button
                  key={i}
                  type="button"
                  title={`${getCard(id).name}: click to compare every card against it`}
                  onClick={() => setPinned(pinned === id ? null : id)}
                  onMouseEnter={() => onHover(id)}
                  onMouseLeave={() => onHover(null)}
                  className={`rounded-full ${pinned === id ? 'ring-2 ring-amber-300' : ''}`}
                >
                  <Art id={id} className={`h-8 w-8 rounded-full ring-2 ${side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} alt={getCard(id).name} />
                </button>
              ) : (
                <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-full border border-dashed text-[10px] ${next ? 'border-amber-300 text-amber-300' : 'border-slate-600 text-slate-500'}`}>
                  {i === 3 && s.draft.legendPool.length ? 'L' : i + 1}
                </span>
              );
            })}
          </div>
        ))}
        <p className="min-w-[200px] flex-1 text-[11px] leading-snug text-slate-400">
          {focusCard ? (
            <>Comparing with <b className="text-amber-300">{focusCard.name}</b>: <b className="text-slate-300">hits</b> = how hard each card hits it, <b className="text-slate-300">takes</b> = how hard it hits that card (neutral 1× not shown).{pinned && !hovered ? ' Click its portrait again to unpin.' : ''}</>
          ) : rivalPicks.length ? (
            <>Badges compare each card with the {rival === 'A' ? 'Attacker' : 'Defender'}'s picks. Hover a card to compare with it{touch ? '' : ' and see it enlarged'}.</>
          ) : (
            <>Hover a card to compare every other card with it{touch ? '' : ' and see it enlarged'}. Click a card for its full matchups.</>
          )}
        </p>
        <button type="button" className="btn-ghost shrink-0" onClick={() => setChart(true)}>Type chart</button>
        <div className="w-full">{filter.controls}</div>
      </div>
      <div className="flex gap-3 wide:min-h-0 wide:flex-1">
      <div ref={setGridBox} className="min-w-0 flex-1">
        {ordered.length === 0 && (
          <div className="panel p-4 text-sm text-slate-300">
            No card in this pool matches. <button type="button" className="btn-ghost ml-2" onClick={filter.clear}>Clear search</button>
          </div>
        )}
        <DraftCards
          cards={ordered}
          fit={wide && fit.width > 0 ? fit : null}
          takenBy={takenBy}
          pickable={pickable}
          canPick={mine}
          legendTurn={legendTurn}
          onOpen={setDetail}
          onDraft={draft}
          onHover={onHover}
          focusId={focus}
          badge={badge}
        />
        {offered.length > 0 && (
          <TrainerRow
            ids={offered}
            fit={wide && fit.width > 0 ? fit : null}
            owner={(id) => (s.trainers!.picks.A === id ? 'A' : s.trainers!.picks.D === id ? 'D' : null)}
            pickable={trainerTurn && mine ? pickable : new Set()}
            active={trainerTurn}
            onPick={(id) => ctl.dispatch({ type: 'draftPick', cardId: id })}
            onHover={(id) => id && setReading(id)}
          />
        )}
      </div>
      {wide && !touch && (
        <aside
          className="flex shrink-0 flex-col justify-center gap-2"
          style={{ width: 'min(30vw, calc((100dvh - 200px) * 204 / 265))' }}
          aria-label="Card reader"
        >
          {readId && TRAINERS[readId] ? (
            <>
              <img src={trainerImg(readId)} alt={`${getTrainer(readId).name} card`} className="w-full rounded-lg shadow-2xl shadow-black/60" />
              <p className="text-center text-[11px] text-slate-400">
                Trainer: picked after the 8 Pokémon, the Attacker first. Its Special Move can be used once per game.
              </p>
            </>
          ) : readId ? (
            <>
              <CardImage id={readId} name={getCard(readId).name} className="shadow-2xl shadow-black/60" />
              <p className="text-center text-[11px] text-slate-400">
                {reading ? 'Last card you hovered.' : 'Pinned card.'} Click a card for its matchups and counters.
              </p>
            </>
          ) : (
            <div className="flex aspect-[204/265] w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
              Hover any card to read it here at full size.
            </div>
          )}
        </aside>
      )}
      </div>
      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <CardDetail card={detail} extra={<CounterLists card={detail} pool={pool.filter((c) => !takenBy.has(c.id))} onOpen={setDetail} />} />
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => setDetail(null)}>Close</button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => {
                setPinned(detail.id);
                setDetail(null);
              }}
            >
              Compare in grid
            </button>
            {mine && pickable.has(detail.id) && (
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => {
                  ctl.dispatch({ type: 'draftPick', cardId: detail.id });
                  setDetail(null);
                }}
              >
                Draft {detail.name}
              </button>
            )}
          </div>
        </Modal>
      )}
      {chart && <TypeChartModal onClose={() => setChart(false)} cards={pool} />}
    </div>
  );
}

/**
 * Trainer mode: the trainers on offer, as cards in a row of their own under the Pokémon pool (same
 * size). They are picked after the 8 Pokémon, the Attacker first; then the row is the one to pick from.
 */
function TrainerRow({ ids, fit, owner, pickable, active, onPick, onHover }: {
  ids: string[];
  fit: FitGrid | null;
  owner: (id: string) => Side | null;
  pickable: Set<string>;
  active: boolean;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  // Lined up with the pool's left edge (the pool grid is centred at its full width).
  const width = fit ? fit.cols * fit.width + (fit.cols - 1) * 8 : undefined;
  return (
    <div className="mx-auto mt-2" style={{ width }}>
      <div className={`mb-1 text-[11px] font-bold uppercase tracking-wide ${active ? 'text-amber-300' : 'text-slate-400'}`}>
        Trainers on offer{active ? ' · pick one' : ' · picked after the Pokémon, the Attacker first'}
      </div>
      <div
        className={fit ? 'grid justify-start gap-2' : 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-2'}
        style={fit ? { gridTemplateColumns: `repeat(${Math.min(fit.cols, ids.length)}, ${fit.width}px)` } : undefined}
        onMouseLeave={() => onHover(null)}
      >
        {ids.map((id) => {
          const taken = owner(id);
          return (
            <div key={id} onMouseEnter={() => onHover(id)} className={`relative flex flex-col gap-1 rounded-lg ${taken ? 'opacity-35' : active ? '' : 'opacity-75'}`}>
              <img src={trainerImg(id)} alt={`${getTrainer(id).name} card`} title={`${getTrainer(id).passive} · Special: ${getTrainer(id).special}`} className="block aspect-[204/265] w-full rounded-lg bg-slate-800 object-cover shadow-md shadow-black/40" />
              <div className="flex h-[22px] items-center justify-end gap-1 overflow-hidden">
                {pickable.has(id) && (
                  <button type="button" className="chip shrink-0 bg-amber-400 px-2 py-1 normal-case text-slate-950 hover:bg-amber-300" onClick={() => onPick(id)}>
                    Choose
                  </button>
                )}
              </div>
              {taken && (
                <span className={`absolute -top-2 right-2 chip ${taken === 'A' ? 'bg-rose-500' : 'bg-sky-500'} text-white shadow`}>
                  {taken === 'A' ? 'Attacker' : 'Defender'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
