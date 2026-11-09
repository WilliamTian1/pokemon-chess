import { CARDS, DRAFTABLE, getCard } from './data/cards';
import { DEFAULT_MAP_ID, getMap } from './data/maps';
import {
  canTargetFrom, emergencyExitOptions, executeMove, followMeUsers, isSupportOnly, liquidVoiceCopy, targeting, trebuchetAttack,
} from './moves';
import {
  type Ctx, RuleError, applyStage, checkWin, cureStatus, dealDamage, emit, endGame, enterTile, heal, log, nameOf,
} from './mutate';
import {
  abilityOf, adjacentToType, alliesOf, cardOf, effectiveMov, enemiesOf, getUnit, hasType, hazardAt, isFlier,
  isTrebuchet, liveUnits, moveOf, onBoard, reachable, terrainAt, terrainBonus, unitAt, withAbility,
} from './query';
import type { Action, ActiveActivation, Dir, GameEvent, GameState, Pos, Rng, Side, Unit } from './types';
import { SIDE_NAME, otherSide } from './types';
import { cheb, posKey, samePos, steps } from './util';

export { RuleError } from './mutate';

const ALTERNATE: Side[] = ['A', 'D', 'A', 'D', 'A', 'D', 'A', 'D'];
export const DRAFT_POOL_SIZE = 15;
/** Without legendaries the pool is bigger, and all four picks per side come from it. */
export const NO_LEGEND_POOL_SIZE = 20;
export const LEGEND_POOL_SIZE = 4;
/** Picks per side from the normal pool; each side's last pick is a legendary. */
export const NORMAL_PICKS = 3;
export const MAX_ROUNDS = 10;

function shuffled(ids: string[], rng: Rng): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `size` distinct non-legendary draftable card ids, chosen uniformly at random. */
export function randomPool(rng: Rng, size = DRAFT_POOL_SIZE): string[] {
  return shuffled(DRAFTABLE.filter((c) => !c.legendary).map((c) => c.id), rng).slice(0, size);
}

/** `LEGEND_POOL_SIZE` distinct legendaries, chosen uniformly at random. */
export function randomLegendPool(rng: Rng): string[] {
  return shuffled(DRAFTABLE.filter((c) => c.legendary).map((c) => c.id), rng).slice(0, LEGEND_POOL_SIZE);
}

/**
 * Whether pick number `index` (0-based, both sides) is a legendary pick. Without legendaries (an empty
 * legendary pool) all eight picks come from the normal pool.
 */
export const isLegendPick = (s: GameState, index = s.draft.index): boolean =>
  s.draft.legendPool.length > 0 && index >= 2 * NORMAL_PICKS;

/** Card ids the side on the clock may draft right now. */
export function draftOptions(s: GameState): string[] {
  if (s.phase !== 'draft') return [];
  const taken = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
  return (isLegendPick(s) ? s.draft.legendPool : s.draft.pool).filter((id) => !taken.has(id));
}

/** A new match. The draft pools are drawn from `rng` unless given; `legendaries: false` drafts without them. */
export function newGame(opts: { rng: Rng; mapId?: string; pool?: string[]; legendPool?: string[]; legendaries?: boolean }): GameState {
  return {
    version: 1,
    mapId: opts.mapId ?? DEFAULT_MAP_ID,
    phase: 'draft',
    round: 1,
    maxRounds: MAX_ROUNDS,
    side: 'A',
    draft: {
      order: [...ALTERNATE], index: 0, picks: { A: [], D: [] },
      pool: opts.pool ?? randomPool(opts.rng, opts.legendaries === false ? NO_LEGEND_POOL_SIZE : DRAFT_POOL_SIZE),
      legendPool: opts.legendPool ?? (opts.legendaries === false ? [] : randomLegendPool(opts.rng)),
    },
    placement: { order: [...ALTERNATE], index: 0 },
    units: [],
    hazards: [],
    substitute: null,
    futureSight: [],
    active: null,
    pending: [],
    winner: null,
    winReason: null,
    log: [],
    logCounter: 0,
    seq: 0,
  };
}

function makeUnit(id: string, side: Side, cardId: string): Unit {
  const c = getCard(cardId);
  return {
    id, side, cardId, draftId: cardId, hp: c.hp, maxHp: c.hp, pos: null, fainted: false,
    stages: { atk: 0, def: 0, mov: 0 }, status: null, toxicN: 0, confused: false, flinched: false,
    sturdyBroken: false, nextTurn: { noMove: false, noAct: false },
    turn: { noMove: false, noAct: false, reasons: [] }, activated: false, followMe: null,
  };
}

/** Fast structural clone. Silent (AI) clones share the log array, which they never write. */
export function cloneState(s: GameState, shareLog = false): GameState {
  return {
    ...s,
    draft: { order: s.draft.order, index: s.draft.index, picks: { A: [...s.draft.picks.A], D: [...s.draft.picks.D] }, pool: s.draft.pool, legendPool: s.draft.legendPool },
    placement: { ...s.placement },
    units: s.units.map((u) => ({
      ...u,
      pos: u.pos && { x: u.pos.x, y: u.pos.y },
      stages: { ...u.stages },
      nextTurn: { ...u.nextTurn },
      turn: { noMove: u.turn.noMove, noAct: u.turn.noAct, reasons: [...u.turn.reasons] },
      followMe: u.followMe && { ...u.followMe },
    })),
    hazards: s.hazards.map((h) => ({ kind: h.kind, pos: { ...h.pos } })),
    substitute: s.substitute && { pos: { ...s.substitute.pos }, ownerId: s.substitute.ownerId },
    futureSight: s.futureSight.map((f) => ({ ...f })),
    active: s.active && { ...s.active, from: { ...s.active.from } },
    pending: s.pending.map((p) => ({ ...p, options: [...p.options] }) as typeof p),
    log: shareLog ? s.log : [...s.log],
  };
}

/** Which side must act next (draft pick, placement, turn, or a pending choice). */
export function decider(s: GameState): Side | null {
  if (s.phase === 'over') return null;
  if (s.pending.length) return s.pending[0].side;
  if (s.phase === 'draft') return s.draft.order[s.draft.index];
  if (s.phase === 'placement') return s.placement.order[s.placement.index];
  return s.side;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export function applyAction(state: GameState, action: Action, rng: Rng, opts: { silent?: boolean } = {}): ApplyResult {
  const s = cloneState(state, !!opts.silent);
  const ctx: Ctx = { s, rng, events: [], silent: !!opts.silent };
  applyInPlace(ctx, action);
  s.seq += 1;
  return { state: s, events: ctx.events };
}

/** Silent look-ahead for the AI: returns the next state, or null if the action is illegal. */
export function simulate(state: GameState, action: Action, rng: Rng): GameState | null {
  const s = cloneState(state, true);
  try {
    applyInPlace({ s, rng, events: [], silent: true }, action);
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
  s.seq += 1;
  return s;
}

export function applyInPlace(ctx: Ctx, action: Action): void {
  const s = ctx.s;
  if (s.phase === 'over') throw new RuleError('The game is over.');
  if (action.type === 'concede') {
    endGame(ctx, otherSide(action.side), `${SIDE_NAME[action.side]} conceded.`);
    return;
  }
  if (s.pending.length) {
    if (action.type !== 'choose') throw new RuleError('A choice must be made first.');
    resolvePending(ctx, action.option);
    return;
  }
  switch (action.type) {
    case 'draftPick': return draftPick(ctx, action.cardId);
    case 'place': return place(ctx, action.unitId, action.pos);
    case 'move': return doMove(ctx, action.unitId, action.to);
    case 'undoMove': return undoMove(ctx, action.unitId);
    case 'useMove': return useMove(ctx, action);
    case 'trebuchet': return useTrebuchet(ctx, action);
    case 'wait': return wait(ctx, action.unitId);
    case 'postMove': return postMove(ctx, action.unitId, action.to);
    case 'skipPostMove': return skipPostMove(ctx, action.unitId);
    case 'endTurn': return endTurn(ctx);
    case 'choose': throw new RuleError('There is nothing to choose.');
  }
}

// ---------------------------------------------------------------- draft & placement

function draftPick(ctx: Ctx, cardId: string): void {
  const s = ctx.s;
  if (s.phase !== 'draft') throw new RuleError('Not drafting.');
  const side = s.draft.order[s.draft.index];
  const c = CARDS[cardId];
  if (!c || !c.draftable) throw new RuleError('That card cannot be drafted.');
  if (s.draft.picks.A.includes(cardId) || s.draft.picks.D.includes(cardId)) throw new RuleError(`${c.name} was already drafted.`);
  const legend = isLegendPick(s);
  if (legend && !s.draft.legendPool.includes(cardId)) throw new RuleError(`This pick must be one of this match's legendaries.`);
  if (!legend && !s.draft.pool.includes(cardId)) {
    if (!c.legendary) throw new RuleError(`${c.name} is not in this match's draft pool.`);
    throw new RuleError(s.draft.legendPool.length ? 'Legendaries are drafted last.' : 'This match is played without legendaries.');
  }
  s.draft.picks[side].push(cardId);
  log(ctx, `${SIDE_NAME[side]} drafted ${c.name}.`, 'info', side);
  s.draft.index += 1;
  if (s.draft.index >= s.draft.order.length) finishDraft(ctx);
  else s.side = s.draft.order[s.draft.index];
}

/** Turns the picks into units; placement follows, Attacker first. */
function finishDraft(ctx: Ctx): void {
  const s = ctx.s;
  for (const sd of ['A', 'D'] as const) {
    s.draft.picks[sd].forEach((id, i) => s.units.push(makeUnit(`${sd}${i}`, sd, id)));
  }
  s.phase = 'placement';
  s.placement = { order: [...ALTERNATE], index: 0 };
  s.side = 'A';
  log(ctx, 'Draft complete. The Attacker places first.', 'system');
}

function place(ctx: Ctx, unitId: string, pos: Pos): void {
  const s = ctx.s;
  if (s.phase !== 'placement') throw new RuleError('Not in the placement phase.');
  const side = s.placement.order[s.placement.index];
  const u = getUnit(s, unitId);
  if (u.side !== side) throw new RuleError('Not your Pokémon.');
  if (u.pos) throw new RuleError('Already placed.');
  if (!getMap(s.mapId).spawns[side].some((p) => samePos(p, pos))) throw new RuleError('Pokémon must be placed on your spawn tiles.');
  if (unitAt(s, pos)) throw new RuleError('That spawn tile is taken.');
  u.pos = { x: pos.x, y: pos.y };
  log(ctx, `${SIDE_NAME[side]} placed ${cardOf(u).name}.`, 'info', side);
  s.placement.index += 1;
  if (s.placement.index >= s.placement.order.length) startBattle(ctx);
  else s.side = s.placement.order[s.placement.index];
}

function startBattle(ctx: Ctx): void {
  const s = ctx.s;
  s.phase = 'battle';
  s.round = 1;
  log(ctx, 'The battle begins!', 'system');
  const all = liveUnits(s);
  for (const src of withAbility(s, 'sandStream')) {
    log(ctx, `${nameOf(src)}'s Sand Stream whips up a sandstorm.`, 'info', src.side);
    for (const x of all) if (hasType(x, 'Rock')) applyStage(ctx, x, 'def', 1, { source: src, label: 'Sand Stream' });
  }
  for (const src of withAbility(s, 'drizzle')) {
    log(ctx, `${nameOf(src)}'s Drizzle makes it rain.`, 'info', src.side);
    for (const x of all) {
      if (hasType(x, 'Water')) applyStage(ctx, x, 'atk', 1, { source: src, label: 'Drizzle' });
      if (hasType(x, 'Fire')) applyStage(ctx, x, 'atk', -1, { source: src, label: 'Drizzle' });
    }
  }
  for (const src of withAbility(s, 'drought')) {
    log(ctx, `${nameOf(src)}'s Drought intensifies the sun.`, 'info', src.side);
    for (const x of all) {
      if (hasType(x, 'Fire')) applyStage(ctx, x, 'atk', 1, { source: src, label: 'Drought' });
      if (hasType(x, 'Water')) applyStage(ctx, x, 'atk', -1, { source: src, label: 'Drought' });
    }
  }
  startTurn(ctx, 'A');
}

// ---------------------------------------------------------------- turns

function startTurn(ctx: Ctx, side: Side): void {
  const s = ctx.s;
  s.side = side;
  s.active = null;
  log(ctx, `Round ${s.round} — ${SIDE_NAME[side]}'s turn.`, 'system', side);
  for (const u of s.units) if (u.side === side) u.followMe = null;

  const due = s.futureSight.filter((f) => f.side === side);
  s.futureSight = s.futureSight.filter((f) => f.side !== side);
  for (const f of due) {
    const user = getUnit(s, f.userId);
    // The attack is Slowbro's own: if Slowbro has fainted since, it never arrives.
    if (!onBoard(user)) {
      log(ctx, `${nameOf(user)} fainted, so its Future Sight fizzles.`, 'info', side);
      continue;
    }
    const center = user.pos;
    log(ctx, `${nameOf(user)}'s Future Sight strikes!`, 'info', side);
    emit(ctx, { t: 'attack', unitId: user.id, name: 'Future Sight', tiles: liveUnits(s).filter((x) => steps(x.pos!, center) <= 3).map((x) => x.pos!) });
    for (const x of liveUnits(s)) {
      if (x.id !== user.id && steps(x.pos!, center) <= 3) dealDamage(ctx, x, 100, { source: user, label: 'Future Sight' });
    }
    if (checkWin(ctx)) return;
  }

  for (const u of liveUnits(s, side)) {
    u.activated = false;
    const flags = { noMove: false, noAct: false, reasons: [] as string[] };
    if (u.flinched) {
      flags.noMove = flags.noAct = true;
      flags.reasons.push('Flinched');
      u.flinched = false;
    }
    if (u.nextTurn.noMove || u.nextTurn.noAct) {
      flags.noMove ||= u.nextTurn.noMove;
      flags.noAct ||= u.nextTurn.noAct;
      flags.reasons.push('Recharging');
      u.nextTurn = { noMove: false, noAct: false };
    }
    if (u.status === 'slp' || u.status === 'frz') {
      const roll = ctx.rng.d6();
      const word = u.status === 'slp' ? 'woke up' : 'thawed out';
      if (roll >= 5) {
        log(ctx, `${nameOf(u)} ${word}! (rolled ${roll})`, 'good', side);
        u.status = null;
      } else {
        log(ctx, `${nameOf(u)} is still ${u.status === 'slp' ? 'asleep' : 'frozen'}. (rolled ${roll})`, 'bad', side);
        flags.noMove = flags.noAct = true;
        flags.reasons.push(u.status === 'slp' ? 'Asleep' : 'Frozen');
      }
    }
    if (u.status === 'par' && ctx.rng.chance(0.2)) {
      flags.noMove = flags.noAct = true;
      flags.reasons.push('Fully paralyzed');
      log(ctx, `${nameOf(u)} is fully paralyzed and can't act this turn!`, 'bad', side);
    }
    if (abilityOf(u) === 'truant' && s.round % 2 === 0) {
      flags.noMove = true;
      flags.reasons.push('Truant (even round)');
    }
    u.turn = flags;
  }
}

/** Movement left for a fresh activation (0 when the unit can't move this turn). */
export function movementAllowance(s: GameState, u: Unit): number {
  if (u.turn.noMove || u.status === 'slp' || u.status === 'frz') return 0;
  return effectiveMov(s, u);
}

export function canActNow(u: Unit): boolean {
  return !u.turn.noAct && u.status !== 'slp' && u.status !== 'frz';
}

function controllable(s: GameState, unitId: string): Unit {
  if (s.phase !== 'battle') throw new RuleError('The battle has not started.');
  const u = getUnit(s, unitId);
  if (u.side !== s.side) throw new RuleError('That Pokémon is not on the active team.');
  if (!onBoard(u)) throw new RuleError('That Pokémon has fainted.');
  return u;
}

function freshActivation(s: GameState, u: Unit): ActiveActivation {
  return {
    unitId: u.id, stage: 'moved', from: { ...u.pos! }, moveCost: 0, movBudget: movementAllowance(s, u),
    undoable: false, postMove: 0, movedThisActivation: false,
  };
}

/** Starts (or continues) the activation of `u` for an action. */
function activationFor(s: GameState, u: Unit): ActiveActivation {
  if (s.active) {
    if (s.active.unitId !== u.id) throw new RuleError(`Finish ${cardOf(getUnit(s, s.active.unitId)).name}'s activation first.`);
    if (s.active.stage !== 'moved') throw new RuleError('This Pokémon has already acted.');
    return s.active;
  }
  if (u.activated) throw new RuleError(`${cardOf(u).name} has already been activated this turn.`);
  return freshActivation(s, u);
}

// ---------------------------------------------------------------- Follow Me enforcement

/** Tiles (including the current one) from which `u` could hit one of the forcing Pokémon. */
export function followMeTiles(s: GameState, u: Unit, budget: number): Set<string> | null {
  const users = followMeUsers(s, u);
  if (!users.length || !canActNow(u) || !u.pos) return null;
  const tiles = new Set<string>();
  const candidates: Pos[] = [u.pos, ...[...reachable(s, u, budget).values()].map((r) => r.pos)];
  for (const p of candidates) if (users.some((f) => canTargetFrom(s, u, p, f))) tiles.add(posKey(p));
  return tiles.size ? tiles : null;
}

/** Throws if `u` is forced by Follow Me but the chosen action doesn't hit a forcing Pokémon. */
function enforceFollowMe(s: GameState, u: Unit, hitIds: string[] | null): void {
  const users = followMeUsers(s, u);
  if (!users.length || !canActNow(u)) return;
  const names = users.map((f) => cardOf(f).name).join(' / ');
  const canFromHere = users.some((f) => canTargetFrom(s, u, u.pos!, f));
  if (!canFromHere) {
    const moved = s.active?.unitId === u.id;
    if (!moved && followMeTiles(s, u, movementAllowance(s, u))) {
      throw new RuleError(`Follow Me: ${cardOf(u).name} must first move into range of ${names}.`);
    }
    return;
  }
  if (!hitIds || !hitIds.some((id) => users.some((f) => f.id === id))) {
    throw new RuleError(`Follow Me: ${cardOf(u).name} must target ${names}.`);
  }
}

// ---------------------------------------------------------------- actions

function walkPath(ctx: Ctx, u: Unit, path: Pos[]): void {
  const walked: Pos[] = [];
  for (const p of path) {
    enterTile(ctx, u, p);
    walked.push(p);
    if (u.fainted) break;
  }
  emit(ctx, { t: 'move', unitId: u.id, path: walked });
}

function doMove(ctx: Ctx, unitId: string, to: Pos): void {
  const s = ctx.s;
  const u = controllable(s, unitId);
  if (s.active) throw new RuleError(s.active.unitId === u.id ? 'This Pokémon has already moved.' : `Finish ${cardOf(getUnit(s, s.active.unitId)).name}'s activation first.`);
  if (u.activated) throw new RuleError(`${cardOf(u).name} has already been activated this turn.`);
  const budget = movementAllowance(s, u);
  if (budget <= 0) throw new RuleError(`${cardOf(u).name} can't move this turn.`);
  const info = reachable(s, u, budget).get(posKey(to));
  if (!info) throw new RuleError('That tile is out of reach.');
  const fmTiles = followMeTiles(s, u, budget);
  if (fmTiles && !fmTiles.has(posKey(to))) {
    throw new RuleError(`Follow Me: ${cardOf(u).name} must move where it can attack ${followMeUsers(s, u).map((f) => cardOf(f).name).join(' / ')}.`);
  }
  s.active = {
    unitId, stage: 'moved', from: { ...u.pos! }, moveCost: info.cost, movBudget: budget,
    undoable: info.hazards === 0, postMove: 0, movedThisActivation: true,
  };
  walkPath(ctx, u, info.path);
  if (u.fainted) {
    s.active = null;
    u.activated = true;
    checkWin(ctx);
  }
}

function undoMove(ctx: Ctx, unitId: string): void {
  const s = ctx.s;
  const a = s.active;
  if (!a || a.unitId !== unitId || a.stage !== 'moved' || !a.movedThisActivation) throw new RuleError('Nothing to undo.');
  if (!a.undoable) throw new RuleError('This move triggered a hazard and cannot be undone.');
  const u = getUnit(s, unitId);
  u.pos = { ...a.from };
  emit(ctx, { t: 'move', unitId, path: [a.from] });
  s.active = null;
}

function useMove(ctx: Ctx, a: Extract<Action, { type: 'useMove' }>): void {
  const s = ctx.s;
  const u = controllable(s, a.unitId);
  const act = activationFor(s, u);
  if (!canActNow(u)) throw new RuleError(`${cardOf(u).name} can't act this turn (${u.turn.reasons.join(', ') || u.status}).`);
  if (a.moveIndex !== 0 && a.moveIndex !== 1) throw new RuleError('Unknown move.');
  const move = moveOf(u, a.moveIndex);
  const tg = targeting(s, u, move, { dir: a.dir, targetId: a.targetId });
  if (!tg.ok) throw new RuleError(tg.reason ?? 'Invalid target.');
  const hitsPokemon = (move.target.kind === 'grid' || move.target.kind === 'range') && !isSupportOnly(move);
  enforceFollowMe(s, u, hitsPokemon ? tg.targets.map((t) => t.id) : null);

  s.active = act;
  act.undoable = false;
  if (u.confused && ctx.rng.chance(1 / 3)) {
    log(ctx, `${nameOf(u)} is confused and hurt itself!`, 'bad', u.side);
    dealDamage(ctx, u, 30, { label: 'confusion' });
    afterAction(ctx, u, 0, 0);
    return;
  }
  const res = executeMove(ctx, u, move, { dir: a.dir, targetId: a.targetId, moveIndex: a.moveIndex });
  afterAction(ctx, u, move.fx.postMove ?? 0, res.kos);
}

function useTrebuchet(ctx: Ctx, a: Extract<Action, { type: 'trebuchet' }>): void {
  const s = ctx.s;
  const u = controllable(s, a.unitId);
  const act = activationFor(s, u);
  if (!canActNow(u)) throw new RuleError(`${cardOf(u).name} can't act this turn.`);
  if (!isTrebuchet(s, u.pos!)) throw new RuleError('Stand on the trebuchet to fire it.');
  const t = getUnit(s, a.targetId);
  if (!onBoard(t) || t.id === u.id) throw new RuleError('Choose a Pokémon to fire at.');
  enforceFollowMe(s, u, [t.id]);
  s.active = act;
  act.undoable = false;
  if (u.confused && ctx.rng.chance(1 / 3)) {
    log(ctx, `${nameOf(u)} is confused and hurt itself!`, 'bad', u.side);
    dealDamage(ctx, u, 30, { label: 'confusion' });
    afterAction(ctx, u, 0, 0);
    return;
  }
  const res = trebuchetAttack(ctx, u, t);
  afterAction(ctx, u, 0, res.kos);
}

function afterAction(ctx: Ctx, u: Unit, movePost: number, kos: number): void {
  const s = ctx.s;
  if (checkWin(ctx)) return;
  const act = s.active!;
  if (!onBoard(u)) {
    s.active = null;
    u.activated = true;
    return;
  }
  let post = movePost;
  if (abilityOf(u) === 'runAway') post = Math.max(post, act.movBudget - act.moveCost);
  if (abilityOf(u) === 'celebrate' && kos > 0) {
    post = Math.max(post, effectiveMov(s, u));
    log(ctx, `${nameOf(u)} celebrates and can move again!`, 'good', u.side);
  }
  if (u.turn.noMove || u.status === 'slp' || u.status === 'frz') post = 0;
  if (post > 0 && reachable(s, u, post).size > 0) {
    act.stage = 'acted';
    act.postMove = post;
    act.undoable = false;
  } else {
    finishActivation(ctx, u);
  }
}

function wait(ctx: Ctx, unitId: string): void {
  const s = ctx.s;
  const u = controllable(s, unitId);
  const act = activationFor(s, u);
  enforceFollowMe(s, u, null);
  s.active = act;
  finishActivation(ctx, u);
}

function postMove(ctx: Ctx, unitId: string, to: Pos): void {
  const s = ctx.s;
  const a = s.active;
  if (!a || a.unitId !== unitId || a.stage !== 'acted') throw new RuleError('No movement available after acting.');
  const u = getUnit(s, unitId);
  const info = reachable(s, u, a.postMove).get(posKey(to));
  if (!info) throw new RuleError('That tile is out of reach.');
  a.movedThisActivation = true;
  walkPath(ctx, u, info.path);
  if (u.fainted) {
    s.active = null;
    u.activated = true;
    checkWin(ctx);
    return;
  }
  finishActivation(ctx, u);
}

function skipPostMove(ctx: Ctx, unitId: string): void {
  const s = ctx.s;
  const a = s.active;
  if (!a || a.unitId !== unitId || a.stage !== 'acted') throw new RuleError('Nothing to skip.');
  finishActivation(ctx, getUnit(s, unitId));
}

function finishActivation(ctx: Ctx, u: Unit): void {
  const s = ctx.s;
  const moved = s.active?.unitId === u.id ? s.active.movedThisActivation : false;
  if (s.active?.unitId === u.id) s.active = null;
  u.activated = true;
  if (onBoard(u)) endOfActivation(ctx, u, moved);
  checkWin(ctx);
}

/** Status ticks, hazards stayed on, positional healing abilities and terrain (README §2.2.3). */
function endOfActivation(ctx: Ctx, u: Unit, moved: boolean): void {
  const s = ctx.s;
  if (u.status === 'psn' || u.status === 'tox') {
    if (u.status === 'tox') u.toxicN += 1;
    if (abilityOf(u) === 'poisonHeal') heal(ctx, u, 30, 'Poison Heal');
    else dealDamage(ctx, u, u.status === 'tox' ? 20 * u.toxicN : 20, { label: u.status === 'tox' ? 'bad poison' : 'poison' });
  } else if (u.status === 'brn') {
    dealDamage(ctx, u, 20, { label: 'burn' });
  }
  if (!onBoard(u)) return;
  if (!moved && !isFlier(u)) {
    const hz = hazardAt(s, u.pos);
    if (hz?.kind === 'spikes') dealDamage(ctx, u, 30, { label: 'Spikes' });
    else if (hz?.kind === 'web') applyStage(ctx, u, 'mov', -1, { source: null, label: 'Sticky Web' });
  }
  if (!onBoard(u)) return;
  const ab = abilityOf(u);
  const enemies = enemiesOf(s, u);
  if (ab === 'rainDish' && (terrainAt(s, u.pos) === 'water' || adjacentToType(s, u, 'Water'))) heal(ctx, u, 30, 'Rain Dish');
  if (ab === 'regenerator' && !enemies.some((e) => steps(e.pos!, u.pos!) <= 3)) heal(ctx, u, 30, 'Regenerator');
  if (ab === 'naturalCure' && u.status && enemies.every((e) => steps(e.pos!, u.pos!) > 3)) cureStatus(ctx, u, 'Natural Cure');
  if (ab === 'hospitality') for (const a of alliesOf(s, u)) if (cheb(a.pos!, u.pos!) === 1) heal(ctx, a, 30, 'Hospitality');
  if (onBoard(u) && terrainBonus(s, u) === 'flower') heal(ctx, u, 30, 'flowers');
  if (u.confused) {
    u.confused = false;
    log(ctx, `${nameOf(u)} snapped out of its confusion.`, 'info', u.side);
  }
}

/** Units that must still attack a Follow Me user before the turn can end. */
export function followMeBlockers(s: GameState): Unit[] {
  if (s.phase !== 'battle') return [];
  return liveUnits(s, s.side).filter((u) => {
    if (u.activated) return false;
    if (s.active?.unitId === u.id && s.active.stage === 'acted') return false;
    const budget = s.active?.unitId === u.id ? 0 : movementAllowance(s, u);
    return followMeTiles(s, u, budget) !== null;
  });
}

function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'battle') throw new RuleError('The battle has not started.');
  const blockers = followMeBlockers(s);
  if (blockers.length) throw new RuleError(`Follow Me: ${blockers.map((u) => cardOf(u).name).join(', ')} must attack first.`);
  if (s.active) {
    finishActivation(ctx, getUnit(s, s.active.unitId));
    if (s.phase !== 'battle') return;
  }
  for (const u of liveUnits(s, s.side)) {
    if (u.activated) continue;
    finishActivation(ctx, u);
    if (s.phase !== 'battle') return;
  }
  if (s.side === 'D') {
    if (s.round >= s.maxRounds) {
      endGame(ctx, 'D', `The Defender survived all ${s.maxRounds} rounds.`);
      return;
    }
    s.round += 1;
  }
  startTurn(ctx, otherSide(s.side));
}

// ---------------------------------------------------------------- pending choices

function resolvePending(ctx: Ctx, option: string | null): void {
  const s = ctx.s;
  const p = s.pending[0];
  if (p.kind === 'emergencyExit') {
    const g = getUnit(s, p.unitId);
    const opts = emergencyExitOptions(s, g);
    if (!onBoard(g) || opts.length === 0) {
      s.pending.shift();
      return;
    }
    if (option === null || !opts.includes(option)) throw new RuleError('Choose an ally to switch places with.');
    const ally = getUnit(s, option);
    const a = { ...g.pos! };
    const b = { ...ally.pos! };
    s.pending.shift();
    (g as Unit).pos = null;
    enterTile(ctx, ally, a);
    if (!g.fainted) enterTile(ctx, g, b);
    emit(ctx, { t: 'move', unitId: g.id, path: [b] });
    emit(ctx, { t: 'move', unitId: ally.id, path: [a] });
    log(ctx, `${nameOf(g)} escaped by switching places with ${nameOf(ally)}!`, 'info', g.side);
    checkWin(ctx);
    return;
  }
  // Liquid Voice
  if (option !== null && !p.options.includes(option as Dir)) throw new RuleError('Choose a direction to aim the copied move.');
  s.pending.shift();
  const prim = getUnit(s, p.unitId);
  if (option === null) {
    log(ctx, `${nameOf(prim)} let the chance to copy pass.`, 'info', prim.side);
    return;
  }
  if (!onBoard(prim)) return;
  const copy = liquidVoiceCopy(getCard(p.source.cardId).moves[p.source.moveIndex]);
  const dir = option as Dir;
  if (!targeting(s, prim, copy, { dir }).ok) {
    log(ctx, `${nameOf(prim)}'s copied move has nothing left to hit.`, 'info', prim.side);
    return;
  }
  executeMove(ctx, prim, copy, { dir, moveType: 'Water', copied: true });
  checkWin(ctx);
}

// ---------------------------------------------------------------- helpers for tests / quick play

/** Builds a game that skips the draft (and optionally placement). */
export function quickGame(teamA: string[], teamD: string[], opts: { mapId?: string; rng: Rng; place?: boolean }): GameState {
  // Any 4-card teams, legendary or not: the draft rules are skipped entirely.
  let s = newGame({ rng: opts.rng, mapId: opts.mapId, pool: [], legendPool: [] });
  s.draft.picks = { A: teamA.slice(0, 4), D: teamD.slice(0, 4) };
  s.draft.index = s.draft.order.length;
  finishDraft({ s, rng: opts.rng, events: [], silent: false });
  if (opts.place === false) return s;
  const m = getMap(s.mapId);
  const placed = { A: 0, D: 0 };
  for (const side of s.placement.order) {
    const i = placed[side]++;
    s = applyAction(s, { type: 'place', unitId: `${side}${i}`, pos: m.spawns[side][i] }, opts.rng).state;
  }
  return s;
}
