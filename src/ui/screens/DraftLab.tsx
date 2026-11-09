import { useEffect, useMemo, useState } from 'react';
import { decide } from '../../ai/bot';
import { type DraftAnalysis, type DraftModel, type PickBreakdown, analyzeDraft, analyzeTrainerPick, draftLogit, winChance } from '../../ai/draft';
import { GENERAL_MODEL, draftModelFor, modeSuffix } from '../../ai/draftModel';
import { type AuctionAnalysis, type SecretLine, analyzeAuction, analyzeSecretPick, analyzeSecretTrainer } from '../../ai/styles';
import {
  type Action, type CardDef, DRAFTABLE, DRAFT_POOL_SIZE, type DraftStyle, type GameState, MAP_LIST, NO_LEGEND_POOL_SIZE, PROC_PREFIX, type Side, TEAM_SIZE,
  TRAINER_LIST, applyAction, auctionOpen, canBidFor, decider, deciders, draftOptions, getCard, getMap, getTrainer, hiddenView, isLegendPick,
  isProcMapId, isTrainerPick, newGame, otherSide, randomLegendPool, randomPool, randomSeed, randomTrainerPool, secretNext, seededRng,
} from '../../engine';
import { Art, CardImage, SIDE_TEXT } from '../components/bits';
import { CoinIcon } from '../components/icons';
import { MapPreview, savedLegendaries, savedMapId, savedStyle, savedTrainers } from '../components/MapPicker';
import { trainerImg } from '../components/Trainers';
import { useCardFilter } from './DraftView';

const SIDE_LABEL: Record<Side, string> = { A: 'Attacker', D: 'Defender' };
const STYLE_LABEL: Record<DraftStyle, string> = { classic: 'Classic', secret: 'Secret', auction: 'Auction' };
const pct = (p: number): string => `${(100 * p).toFixed(1)}%`;
/** A side's win chance from the Attacker's logit. */
const forSide = (side: Side, logit: number): number => (side === 'A' ? winChance(logit) : 1 - winChance(logit));

interface Setup {
  mapId: string;
  style: DraftStyle;
  pool: string[];
  legendPool: string[];
  trainerPool: string[] | null;
  /** Deals the Secret pools and shuffles the Auction deck. */
  seed: number;
}

/**
 * A draft from scratch: the chosen map, style and pools (Secret deals its own from the seed), then the
 * actions so far (picks, bids, passes) replayed through the engine.
 */
function buildDraft(setup: Setup, actions: Action[]): GameState {
  const rng = seededRng(setup.style === 'classic' ? 1 : setup.seed);
  let s = newGame({
    rng, mapId: setup.mapId, pool: setup.pool, legendPool: setup.legendPool, legendaries: setup.legendPool.length > 0,
    trainers: !!setup.trainerPool, trainerPool: setup.trainerPool ?? undefined, style: setup.style,
  });
  for (const a of actions) s = applyAction(s, a, rng).state;
  return s;
}

/** Who the Lab is deciding for: the classic order, the side to call in an auction, or the Secret side on screen. */
function actingSide(s: GameState, view: Side): Side | null {
  if (s.phase !== 'draft') return null;
  if (s.draft.style === 'secret') return secretNext(s, view) ? view : deciders(s)[0] ?? null;
  return decider(s);
}

/** Classic: the rest of the draft as the model would play it (the predicted picks, then the trainer picks). */
function aiFinishClassic(s0: GameState, model: DraftModel): Action[] {
  const out: Action[] = [];
  let s = s0;
  for (let guard = 0; s.phase === 'draft' && guard < 12; guard++) {
    const ids = isTrainerPick(s) ? [analyzeTrainerPick(s, model).lines[0].id] : (() => {
      const best = analyzeDraft(s, model).lines[0];
      return [best.id, ...best.pv.map((x) => x.id)];
    })();
    for (const id of ids) {
      s = applyAction(s, { type: 'draftPick', cardId: id }, seededRng(1)).state;
      out.push({ type: 'draftPick', cardId: id });
    }
  }
  return out;
}

/**
 * Secret and Auction: the Hard bot's own moves (it sees only what a player would), one at a time, for
 * `steps` moves or to the end of the draft. Each step replays the draft, so random fills stay in step.
 */
function aiMoves(setup: Setup, actions: Action[], view: Side, steps: number): Action[] {
  const out: Action[] = [];
  const rng = seededRng(setup.seed ^ 0x5bd1);
  for (let i = 0; i < steps; i++) {
    const s = buildDraft(setup, [...actions, ...out]);
    const who = actingSide(s, view);
    if (!who) break;
    const a = decide(hiddenView(s, who), who, 'hard', rng)[0];
    if (!a) break;
    try {
      buildDraft(setup, [...actions, ...out, a]);
    } catch {
      break;
    }
    out.push(a);
  }
  return out;
}

/** Development only: `?screen=lab&style=secret|auction` opens the Lab in that style (for screenshots). */
function devStyle(): DraftStyle | null {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(location.search).get('style');
  return v === 'classic' || v === 'secret' || v === 'auction' ? v : null;
}

type Analysis =
  | { kind: 'classic'; s: GameState; a: DraftAnalysis }
  | { kind: 'secret'; s: GameState; side: Side; trainer: boolean; lines: SecretLine[] }
  | { kind: 'auction'; s: GameState; a: AuctionAnalysis };

/**
 * Draft analysis board: set up any map, style and pools, make moves for either side, and see how the
 * Hard bot rates every option — the same model and search it plays with.
 */
export function DraftLab({ onBack }: { onBack: () => void }) {
  const [mapId, setMapId] = useState(savedMapId);
  const [style, setStyle] = useState<DraftStyle>(() => devStyle() ?? savedStyle());
  const [legends, setLegends] = useState(savedLegendaries);
  const [pool, setPool] = useState<string[]>(() => randomPool(seededRng(randomSeed()), legends ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE));
  const [legendPool, setLegendPool] = useState<string[]>(() => randomLegendPool(seededRng(randomSeed())));
  const [trainers, setTrainers] = useState(savedTrainers);
  const [trainerPool, setTrainerPool] = useState<string[]>(() => randomTrainerPool(seededRng(randomSeed())));
  const [seed, setSeed] = useState(() => randomSeed());
  const [actions, setActions] = useState<Action[]>([]);
  const [view, setView] = useState<Side>('A');
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  // Without legendaries the draft has an empty legendary pool, so all eight picks come from the pool.
  const activeLegends = useMemo(() => (legends ? legendPool : []), [legends, legendPool]);
  const setup = useMemo<Setup>(() => ({ mapId, style, pool, legendPool: activeLegends, trainerPool: trainers ? trainerPool : null, seed }), [mapId, style, pool, activeLegends, trainers, trainerPool, seed]);
  const s = useMemo(() => buildDraft(setup, actions), [setup, actions]);
  const done = s.phase !== 'draft';
  const secret = style === 'secret';
  const auction = auctionOpen(s);
  const side = actingSide(s, view);
  const trainerTurn = !done && (secret ? side !== null && secretNext(s, side) === 'trainer' : isTrainerPick(s));
  // Secret: when the side on screen has finished, show the other one.
  useEffect(() => {
    if (secret && !done && !secretNext(s, view) && secretNext(s, otherSide(view))) setView(otherSide(view));
  }, [s, secret, done, view]);
  // One model for every map, mode and style (composed for this map and mode).
  const model = draftModelFor(mapId, modeSuffix(legends, trainers));

  // The search takes up to a few hundred ms; run it after paint. Each analysis is kept with the draft
  // it was made for, so a stale one is never shown for the next move.
  const [analysed, setAnalysis] = useState<Analysis | null>(null);
  const analysis = analysed && analysed.s === s ? analysed : null;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (done || editing || !side) {
      setAnalysis(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      if (secret) {
        const trainer = secretNext(s, side) === 'trainer';
        const r = trainer ? analyzeSecretTrainer(s, side, model) : analyzeSecretPick(s, side, model);
        setAnalysis({ kind: 'secret', s, side, trainer, lines: r.lines });
      } else if (auctionOpen(s)) {
        setAnalysis({ kind: 'auction', s, a: analyzeAuction(s, model) });
      } else if (isTrainerPick(s)) {
        // The trainer pick: every trainer on offer, valued by exact minimax over both trainer picks.
        const ta = analyzeTrainerPick(s, model);
        setAnalysis({ kind: 'classic', s, a: { side: ta.side, value: ta.lines[0].value, lines: ta.lines.map((l) => ({ id: l.id, value: l.value, pv: [], why: { card: 0, matchup: 0, synergy: 0, denial: 0 } })) } });
      } else {
        setAnalysis({ kind: 'classic', s, a: analyzeDraft(s, model, { all: true }) });
      }
      setBusy(false);
    }, 20);
    return () => clearTimeout(t);
  }, [s, model, done, editing, side, secret]);

  const classic = analysis?.kind === 'classic' ? analysis.a : null;
  const secretA = analysis?.kind === 'secret' ? analysis : null;
  const auctionA = analysis?.kind === 'auction' ? analysis.a : null;
  const lines: { id: string; value: number }[] = classic?.lines ?? secretA?.lines ?? [];
  const lineOf = new Map(lines.map((l, rank) => [l.id, { ...l, rank }]));
  const best = lines[0];
  const finalP = done ? winChance(draftLogit(model, s)) : null;
  const pA = finalP ?? (classic ? winChance(classic.value) : secretA && best ? winChance(best.value) : auctionA ? winChance(auctionA.predicted.value) : null);
  const outlook = done ? 'Final teams' : secret ? `${SIDE_LABEL[secretA?.side ?? view]}'s best vs likely opponents` : auction ? 'If both bid sensibly from here' : 'With best drafting from here';

  const act = (a: Action) => setActions((xs) => [...xs, a]);
  const pick = (id: string) => act(secret && side ? { type: 'draftPick', cardId: id, side } : { type: 'draftPick', cardId: id });
  const restart = () => setActions([]);
  const reset = (nextPool = pool, nextLegends = legendPool, nextTrainers = trainerPool) => {
    setPool(nextPool);
    setLegendPool(nextLegends);
    setTrainerPool(nextTrainers);
    setSeed(randomSeed());
    setView('A');
    restart();
  };
  // Without legendaries a match draws 20 Pokémon instead of 15: grow (or trim) the pool to match.
  const toggleLegends = () => {
    const on = !legends;
    const size = on ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE;
    const extra = randomPool(seededRng(randomSeed()), NO_LEGEND_POOL_SIZE + DRAFT_POOL_SIZE).filter((id) => !pool.includes(id));
    setLegends(on);
    reset(pool.length > size ? pool.slice(0, size) : [...pool, ...extra].slice(0, size), legendPool);
  };
  const aiPick = () => {
    if (style === 'classic') {
      if (best) pick(best.id);
    } else setActions((xs) => [...xs, ...aiMoves(setup, xs, view, 1)]);
  };
  const aiFinish = () => {
    if (style === 'classic') setActions((xs) => [...xs, ...aiFinishClassic(s, model)]);
    else setActions((xs) => [...xs, ...aiMoves(setup, xs, view, 400)]);
  };
  const options = new Set(side ? draftOptions(s, secret ? side : undefined) : []);

  // The pools on screen: the shared ones, or (Secret) the side on screen's own.
  const shownSide: Side = secret ? (side ?? view) : 'A';
  const groups: { key: 'legend' | 'normal'; ids: string[] }[] = secret
    ? [{ key: 'legend' as const, ids: s.draft.secret!.legendPools[shownSide] }, { key: 'normal' as const, ids: s.draft.secret!.pools[shownSide] }].filter((g) => g.ids.length > 0)
    : (legends ? [{ key: 'legend' as const, ids: legendPool }, { key: 'normal' as const, ids: pool }] : [{ key: 'normal' as const, ids: pool }]);
  const trainerIds = !s.trainers ? [] : secret ? s.draft.secret!.trainerPools?.[shownSide] ?? [] : trainerPool;
  const legendNow = !done && !trainerTurn && (secret ? side !== null && secretNext(s, side) === 'legend' : isLegendPick(s));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 pb-8 pt-3 sm:px-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onBack}>← Menu</button>
        <h2 className="mr-auto text-lg font-bold">Draft analysis</h2>
        <Segmented
          items={[...MAP_LIST.map((m) => ({ id: m.id, label: m.name })), { id: 'proc', label: 'Random field' }]}
          value={isProcMapId(mapId) ? 'proc' : mapId}
          onChange={(id) => {
            setMapId(id === 'proc' ? `${PROC_PREFIX}${randomSeed() % 100000}` : id);
            restart();
          }}
        />
        {isProcMapId(mapId) && (
          <button type="button" className="btn-ghost" title="Another generated layout" onClick={() => { setMapId(`${PROC_PREFIX}${randomSeed() % 100000}`); restart(); }}>New field</button>
        )}
        <Segmented
          items={(['classic', 'secret', 'auction'] as const).map((id) => ({ id, label: STYLE_LABEL[id] }))}
          value={style}
          onChange={(id) => {
            setStyle(id as DraftStyle);
            setEditing(false);
            setView('A');
            restart();
          }}
        />
        <button type="button" aria-pressed={legends} className={legends ? 'btn-ghost' : 'btn bg-amber-400 text-slate-950'} onClick={toggleLegends}>
          {legends ? 'With legendaries' : 'No legendaries'}
        </button>
        <button
          type="button"
          aria-pressed={trainers}
          className={trainers ? 'btn bg-amber-400 text-slate-950' : 'btn-ghost'}
          title="Trainer mode: after the Pokémon, each side takes a trainer"
          onClick={() => {
            setTrainers((x) => !x);
            restart();
          }}
        >
          {trainers ? 'With trainers' : 'No trainers'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => reset(randomPool(seededRng(randomSeed()), legends ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE), randomLegendPool(seededRng(randomSeed())), randomTrainerPool(seededRng(randomSeed())))}>New random pools</button>
        <button type="button" className={editing ? 'btn-primary' : 'btn-ghost'} disabled={secret} title={secret ? 'Secret pools are dealt at random: use New random pools' : undefined} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done editing' : 'Edit pools'}
        </button>
        <button type="button" className="btn-ghost" disabled={!actions.length} onClick={() => setActions((xs) => xs.slice(0, -1))}>Undo</button>
        <button type="button" className="btn-ghost" disabled={!actions.length} onClick={restart}>Restart draft</button>
        <button type="button" className="btn-ghost" disabled={done || busy || (style === 'classic' && !best)} onClick={aiPick}>{auction ? 'AI call' : 'AI pick'}</button>
        <button type="button" className="btn-ghost" disabled={done || busy || (style === 'classic' && !best)} onClick={aiFinish}>AI finishes</button>
      </header>

      {editing && !secret ? (
        <PoolEditor pool={pool} legendPool={legendPool} legends={legends} trainerPool={trainers ? trainerPool : null} onChange={(p, l, t2) => reset(p, l, t2 ?? trainerPool)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-3">
            {secret && !done && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-400">Pool on screen:</span>
                {(['A', 'D'] as const).map((x) => {
                  const next = secretNext(s, x);
                  return (
                    <button key={x} type="button" aria-pressed={view === x} onClick={() => setView(x)} className={`btn !py-1.5 text-xs ${view === x ? 'bg-amber-400 text-slate-950' : 'btn-ghost'}`}>
                      {SIDE_LABEL[x]}’s {next ? `(${next === 'trainer' ? 'trainer next' : next === 'legend' ? 'legendary next' : `${s.draft.picks[x].length}/${TEAM_SIZE} picked`})` : '(done)'}
                    </button>
                  );
                })}
                <span className="text-[11px] text-slate-400">Both sides pick at once, each from its own pool, without seeing the other’s.</span>
              </div>
            )}
            {auction && <LabAuction s={s} analysis={auctionA} onAct={act} onHover={setHover} />}
            {!auction && groups.map((group) => {
              const active = !done && !trainerTurn && legendNow === (group.key === 'legend');
              return (
                <div key={group.key} className={active ? '' : 'opacity-70'}>
                  <h3 className={`mb-1.5 text-sm font-bold ${group.key === 'legend' ? 'text-amber-300' : 'text-slate-200'}`}>
                    {group.key === 'legend' ? (secret ? 'Legendary options' : 'Legendaries') : style === 'auction' ? 'Pokémon in the auction' : 'Pokémon'}
                  </h3>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2" onMouseLeave={() => setHover(null)}>
                    {group.ids.map((id) => {
                      const owner = s.draft.picks.A.includes(id) ? 'A' : s.draft.picks.D.includes(id) ? 'D' : null;
                      const line = lineOf.get(id);
                      const can = options.has(id) && !trainerTurn;
                      const pSide = line && side ? forSide(side, line.value) : null;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!can}
                          onClick={() => pick(id)}
                          onMouseEnter={() => setHover(id)}
                          className={`relative rounded-lg text-left transition enabled:hover:-translate-y-0.5 ${line?.rank === 0 ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950' : ''} ${owner ? 'opacity-40' : ''}`}
                          title={can ? `Pick ${getCard(id).name} for the ${side ? SIDE_LABEL[side] : ''}` : getCard(id).name}
                        >
                          <CardImage id={id} name={getCard(id).name} />
                          {owner && <span className={`absolute -top-2 right-2 chip ${owner === 'A' ? 'bg-rose-500' : 'bg-sky-500'} text-white shadow`}>{SIDE_LABEL[owner]}</span>}
                          {line && pSide !== null && (
                            <span className={`absolute -top-2 left-2 chip shadow ${line.rank === 0 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-100'}`}>
                              #{line.rank + 1} · {pct(pSide)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {trainerIds.length > 0 && (
              <div className={trainerTurn ? '' : 'opacity-70'}>
                <h3 className="mb-1.5 text-sm font-bold text-amber-300">{secret ? 'Trainer options' : 'Trainers'}</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                  {trainerIds.map((id) => {
                    const owner = s.trainers?.picks.A === id ? 'A' : s.trainers?.picks.D === id ? 'D' : null;
                    const line = trainerTurn ? lineOf.get(id) : undefined;
                    const can = trainerTurn && options.has(id);
                    const pSide = line && side ? forSide(side, line.value) : null;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={!can}
                        onClick={() => pick(id)}
                        className={`relative rounded-lg text-left transition enabled:hover:-translate-y-0.5 ${line?.rank === 0 ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950' : ''} ${owner ? 'opacity-40' : ''}`}
                        title={`${getTrainer(id).name}: ${getTrainer(id).passive} Special: ${getTrainer(id).special}`}
                      >
                        <img src={trainerImg(id)} alt={`${getTrainer(id).name} card`} className="block aspect-[204/265] w-full rounded-lg bg-slate-800 object-cover shadow-md shadow-black/40" />
                        {owner && <span className={`absolute -top-2 right-2 chip ${owner === 'A' ? 'bg-rose-500' : 'bg-sky-500'} text-white shadow`}>{SIDE_LABEL[owner]}</span>}
                        {line && pSide !== null && (
                          <span className={`absolute -top-2 left-2 chip shadow ${line.rank === 0 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-100'}`}>
                            #{line.rank + 1} · {pct(pSide)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-3 xl:sticky xl:top-3 xl:self-start">
            <div className="panel space-y-3 p-3">
              <div className="flex items-center gap-3">
                <MapPreview map={getMap(mapId)} className="max-w-[220px]" />
                {isProcMapId(mapId) && <span className="text-xs font-bold text-slate-400">{getMap(mapId).name}: a generated layout. The model has never seen it; it reads the map’s traits.</span>}
              </div>
              <OutcomeBar pA={pA} busy={busy} label={outlook} />
              <Teams s={s} legends={legends && style !== 'auction'} />
            </div>

            {hover && !trainerTurn && (
              <div className="panel hidden p-2 xl:block">
                <CardImage id={hover} name={getCard(hover).name} className="mx-auto max-w-[300px]" />
              </div>
            )}

            {!done && side && (classic || secretA) && (
              <div className="panel space-y-2 p-3">
                <div className={`font-bold ${SIDE_TEXT[side]}`}>
                  {secret
                    ? `${SIDE_LABEL[side]} · secret ${trainerTurn ? 'trainer pick' : legendNow ? 'legendary pick' : `pick ${s.draft.picks[side].length + 1} of ${TEAM_SIZE}`}`
                    : `Pick ${s.draft.index + 1} of ${s.draft.order.length} · ${SIDE_LABEL[side]} to pick${trainerTurn ? ' a trainer' : isLegendPick(s) ? ' a legendary' : ''}`}
                </div>
                <p className="text-[11px] leading-snug text-slate-400">
                  {secret
                    ? trainerTurn
                      ? `Each trainer with the ${SIDE_LABEL[side]}'s finished team, against the same likely opponents: its value plus how well its passive suits the team (the part that doesn't depend on the unseen opponent).`
                      : `The ${SIDE_LABEL[side]} can't see the other pool, so each option is valued by the best whole team it leads to, on average against 40 likely opponent teams (random pools of the cards it can't see, each drafted for strength). No denial: nobody else picks from this pool.`
                    : trainerTurn
                      ? `Each trainer's win chance with the final teams, if the ${side === 'A' ? 'Defender then takes the best of the rest for them' : 'Attacker keeps their trainer'}: its value for the ${SIDE_LABEL[side]} plus how well its passive suits the team.`
                      : `Each option's win chance assumes both sides draft as well as the model knows from then on${trainers ? ', trainer picks included' : ''}; that is what the ranking uses. The chips explain it in percentage points for the ${SIDE_LABEL[side]}, each against nobody taking the card: the card itself, type matchups with the opponent's picks so far, learned synergy, and what the opponent would gain by taking it.`}
                </p>
                <div className="space-y-1">
                  {(classic?.lines ?? secretA?.lines ?? []).map((l, rank) => {
                    const pSide = forSide(side, l.value);
                    const bestP = forSide(side, (classic ? classic.value : best?.value) ?? 0);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => pick(l.id)}
                        onMouseEnter={() => setHover(l.id)}
                        className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition hover:bg-slate-800 ${rank === 0 ? 'bg-emerald-500/10 ring-1 ring-emerald-400/60' : 'bg-slate-900/60'}`}
                      >
                        <span className="w-5 text-right text-xs font-bold text-slate-400">{rank + 1}</span>
                        {trainerTurn ? (
                          <img src={trainerImg(l.id)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover object-top" />
                        ) : (
                          <Art id={l.id} className="h-8 w-8 shrink-0 rounded-full" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{trainerTurn ? getTrainer(l.id).name : getCard(l.id).name}</span>
                            <span className="shrink-0 text-sm font-bold tabular-nums">
                              {pct(pSide)}
                              {rank > 0 && <span className="ml-1 text-[11px] font-medium text-rose-300">{(100 * (pSide - bestP)).toFixed(1)}</span>}
                            </span>
                          </div>
                          {trainerTurn ? (
                            <p className="truncate text-[10px] text-slate-400">{getTrainer(l.id).passive}</p>
                          ) : 'why' in l ? (
                            <Breakdown why={(l as { why: PickBreakdown }).why} p={bestP} />
                          ) : (l as SecretLine).team.length > 1 ? (
                            <p className="truncate text-[10px] text-slate-400">then {(l as SecretLine).team.slice(1).map((x) => getCard(x).name).join(', ')}</p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {classic && classic.lines[0] && classic.lines[0].pv.length > 0 && (
                  <div className="border-t border-slate-700 pt-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Predicted rest of the draft after {getCard(classic.lines[0].id).name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {classic.lines[0].pv.map((x, i) => (
                        <span key={i} className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-semibold ${x.side === 'A' ? 'bg-rose-500/20 text-rose-200' : 'bg-sky-500/20 text-sky-200'}`}>
                          <Art id={x.id} className="h-5 w-5 rounded-full" />
                          {getCard(x.id).name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!done && auctionA && auction && <AuctionReadout s={s} a={auctionA} />}

            <p className="px-1 text-[11px] leading-snug text-slate-500">
              Estimates come from the Hard bot’s general draft model: one model for every map, mode and draft style, here set for{' '}
              {getMap(mapId).name} ({legends ? 'with' : 'without'} legendaries, {trainers ? 'with' : 'without'} trainers). It learned from{' '}
              {GENERAL_MODEL.games.toLocaleString()} self-play games with random teams on Meadow, River and generated fields. The style only changes the search on top:
              {style === 'classic' ? ' exact minimax over the remaining picks.' : style === 'secret' ? ' the best own team against likely unseen opponents.' : ' how much each lot is worth, from playing the rest of the auction out many times.'}{' '}
              They measure how teams fare when both sides are played by the Hard bot, not a guarantee against people.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

/** A row of exclusive choices (map, style). */
function Segmented({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
      {items.map((m) => (
        <button key={m.id} type="button" aria-pressed={value === m.id} onClick={() => onChange(m.id)} className={`btn !py-1.5 text-xs ${value === m.id ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Auction: the lot on offer and the calls for whichever side is to act. */
function LabAuction({ s, analysis, onAct, onHover }: { s: GameState; analysis: AuctionAnalysis | null; onAct: (a: Action) => void; onHover: (id: string | null) => void }) {
  const a = s.draft.auction!;
  const lot = a.lot!;
  const turn = a.toAct;
  const min = a.high ? a.high.amount + 1 : 0;
  const max = a.coins[turn];
  const [amount, setAmount] = useState(min);
  useEffect(() => setAmount(min), [lot, min]);
  const canAfford = max >= min;
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="panel flex flex-col items-center gap-2 p-3" onMouseEnter={() => onHover(lot)} onMouseLeave={() => onHover(null)}>
        <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Lot {a.history.length + 1} · {a.deck.length} more to come</div>
        <CardImage id={lot} name={getCard(lot).name} className="w-full max-w-[240px]" />
        {getCard(lot).legendary && <span className="chip bg-amber-400 text-slate-950">★ Legendary · one per team</span>}
      </div>
      <div className="panel space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          {(['A', 'D'] as const).map((x) => (
            <div key={x} className={`paper-inset flex items-center justify-between gap-2 p-2 ${a.high?.side === x ? '!border-[#d9ab45]' : ''}`}>
              <span className={`text-sm font-bold ${SIDE_TEXT[x]}`}>{SIDE_LABEL[x]}</span>
              <span className="flex items-center gap-1 font-display text-lg"><CoinIcon className="h-5 w-5" />{a.coins[x]}</span>
              {analysis && (
                <span className="text-[11px] font-bold text-slate-400" title="The most the Hard bot would bid for this lot on this side">
                  {analysis.reserve[x] < 0 ? (canBidFor(s, x, lot) ? 'won’t bid' : 'can’t bid') : `max ${analysis.reserve[x]}`}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="text-center">
          <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Standing bid</div>
          <div className="font-display text-2xl">{a.high ? `${SIDE_LABEL[a.high.side]} · ${a.high.amount}` : 'No bids yet'}</div>
        </div>
        <div className="space-y-2">
          <div className={`text-center text-sm font-bold ${SIDE_TEXT[turn]}`}>{SIDE_LABEL[turn]} to call</div>
          {canAfford ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-ghost !px-3" disabled={amount <= min} onClick={() => setAmount((x) => Math.max(min, x - 1))}>−</button>
              <span className="min-w-[3rem] text-center font-display text-2xl">{amount}</span>
              <button type="button" className="btn-ghost !px-3" disabled={amount >= max} onClick={() => setAmount((x) => Math.min(max, x + 1))}>+</button>
              <button type="button" className="btn-primary" onClick={() => onAct({ type: 'bid', amount: Math.max(min, Math.min(max, amount)) })}>Bid {amount}</button>
              <button type="button" className="btn-ghost" onClick={() => onAct({ type: 'passBid' })}>Pass</button>
            </div>
          ) : (
            <button type="button" className="btn-ghost w-full" onClick={() => onAct({ type: 'passBid' })}>Pass (can’t outbid {a.high?.amount})</button>
          )}
        </div>
        {a.history.length > 0 && (
          <div className="border-t-2 border-dashed border-slate-700 pt-2">
            <div className="mb-1 text-xs font-extrabold uppercase tracking-widest text-slate-400">Lots so far</div>
            <div className="flex flex-wrap gap-1.5">
              {a.history.map((h, i) => (
                <span key={i} className={`flex items-center gap-1 rounded-full border-2 py-0.5 pl-0.5 pr-2 text-xs font-bold ${h.winner === 'A' ? 'border-[#c73a2e]' : h.winner === 'D' ? 'border-[#2f62b8]' : 'border-slate-600 opacity-60'}`}
                  title={`${getCard(h.cardId).name}: ${h.winner ? `${SIDE_LABEL[h.winner]}${h.random ? ' (dealt at random)' : ` for ${h.price}`}` : 'nobody'}`}>
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

/** Auction: what the lot is worth to each side, and where open bidding between them would end. */
function AuctionReadout({ s, a }: { s: GameState; a: AuctionAnalysis }) {
  const lot = s.draft.auction!.lot!;
  const name = getCard(lot).name;
  const p = a.predicted;
  return (
    <div className="panel space-y-2 p-3">
      <div className="font-bold">Lot {s.draft.auction!.history.length + 1} · {name}</div>
      <p className="text-[11px] leading-snug text-slate-400">
        The Hard bot plays the rest of the auction out 32 times (unseen lots drawn from the cards not yet shown, both sides bidding by card value) and scores the final teams.
        A side’s limit is the highest price at which taking {name} still beats letting the other side have it at that price.
      </p>
      <div className="space-y-1 text-sm">
        {(['A', 'D'] as const).map((x) => (
          <div key={x} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 p-1.5">
            <span className={`font-semibold ${SIDE_TEXT[x]}`}>{SIDE_LABEL[x]}</span>
            <span className="tabular-nums">
              {a.reserve[x] < 0 ? (canBidFor(s, x, lot) ? 'not worth a bid' : 'can’t take it') : <>bids up to <b>{a.reserve[x]}</b></>}
              {canBidFor(s, x, lot) && <span className="ml-2 text-[11px] text-slate-400">if it got it free: {pct(forSide(x, a.ifTaken[x]))}</span>}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 p-1.5">
          <span className="font-semibold text-slate-300">Nobody takes it</span>
          <span className="tabular-nums text-[11px] text-slate-400">Attacker {pct(winChance(a.ifNobody))}</span>
        </div>
      </div>
      <div className="rounded-lg bg-emerald-500/10 p-2 text-sm ring-1 ring-emerald-400/60">
        {p.winner ? (
          <>Predicted: <b className={SIDE_TEXT[p.winner]}>{SIDE_LABEL[p.winner]}</b> takes {name} for <b>{p.price}</b>{' '}</>
        ) : <>Predicted: nobody bids for {name}{' '}</>}
        <span className="text-slate-400">· Attacker {pct(winChance(p.value))} after the rest of the auction</span>
      </div>
    </div>
  );
}

function OutcomeBar({ pA, busy, label }: { pA: number | null; busy: boolean; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-semibold">
        <span className="text-rose-300">Attacker {pA !== null ? pct(pA) : '…'}</span>
        <span className="text-center text-slate-400">{busy ? 'Analysing…' : label}</span>
        <span className="text-sky-300">{pA !== null ? pct(1 - pA) : '…'} Defender</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
        <div className="bg-rose-500 transition-all duration-500" style={{ width: `${100 * (pA ?? 0.5)}%` }} />
        <div className="flex-1 bg-sky-500" />
      </div>
    </div>
  );
}

function Teams({ s, legends }: { s: GameState; legends: boolean }) {
  const pending = s.phase === 'draft' ? deciders(s) : [];
  return (
    <div className="space-y-1.5">
      {(['A', 'D'] as const).map((side) => {
        const trainer = s.trainers?.picks[side];
        return (
          <div key={side} className="flex items-center gap-1.5">
            <span className={`w-16 text-xs font-bold ${SIDE_TEXT[side]}`}>{SIDE_LABEL[side]}</span>
            {[0, 1, 2, 3].map((i) => {
              const id = s.draft.picks[side][i];
              return id ? (
                <Art key={i} id={id} className={`h-9 w-9 rounded-full ring-2 ${side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} alt={getCard(id).name} />
              ) : (
                <span key={i} className={`flex h-9 w-9 items-center justify-center rounded-full border border-dashed text-[10px] ${pending.includes(side) && s.draft.picks[side].length === i ? 'border-amber-300 text-amber-300' : 'border-slate-600 text-slate-500'}`}>
                  {i === 3 && legends ? 'L' : i + 1}
                </span>
              );
            })}
            {s.trainers && (trainer ? (
              <img src={trainerImg(trainer)} alt={getTrainer(trainer).name} title={getTrainer(trainer).name} className={`h-9 w-7 rounded object-cover object-top ring-2 ${side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} />
            ) : (
              <span className="flex h-9 w-7 items-center justify-center rounded border border-dashed border-slate-600 text-[10px] text-slate-500">T</span>
            ))}
            {s.draft.auction && (
              <span className="ml-auto flex items-center gap-1 text-sm font-bold"><CoinIcon className="h-4 w-4" />{s.draft.auction.coins[side]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Percentage-point contributions for the picking side (linearised around the current estimate). */
function Breakdown({ why, p }: { why: PickBreakdown; p: number }) {
  const k = p * (1 - p) * 100;
  const parts: [string, number][] = [['card', why.card], ['matchups', why.matchup], ['synergy', why.synergy], ['denial', why.denial]];
  return (
    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] tabular-nums">
      {parts.filter(([, v]) => Math.abs(v * k) >= 0.05).map(([label, v]) => (
        <span key={label} className={`rounded px-1 ${v > 0 ? 'bg-emerald-600/30 text-emerald-200' : 'bg-rose-600/30 text-rose-200'}`}>
          {label} {v > 0 ? '+' : ''}{(v * k).toFixed(1)}
        </span>
      ))}
    </div>
  );
}

/** Choose exactly which cards are in this draft's pools. */
function PoolEditor({ pool, legendPool, legends, trainerPool, onChange }: {
  pool: string[];
  legendPool: string[];
  legends: boolean;
  /** Trainers on offer (trainer mode), or null. */
  trainerPool: string[] | null;
  onChange: (pool: string[], legends: string[], trainers?: string[]) => void;
}) {
  const toggle = (c: CardDef) => {
    const list = c.legendary ? legendPool : pool;
    const next = list.includes(c.id) ? list.filter((x) => x !== c.id) : [...list, c.id];
    if (c.legendary) onChange(pool, next);
    else onChange(next, legendPool);
  };
  const minPool = legends ? 6 : 8;
  const ok = pool.length >= minPool && (!legends || legendPool.length >= 2);
  const filter = useCardFilter(DRAFTABLE);
  const [only, setOnly] = useState<'all' | 'in' | 'out'>('all');
  const shown = filter.cards.filter((c) => {
    const inPool = (c.legendary ? legendPool : pool).includes(c.id);
    return only === 'all' || (only === 'in') === inPool;
  });
  return (
    <div className="space-y-3">
      {trainerPool && (
        <div className="panel space-y-2 px-3 py-2">
          <div className="text-sm">
            Trainers <b className={trainerPool.length >= 2 ? 'text-emerald-300' : 'text-rose-300'}>{trainerPool.length}</b>
            <span className="text-slate-400"> (a normal game offers 4; at least 2). Click to add or remove.</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {TRAINER_LIST.map((t) => {
              const on = trainerPool.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  title={`${t.name}: ${t.passive}`}
                  onClick={() => {
                    const next = on ? trainerPool.filter((x) => x !== t.id) : [...trainerPool, t.id];
                    if (next.length >= 2) onChange(pool, legendPool, next);
                  }}
                  className={`relative rounded-lg transition ${on ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950' : 'opacity-40 hover:opacity-80'}`}
                >
                  <img src={trainerImg(t.id)} alt={`${t.name} card`} className="w-full rounded-lg" />
                  {on && <span className="absolute -top-2 right-2 chip bg-amber-400 text-slate-950 shadow">On offer</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="panel space-y-2 px-3 py-2">
        {filter.controls}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400">Show</span>
          {(['all', 'in', 'out'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)} className={`chip ${only === k ? 'bg-amber-400 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
              {k === 'all' ? 'All cards' : k === 'in' ? 'In the pool' : 'Not in the pool'}
            </button>
          ))}
        </div>
      </div>
      <div className="panel flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
        <span>Pool: <b className={pool.length >= minPool ? 'text-emerald-300' : 'text-rose-300'}>{pool.length}</b> Pokémon (a normal game has {legends ? 15 : 20}; at least {minPool})</span>
        {legends && <span>Legendaries: <b className={legendPool.length >= 2 ? 'text-emerald-300' : 'text-rose-300'}>{legendPool.length}</b> (a normal game has 4; at least 2)</span>}
        {!ok && <span className="text-rose-300">Add more cards to analyse a full draft.</span>}
        <span className="text-slate-400">Click cards to add or remove them. Changing the pools restarts the draft.</span>
      </div>
      {(legends ? (['legend', 'normal'] as const) : (['normal'] as const)).map((group) => (
        <div key={group}>
          <h3 className="mb-1.5 text-sm font-bold text-slate-200">{group === 'legend' ? 'LEGENDARIES' : 'POKÉMON'}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
            {shown.filter((c) => c.legendary === (group === 'legend')).map((c) => {
              const inPool = (c.legendary ? legendPool : pool).includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggle(c)} aria-pressed={inPool} className={`relative rounded-lg transition ${inPool ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950' : 'opacity-40 hover:opacity-80'}`}>
                  <CardImage id={c.id} name={c.name} />
                  {inPool && <span className="absolute -top-2 right-2 chip bg-amber-400 text-slate-950 shadow">In pool</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
