import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  type Action, type CardDef, type PType, type Side, TEAM_SIZE, TRAINERS, TYPES, auctionOpen, bestHit, canBidFor, decider, deciders, draftStyle, draftOptions, getCard, getTrainer, isLegendPick,
  isTrainerPick, otherSide, secretNext,
} from '../../engine';
import { Art, CardImage, Modal, SIDE_TEXT, TypeBadge } from '../components/bits';
import { CoinIcon, SealedIcon } from '../components/icons';
import { CardDetail } from '../components/CardView';
import { CounterLists, MultChip, TypeChartModal, matchupTitle } from '../components/Matchups';
import { trainerImg } from '../components/Trainers';
import { sfx } from '../audio';
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
                <button type="button" className="btn-primary shrink-0 !rounded-md !px-2.5 !py-0.5 text-xs" onClick={() => onDraft(c)}>
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
        className="w-full rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-1.5 text-sm font-bold shadow-inner outline-none placeholder:font-medium focus:border-amber-400 sm:w-64"
      />
      <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border-2 border-slate-600 bg-slate-950 px-2 py-1.5 text-sm font-bold shadow-inner" aria-label="Sort cards">
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
  const style = draftStyle(s);
  const secret = style === 'secret';
  const auction = auctionOpen(s);
  // Secret draft: both sides pick at once, each from its own pool, so the screen is about one side
  // (yours; in hot-seat GameScreen hands this view one side at a time). Its state is already a hidden
  // view: the other side's picks and trainer read '?' and its pools are empty.
  const turn: Side = secret && ctl.mySides.length === 1 ? ctl.mySides[0] : decider(s)!;
  const pending = deciders(s);
  const mine = ctl.mySides.includes(turn) && pending.includes(turn);
  const secretStep = secret ? secretNext(s, turn) : null;
  const waiting = secret && ctl.mySides.includes(turn) && secretStep === null;
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [chart, setChart] = useState(false);
  // Phones: the search and sort row stays folded away until asked for.
  const [searching, setSearching] = useState(false);
  const takenBy = useMemo(() => {
    const m = new Map<string, Side>();
    for (const side of ['A', 'D'] as const) for (const id of s.draft.picks[side]) m.set(id, side);
    return m;
  }, [s.draft.picks]);
  // '?': a card hidden from this viewer (a spectator in a Secret draft sees neither side's pool).
  const normals = useMemo(() => (secret ? s.draft.secret!.pools[turn] : auction ? [] : s.draft.pool).filter((id) => id !== '?').map(getCard), [s.draft.pool, secret, auction, turn]); // eslint-disable-line react-hooks/exhaustive-deps
  const legends = useMemo(() => (secret ? s.draft.secret!.legendPools[turn] : auction ? [] : s.draft.legendPool).filter((id) => id !== '?').map(getCard), [s.draft.legendPool, secret, auction, turn]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useMemo(() => [...normals, ...legends], [normals, legends]);
  const secretTotal = TEAM_SIZE + (s.trainers ? 1 : 0);
  const pickNo = secret
    ? Math.min(secretTotal, s.draft.picks[turn].length + (s.trainers?.picks[turn] ? 1 : 0) + 1)
    : s.draft.index + 1;
  const pickOf = secret ? secretTotal : s.draft.order.length;
  const legendTurn = secret ? secretStep === 'legend' : isLegendPick(s);
  const trainerTurn = secret ? secretStep === 'trainer' : isTrainerPick(s);
  const pickable = new Set(draftOptions(s, secret ? turn : undefined));
  const pick = (cardId: string) => ctl.dispatch((secret ? { type: 'draftPick', cardId, side: turn } : { type: 'draftPick', cardId }) as Action);

  // Matchups are shown against the hovered or pinned card, or else against the opposing team.
  const focus = hovered ?? pinned;
  const focusCard = focus ? getCard(focus) : null;
  const rival: Side = ctl.mySides.length === 1 ? otherSide(ctl.mySides[0]) : otherSide(turn);
  const rivalPicks = s.draft.picks[rival].filter((id) => id !== '?').map(getCard);
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
  const draft = (c: CardDef) => pick(c.id);
  // A chime for every pick, whoever makes it.
  useEffect(() => {
    if (s.draft.index > 0) sfx('pick');
  }, [s.draft.index]);

  return (
    <div className="flex flex-col gap-2 wide:h-full wide:min-h-0">
      {/* Pinned on phones so whose pick it is stays in view while scrolling the cards. */}
      <div className="panel sticky top-0 z-20 flex shrink-0 flex-col gap-2.5 px-3 py-2.5 phone:gap-1.5 phone:px-2 phone:py-1.5 wide:static">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 phone:gap-x-2 phone:gap-y-1.5">
          {/* Takes the space left over, whatever its text: the text changes with the pick and with the card hovered, and must not push the teams’ medallions around. */}
          <div className="flex min-w-0 items-center gap-3 phone:flex-1 phone:gap-2 sm:flex-[1_1_10rem]">
            {auction ? (
              <div className="draft-seal" title={`Lot ${s.draft.auction!.history.length + 1}`}>
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#f2d27a]">Lot</span>
                <span className="font-display text-xl leading-none">{s.draft.auction!.history.length + 1}</span>
              </div>
            ) : (
              <div className="draft-seal" title={`Pick ${pickNo} of ${pickOf}`}>
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#f2d27a]">Pick</span>
                <span className="font-display text-xl leading-none">{pickNo}<span className="text-xs text-[#f2d27a]">/{pickOf}</span></span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className={`truncate font-display text-xl leading-tight phone:text-base ${SIDE_TEXT[turn]}`}>
                {waiting ? `Sealed! Waiting for ${ctl.names[otherSide(turn)]}…`
                  : auction ? (mine ? 'Your call!' : ctl.thinking ? `${ctl.names[turn]} is thinking…` : `${ctl.names[turn]}’s call…`)
                  : mine ? 'Your pick!' : ctl.thinking ? `${ctl.names[turn]} is thinking…` : `${ctl.names[turn]} is picking${secret ? ' in secret' : ''}…`}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden phone:mt-0">
                <span className="draft-phase shrink-0">
                  {waiting ? 'Revealed when the battle begins' : trainerTurn ? (secret ? 'Secret trainer pick' : 'Trainer pick') : auction ? 'Auction' : secret ? (legendTurn ? '★ Secret legendary pick' : 'Secret pick') : legendTurn ? '★ Legendary pick' : 'Pool pick'}
                </span>
                {focusCard && (
                  <span className="draft-phase min-w-0 !bg-[#f2d27a] !text-[#4a2b16]" title={`Comparing with ${focusCard.name}`}>
                    <span className="truncate">Comparing with {focusCard.name}</span>
                    {pinned && !hovered && (
                      <button type="button" className="ml-1 shrink-0 font-black" aria-label="Stop comparing" onClick={() => setPinned(null)}>✕</button>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`flex flex-wrap gap-x-5 gap-y-2 phone:order-3 phone:w-full phone:gap-1 ${auction ? '' : 'phone:flex-nowrap phone:justify-between'}`}>
          {(['A', 'D'] as const).map((side) => {
            const trainer = s.trainers?.picks[side] ?? null;
            const active = secret ? pending.includes(side) : turn === side;
            return (
              <div key={side} className={`draft-army ${side === 'A' ? 'draft-army-a' : 'draft-army-d'} ${active ? 'draft-army-active' : ''}`}>
                <span className="draft-sash" title={side === 'A' ? 'Attacker' : 'Defender'}>
                  <span className="phone:hidden">{side === 'A' ? 'Attacker' : 'Defender'}</span>
                  <span className="sm:hidden">{side}</span>
                </span>
                <div className="flex items-center gap-1.5 phone:gap-[3px]">
                  {[0, 1, 2, 3].map((i) => {
                    const id = s.draft.picks[side][i];
                    const next = active && !auction && s.draft.picks[side].length === i;
                    const legendSlot = i === 3 && s.draft.legendPool.length > 0 && !auction;
                    if (id === '?') {
                      return <span key={i} className="draft-medal draft-medal-empty !border-solid !text-[#8a1c15]" title="A secret pick">?</span>;
                    }
                    return id ? (
                      <button
                        key={i}
                        type="button"
                        title={`${getCard(id).name}: click to compare every card against it`}
                        onClick={() => setPinned(pinned === id ? null : id)}
                        onMouseEnter={() => onHover(id)}
                        onMouseLeave={() => onHover(null)}
                        className={`draft-medal ${pinned === id ? 'draft-medal-pinned' : ''}`}
                      >
                        <Art id={id} className="h-full w-full rounded-full" alt={getCard(id).name} />
                      </button>
                    ) : (
                      <span key={i} className={`draft-medal draft-medal-empty ${next ? 'draft-medal-next' : ''}`} title={legendSlot ? 'Legendary' : `Pick ${i + 1}`}>
                        {legendSlot ? '★' : i + 1}
                      </span>
                    );
                  })}
                  {auction && (
                    <span className="ml-1 flex items-center gap-1 rounded-full bg-[#4a2b16] px-2 py-1 font-display text-sm text-[#f2d27a] phone:ml-0.5 phone:px-1.5 phone:py-0 phone:text-xs" title="Coins left">
                      <CoinIcon className="h-5 w-5 phone:h-4 phone:w-4" />{s.draft.auction!.coins[side]}
                    </span>
                  )}
                  {s.trainers && (
                    trainer === '?' ? (
                      <span className="draft-trainer draft-medal-empty !border-solid !text-[#8a1c15]" title="A secret trainer">?</span>
                    ) : trainer ? (
                      <img src={trainerImg(trainer)} alt={getTrainer(trainer).name} title={getTrainer(trainer).name} className="draft-trainer" />
                    ) : (
                      <span className={`draft-trainer draft-medal-empty ${active && trainerTurn ? 'draft-medal-next' : ''}`} title="Trainer">T</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 phone:order-2">
            {!auction && (
              <button type="button" className={`btn-ghost relative !px-2 !py-1 text-xs sm:hidden ${searching ? '!border-[#a8261d]' : ''}`} onClick={() => setSearching((v) => !v)} aria-expanded={searching}>
                Search
                {filter.active && !searching && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#a8261d]" />}
              </button>
            )}
            <button type="button" className="btn-ghost shrink-0 phone:!px-2 phone:!py-1 phone:text-xs" onClick={() => setChart(true)}>
              Type chart
            </button>
          </div>
        </div>
        {!auction && <div className={`w-full border-t-2 border-dashed border-slate-700 pt-2 ${searching ? '' : 'phone:hidden'}`}>{filter.controls}</div>}
      </div>
      <div className="flex gap-3 wide:min-h-0 wide:flex-1">
      <div ref={setGridBox} className="min-w-0 flex-1">
        {auction && <AuctionBoard ctl={ctl} onRead={setReading} />}
        {waiting && (
          <div className="panel mb-2 flex items-center gap-3 p-3">
            <SealedIcon className="h-10 w-10 shrink-0" />
            <p className="text-sm font-bold text-slate-300">
              Your team is sealed. {ctl.names[otherSide(turn)]} is still picking from a pool you can’t see; both teams and trainers are revealed when the battle begins.
            </p>
          </div>
        )}
        {!auction && ordered.length === 0 && (
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
            onPick={pick}
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
                {secret ? 'Trainer: picked after your 4 Pokémon, in secret.' : 'Trainer: picked after the 8 Pokémon, the Attacker first.'} Its Special Move can be used once per game.
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
                  pick(detail.id);
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

/** Auction: the lot on offer, the standing bid, both sides' coins and the bid controls. */
function AuctionBoard({ ctl, onRead }: { ctl: Controller; onRead: (id: string) => void }) {
  const s = ctl.state;
  const a = s.draft.auction!;
  const lot = a.lot!;
  const card = getCard(lot);
  const turn = a.toAct;
  const mine = ctl.mySides.includes(turn);
  const min = a.high ? a.high.amount + 1 : 0;
  const max = a.coins[turn];
  const [amount, setAmount] = useState(min);
  useEffect(() => {
    setAmount(min);
    onRead(lot);
  }, [lot, min]); // eslint-disable-line react-hooks/exhaustive-deps
  const canAfford = max >= min;
  const bid = (n: number) => ctl.dispatch({ type: 'bid', amount: Math.max(min, Math.min(max, n)) });
  const blocked = (side: Side) => !canBidFor(s, side, lot);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="panel flex flex-col items-center gap-2 p-3">
        <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
          Lot {a.history.length + 1} · {a.deck.length} more to come
        </div>
        <CardImage id={lot} name={card.name} className="w-full max-w-[280px] shadow-xl phone:max-w-[190px]" />
        {card.legendary && <span className="chip bg-amber-400 text-slate-950">★ Legendary · one per team</span>}
      </div>
      <div className="panel space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          {(['A', 'D'] as const).map((side) => (
            <div key={side} className={`paper-inset flex items-center justify-between gap-2 p-2 ${a.high?.side === side ? '!border-[#d9ab45]' : ''}`}>
              <span className={`sash ${side === 'A' ? 'sash-a' : 'sash-d'}`}>
                <span className="phone:hidden">{side === 'A' ? 'Attacker' : 'Defender'}</span><span className="sm:hidden">{side === 'A' ? 'Atk' : 'Def'}</span>
              </span>
              <span className="flex items-center gap-1 font-display text-xl"><CoinIcon className="h-6 w-6" />{a.coins[side]}</span>
              <span className="text-xs font-bold text-slate-400">{s.draft.picks[side].length}/{TEAM_SIZE}</span>
            </div>
          ))}
        </div>
        <div className="text-center">
          <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Standing bid</div>
          <div className="font-display text-3xl">
            {a.high ? <span>{a.high.side === 'A' ? 'Attacker' : 'Defender'} · {a.high.amount} <CoinIcon className="inline h-7 w-7 align-[-4px]" /></span> : 'No bids yet'}
          </div>
          {(['A', 'D'] as const).filter(blocked).map((side) => (
            <div key={side} className="text-xs font-bold text-slate-400">
              The {side === 'A' ? 'Attacker' : 'Defender'} can’t bid ({s.draft.picks[side].length >= TEAM_SIZE ? 'team full' : 'already has a legendary'}).
            </div>
          ))}
        </div>
        {mine ? (
          <div className="space-y-2">
            {canAfford ? (
              <>
                <div className="flex items-center justify-center gap-2">
                  <button type="button" className="btn-ghost !px-3" disabled={amount <= min} onClick={() => setAmount((x) => Math.max(min, x - 1))}>−</button>
                  <span className="min-w-[4.5rem] text-center font-display text-3xl">{amount}</span>
                  <button type="button" className="btn-ghost !px-3" disabled={amount >= max} onClick={() => setAmount((x) => Math.min(max, x + 1))}>+</button>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {[1, 3, 5].map((d) => (
                    <button key={d} type="button" className="btn-ghost !py-1 text-xs" disabled={min + d - 1 > max} onClick={() => setAmount(Math.min(max, min + d - 1))}>
                      {a.high ? `+${d}` : d - 1}
                    </button>
                  ))}
                  <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setAmount(max)}>All in ({max})</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-primary py-2.5 font-display text-lg" onClick={() => bid(amount)}>Bid {amount}</button>
                  <button type="button" className="btn-ghost py-2.5 font-display text-lg" onClick={() => ctl.dispatch({ type: 'passBid' })}>Pass</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn-ghost w-full py-2.5 font-display text-lg" onClick={() => ctl.dispatch({ type: 'passBid' })}>
                Pass (you can’t outbid {a.high?.amount})
              </button>
            )}
            <p className="text-center text-xs font-bold text-slate-400">
              {a.high ? 'Pass and the high bidder wins it.' : 'Pass with no bid: the other side may still take it, or it leaves the auction.'} Run out of coins and the rest of your team is dealt at random.
            </p>
          </div>
        ) : (
          <div className="text-center text-sm font-bold text-slate-300">{ctl.thinking ? `${ctl.names[turn]} is thinking…` : `Waiting for ${ctl.names[turn]}…`}</div>
        )}
        {a.history.length > 0 && (
          <div className="border-t-2 border-dashed border-slate-700 pt-2">
            <div className="mb-1 text-xs font-extrabold uppercase tracking-widest text-slate-400">Lots so far</div>
            <div className="flex flex-wrap gap-1.5">
              {a.history.map((h, i) => (
                <span key={i} className={`flex items-center gap-1 rounded-full border-2 py-0.5 pl-0.5 pr-2 text-xs font-bold ${h.winner === 'A' ? 'border-[#c73a2e]' : h.winner === 'D' ? 'border-[#2f62b8]' : 'border-slate-600 opacity-60'}`} title={`${getCard(h.cardId).name}: ${h.winner ? `${h.winner === 'A' ? 'Attacker' : 'Defender'}${h.random ? ' (dealt at random)' : ` for ${h.price}`}` : 'nobody'}`}>
                  <Art id={h.cardId} className="h-6 w-6 rounded-full" alt={getCard(h.cardId).name} />
                  {h.random ? '🎲' : h.winner ? h.price : '—'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
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
        Trainers
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
