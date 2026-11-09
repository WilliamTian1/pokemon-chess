import { useEffect, useMemo, useState } from 'react';
import { type DraftAnalysis, type DraftModel, type PickBreakdown, analyzeDraft, analyzeTrainerPick, draftLogit, winChance } from '../../ai/draft';
import { draftModelFor, modeSuffix } from '../../ai/draftModel';
import {
  type CardDef, DRAFTABLE, DRAFT_POOL_SIZE, type GameState, MAP_LIST, NO_LEGEND_POOL_SIZE, type Side, TRAINER_LIST, applyAction,
  draftOptions, getCard, getMap, getTrainer, isLegendPick, isTrainerPick, newGame, randomLegendPool, randomPool, randomSeed,
  randomTrainerPool, seededRng,
} from '../../engine';
import { Art, CardImage, SIDE_TEXT } from '../components/bits';
import { MapPreview, savedLegendaries, savedMapId, savedTrainers } from '../components/MapPicker';
import { trainerImg } from '../components/Trainers';
import { useCardFilter } from './DraftView';

const SIDE_LABEL: Record<Side, string> = { A: 'Attacker', D: 'Defender' };
const pct = (p: number): string => `${(100 * p).toFixed(1)}%`;

/**
 * A draft from scratch: chosen map and pools (and trainers on offer, in trainer mode), then the picks
 * made so far (replayed through the engine).
 */
function buildDraft(mapId: string, pool: string[], legendPool: string[], trainerPool: string[] | null, picks: string[]): GameState {
  const rng = seededRng(1);
  let s = newGame({ rng, mapId, pool, legendPool, trainerPool: trainerPool ?? undefined });
  for (const cardId of picks) s = applyAction(s, { type: 'draftPick', cardId }, rng).state;
  return s;
}

/** The rest of the draft as the model would play it: the predicted Pokémon picks, then the trainer picks. */
function aiFinish(s0: GameState, model: DraftModel): string[] {
  const out: string[] = [];
  let s = s0;
  for (let guard = 0; s.phase === 'draft' && guard < 12; guard++) {
    const ids = isTrainerPick(s) ? [analyzeTrainerPick(s, model).lines[0].id] : (() => {
      const best = analyzeDraft(s, model).lines[0];
      return [best.id, ...best.pv.map((x) => x.id)];
    })();
    for (const id of ids) {
      s = applyAction(s, { type: 'draftPick', cardId: id }, seededRng(1)).state;
      out.push(id);
    }
  }
  return out;
}

/**
 * Draft analysis board: set up any pools, make picks for either side, and see how the Hard bot's
 * draft model rates every option — the same search the bot drafts with.
 */
export function DraftLab({ onBack }: { onBack: () => void }) {
  const [mapId, setMapId] = useState(savedMapId);
  const [legends, setLegends] = useState(savedLegendaries);
  const [pool, setPool] = useState<string[]>(() => randomPool(seededRng(randomSeed()), legends ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE));
  const [legendPool, setLegendPool] = useState<string[]>(() => randomLegendPool(seededRng(randomSeed())));
  const [trainers, setTrainers] = useState(savedTrainers);
  const [trainerPool, setTrainerPool] = useState<string[]>(() => randomTrainerPool(seededRng(randomSeed())));
  const [picks, setPicks] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  // Without legendaries the draft has an empty legendary pool, so all eight picks come from the pool.
  const activeLegends = useMemo(() => (legends ? legendPool : []), [legends, legendPool]);
  const s = useMemo(() => buildDraft(mapId, pool, activeLegends, trainers ? trainerPool : null, picks), [mapId, pool, activeLegends, trainers, trainerPool, picks]);
  const done = s.phase !== 'draft';
  const trainerTurn = !done && isTrainerPick(s);
  // The model for this mode (legendaries on or off, trainers on or off); until a mode's own model is
  // trained, the map's default stands in.
  const model = draftModelFor(mapId, modeSuffix(legends, trainers));
  const modeTrained = draftModelFor(mapId, modeSuffix(legends, trainers)) !== draftModelFor(mapId) || modeSuffix(legends, trainers) === '';

  // The search takes up to a few hundred ms at the first pick; run it after paint.
  // Each analysis is kept with the draft it was made for, so a stale one is never shown for the next pick.
  const [analysed, setAnalysis] = useState<{ s: GameState; a: DraftAnalysis } | null>(null);
  const analysis = analysed && analysed.s === s ? analysed.a : null;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (done || editing) {
      setAnalysis(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      if (isTrainerPick(s)) {
        // The trainer pick: every trainer on offer, valued by exact minimax over both trainer picks.
        const ta = analyzeTrainerPick(s, model);
        setAnalysis({ s, a: { side: ta.side, value: ta.lines[0].value, lines: ta.lines.map((l) => ({ id: l.id, value: l.value, pv: [], why: { card: 0, matchup: 0, synergy: 0, denial: 0 } })) } });
      } else {
        setAnalysis({ s, a: analyzeDraft(s, model, { all: true }) });
      }
      setBusy(false);
    }, 20);
    return () => clearTimeout(t);
  }, [s, model, done, editing]);

  const finalP = done ? winChance(draftLogit(model, s)) : null;
  const pA = finalP ?? (analysis ? winChance(analysis.value) : null);
  const side = done ? null : s.draft.order[s.draft.index];
  const lineOf = new Map(analysis?.lines.map((l, rank) => [l.id, { ...l, rank }]) ?? []);
  const pick = (id: string) => setPicks((p) => [...p, id]);
  const reset = (nextPool = pool, nextLegends = legendPool, nextTrainers = trainerPool) => {
    setPool(nextPool);
    setLegendPool(nextLegends);
    setTrainerPool(nextTrainers);
    setPicks([]);
  };
  // Without legendaries a match draws 20 Pokémon instead of 15: grow (or trim) the pool to match.
  const toggleLegends = () => {
    const on = !legends;
    const size = on ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE;
    const extra = randomPool(seededRng(randomSeed()), NO_LEGEND_POOL_SIZE + DRAFT_POOL_SIZE).filter((id) => !pool.includes(id));
    setLegends(on);
    reset(pool.length > size ? pool.slice(0, size) : [...pool, ...extra].slice(0, size), legendPool);
  };
  const options = new Set(draftOptions(s));
  const best = analysis?.lines[0];

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 pb-8 pt-3 sm:px-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onBack}>← Menu</button>
        <h2 className="mr-auto text-lg font-bold">Draft analysis</h2>
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
          {MAP_LIST.map((m) => (
            <button key={m.id} type="button" onClick={() => { setMapId(m.id); setPicks([]); }} className={`btn !py-1.5 text-xs ${mapId === m.id ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>
              {m.name}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={legends} className={legends ? 'btn-ghost' : 'btn bg-amber-400 text-slate-950'} onClick={toggleLegends}>
          {legends ? 'With legendaries' : 'No legendaries'}
        </button>
        <button
          type="button"
          aria-pressed={trainers}
          className={trainers ? 'btn bg-amber-400 text-slate-950' : 'btn-ghost'}
          title="Trainer mode: after the 8 Pokémon picks, the Attacker and then the Defender take one of the trainers on offer"
          onClick={() => {
            setTrainers((t) => !t);
            setPicks([]);
          }}
        >
          {trainers ? 'With trainers' : 'No trainers'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => reset(randomPool(seededRng(randomSeed()), legends ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE), randomLegendPool(seededRng(randomSeed())), randomTrainerPool(seededRng(randomSeed())))}>New random pools</button>
        <button type="button" className={editing ? 'btn-primary' : 'btn-ghost'} onClick={() => setEditing((e) => !e)}>{editing ? 'Done editing' : 'Edit pools'}</button>
        <button type="button" className="btn-ghost" disabled={!picks.length} onClick={() => setPicks((p) => p.slice(0, -1))}>Undo</button>
        <button type="button" className="btn-ghost" disabled={!picks.length} onClick={() => setPicks([])}>Restart draft</button>
        <button type="button" className="btn-ghost" disabled={done || !best} onClick={() => best && pick(best.id)}>AI pick</button>
        <button type="button" className="btn-ghost" disabled={done || !best} onClick={() => setPicks((p) => [...p, ...aiFinish(s, model)])}>AI finishes</button>
      </header>

      {editing ? (
        <PoolEditor pool={pool} legendPool={legendPool} legends={legends} trainerPool={trainers ? trainerPool : null} onChange={(p, l, t) => reset(p, l, t ?? trainerPool)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-3">
            {(legends ? (['legend', 'normal'] as const) : (['normal'] as const)).map((group) => {
              const ids = group === 'legend' ? legendPool : pool;
              const active = !done && !trainerTurn && isLegendPick(s) === (group === 'legend');
              return (
                <div key={group} className={active ? '' : 'opacity-70'}>
                  <h3 className={`mb-1.5 text-sm font-bold ${group === 'legend' ? 'text-amber-300' : 'text-slate-200'}`}>
                    {group === 'legend' ? 'Legendaries' : `Pokémon`}
                  </h3>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2" onMouseLeave={() => setHover(null)}>
                    {ids.map((id) => {
                      const owner = s.draft.picks.A.includes(id) ? 'A' : s.draft.picks.D.includes(id) ? 'D' : null;
                      const line = lineOf.get(id);
                      const can = options.has(id);
                      const pSide = line && side ? (side === 'A' ? winChance(line.value) : 1 - winChance(line.value)) : null;
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
            {trainers && (
              <div className={trainerTurn ? '' : 'opacity-70'}>
                <h3 className="mb-1.5 text-sm font-bold text-amber-300">Trainers</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                  {trainerPool.map((id) => {
                    const owner = s.trainers?.picks.A === id ? 'A' : s.trainers?.picks.D === id ? 'D' : null;
                    const line = trainerTurn ? lineOf.get(id) : undefined;
                    const can = trainerTurn && options.has(id);
                    const pSide = line && side ? (side === 'A' ? winChance(line.value) : 1 - winChance(line.value)) : null;
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
              <MapPreview map={getMap(mapId)} className="max-w-[220px]" />
              <OutcomeBar pA={pA} busy={busy} done={done} />
              <Teams s={s} legends={legends} />
            </div>

            {hover && !trainerTurn && (
              <div className="panel hidden p-2 xl:block">
                <CardImage id={hover} name={getCard(hover).name} className="mx-auto max-w-[300px]" />
              </div>
            )}

            {!done && side && analysis && (
              <div className="panel space-y-2 p-3">
                <div className={`font-bold ${SIDE_TEXT[side]}`}>
                  Pick {s.draft.index + 1} of {s.draft.order.length} · {SIDE_LABEL[side]} to pick{trainerTurn ? ' a trainer' : isLegendPick(s) ? ' a legendary' : ''}
                </div>
                <p className="text-[11px] leading-snug text-slate-400">
                  {trainerTurn
                    ? `Each trainer's win chance with the final teams, if the ${side === 'A' ? 'Defender then takes the best of the rest for them' : 'Attacker keeps their trainer'}: its value for the ${SIDE_LABEL[side]} plus how well its passive suits the team.`
                    : `Each option's win chance assumes both sides draft as well as the model knows from then on${trainers ? ', trainer picks included' : ''}; that is what the ranking uses. The chips explain it in percentage points for the ${SIDE_LABEL[side]}, each against nobody taking the card: the card itself, type matchups with the opponent's picks so far, learned synergy, and what the opponent would gain by taking it.`}
                </p>
                <div className="space-y-1">
                  {analysis.lines.map((l, rank) => {
                    const pSide = side === 'A' ? winChance(l.value) : 1 - winChance(l.value);
                    const bestP = side === 'A' ? winChance(analysis.value) : 1 - winChance(analysis.value);
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
                          {trainerTurn ? <p className="truncate text-[10px] text-slate-400">{getTrainer(l.id).passive}</p> : <Breakdown why={l.why} p={bestP} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {best && best.pv.length > 0 && (
                  <div className="border-t border-slate-700 pt-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Predicted rest of the draft after {getCard(best.id).name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {best.pv.map((x, i) => (
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

            <p className="px-1 text-[11px] leading-snug text-slate-500">
              Estimates come from the Hard bot's draft model for {getMap(mapId).name}
              {modeTrained ? ` in this mode (${legends ? 'with' : 'without'} legendaries, ${trainers ? 'with' : 'without'} trainers)` : ' (this mode has no model of its own yet, so the default one stands in)'},
              fitted to {model.games.toLocaleString()} self-play games with random teams. They measure how teams fare when both sides are played by the Hard bot, not a guarantee against people.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

function OutcomeBar({ pA, busy, done }: { pA: number | null; busy: boolean; done: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-semibold">
        <span className="text-rose-300">Attacker {pA !== null ? pct(pA) : '…'}</span>
        <span className="text-slate-400">{busy ? 'Analysing…' : done ? 'Final teams' : 'With best drafting from here'}</span>
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
  const next = s.phase === 'draft' ? s.draft.order[s.draft.index] : null;
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
                <span key={i} className={`flex h-9 w-9 items-center justify-center rounded-full border border-dashed text-[10px] ${next === side && s.draft.picks[side].length === i ? 'border-amber-300 text-amber-300' : 'border-slate-600 text-slate-500'}`}>
                  {i === 3 && legends ? 'L' : i + 1}
                </span>
              );
            })}
            {s.trainers && (trainer ? (
              <img src={trainerImg(trainer)} alt={getTrainer(trainer).name} title={getTrainer(trainer).name} className={`h-9 w-7 rounded object-cover object-top ring-2 ${side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} />
            ) : (
              <span className="flex h-9 w-7 items-center justify-center rounded border border-dashed border-slate-600 text-[10px] text-slate-500">T</span>
            ))}
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
