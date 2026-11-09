import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Action, type CopyOption, DIRS, DIR_VEC, type Dir, type GameState, type MoveDef, type MoveOption, type Pos, type Side, type TargetPreview,
  type Unit, addPos, bestHit, canUseSpecial, cardOf, dangerZone, decider, dirToward, followMeBlockers, followMeUsers, getCard, getMap,
  getTrainer, inBounds, liveUnits, markedTiles, moveOf, moveOptions, moveTargets, onBoard, otherSide, parseAim, posKey, previewAction,
  selfEffectNotes, specialTargets, targeting, trainerOf, trebuchetOption, unitAt, unitTurnInfo, waitBlock,
} from '../../engine';
import { Art, HpBar, Modal, SIDE_TEXT, StatusBadge, TypeBadge } from '../components/bits';
import { ARROW, Board, type BoardView, MOVE_RANGE, type Overlay, screenDir } from '../components/Board';
import { MiniGrid } from '../components/CardView';
import { MatchupMatrix, TypeChartModal } from '../components/Matchups';
import { LogPanel } from '../components/Panels';
import { FieldFx, SpecialCutIn, TurnSweep, useEventSounds } from '../components/Effects';
import { TeamCards } from '../components/TeamCards';
import { sfx } from '../audio';
import type { Controller } from '../controller';
import { useBoxSize, usePortraitBoard, useTouch, useWideLayout } from '../hooks';

/** What's being aimed: a move (Transform: with the move it copies), the trebuchet, or Nobunaga's special. */
type Aim = { kind: 'move'; index: 0 | 1; copy?: CopyOption } | { kind: 'treb' } | { kind: 'special' };

/** The option being aimed: the move itself, or for Transform the move it copies (same slot). */
function aimedOption(opts: MoveOption[], aim: Aim | null): MoveOption | undefined {
  if (aim?.kind !== 'move') return undefined;
  const c = aim.copy;
  return c ? { moveIndex: aim.index, move: c.move, usable: true, aim: c.aim, dirs: c.dirs, units: c.units } : opts[aim.index];
}

export function BattleView({ ctl }: { ctl: Controller }) {
  const s = ctl.state;
  const rotated = usePortraitBoard();
  // Like chess, the board faces the player: the Defender sees its own side at the bottom. In hot-seat
  // it faces whoever is acting; spectators get the Attacker's view.
  const viewSide: Side = ctl.mySides.length === 1 ? ctl.mySides[0] : ctl.mySides.length === 2 ? decider(s) ?? s.side : 'A';
  const view = useMemo<BoardView>(() => ({ rotated, flipped: viewSide === 'D' }), [rotated, viewSide]);
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
  // Why the direction under the cursor can't be used (e.g. Follow Me), so a dimmed arrow is explained.
  const [aimBlocked, setAimBlocked] = useState<string | null>(null);
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  // An opposing Pokémon whose reach is shown, each move in its own colour (click it; click again or Esc to clear).
  const [dangerUnit, setDangerUnit] = useState<string | null>(null);
  const [hoverMove, setHoverMove] = useState<0 | 1 | null>(null);
  const [hoverTile, setHoverTile] = useState<Pos | null>(null);
  const [matrixHover, setMatrixHover] = useState<string[] | null>(null);
  const [matchups, setMatchups] = useState(false);
  const [boardBox, setBoardBox] = useState<HTMLDivElement | null>(null);
  const boardSize = useBoxSize(boardBox);
  const [chart, setChart] = useState(false);



  useEventSounds(ctl.events);
  const placed = s.units.filter((u) => u.pos).length;
  useEffect(() => {
    if (s.phase === 'placement' && placed > 0) sfx('place');
  }, [placed]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelAim = useCallback(() => {
    setAim(null);
    setAimDir(null);
    setAimTarget(null);
    setAimBlocked(null);
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
        setDangerUnit(null);
        if (aim) cancelAim();
        else if (!s.active) setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aim, cancelAim, s.active]);

  const selUnit = sel ? s.units.find((u) => u.id === sel) ?? null : null;
  const controllable = !!selUnit && myBattleTurn && selUnit.side === s.side && onBoard(selUnit) && !selUnit.activated;
  const lockedTo = s.active && ctl.mySides.includes(s.side) ? s.active.unitId : null;
  const isPost = !!selUnit && s.active?.unitId === selUnit.id && s.active.stage === 'acted';
  const opts = useMemo(() => (controllable && selUnit ? moveOptions(s, selUnit) : []), [controllable, selUnit, s]);
  const treb = useMemo(() => (controllable && selUnit ? trebuchetOption(s, selUnit) : null), [controllable, selUnit, s]);
  const reach = useMemo(() => (controllable && selUnit && !aim ? moveTargets(s, selUnit) : new Map()), [controllable, selUnit, aim, s]);
  const aimOpt = aimedOption(opts, aim);
  /** Transform previews the borrowed move as the user's own. */
  const copied: { move?: MoveDef } = aim?.kind === 'move' && aim.copy ? { move: aim.copy.move } : {};

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
      const opt = aimOpt;
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
          if (opt.move.target.kind === 'grid') for (const p of previewAction(s, id, aim.index, { dir: d.dir, ...copied })) out.previews.set(p.unitId, p);
        }
      } else if (opt.aim === 'unit') {
        out.targetable = new Set(opt.units);
        if (aimTarget && opt.units.includes(aimTarget)) {
          const tu = s.units.find((u) => u.id === aimTarget)!;
          out.zone = [tu.pos!];
          for (const p of previewAction(s, id, aim.index, { targetId: aimTarget, ...copied })) out.previews.set(p.unitId, p);
        }
      }
    } else if (aim.kind === 'special') {
      out.targetable = new Set(specialTargets(s, s.side));
    } else if (treb?.usable) {
      out.targetable = new Set(treb.targets);
      if (aimTarget && treb.targets.includes(aimTarget)) {
        for (const p of previewAction(s, id, 'treb', { targetId: aimTarget })) out.previews.set(p.unitId, p);
      }
    }
    return out;
  }, [aim, aimDir, aimTarget, selUnit, opts, treb, s, hoverMove]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- danger zone & matchups
  const dangerSide: Side = ctl.mySides.length === 1 ? otherSide(ctl.mySides[0]) : otherSide(s.side);
  const soloDanger = dangerUnit ? s.units.find((u) => u.id === dangerUnit && u.side === dangerSide && onBoard(u)) ?? null : null;
  const dz = useMemo(() => {
    if (s.phase !== 'battle' && s.phase !== 'placement') return null;
    return soloDanger ? dangerZone(s, dangerSide, soloDanger.id) : null;
  }, [soloDanger, s, dangerSide]);
  /** Clicking an opponent shows its own danger zone; clicking it again goes back. */
  const toggleSoloDanger = (u: Unit) => {
    if (u.side === dangerSide && onBoard(u)) setDangerUnit((cur) => (cur === u.id ? null : u.id));
  };
  // Tile → which of the Pokémon's moves reach it (bit 1: first move, bit 2: second).
  const dangerMoves = useMemo(
    () => (dz ? new Map([...dz.tiles].map(([k, v]) => [k, v.reduce((m, src) => m | (1 << src.moveIndex), 0)])) : undefined),
    [dz],
  );
  const readout = dangerReadout(s, dz, hoverTile);

  const send = (a: Action) => {
    ctl.dispatch(a);
  };

  const copyOf = (a: Aim) => (a.kind === 'move' && a.copy ? { copy: { unitId: a.copy.unitId, moveIndex: a.copy.moveIndex } } : {});
  const fireDir = (d: Dir) => aim?.kind === 'move' && selUnit && send({ type: 'useMove', unitId: selUnit.id, moveIndex: aim.index, dir: d, ...copyOf(aim) });
  const fireAt = (targetId: string) => {
    if (!selUnit || !aim) return;
    if (aim.kind === 'move') send({ type: 'useMove', unitId: selUnit.id, moveIndex: aim.index, targetId, ...copyOf(aim) });
    else if (aim.kind === 'treb') send({ type: 'trebuchet', unitId: selUnit.id, targetId });
  };

  // ---------------------------------------------------------------- placement
  const placing = s.phase === 'placement';
  const placeSide = placing ? decider(s) : null;
  const myPlacement = placing && placeSide !== null && ctl.mySides.includes(placeSide);
  const unplaced = placing && placeSide ? s.units.filter((u) => u.side === placeSide && !u.pos) : [];
  const placeUnit = unplaced.find((u) => u.id === placeSel) ?? unplaced[0] ?? null;
  const freeSpawns = placing && placeSide ? getMap(s.mapId).spawns[placeSide].filter((p) => !unitAt(s, p)) : [];

  // ---------------------------------------------------------------- board input
  /**
   * Which way to aim a direction move at tile `p`: straight at it when that covers it (or it's the
   * arrow tile), otherwise any direction whose zone covers it, so clicking a target always works.
   */
  const aimDirFor = (p: Pos): Dir | null => {
    if (!selUnit?.pos) return null;
    const dirs = aimOpt?.dirs ?? [];
    const toward = dirToward(selUnit.pos, p);
    const straight = dirs.find((d) => d.dir === toward);
    const covers = (d: (typeof dirs)[number]) => d.tg.zone.some((z) => z.x === p.x && z.y === p.y);
    if (straight && (covers(straight) || Math.abs(p.x - selUnit.pos.x) + Math.abs(p.y - selUnit.pos.y) === 1)) return straight.dir;
    return dirs.find(covers)?.dir ?? straight?.dir ?? null;
  };

  /** Why a move can't be aimed `dir` (null if it can): nothing in the zone, or Follow Me. */
  const dirBlockReason = (dir: Dir | null): string | null => {
    if (!selUnit || !dir || !aimOpt || aimOpt.dirs.some((d) => d.dir === dir)) return null;
    const tg = targeting(s, selUnit, aimOpt.move, { dir });
    const decoys = followMeUsers(s, selUnit);
    if (tg.ok && decoys.length) return `Follow Me: ${cardOf(selUnit).name} must hit ${decoys.map((f) => cardOf(f).name).join(' / ')}, and that direction doesn't.`;
    return tg.reason ? `Can't aim that way: ${tg.reason[0].toLowerCase()}${tg.reason.slice(1)}.` : null;
  };

  const onTile = (p: Pos) => {
    const u = unitAt(s, p);
    if (aim?.kind === 'special') {
      if (u && specialTargets(s, s.side).includes(u.id)) send({ type: 'trainerSpecial', unitId: u.id });
      return;
    }
    if (placing) {
      if (myPlacement && placeUnit && freeSpawns.some((f) => f.x === p.x && f.y === p.y)) send({ type: 'place', unitId: placeUnit.id, pos: p });
      else if (u) setInspect(u.id);
      return;
    }
    if (aim && selUnit?.pos) {
      if (u?.id === selUnit.id) return cancelAim();
      if (aim.kind === 'move' && aimOpt?.aim === 'dir') {
        const d = aimDirFor(p);
        setAimBlocked(dirBlockReason(d ?? dirToward(selUnit.pos, p)));
        if (d && aimOpt.dirs.some((x) => x.dir === d)) {
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
        toggleSoloDanger(u);
      }
      return;
    }
    if (selUnit && reach.has(posKey(p))) {
      send(isPost ? { type: 'postMove', unitId: selUnit.id, to: p } : { type: 'move', unitId: selUnit.id, to: p });
      return;
    }
    if (!lockedTo) setSel(null);
    setInspect(null);
    setDangerUnit(null);
  };

  const onHover = (p: Pos | null) => {
    const u = p ? unitAt(s, p) : undefined;
    setHoverUnit(u?.id ?? null);
    setHoverTile(p);
    if (!p || touch || !aim || !selUnit?.pos) return;
    if (aim.kind === 'move' && aimOpt?.aim === 'dir') {
      const d = aimDirFor(p);
      const ok = d && aimOpt.dirs.some((x) => x.dir === d);
      setAimDir(ok ? d : null);
      setAimBlocked(ok ? null : dirBlockReason(d ?? dirToward(selUnit.pos, p)));
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
    danger: dangerMoves,
    note: wide && readout ? { text: readout, avoid: hoverTile } : undefined,
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(0,1fr)_minmax(0,2.1fr)_minmax(0,1fr)] wide:grid-rows-[minmax(0,1fr)]">
      {([leftSide, otherSide(leftSide)] as const).map((side, i) => (
        <aside key={side} className={`min-w-0 wide:h-full wide:min-h-0 ${i === 0 ? 'order-2 wide:order-1' : 'order-3'}`}>
          <TeamCards
            state={s}
            events={ctl.events}
            trainer={trainerOf(s, side) ? {
              id: trainerOf(s, side)!,
              used: s.trainers!.used[side],
              canUse: myBattleTurn && ctl.mySides.includes(side) && canUseSpecial(s, side),
              aiming: aim?.kind === 'special' && s.side === side,
              onUse: () => {
                if (getTrainer(trainerOf(s, side)!).specialTarget === 'ally') {
                  setSel(null);
                  setAim({ kind: 'special' });
                } else {
                  send({ type: 'trainerSpecial' });
                }
              },
              onCancel: cancelAim,
            } : null}
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
              if (aim?.kind === 'special') {
                if (specialTargets(s, s.side).includes(id)) send({ type: 'trainerSpecial', unitId: id });
                return;
              }
              if (placing && myPlacement && !u.pos && u.side === placeSide) setPlaceSel(id);
              else if (myBattleTurn && u.side === s.side && onBoard(u) && !u.activated && (!lockedTo || lockedTo === id)) setSel(id);
              else {
                setInspect(id);
                if (!placing) toggleSoloDanger(u);
              }
            }}
          />
        </aside>
      ))}

      {/* On one-screen layouts this column is a fixed-height stack: the board takes whatever room the
          banner, action bar and log leave, so End turn and the log never need scrolling to. */}
      <main ref={mainRef} className="order-1 min-w-0 space-y-3 md:col-span-2 wide:order-2 wide:col-span-1 wide:flex wide:min-h-0 wide:flex-col wide:gap-2 wide:space-y-0 wide:overflow-y-auto">
        {/* One-screen layouts: banner and tools share a row, leaving the height to the board. */}
        <div className="space-y-3 wide:flex wide:shrink-0 wide:flex-wrap wide:items-center wide:gap-2 wide:space-y-0">
          <div className="min-w-0 wide:min-w-[260px] wide:flex-1">
            <TurnBanner ctl={ctl} remaining={remaining.length} />
          </div>
          <BoardTools
            state={s}
            dangerSide={dangerSide}
            solo={soloDanger}
            onClearSolo={() => setDangerUnit(null)}
            dz={dz}
            readout={readout}
            onChart={() => setChart(true)}
            onMatchups={() => setMatchups(true)}
          />
        </div>
        <div ref={setBoardBox} className="wide:flex wide:min-h-[110px] wide:flex-1 wide:items-center wide:justify-center">
        <div className="mx-auto w-full" style={wide && boardSize.w > 0 ? { width: Math.min(boardSize.w, boardSize.h * boardAspect) } : undefined}>
          <Board
            state={s}
            view={view}
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
        {/* On phones the controls stay pinned to the bottom of the screen while the board scrolls. */}
        <div className="sticky bottom-0 z-20 -mx-1 rounded-xl bg-slate-950/90 p-1 backdrop-blur wide:static wide:m-0 wide:bg-transparent wide:p-0 wide:backdrop-blur-none">
        {aim?.kind === 'special' && (
          <div className="panel mb-2 flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-sm text-amber-200">{getTrainer(trainerOf(s, s.side)!).name}’s Special Move: pick one of your Pokémon that hasn’t moved yet (board or card).</span>
            <button type="button" className="btn-ghost" onClick={cancelAim}>Cancel</button>
          </div>
        )}
        {placing ? (
          <PlacementBar ctl={ctl} placeSide={placeSide} myPlacement={myPlacement} unplaced={unplaced} selected={placeUnit} onSelect={setPlaceSel} />
        ) : (
          <ActionBar
            ctl={ctl}
            unit={controllable ? selUnit : null}
            myTurn={myBattleTurn}
            opts={opts}
            aimOpt={aimOpt}
            treb={treb}
            aim={aim}
            aimDir={aimDir}
            aimTarget={aimTarget}
            aimBlocked={aimBlocked}
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
            }}
            onFireDir={fireDir}
            onFireAt={fireAt}
            onSelfMove={(index) => selUnit && send({ type: 'useMove', unitId: selUnit.id, moveIndex: index })}
            onHoverMove={touch ? () => {} : setHoverMove}
            send={send}
          />
        )}
        </div>
        <LogPanel log={s.log} className="h-56 wide:h-[clamp(60px,10vh,110px)] wide:shrink-0" />
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

      <PendingModal ctl={ctl} view={view} />
      <SpecialCutIn events={ctl.events} names={ctl.names} />
      <FieldFx events={ctl.events} />
      <TurnSweep state={s} names={ctl.names} mySides={ctl.mySides} />
      {chart && <TypeChartModal onClose={() => setChart(false)} cards={s.units.map((u) => cardOf(u))} />}
    </div>
  );
}

// ---------------------------------------------------------------- board tools

/** "In reach of …" for a danger-zone tile: who can hit it, with which moves (null if nobody). */
function dangerReadout(state: GameState, dz: ReturnType<typeof dangerZone> | null, tile: Pos | null): string | null {
  const here = dz && tile ? dz.tiles.get(posKey(tile)) : undefined;
  if (!here?.length) return null;
  const byUnit = new Map<string, string[]>();
  for (const src of here) {
    const u = state.units.find((x) => x.id === src.unitId)!;
    const list = byUnit.get(u.id) ?? [];
    list.push(moveOf(u, src.moveIndex).name);
    byUnit.set(u.id, list);
  }
  return `In reach of ${[...byUnit].map(([id, mv]) => `${cardOf(state.units.find((x) => x.id === id)!).name} (${mv.join(', ')})`).join(' · ')}`;
}

function BoardTools({ state, dangerSide, solo, onClearSolo, dz, readout, onChart, onMatchups }: {
  state: GameState;
  dangerSide: Side;
  solo: Unit | null;
  onClearSolo: () => void;
  dz: ReturnType<typeof dangerZone> | null;
  /** Who can hit the hovered tile (shown on the board itself on one-screen layouts). */
  readout: string | null;
  onChart: () => void;
  onMatchups: () => void;
}) {
  const when = state.phase === 'battle' && state.side === dangerSide ? 'this turn' : 'on their next turn';
  const treb = dz?.trebuchet.map((id) => cardOf(state.units.find((x) => x.id === id)!).name) ?? [];
  const soloIdle = solo && !dz?.tiles.size;
  // Moves that reach at least one tile, for the colour key.
  const shown = solo ? ([0, 1] as const).filter((i) => [...(dz?.tiles.values() ?? [])].some((srcs) => srcs.some((x) => x.moveIndex === i))) : [];
  let text: string;
  if (readout) text = readout;
  else if (solo) text = soloIdle ? `${cardOf(solo).name} can't attack ${when}.` : `Where ${cardOf(solo).name} can attack ${when}, after moving: one colour per move.`;
  else text = 'Click an opposing Pokémon to see where each of its moves can reach.';
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 wide:justify-end">
      {solo && (
        <button type="button" className="btn bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={onClearSolo} title="Hide its reach (Esc)">
          <span className="font-bold">{cardOf(solo).name}</span>
          {soloIdle && <span className="text-slate-400">can’t attack</span>}
          {treb.length > 0 && <span className="text-xs text-rose-300" title="It can walk to the trebuchet, which hits any Pokémon on the map (40 power).">+ trebuchet</span>}
          {shown.map((i) => (
            <span key={i} className="flex items-center gap-1 text-xs font-semibold">
              <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ ...MOVE_RANGE[i], boxShadow: i ? 'inset 0 0 0 2px rgba(253, 224, 71, 0.95)' : MOVE_RANGE[i].boxShadow }} />
              {cardOf(solo).moves[i].name}
            </span>
          ))}
          <span aria-hidden>✕</span>
        </button>
      )}
      {!solo && <span className="hidden text-xs text-slate-400 min-[1400px]:wide:inline">Click an opponent to see its reach</span>}
      <button type="button" className="btn-ghost" onClick={onMatchups}>Matchups</button>
      <button type="button" className="btn-ghost" onClick={onChart}>Type chart</button>
      {/* Phones: beside the buttons or on its own line. One-screen layouts keep the row slim (the
          hover readout appears on the board instead). */}
      <div className="line-clamp-2 min-w-[min(100%,240px)] flex-1 text-xs leading-snug text-slate-400 wide:hidden">{text}</div>
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
          The Attacker places first.{' '}
          The board faces you: your spawn tiles are along the bottom edge.
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
            {s.phase === 'over' ? s.winReason : ctl.thinking ? 'Thinking…' : `${remaining} Pokémon left to activate`}
          </div>
        </div>
      </div>
      <div className="hidden text-right text-[11px] leading-tight text-slate-400 sm:block wide:hidden">
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
  /** The move being aimed (for Transform, the copied move). */
  aimOpt: MoveOption | undefined;
  treb: ReturnType<typeof trebuchetOption> | null;
  aim: Aim | null;
  aimDir: Dir | null;
  aimTarget: string | null;
  aimBlocked: string | null;
  touch: boolean;
  isPost: boolean;
  postBudget: number;
  remaining: Unit[];
  confirmEnd: boolean;
  setConfirmEnd: (v: boolean) => void;
  onAim: (a: Aim | null) => void;
  onFireDir: (d: Dir) => void;
  onFireAt: (id: string) => void;
  onSelfMove: (i: 0 | 1) => void;
  onHoverMove: (i: 0 | 1 | null) => void;
  send: (a: Action) => void;
}) {
  const { ctl, unit, myTurn, opts, aimOpt, treb, aim, aimDir, aimTarget, aimBlocked, touch, isPost, postBudget, remaining, confirmEnd, setConfirmEnd, onAim, onFireDir, onFireAt, onSelfMove, onHoverMove, send } = props;
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

  if (aim?.kind === 'move' && opts[aim.index]?.aim === 'copy' && !aim.copy) {
    // Transform: pick the move to borrow first.
    const copies = opts[aim.index].copies ?? [];
    return (
      <div className="panel space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">Transform: choose a move to copy</span>
          <button type="button" className="btn-ghost" onClick={() => onAim(null)}>Cancel</button>
        </div>
        <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {copies.map((cp) => {
            const src = s.units.find((x) => x.id === cp.unitId)!;
            return (
              <button
                key={`${cp.unitId}-${cp.moveIndex}`}
                type="button"
                onClick={() => (cp.aim === 'none' ? send({ type: 'useMove', unitId: unit.id, moveIndex: aim.index, copy: { unitId: cp.unitId, moveIndex: cp.moveIndex } }) : onAim({ ...aim, copy: cp }))}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-left hover:border-amber-300"
              >
                <Art id={src.cardId} className="h-7 w-7 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-400">{cardOf(src).name}</span>
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    {cp.move.name} {cp.move.type && <TypeBadge type={cp.move.type} small />}
                    <span className="text-xs text-amber-300">{cp.move.powerLabel ?? cp.move.power ?? ''}</span>
                  </span>
                </span>
                <MiniGrid move={cp.move} size={7} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (aim && aim.kind !== 'special') {
    const isTreb = aim.kind === 'treb';
    const opt = !isTreb ? aimOpt : null;
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
            <span className="font-bold">{isTreb ? 'Trebuchet' : move!.name}{aim.kind === 'move' && aim.copy ? ' (Transform)' : ''}</span>
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
        {isTreb && treb && (
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            Fires as {treb.types.map((t) => <TypeBadge key={t} type={t} small />)}{treb.types.length > 1 ? ' — whichever hits the target hardest' : ''}
          </div>
        )}
        <p className="text-xs text-slate-400">{move?.text || (isTreb ? 'A flat 40 of whichever of the user’s types does the most damage to the target. Stat stages, abilities, terrain and burns don’t change it.' : '')}</p>
        <p className={`text-xs ${aimBlocked ? 'text-rose-300' : 'text-amber-200/90'}`}>{aimBlocked ?? hint}</p>
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
          {opts.filter((o) => !o.move.fx.none).map((o) => (
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

function PendingModal({ ctl, view }: { ctl: Controller; view: BoardView }) {
  const s = ctl.state;
  const p = s.pending[0];
  const [hover, setHover] = useState<string | null>(null);
  if (!p || !ctl.mySides.includes(p.side)) return null;
  const u = s.units.find((x) => x.id === p.unitId)!;
  const choose = (option: string | null) => {
    setHover(null);
    ctl.dispatch({ type: 'choose', option });
  };
  // Direction labels follow the board as drawn (it is turned a quarter turn on portrait phones).
  const word: Record<Dir, string> = { N: 'Up', E: 'Right', S: 'Down', W: 'Left' };
  const dirLabel = (d: Dir): string => {
    const sd = screenDir(d, view);
    return `${ARROW[sd]} ${word[sd]}`;
  };
  const previewList = (pv: TargetPreview[]) => pv.length > 0 && (
    <div className="mt-2 space-y-0.5 text-xs text-slate-300">
      {pv.map((x) => (
        <div key={x.unitId}>
          {cardOf(s.units.find((q) => q.id === x.unitId)!).name}: {x.kind === 'damage' ? `${x.min}–${x.max}` : x.kind} {x.notes.join(', ')}
        </div>
      ))}
    </div>
  );

  if (p.kind === 'emergencyExit' || p.kind === 'imposter') {
    const exit = p.kind === 'emergencyExit';
    return (
      <Modal>
        <h3 className="text-lg font-bold">{exit ? 'Emergency Exit!' : 'Imposter'}</h3>
        <p className="mb-3 text-sm text-slate-300">
          {exit ? `${cardOf(u).name} dropped below 100 HP and must switch places with an ally.` : `${cardOf(u).name} may copy the stat changes of a Pokémon beside it.`}
        </p>
        <div className="grid gap-2">
          {p.options.map((id) => {
            const a = s.units.find((x) => x.id === id)!;
            const st = (['atk', 'def', 'mov'] as const).filter((k) => a.stages[k]).map((k) => `${k === 'atk' ? 'Atk' : k === 'def' ? 'Def' : 'Mov'} ${a.stages[k] > 0 ? '+' : ''}${a.stages[k]}`);
            return (
              <button key={id} type="button" className="btn-ghost justify-start" onClick={() => choose(id)}>
                <Art id={a.cardId} className="h-8 w-8 rounded-full" />
                {cardOf(a).name}
                <span className="text-xs text-slate-400">{exit ? `(${a.hp} HP)` : st.join(', ') || 'no stat changes'}</span>
              </button>
            );
          })}
        </div>
        {!exit && <button type="button" className="btn-ghost mt-3 w-full" onClick={() => choose(null)}>Keep its own</button>}
      </Modal>
    );
  }

  if (p.kind === 'metronome') {
    const card = getCard(p.cardId);
    const label = (o: string) => {
      const cut = o.indexOf(':');
      const m = card.moves[Number(o.slice(0, cut))];
      const aim = parseAim(o.slice(cut + 1));
      const where = aim.dir ? dirLabel(aim.dir) : aim.targetId ? `at ${cardOf(s.units.find((x) => x.id === aim.targetId)!).name}` : '';
      return { m, where, aim };
    };
    const hovered = hover ? label(hover) : null;
    const pv = hovered ? previewAction(s, u.id, 0, { ...hovered.aim, move: hovered.m }) : [];
    return (
      <Modal>
        <h3 className="text-lg font-bold">Metronome drew {card.name}!</h3>
        <p className="mb-3 text-sm text-slate-300">Choose one of {card.name}’s moves for {cardOf(u).name} to use, and how to aim it.</p>
        <div className="grid grid-cols-2 gap-2">
          {p.options.map((o) => {
            const { m, where } = label(o);
            return (
              <button key={o} type="button" className="btn-ghost justify-start text-left" onMouseEnter={() => setHover(o)} onFocus={() => setHover(o)} onClick={() => choose(o)}>
                <span className="font-semibold">{m.name}</span> <span className="text-xs text-slate-400">{where}</span>
              </button>
            );
          })}
        </div>
        {previewList(pv)}
      </Modal>
    );
  }

  // Liquid Voice (optional, as Water) and Dancer (mandatory, as printed): aim a copied move.
  const src = getCard(p.source.cardId).moves[p.source.moveIndex];
  const dancer = p.kind === 'dancer';
  const pv = hover ? previewAction(s, u.id, 0, dancer ? { dir: hover as Dir, move: src } : { dir: hover as Dir, copyOf: src }) : [];
  return (
    <Modal>
      <h3 className="text-lg font-bold">{dancer ? 'Dancer' : 'Liquid Voice'}</h3>
      <p className="mb-3 text-sm text-slate-300">
        {cardOf(u).name} {dancer ? 'copies' : 'can copy'} <b>{src.name}</b>{dancer ? '' : ' as a Water-type move'}. Choose which way to aim it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {p.options.map((d) => (
          <button key={d} type="button" className="btn-ghost" onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onClick={() => choose(d)}>
            {dirLabel(d as Dir)}
          </button>
        ))}
      </div>
      {previewList(pv)}
      {!dancer && <button type="button" className="btn-ghost mt-3 w-full" onClick={() => choose(null)}>Don’t copy</button>}
    </Modal>
  );
}
