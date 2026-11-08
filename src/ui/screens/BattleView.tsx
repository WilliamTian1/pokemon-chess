import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Action, DIRS, DIR_VEC, type Dir, type GameState, type PType, type Pos, SIDE_NAME, type Side, type TargetPreview, type Unit,
  addPos, bestHit, cardOf, dangerZone, decider, dirToward, followMeBlockers, getCard, getMap, inBounds, liveUnits, markedTiles,
  moveOf, moveOptions, moveTargets, onBoard, otherSide, posKey, previewAction, selfEffectNotes, trebuchetOption, unitAt,
  unitTurnInfo, waitBlock,
} from '../../engine';
import { Art, HpBar, Modal, SIDE_TEXT, StatusBadge, TypeBadge } from '../components/bits';
import { Board, type Overlay } from '../components/Board';
import { MiniGrid } from '../components/CardView';
import { MatchupMatrix, TypeChartModal } from '../components/Matchups';
import { LogPanel } from '../components/Panels';
import { TeamCards } from '../components/TeamCards';
import type { Controller } from '../controller';
import { useBoxSize, usePortraitBoard, useTouch, useWideLayout } from '../hooks';

type Aim = { kind: 'move'; index: 0 | 1 } | { kind: 'treb' };

const DANGER_KEY = 'pcc-danger-zone';

function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this visit.
  }
}

export function BattleView({ ctl }: { ctl: Controller }) {
  const s = ctl.state;
  const rotated = usePortraitBoard();
  const wide = useWideLayout();
  // Enlarged cards are shown over the board column, never over either team's cards.
  const mainRef = useRef<HTMLElement>(null);
  const boardAspect = getMap(s.mapId).width / getMap(s.mapId).height;
  const touch = useTouch();
  const turnSide = decider(s);
  const myDecision = turnSide !== null && ctl.mySides.includes(turnSide);
  const myBattleTurn = s.phase === 'battle' && myDecision && s.pending.length === 0;

  const [sel, setSel] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [aimDir, setAimDir] = useState<Dir | null>(null);
  const [aimTarget, setAimTarget] = useState<string | null>(null);
  const [trebType, setTrebType] = useState<PType | null>(null);
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  const [danger, setDanger] = useState(() => readPref(DANGER_KEY));
  const [hoverMove, setHoverMove] = useState<0 | 1 | null>(null);
  const [hoverTile, setHoverTile] = useState<Pos | null>(null);
  const [matrixHover, setMatrixHover] = useState<string[] | null>(null);
  const [matchups, setMatchups] = useState(false);
  const [boardBox, setBoardBox] = useState<HTMLDivElement | null>(null);
  const boardSize = useBoxSize(boardBox);
  const [chart, setChart] = useState(false);
  const [coin, setCoin] = useState(() => s.phase === 'placement' && s.placement.index === 0 && s.placement.first !== null);

  const toggleDanger = useCallback(() => {
    setDanger((on) => {
      writePref(DANGER_KEY, !on);
      return !on;
    });
  }, []);

  useEffect(() => {
    if (!coin) return;
    const t = setTimeout(() => setCoin(false), 2600);
    return () => clearTimeout(t);
  }, [coin]);

  const cancelAim = useCallback(() => {
    setAim(null);
    setAimDir(null);
    setAimTarget(null);
  }, []);

  // Every new state invalidates aiming; an in-progress activation locks the selection.
  useEffect(() => {
    cancelAim();
    setConfirmEnd(false);
    if (s.active && ctl.mySides.includes(s.side)) setSel(s.active.unitId);
    else setSel((cur) => {
      const u = cur ? s.units.find((x) => x.id === cur) : null;
      return u && onBoard(u) && !u.activated && u.side === s.side ? cur : null;
    });
  }, [s.seq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (aim) cancelAim();
        else if (!s.active) setSel(null);
      }
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'd') toggleDanger();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aim, cancelAim, s.active, toggleDanger]);

  const selUnit = sel ? s.units.find((u) => u.id === sel) ?? null : null;
  const controllable = !!selUnit && myBattleTurn && selUnit.side === s.side && onBoard(selUnit) && !selUnit.activated;
  const lockedTo = s.active && ctl.mySides.includes(s.side) ? s.active.unitId : null;
  const isPost = !!selUnit && s.active?.unitId === selUnit.id && s.active.stage === 'acted';
  const opts = useMemo(() => (controllable && selUnit ? moveOptions(s, selUnit) : []), [controllable, selUnit, s]);
  const treb = useMemo(() => (controllable && selUnit ? trebuchetOption(s, selUnit) : null), [controllable, selUnit, s]);
  const reach = useMemo(() => (controllable && selUnit && !aim ? moveTargets(s, selUnit) : new Map()), [controllable, selUnit, aim, s]);

  // ---------------------------------------------------------------- aim preview
  const preview = useMemo(() => {
    const out: {
      zone?: Pos[]; dash?: Pos | null; knock?: Pos[]; previews: Map<string, TargetPreview>; arrows?: Overlay['arrows'];
      targetable?: Set<string>; hoverZone?: Set<string>;
    } = { previews: new Map() };
    if (!selUnit || !selUnit.pos) return out;
    const id = selUnit.id;
    // Hovering a move button: everything it could hit from here, in any direction.
    if (!aim && hoverMove !== null && opts[hoverMove]?.usable) {
      const opt = opts[hoverMove];
      const keep = (p: TargetPreview) => {
        const cur = out.previews.get(p.unitId);
        if (!cur || p.expected > cur.expected) out.previews.set(p.unitId, p);
      };
      if (opt.aim === 'dir') {
        out.hoverZone = new Set(opt.dirs.flatMap((d) => d.tg.zone.map(posKey)));
        if (opt.move.target.kind === 'grid') for (const d of opt.dirs) previewAction(s, id, hoverMove, { dir: d.dir }).forEach(keep);
      } else if (opt.aim === 'unit') {
        out.targetable = new Set(opt.units);
        for (const t of opt.units) previewAction(s, id, hoverMove, { targetId: t }).forEach(keep);
      }
      return out;
    }
    if (!aim) return out;
    if (aim.kind === 'move') {
      const opt = opts[aim.index];
      if (!opt) return out;
      if (opt.aim === 'dir') {
        out.arrows = DIRS.map((d) => ({ dir: d, pos: addPos(selUnit.pos!, DIR_VEC[d]), active: opt.dirs.some((x) => x.dir === d) }))
          .filter((a) => inBounds(s, a.pos));
        const d = aimDir ? opt.dirs.find((x) => x.dir === aimDir) : undefined;
        if (d) {
          out.zone = d.tg.zone;
          out.dash = d.tg.dashTo;
          const t = opt.move.target;
          if (t.kind === 'grid') out.knock = markedTiles(s, t.grid, 'R', selUnit.pos, d.dir);
          if (opt.move.target.kind === 'grid') for (const p of previewAction(s, id, aim.index, { dir: d.dir })) out.previews.set(p.unitId, p);
        }
      } else if (opt.aim === 'unit') {
        out.targetable = new Set(opt.units);
        if (aimTarget && opt.units.includes(aimTarget)) {
          const tu = s.units.find((u) => u.id === aimTarget)!;
          out.zone = [tu.pos!];
          for (const p of previewAction(s, id, aim.index, { targetId: aimTarget })) out.previews.set(p.unitId, p);
        }
      }
    } else if (treb?.usable) {
      out.targetable = new Set(treb.targets);
      if (aimTarget && treb.targets.includes(aimTarget)) {
        for (const p of previewAction(s, id, 'treb', { targetId: aimTarget, attackType: trebType ?? treb.types[0] })) out.previews.set(p.unitId, p);
      }
    }
    return out;
  }, [aim, aimDir, aimTarget, trebType, selUnit, opts, treb, s, hoverMove]);

  // ---------------------------------------------------------------- danger zone & matchups
  const dangerSide: Side = ctl.mySides.length === 1 ? otherSide(ctl.mySides[0]) : otherSide(s.side);
  const dz = useMemo(
    () => (danger && (s.phase === 'battle' || s.phase === 'placement') ? dangerZone(s, dangerSide) : null),
    [danger, s, dangerSide],
  );
  const dangerCounts = useMemo(() => (dz ? new Map([...dz.tiles].map(([k, v]) => [k, v.length])) : undefined), [dz]);

  const send = (a: Action) => {
    ctl.dispatch(a);
  };

  const fireDir = (d: Dir) => aim?.kind === 'move' && selUnit && send({ type: 'useMove', unitId: selUnit.id, moveIndex: aim.index, dir: d });
  const fireAt = (targetId: string) => {
    if (!selUnit || !aim) return;
    if (aim.kind === 'move') send({ type: 'useMove', unitId: selUnit.id, moveIndex: aim.index, targetId });
    else send({ type: 'trebuchet', unitId: selUnit.id, targetId, attackType: trebType ?? cardOf(selUnit).types[0] });
  };

  // ---------------------------------------------------------------- placement
  const placing = s.phase === 'placement';
  const placeSide = placing ? decider(s) : null;
  const myPlacement = placing && placeSide !== null && ctl.mySides.includes(placeSide);
  const unplaced = placing && placeSide ? s.units.filter((u) => u.side === placeSide && !u.pos) : [];
  const placeUnit = unplaced.find((u) => u.id === placeSel) ?? unplaced[0] ?? null;
  const freeSpawns = placing && placeSide ? getMap(s.mapId).spawns[placeSide].filter((p) => !unitAt(s, p)) : [];

  // ---------------------------------------------------------------- board input
  const onTile = (p: Pos) => {
    const u = unitAt(s, p);
    if (placing) {
      if (myPlacement && placeUnit && freeSpawns.some((f) => f.x === p.x && f.y === p.y)) send({ type: 'place', unitId: placeUnit.id, pos: p });
      else if (u) setInspect(u.id);
      return;
    }
    if (aim && selUnit?.pos) {
      if (u?.id === selUnit.id) return cancelAim();
      if (aim.kind === 'move' && opts[aim.index]?.aim === 'dir') {
        const d = dirToward(selUnit.pos, p);
        if (d && opts[aim.index].dirs.some((x) => x.dir === d)) {
          if (touch && aimDir !== d) setAimDir(d);
          else fireDir(d);
        }
        return;
      }
      if (u && preview.targetable?.has(u.id)) {
        if (touch && aimTarget !== u.id) setAimTarget(u.id);
        else fireAt(u.id);
      }
      return;
    }
    if (u) {
      const mineNow = myBattleTurn && u.side === s.side && !u.activated;
      if (mineNow && (!lockedTo || lockedTo === u.id)) {
        setSel(u.id);
        setInspect(null);
      } else {
        setInspect(u.id);
      }
      return;
    }
    if (selUnit && reach.has(posKey(p))) {
      send(isPost ? { type: 'postMove', unitId: selUnit.id, to: p } : { type: 'move', unitId: selUnit.id, to: p });
      return;
    }
    if (!lockedTo) setSel(null);
    setInspect(null);
  };

  const onHover = (p: Pos | null) => {
    const u = p ? unitAt(s, p) : undefined;
    setHoverUnit(u?.id ?? null);
    setHoverTile(p);
    if (!p || touch || !aim || !selUnit?.pos) return;
    if (aim.kind === 'move' && opts[aim.index]?.aim === 'dir') {
      const d = dirToward(selUnit.pos, p);
      setAimDir(d && opts[aim.index].dirs.some((x) => x.dir === d) ? d : null);
    } else if (u && preview.targetable?.has(u.id)) {
      setAimTarget(u.id);
    }
  };

  const overlay: Overlay = {
    reach: !isPost && reach.size ? new Set(reach.keys()) : undefined,
    post: isPost && reach.size ? new Set(reach.keys()) : undefined,
    zone: preview.zone,
    dash: preview.dash,
    knock: preview.knock,
    targetable: preview.targetable,
    arrows: preview.arrows,
    spawns: myPlacement && placeSide ? { tiles: freeSpawns, side: placeSide } : undefined,
    danger: dangerCounts,
    hoverZone: preview.hoverZone,
    highlight: matrixHover ? new Set(matrixHover) : undefined,
  };

  const inspectId = hoverUnit ?? inspect ?? sel ?? (placing ? placeUnit?.id ?? null : null);
  // Your team sits on the left; in hot-seat and spectating the Attacker does.
  const leftSide: Side = ctl.mySides.length === 1 ? ctl.mySides[0] : 'A';
  const inspected = inspectId ? s.units.find((u) => u.id === inspectId) : null;

  // Type-matchup badges: how the focused Pokémon's best attack lands on each opponent.
  const focus = inspected && onBoard(inspected) && !aim ? inspected : null;
  if (focus) {
    const m = new Map<string, number>();
    for (const x of liveUnits(s, otherSide(focus.side))) {
      const hit = bestHit(cardOf(focus), cardOf(x));
      if (hit && hit.mult !== 1) m.set(x.id, hit.mult);
    }
    overlay.matchups = m;
  }
  const remaining = s.phase === 'battle' ? s.units.filter((u) => u.side === s.side && onBoard(u) && !u.activated) : [];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] wide:grid-rows-[minmax(0,1fr)]">
      {([leftSide, otherSide(leftSide)] as const).map((side, i) => (
        <aside key={side} className={`min-w-0 wide:h-full wide:min-h-0 ${i === 0 ? 'order-2 wide:order-1' : 'order-3'}`}>
          <TeamCards
            state={s}
            side={side}
            name={ctl.names[side]}
            mine={ctl.mySides.length === 1 && ctl.mySides[0] === side}
            fill={wide}
            magnifyRegion={() => (wide ? mainRef.current?.getBoundingClientRect() ?? null : null)}
            selectedId={placing ? placeUnit?.id ?? null : sel}
            focusId={inspectId}
            onHover={setHoverUnit}
            onPick={(id) => {
              const u = s.units.find((x) => x.id === id)!;
              if (placing && myPlacement && !u.pos && u.side === placeSide) setPlaceSel(id);
              else if (myBattleTurn && u.side === s.side && onBoard(u) && !u.activated && (!lockedTo || lockedTo === id)) setSel(id);
              else setInspect(id);
            }}
          />
        </aside>
      ))}

      {/* On one-screen layouts this column is a fixed-height stack: the board takes whatever room the
          banner, action bar and log leave, so End turn and the log never need scrolling to. */}
      <main ref={mainRef} className="order-1 min-w-0 space-y-3 md:col-span-2 wide:order-2 wide:col-span-1 wide:flex wide:min-h-0 wide:flex-col wide:gap-2 wide:space-y-0 wide:overflow-y-auto">
        <TurnBanner ctl={ctl} remaining={remaining.length} />
        <BoardTools
          state={s}
          names={ctl.names}
          danger={danger}
          dangerSide={dangerSide}
          dz={dz}
          hoverTile={hoverTile}
          onToggleDanger={toggleDanger}
          onChart={() => setChart(true)}
          onMatchups={() => setMatchups(true)}
        />
        <div ref={setBoardBox} className="wide:flex wide:min-h-[110px] wide:flex-1 wide:items-center wide:justify-center">
        <div className="mx-auto w-full" style={wide && boardSize.w > 0 ? { width: Math.min(boardSize.w, boardSize.h * boardAspect) } : undefined}>
          <Board
            state={s}
            rotated={rotated}
            overlay={overlay}
            previews={preview.previews}
            selectedId={sel}
            hoverId={hoverUnit}
            events={ctl.events}
            onTile={onTile}
            onHover={onHover}
          />
        </div>
        </div>
        {placing ? (
          <PlacementBar ctl={ctl} placeSide={placeSide} myPlacement={myPlacement} unplaced={unplaced} selected={placeUnit} onSelect={setPlaceSel} />
        ) : (
          <ActionBar
            ctl={ctl}
            unit={controllable ? selUnit : null}
            myTurn={myBattleTurn}
            opts={opts}
            treb={treb}
            aim={aim}
            aimDir={aimDir}
            aimTarget={aimTarget}
            trebType={trebType}
            touch={touch}
            isPost={isPost}
            postBudget={isPost ? s.active!.postMove : 0}
            remaining={remaining}
            confirmEnd={confirmEnd}
            setConfirmEnd={setConfirmEnd}
            onAim={(a) => {
              setAim(a);
              setAimDir(null);
              setAimTarget(null);
              if (a?.kind === 'treb' && selUnit) setTrebType(cardOf(selUnit).types[0]);
            }}
            onTrebType={setTrebType}
            onFireDir={fireDir}
            onFireAt={fireAt}
            onSelfMove={(index) => selUnit && send({ type: 'useMove', unitId: selUnit.id, moveIndex: index })}
            onHoverMove={touch ? () => {} : setHoverMove}
            send={send}
          />
        )}
        <LogPanel log={s.log} className="h-56 wide:h-[clamp(64px,12vh,110px)] wide:shrink-0" />
      </main>
      {matchups && (
        <Modal onClose={() => setMatchups(false)} wide>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Matchups</h3>
            <button type="button" className="btn-ghost" onClick={() => setMatchups(false)}>Close</button>
          </div>
          <MatchupMatrix state={s} rows={leftSide} onHover={setMatrixHover} />
        </Modal>
      )}

      <PendingModal ctl={ctl} rotated={rotated} />
      {chart && <TypeChartModal onClose={() => setChart(false)} cards={s.units.map((u) => cardOf(u))} />}
      {coin && s.placement.first && <CoinFlip first={s.placement.first} name={ctl.names[s.placement.first]} onDone={() => setCoin(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- board tools

function BoardTools({ state, names, danger, dangerSide, dz, hoverTile, onToggleDanger, onChart, onMatchups }: {
  state: GameState;
  names: Record<Side, string>;
  danger: boolean;
  dangerSide: Side;
  dz: ReturnType<typeof dangerZone> | null;
  hoverTile: Pos | null;
  onToggleDanger: () => void;
  onChart: () => void;
  onMatchups: () => void;
}) {
  const here = dz && hoverTile ? dz.tiles.get(posKey(hoverTile)) : undefined;
  const byUnit = new Map<string, string[]>();
  for (const src of here ?? []) {
    const u = state.units.find((x) => x.id === src.unitId)!;
    const list = byUnit.get(u.id) ?? [];
    list.push(moveOf(u, src.moveIndex).name);
    byUnit.set(u.id, list);
  }
  const when = state.phase === 'battle' && state.side === dangerSide ? 'this turn' : 'on their next turn';
  const treb = dz?.trebuchet.map((id) => cardOf(state.units.find((x) => x.id === id)!).name) ?? [];
  let text: string;
  if (!danger) text = 'Danger zone shows every tile the opponent can attack (shortcut: D).';
  else if (byUnit.size) text = `In reach of ${[...byUnit].map(([id, mv]) => `${cardOf(state.units.find((x) => x.id === id)!).name} (${mv.join(', ')})`).join(' · ')}`;
  else text = `Red tiles: where the ${SIDE_NAME[dangerSide]} (${names[dangerSide]}) can attack ${when}, after moving. Darker red means more attacks overlap.`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={danger}
        onClick={onToggleDanger}
        title="Toggle the opponent's danger zone (D)"
        className={danger ? 'btn bg-rose-600 text-white hover:bg-rose-500' : 'btn-ghost'}
      >
        <span className={`inline-block h-3 w-3 rounded-sm border ${danger ? 'border-white bg-white/80' : 'border-rose-300 bg-rose-500/50'}`} />
        Danger zone{danger ? ': on' : ''}
      </button>
      <button type="button" className="btn-ghost" onClick={onMatchups}>Matchups</button>
      <button type="button" className="btn-ghost" onClick={onChart}>Type chart</button>
      {/* Beside the buttons when there's room, otherwise on its own line; never more than two lines. */}
      <div className="line-clamp-2 min-w-[min(100%,240px)] flex-1 text-xs leading-snug text-slate-400">
        {text}
        {danger && treb.length > 0 && <span className="text-rose-300"> {treb.join(', ')} can also reach the trebuchet, which hits anywhere (40 power).</span>}
      </div>
    </div>
  );
}

function CoinFlip({ first, name, onDone }: { first: Side; name: string; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onDone} role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-slate-300">Coin flip for placement</div>
        <div className="mt-20" style={{ perspective: '700px' }}>
          <div className={`coin coin-${first} relative h-28 w-28`}>
            <div className="coin-face absolute inset-0 flex items-center justify-center rounded-full border-4 border-amber-200 bg-gradient-to-br from-rose-400 to-rose-700 text-4xl font-black text-white shadow-xl shadow-black/50">A</div>
            <div className="coin-face coin-back absolute inset-0 flex items-center justify-center rounded-full border-4 border-amber-200 bg-gradient-to-br from-sky-400 to-sky-700 text-4xl font-black text-white shadow-xl shadow-black/50">D</div>
          </div>
        </div>
        <div className="coin-result">
          <div className={`text-2xl font-black ${SIDE_TEXT[first]}`}>The {SIDE_NAME[first]} places first</div>
          <div className="mt-1 text-sm text-slate-300">{name}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- banner

function TurnBanner({ ctl, remaining }: { ctl: Controller; remaining: number }) {
  const s = ctl.state;
  if (s.phase === 'placement') {
    const side = decider(s)!;
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className={`font-bold ${SIDE_TEXT[side]}`}>
          Placement · {ctl.mySides.includes(side) ? 'place a Pokémon on a glowing spawn tile' : `${ctl.names[side]} is placing…`}
        </div>
        <div className="text-xs text-slate-400">
          {s.placement.first && <>The {SIDE_NAME[s.placement.first]} won the coin flip and placed first. </>}
          Attackers start at the bottom, Defenders at the top.
        </div>
      </div>
    );
  }
  const side = s.side;
  const mine = ctl.mySides.includes(side);
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-800 px-2.5 py-1 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Round</div>
          <div className="text-lg font-black leading-none">{s.round}<span className="text-sm text-slate-500">/{s.maxRounds}</span></div>
        </div>
        <div>
          <div className={`font-bold ${SIDE_TEXT[side]}`}>
            {s.phase === 'over' ? 'Battle over' : mine && ctl.mySides.length === 1 ? 'Your turn' : `${ctl.names[side]}’s turn`}
            {s.phase !== 'over' && <span className="ml-1.5 text-xs font-medium text-slate-400">({side === 'A' ? 'Attacker' : 'Defender'})</span>}
          </div>
          <div className="text-xs text-slate-400">
            {s.phase === 'over' ? s.winReason : ctl.thinking ? 'Thinking…' : `${remaining} Pokémon left to activate${s.round === 1 ? ' · round 1 is movement only' : ''}`}
          </div>
        </div>
      </div>
      <div className="text-right text-[11px] leading-tight text-slate-400 wide:hidden min-[1500px]:wide:block">
        Attacker wins by fainting all 4 Defenders.<br />Defender wins by surviving round {s.maxRounds}.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- placement bar

function PlacementBar({ ctl, placeSide, myPlacement, unplaced, selected, onSelect }: {
  ctl: Controller;
  placeSide: 'A' | 'D' | null;
  myPlacement: boolean;
  unplaced: Unit[];
  selected: Unit | null;
  onSelect: (id: string) => void;
}) {
  if (!myPlacement || !placeSide) {
    return <div className="panel p-3 text-sm text-slate-300">{ctl.thinking ? 'The bot is placing…' : 'Waiting for the other player to place…'}</div>;
  }
  return (
    <div className="panel space-y-2 p-3">
      <div className="text-sm text-slate-300">Choose a Pokémon, then tap a glowing spawn tile.</div>
      <div className="flex flex-wrap gap-2">
        {unplaced.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onSelect(u.id)}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${selected?.id === u.id ? 'border-amber-300 bg-slate-800' : 'border-slate-700 bg-slate-900'}`}
          >
            <Art id={u.cardId} className="h-8 w-8 rounded-full" />
            <span className="text-sm font-semibold">{cardOf(u).name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- action bar

function ActionBar(props: {
  ctl: Controller;
  unit: Unit | null;
  myTurn: boolean;
  opts: ReturnType<typeof moveOptions>;
  treb: ReturnType<typeof trebuchetOption> | null;
  aim: Aim | null;
  aimDir: Dir | null;
  aimTarget: string | null;
  trebType: PType | null;
  touch: boolean;
  isPost: boolean;
  postBudget: number;
  remaining: Unit[];
  confirmEnd: boolean;
  setConfirmEnd: (v: boolean) => void;
  onAim: (a: Aim | null) => void;
  onTrebType: (t: PType) => void;
  onFireDir: (d: Dir) => void;
  onFireAt: (id: string) => void;
  onSelfMove: (i: 0 | 1) => void;
  onHoverMove: (i: 0 | 1 | null) => void;
  send: (a: Action) => void;
}) {
  const { ctl, unit, myTurn, opts, treb, aim, aimDir, aimTarget, trebType, touch, isPost, postBudget, remaining, confirmEnd, setConfirmEnd, onAim, onTrebType, onFireDir, onFireAt, onSelfMove, onHoverMove, send } = props;
  const s = ctl.state;
  if (s.phase === 'over') return null;
  if (!myTurn) {
    const who = decider(s);
    return (
      <div className="panel p-3 text-sm text-slate-300">
        {s.pending.length && who && !ctl.mySides.includes(who)
          ? `Waiting for ${ctl.names[who]} to make a choice…`
          : ctl.thinking ? `${ctl.names[s.side]} is thinking…` : `Waiting for ${ctl.names[s.side]}…`}
      </div>
    );
  }

  const usefulLeft = remaining.filter((u) => unitTurnInfo(s, u).canAct || unitTurnInfo(s, u).canMove);
  const blockers = followMeBlockers(s);
  const endTurn = (
    <button
      type="button"
      className={confirmEnd ? 'btn-danger' : 'btn-primary'}
      disabled={blockers.length > 0}
      title={blockers.length ? `Follow Me: ${blockers.map((u) => cardOf(u).name).join(', ')} must attack first` : undefined}
      onClick={() => {
        if (usefulLeft.length > 0 && !confirmEnd) setConfirmEnd(true);
        else send({ type: 'endTurn' });
      }}
    >
      {confirmEnd ? `End turn? ${usefulLeft.length} can still act` : 'End turn'}
    </button>
  );

  if (!unit) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="text-sm text-slate-300">
          {remaining.length ? 'Select one of your Pokémon on the board to move and act.' : 'Everyone has acted.'}
        </div>
        {endTurn}
      </div>
    );
  }

  const c = cardOf(unit);
  const info = unitTurnInfo(s, unit);
  const active = s.active?.unitId === unit.id ? s.active : null;

  if (aim) {
    const isTreb = aim.kind === 'treb';
    const opt = !isTreb ? opts[aim.index] : null;
    const move = opt?.move;
    const hint = isTreb
      ? 'Pick any Pokémon on the field to bombard.'
      : opt?.aim === 'dir'
        ? touch ? 'Tap a direction to preview, tap again to fire.' : 'Hover a direction to preview, click to fire.'
        : touch ? 'Tap a highlighted Pokémon to preview, tap again to confirm.' : 'Click a highlighted Pokémon.';
    const canConfirm = touch && ((opt?.aim === 'dir' && aimDir) || ((opt?.aim === 'unit' || isTreb) && aimTarget));
    return (
      <div className="panel space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold">{isTreb ? 'Trebuchet' : move!.name}</span>
            {move?.type && <TypeBadge type={move.type} small />}
            <span className="text-sm font-bold text-amber-300">{isTreb ? 40 : move!.powerLabel ?? move!.power ?? ''}</span>
            {move && <MiniGrid move={move} size={9} />}
          </div>
          <div className="flex gap-2">
            {canConfirm && (
              <button type="button" className="btn-primary" onClick={() => (opt?.aim === 'dir' ? onFireDir(aimDir!) : onFireAt(aimTarget!))}>
                Confirm
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => onAim(null)}>Cancel</button>
          </div>
        </div>
        {isTreb && treb && treb.types.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-slate-300">
            Type:
            {treb.types.map((t) => (
              <button key={t} type="button" onClick={() => onTrebType(t)} className={`rounded ${(trebType ?? treb.types[0]) === t ? 'ring-2 ring-amber-300' : 'opacity-60'}`}>
                <TypeBadge type={t} />
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400">{move?.text || (isTreb ? 'A flat 40 in one of the user’s types, before type effectiveness: stat stages, abilities, terrain and burns don’t change it.' : '')}</p>
        <p className="text-xs text-amber-200/90">{hint}</p>
      </div>
    );
  }

  return (
    <div className="panel space-y-2.5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Art id={unit.cardId} className="h-9 w-9 rounded-full ring-2 ring-amber-300" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-bold">{c.name}</span>
              {unit.status && <StatusBadge status={unit.status} />}
            </div>
            <HpBar hp={unit.hp} max={unit.maxHp} className="w-28" />
          </div>
          <div className="text-xs text-slate-400">
            {isPost ? `Can move ${postBudget} more` : info.canMove ? 'Tap a blue tile to move' : active ? 'Moved' : info.reasons.join(', ') || 'Can’t move'}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {active && active.stage === 'moved' && active.undoable && (
            <button type="button" className="btn-ghost" onClick={() => send({ type: 'undoMove', unitId: unit.id })}>Undo move</button>
          )}
          {!isPost && treb?.usable && (
            <button type="button" className="btn-ghost" onClick={() => onAim({ kind: 'treb' })}>🎯 Trebuchet</button>
          )}
          {!isPost && (
            <button type="button" className="btn-ghost" disabled={!!waitBlock(s, unit)} title={waitBlock(s, unit) ?? 'End this Pokémon’s activation without acting'} onClick={() => send({ type: 'wait', unitId: unit.id })}>
              {info.canAct ? 'Wait' : 'Done'}
            </button>
          )}
          {endTurn}
        </div>
      </div>
      {!isPost && waitBlock(s, unit) && <p className="text-xs text-amber-300">{waitBlock(s, unit)}</p>}

      {isPost ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-emerald-300">Move again on a green tile, or</span>
          <button type="button" className="btn-ghost" onClick={() => send({ type: 'skipPostMove', unitId: unit.id })}>Stay here</button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {opts.map((o) => (
            <button
              key={o.moveIndex}
              type="button"
              disabled={!o.usable}
              title={o.usable ? o.move.text : o.reason}
              onMouseEnter={() => onHoverMove(o.moveIndex)}
              onMouseLeave={() => onHoverMove(null)}
              onClick={() => {
                onHoverMove(null);
                if (o.aim === 'none') onSelfMove(o.moveIndex);
                else onAim({ kind: 'move', index: o.moveIndex });
              }}
              className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-left transition hover:border-amber-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold">{o.move.name}</span>
                  {o.move.type && <TypeBadge type={o.move.type} small />}
                  <span className="text-xs font-bold text-amber-300">{o.move.powerLabel ?? o.move.power ?? ''}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-400 wide:line-clamp-1">
                  {o.usable ? (o.aim === 'none' ? `Use now · ${o.move.text}` : o.move.text || 'Aim, then fire.') : o.reason}
                </div>
                {o.usable && selfEffectNotes(s, unit, o.move).length > 0 && (
                  <div className="mt-0.5 text-[10px] text-amber-200/80">{selfEffectNotes(s, unit, o.move).join(' · ')}</div>
                )}
              </div>
              <MiniGrid move={o.move} size={8} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pending choices

function PendingModal({ ctl, rotated }: { ctl: Controller; rotated: boolean }) {
  const s = ctl.state;
  const p = s.pending[0];
  const [hoverDir, setHoverDir] = useState<Dir | null>(null);
  if (!p || !ctl.mySides.includes(p.side)) return null;
  const u = s.units.find((x) => x.id === p.unitId)!;
  if (p.kind === 'emergencyExit') {
    return (
      <Modal>
        <h3 className="text-lg font-bold">Emergency Exit!</h3>
        <p className="mb-3 text-sm text-slate-300">{cardOf(u).name} dropped below 100 HP and must switch places with an ally.</p>
        <div className="grid gap-2">
          {p.options.map((id) => {
            const a = s.units.find((x) => x.id === id)!;
            return (
              <button key={id} type="button" className="btn-ghost justify-start" onClick={() => ctl.dispatch({ type: 'choose', option: id })}>
                <Art id={a.cardId} className="h-8 w-8 rounded-full" />
                {cardOf(a).name} <span className="text-xs text-slate-400">({a.hp} HP)</span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }
  const src = getCard(p.source.cardId).moves[p.source.moveIndex];
  const pv = hoverDir ? previewAction(s, u.id, 0, { dir: hoverDir, copyOf: src }) : [];
  // Labels follow the board as drawn (it is turned a quarter turn on portrait phones).
  const label: Record<Dir, string> = rotated
    ? { N: '▶ Right', E: '▼ Down', S: '◀ Left', W: '▲ Up' }
    : { N: '▲ Up', E: '▶ Right', S: '▼ Down', W: '◀ Left' };
  return (
    <Modal>
      <h3 className="text-lg font-bold">Liquid Voice</h3>
      <p className="mb-3 text-sm text-slate-300">
        {cardOf(u).name} can copy <b>{src.name}</b> as a Water-type move. Choose which way to aim it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {p.options.map((d) => (
          <button
            key={d}
            type="button"
            className="btn-ghost"
            onMouseEnter={() => setHoverDir(d)}
            onFocus={() => setHoverDir(d)}
            onClick={() => ctl.dispatch({ type: 'choose', option: d })}
          >
            {label[d]}
          </button>
        ))}
      </div>
      {pv.length > 0 && (
        <div className="mt-2 space-y-0.5 text-xs text-slate-300">
          {pv.map((x) => (
            <div key={x.unitId}>
              {cardOf(s.units.find((q) => q.id === x.unitId)!).name}: {x.kind === 'damage' ? `${x.min}–${x.max}` : x.kind} {x.notes.join(', ')}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn-ghost mt-3 w-full" onClick={() => ctl.dispatch({ type: 'choose', option: null })}>Don’t copy</button>
    </Modal>
  );
}
