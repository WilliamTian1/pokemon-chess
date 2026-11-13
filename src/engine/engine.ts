import { CARDS, DRAFTABLE, getCard } from './data/cards';
import { DEFAULT_MAP_ID, getMap } from './data/maps';
import { TRAINER_LIST, TRAINER_POOL_SIZE, getTrainer, trainerMoveFor } from './data/trainers';
import {
  UNCOPYABLE, aimOptions, canTargetFrom, dancerOptions, emergencyExitOptions, executeMove, followMeUsers,
  isHealingMove, isSupportOnly, liquidVoiceCopy, moveOffline, parseAim, targeting, trebuchetAttack, truantRests, weatherProof,
} from './moves';
import {
  type Ctx, RuleError, applyStage, checkWin, cureStatus, dealDamage, emit, endGame, enterTile, faint, heal, log, nameOf, resetStages, triggerProtosynthesis,
} from './mutate';
import {
  abilityOf, adjacentToType, adjacentUnits, alliesOf, cardOf, effectiveMov, enemiesOf, getUnit, hasType, hazardAt, isFlier,
  hazardDamage, isTrebuchet, liveUnits, moveIndexes, moveOf, onBoard, reachable, teleportDestinations, type ReachInfo, terrainAt, terrainBonus, terrainMult, trainerOf, turnEffect, unitAt, verticalOnly,
  withAbility,
} from './query';
import type { Action, ActiveActivation, Dir, DraftStyle, GameEvent, GameState, MoveDef, Pos, Rng, Side, Unit } from './types';
import { SIDE_NAME, TYPES, otherSide } from './types';
import { cheb, posKey, samePos, steps } from './util';

export { RuleError } from './mutate';

const ALTERNATE: Side[] = ['A', 'D', 'A', 'D', 'A', 'D', 'A', 'D'];
export const DRAFT_POOL_SIZE = 15;
/** Without legendaries the pool is bigger, and all four picks per side come from it. */
export const NO_LEGEND_POOL_SIZE = 20;
export const LEGEND_POOL_SIZE = 4;
/** Picks per side from the normal pool; each side's last pick is a fully restricted legendary. */
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

/** `size` distinct normal-pool card ids, chosen uniformly at random. */
export function randomPool(rng: Rng, size = DRAFT_POOL_SIZE, includeSubrestricted = false): string[] {
  return shuffled(DRAFTABLE.filter((c) => !c.legendary || (includeSubrestricted && c.subrestricted)).map((c) => c.id), rng).slice(0, size);
}

/** `LEGEND_POOL_SIZE` distinct fully restricted legendaries, chosen uniformly at random. */
export function randomLegendPool(rng: Rng): string[] {
  return shuffled(DRAFTABLE.filter((c) => c.legendary && !c.subrestricted).map((c) => c.id), rng).slice(0, LEGEND_POOL_SIZE);
}

/** Pokémon picks per side (the trainer pick comes after them). */
export const TEAM_SIZE = 4;

/** Coins each side starts an auction with. */
export const AUCTION_COINS = 20;
/** Secret draft: legendary options each side gets. */
export const SECRET_LEGEND_OPTIONS = 3;
/** Secret draft (trainer mode): trainer options each side gets. */
export const SECRET_TRAINER_OPTIONS = 3;

export const draftStyle = (s: GameState): DraftStyle => s.draft.style ?? 'classic';
const SECRET_ORDER: Side[] = ['A', 'A', 'A', 'A', 'D', 'D', 'D', 'D'];

/**
 * Secret draft: what `side` picks next — a Pokémon, its legendary, its trainer — or null when done. Both
 * sides pick at the same time, each at its own pace.
 */
export function secretNext(s: GameState, side: Side): 'pokemon' | 'legend' | 'trainer' | null {
  const sp = s.draft.secret!;
  const n = s.draft.picks[side].length;
  if (draftStyle(s) === 'freeplay') {
    if (n < TEAM_SIZE) return 'pokemon';
    if (s.trainers && !s.trainers.picks[side]) return 'trainer';
    return null;
  }
  // Legendary mode deals both sides options (a hidden view only shows its own, so check either).
  const normals = sp.legendPools.A.length + sp.legendPools.D.length > 0 ? NORMAL_PICKS : TEAM_SIZE;
  if (n < normals) return 'pokemon';
  if (n < TEAM_SIZE) return 'legend';
  if (s.trainers && !s.trainers.picks[side]) return 'trainer';
  return null;
}

/** Whether this is the simultaneous part of a Secret draft (its picks and its blind placement). */
export const isSimultaneous = (s: GameState): boolean => (draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay') && (s.phase === 'draft' || s.phase === 'placement');

/**
 * Every side that may act right now: one side normally, both in the simultaneous Secret draft and its
 * blind placement. decider() is the first of these.
 */
export function deciders(s: GameState): Side[] {
  if (s.phase === 'over') return [];
  if (!s.pending.length && isSimultaneous(s)) {
    if (s.phase === 'draft') return (['A', 'D'] as const).filter((x) => secretNext(s, x) !== null);
    return (['A', 'D'] as const).filter((x) => s.units.some((u) => u.side === x && !u.pos && !u.fainted));
  }
  const d = decider(s);
  return d ? [d] : [];
}

/** Pick number `index` (0-based, both sides) is a trainer pick: the two picks after the eight Pokémon. */
export function isTrainerPick(s: GameState, index = s.draft.index): boolean {
  if ((draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay') && s.phase === 'draft') return index === s.draft.index && secretNext(s, decider(s)!) === 'trainer';
  return !!s.trainers && index >= 2 * TEAM_SIZE;
}

/**
 * Whether pick number `index` (0-based, both sides) is a legendary pick. Without legendaries (an empty
 * legendary pool) all eight picks come from the normal pool.
 */
export function isLegendPick(s: GameState, index = s.draft.index): boolean {
  if (index >= 2 * TEAM_SIZE) return false;
  const style = draftStyle(s);
  if (style === 'auction') return false;
  if (style === 'secret' || style === 'freeplay') return s.phase === 'draft' && index === s.draft.index && secretNext(s, decider(s)!) === 'legend';
  return s.draft.legendPool.length > 0 && index >= 2 * NORMAL_PICKS;
}

/** Card (or trainer) ids the side on the clock (or, in a Secret draft, `side`) may draft right now. */
export function draftOptions(s: GameState, side?: Side): string[] {
  if (s.phase !== 'draft') return [];
  if (draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay') {
    const who = side ?? decider(s);
    if (!who) return [];
    const sp = s.draft.secret!;
    const next = secretNext(s, who);
    if (next === 'trainer') {
      const offered = sp.trainerPools?.[who] ?? [];
      return draftStyle(s) === 'freeplay' ? offered : offered.filter((id) => s.trainers!.picks.A !== id && s.trainers!.picks.D !== id);
    }
    if (draftStyle(s) === 'freeplay') {
      const offered = next === 'legend' ? sp.legendPools[who] : next === 'pokemon' ? [...sp.pools[who], ...sp.legendPools[who]] : [];
      return offered.filter((id) => !s.draft.picks[who].includes(id));
    }
    const taken = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
    return (next === 'legend' ? sp.legendPools[who] : next === 'pokemon' ? sp.pools[who] : []).filter((id) => !taken.has(id));
  }
  if (isTrainerPick(s)) {
    const t = s.trainers!;
    return t.pool.filter((id) => t.picks.A !== id && t.picks.D !== id);
  }
  const taken = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
  if (draftStyle(s) === 'auction') return [];
  return (isLegendPick(s) ? s.draft.legendPool : s.draft.pool).filter((id) => !taken.has(id));
}

/** `TRAINER_POOL_SIZE` distinct trainers, chosen uniformly at random. */
export function randomTrainerPool(rng: Rng): string[] {
  return shuffled(TRAINER_LIST.map((t) => t.id), rng).slice(0, TRAINER_POOL_SIZE);
}

/**
 * A new match. The draft pools are drawn from `rng` unless given; `legendaries: false` drafts without
 * them, and `trainers: true` adds a trainer pick for each side after the draft.
 */
export function newGame(opts: {
  rng: Rng; mapId?: string; pool?: string[]; legendPool?: string[]; legendaries?: boolean; trainers?: boolean; trainerPool?: string[];
  style?: DraftStyle;
}): GameState {
  const trainers = !!opts.trainers || !!opts.trainerPool;
  const style = opts.style ?? 'classic';
  if (style !== 'classic') return styledGame(opts, style);
  return {
    version: 1,
    mapId: opts.mapId ?? DEFAULT_MAP_ID,
    phase: 'draft',
    round: 1,
    maxRounds: MAX_ROUNDS,
    side: 'A',
    draft: {
      order: trainers ? [...ALTERNATE, 'A', 'D'] : [...ALTERNATE], index: 0, picks: { A: [], D: [] }, style: 'classic',
      pool: opts.pool ?? randomPool(opts.rng, opts.legendaries === false ? NO_LEGEND_POOL_SIZE : DRAFT_POOL_SIZE, opts.legendaries !== false),
      legendPool: opts.legendPool ?? (opts.legendaries === false ? [] : randomLegendPool(opts.rng)),
    },
    placement: { order: [...ALTERNATE], index: 0 },
    units: [],
    hazards: [],
    substitute: null,
    futureSight: [],
    wishes: [],
    perishSongs: [],
    taunted: null,
    trainers: trainers
      ? {
          pool: opts.trainerPool ?? randomTrainerPool(opts.rng), picks: { A: null, D: null }, hiddenPowerType: { A: null, D: null },
          used: { A: false, D: false }, effect: null,
        }
      : null,
    active: null,
    pending: [],
    winner: null,
    winReason: null,
    log: [],
    logCounter: 0,
    seq: 0,
  };
}

/** Secret draft and Auction: the classic game, with the pools dealt the style's way. */
function styledGame(opts: Parameters<typeof newGame>[0], style: DraftStyle): GameState {
  const legendaries = opts.legendaries !== false;
  const size = legendaries ? DRAFT_POOL_SIZE : NO_LEGEND_POOL_SIZE;
  const normalCards = DRAFTABLE.filter((c) => !c.legendary || (legendaries && c.subrestricted));
  const fullLegends = DRAFTABLE.filter((c) => c.legendary && !c.subrestricted);
  const normals = shuffled(normalCards.map((c) => c.id), opts.rng);
  const legends = shuffled(fullLegends.map((c) => c.id), opts.rng);
  if (style === 'freeplay') {
    const allNormals = normalCards.map((c) => c.id);
    const allLegends = legendaries ? fullLegends.map((c) => c.id) : [];
    const trainerPool = TRAINER_LIST.map((t) => t.id);
    const s = newGame({
      ...opts, style: 'classic', pool: allNormals, legendPool: allLegends,
      ...((opts.trainers || opts.trainerPool) ? { trainerPool } : {}),
    });
    const pools = { A: allNormals, D: allNormals };
    const legendPools = { A: allLegends, D: allLegends };
    const trainerPools = { A: trainerPool, D: trainerPool };
    s.draft.style = 'freeplay';
    s.draft.secret = { pools, legendPools, ...(s.trainers ? { trainerPools } : {}) };
    s.draft.order = s.trainers ? [...SECRET_ORDER, 'A', 'D'] : [...SECRET_ORDER];
    return s;
  }
  if (style === 'secret') {
    const k = legendaries ? SECRET_LEGEND_OPTIONS : 0;
    const pools = { A: normals.slice(0, size), D: normals.slice(size, 2 * size) };
    const legendPools = { A: legends.slice(0, k), D: legends.slice(k, 2 * k) };
    // Each side gets its own trainer options too (three each, never the same card).
    const t = shuffled(TRAINER_LIST.map((x) => x.id), opts.rng);
    const trainerPools = { A: t.slice(0, SECRET_TRAINER_OPTIONS), D: t.slice(SECRET_TRAINER_OPTIONS, 2 * SECRET_TRAINER_OPTIONS) };
    const s = newGame({
      ...opts, style: 'classic', pool: [...pools.A, ...pools.D], legendPool: [...legendPools.A, ...legendPools.D],
      ...(opts.trainers ? { trainerPool: [...trainerPools.A, ...trainerPools.D] } : {}),
    });
    s.draft.style = 'secret';
    s.draft.secret = { pools, legendPools, ...(s.trainers ? { trainerPools } : {}) };
    s.draft.order = s.trainers ? [...SECRET_ORDER, 'A', 'D'] : [...SECRET_ORDER];
    return s;
  }
  const pool = opts.pool ?? normals.slice(0, size);
  const legendPool = opts.legendPool ?? (legendaries ? legends.slice(0, LEGEND_POOL_SIZE) : []);
  const s = newGame({ ...opts, style: 'classic', pool, legendPool });
  s.draft.style = 'auction';
  const deck = shuffled([...pool, ...legendPool], opts.rng);
  s.draft.auction = { deck, lot: null, coins: { A: AUCTION_COINS, D: AUCTION_COINS }, high: null, toAct: 'A', opener: 'D', passed: [], history: [] };
  nextLot({ s, rng: opts.rng, events: [], silent: true });
  return s;
}

function makeUnit(id: string, side: Side, cardId: string): Unit {
  const c = getCard(cardId);
  return {
    id, side, cardId, draftId: cardId, hp: c.hp, maxHp: c.hp, pos: null, fainted: false, damageTaken: 0,
    stages: { atk: 0, def: 0, mov: 0 }, status: null, toxicN: 0, confused: false, flinched: false,
    sturdyBroken: false, nextTurn: { noMove: false, noAct: false },
    turn: { noMove: false, noAct: false, reasons: [] }, activated: false, actAgain: 0, gotAfterYou: false, followMe: null, wideGuard: null,
    locked: [], dmgBonus: 0, movBonus: 0, ignoreDefBoosts: false, suckerPunchFor: null,
  };
}

/** Fast structural clone. Silent (AI) clones share the log array, which they never write. */
export function cloneState(s: GameState, shareLog = false): GameState {
  return {
    ...s,
    draft: {
      ...s.draft, picks: { A: [...s.draft.picks.A], D: [...s.draft.picks.D] },
      auction: s.draft.auction && {
        ...s.draft.auction, deck: [...s.draft.auction.deck], coins: { ...s.draft.auction.coins }, high: s.draft.auction.high && { ...s.draft.auction.high },
        passed: [...s.draft.auction.passed], history: s.draft.auction.history.map((h) => ({ ...h })),
      },
    },
    placement: { ...s.placement },
    units: s.units.map((u) => ({
      ...u,
      pos: u.pos && { x: u.pos.x, y: u.pos.y },
      stages: { ...u.stages },
      nextTurn: { ...u.nextTurn },
      turn: { noMove: u.turn.noMove, noAct: u.turn.noAct, reasons: [...u.turn.reasons] },
      followMe: u.followMe && { ...u.followMe },
      locked: [...u.locked],
    })),
    hazards: s.hazards.map((h) => ({ kind: h.kind, pos: { ...h.pos } })),
    substitute: s.substitute && { pos: { ...s.substitute.pos }, ownerId: s.substitute.ownerId },
    futureSight: s.futureSight.map((f) => ({ ...f })),
    wishes: s.wishes.map((w) => ({ ...w })),
    perishSongs: s.perishSongs.map((p) => ({ ...p, center: { ...p.center } })),
    active: s.active && { ...s.active, from: { ...s.active.from } },
    trainers: s.trainers && {
      pool: s.trainers.pool, picks: { ...s.trainers.picks }, hiddenPowerType: { ...s.trainers.hiddenPowerType },
      used: { ...s.trainers.used }, effect: s.trainers.effect && { ...s.trainers.effect },
    },
    pending: s.pending.map((p) => ({ ...p, options: [...p.options] }) as typeof p),
    log: shareLog ? s.log : [...s.log],
  };
}

/** Which side must act next (draft pick, placement, turn, or a pending choice). */
export function decider(s: GameState): Side | null {
  if (s.phase === 'over') return null;
  if (s.pending.length) return s.pending[0].side;
  if (isSimultaneous(s)) {
    // The first side that still has something to do (the other may act at the same time).
    if (s.phase === 'draft') return secretNext(s, 'A') ? 'A' : secretNext(s, 'D') ? 'D' : null;
    return s.units.some((u) => u.side === 'A' && !u.pos) ? 'A' : s.units.some((u) => u.side === 'D' && !u.pos) ? 'D' : null;
  }
  if (s.phase === 'draft') return auctionOpen(s) ? s.draft.auction!.toAct : s.draft.order[s.draft.index];
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
  if (action.type === 'timeout') {
    endGame(ctx, otherSide(action.side), `${SIDE_NAME[action.side]} ran out of time.`);
    return;
  }
  if (s.pending.length) {
    if (action.type !== 'choose') throw new RuleError('A choice must be made first.');
    resolvePending(ctx, action.option);
    return;
  }
  switch (action.type) {
    case 'draftPick': return draftPick(ctx, action.cardId, action.side);
    case 'bid': return auctionBid(ctx, action.amount);
    case 'passBid': return auctionPass(ctx);
    case 'place': return place(ctx, action.unitId, action.pos);
    case 'move': return doMove(ctx, action.unitId, action.to);
    case 'undoMove': return undoMove(ctx, action.unitId);
    case 'useMove': return useMove(ctx, action);
    case 'useFusion': return useFusion(ctx, action);
    case 'trebuchet': return useTrebuchet(ctx, action);
    case 'wait': return wait(ctx, action.unitId);
    case 'postMove': return postMove(ctx, action.unitId, action.to);
    case 'skipPostMove': return skipPostMove(ctx, action.unitId);
    case 'endTurn': return endTurn(ctx);
    case 'trainerSpecial': return trainerSpecial(ctx, action.unitId);
    case 'choose': throw new RuleError('There is nothing to choose.');
  }
}

// ---------------------------------------------------------------- draft & placement

function draftPick(ctx: Ctx, cardId: string, who?: Side): void {
  const s = ctx.s;
  if (s.phase !== 'draft') throw new RuleError('Not drafting.');
  if (draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay') return secretPick(ctx, cardId, who ?? decider(s)!);
  const side = s.draft.order[s.draft.index];
  if (isTrainerPick(s)) {
    if (!draftOptions(s).includes(cardId)) throw new RuleError('Choose one of the trainers on offer.');
    s.trainers!.picks[side] = cardId;
    log(ctx, `${SIDE_NAME[side]} chose ${getTrainer(cardId).name} as their trainer.`, 'info', side);
    s.draft.index += 1;
    if (s.draft.index >= s.draft.order.length) finishDraft(ctx);
    else s.side = s.draft.order[s.draft.index];
    return;
  }
  if (auctionOpen(s)) throw new RuleError('Bid for the lot on offer, or pass.');
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

// ---------------------------------------------------------------- hidden information

/**
 * The game as `viewer` may see it (null: a spectator). A Secret draft hides the other side's pools, picks,
 * legendary, trainer and placed Pokémon until the battle begins; an Auction hides the order of the lots
 * to come. Used for what the server sends each player, for hot-seat screens and for what bots get to see.
 */
export function hiddenView(s: GameState, viewer: Side | null): GameState {
  const d = s.draft;
  if (draftStyle(s) === 'auction' && d.auction && s.phase === 'draft') {
    // The deck's order and contents stay hidden; the legendary pool keeps its size ('?' each), which
    // says whether legendaries are on and how many the deck holds (the Hard bot's bidding needs both).
    return { ...s, draft: { ...d, pool: [], legendPool: d.legendPool.map(() => '?'), auction: { ...d.auction, deck: d.auction.deck.map(() => '?') } } };
  }
  if (!isSimultaneous(s) || !d.secret) return s;
  const see = (x: Side) => viewer === x;
  const pools = { A: see('A') ? d.secret.pools.A : [], D: see('D') ? d.secret.pools.D : [] };
  // Hidden legendary options keep their count ('?' each): it tells how many picks a side has.
  const legendPools = { A: see('A') ? d.secret.legendPools.A : d.secret.legendPools.A.map(() => '?'), D: see('D') ? d.secret.legendPools.D : d.secret.legendPools.D.map(() => '?') };
  const trainerPools = d.secret.trainerPools && { A: see('A') ? d.secret.trainerPools.A : [], D: see('D') ? d.secret.trainerPools.D : [] };
  const publicPool = (a: string[], b: string[]) => draftStyle(s) === 'freeplay' ? [...new Set([...a, ...b])] : [...a, ...b];
  const picks = { A: see('A') ? d.picks.A : d.picks.A.map(() => '?'), D: see('D') ? d.picks.D : d.picks.D.map(() => '?') };
  return {
    ...s,
    draft: { ...d, picks, pool: publicPool(pools.A, pools.D), legendPool: publicPool(legendPools.A, legendPools.D), secret: { pools, legendPools, trainerPools } },
    trainers: s.trainers && {
      ...s.trainers,
      pool: publicPool(trainerPools?.A ?? [], trainerPools?.D ?? []),
      // '?' : picked, but hidden.
      picks: { A: see('A') || !s.trainers.picks.A ? s.trainers.picks.A : '?', D: see('D') || !s.trainers.picks.D ? s.trainers.picks.D : '?' },
    },
    units: s.units.filter((u) => see(u.side)),
    // Placement messages name no Pokémon; draft messages none at all, so the log can stay.
  };
}

// ---------------------------------------------------------------- auction

/** Whether the auction is still running (afterwards the draft continues with the trainer picks). */
export const auctionOpen = (s: GameState): boolean => draftStyle(s) === 'auction' && s.phase === 'draft' && s.draft.index < 2 * TEAM_SIZE;

const hasLegend = (s: GameState, side: Side): boolean => s.draft.picks[side].some((id) => CARDS[id].legendary && !CARDS[id].subrestricted);

/** Whether `side` may bid for `cardId`: a free team slot, and at most one legendary per team. */
export function canBidFor(s: GameState, side: Side, cardId: string | null): boolean {
  if (!cardId || s.draft.picks[side].length >= TEAM_SIZE) return false;
  return !(CARDS[cardId].legendary && !CARDS[cardId].subrestricted && hasLegend(s, side));
}

function auctionBid(ctx: Ctx, amount: number): void {
  const s = ctx.s;
  if (!auctionOpen(s)) throw new RuleError('There is no auction running.');
  const a = s.draft.auction!;
  const side = a.toAct;
  if (!Number.isInteger(amount) || amount < 0) throw new RuleError('Bids are whole numbers of coins.');
  if (amount > a.coins[side]) throw new RuleError(`You only have ${a.coins[side]} coins.`);
  if (a.high && amount <= a.high.amount) throw new RuleError(`Bid more than ${a.high.amount}.`);
  a.high = { side, amount };
  log(ctx, `${SIDE_NAME[side]} bids ${amount} for ${CARDS[a.lot!].name}.`, 'info', side);
  const other = otherSide(side);
  if (canBidFor(s, other, a.lot) && a.coins[other] > amount && !a.passed.includes(other)) {
    a.toAct = other;
    s.side = other;
  } else {
    settleLot(ctx, side, amount);
  }
}

function auctionPass(ctx: Ctx): void {
  const s = ctx.s;
  if (!auctionOpen(s)) throw new RuleError('There is no auction running.');
  const a = s.draft.auction!;
  const side = a.toAct;
  if (a.high) {
    settleLot(ctx, a.high.side, a.high.amount);
    return;
  }
  a.passed.push(side);
  log(ctx, `${SIDE_NAME[side]} passes on ${CARDS[a.lot!].name}.`, 'info', side);
  const other = otherSide(side);
  if (canBidFor(s, other, a.lot) && !a.passed.includes(other)) {
    a.toAct = other;
    s.side = other;
  } else {
    settleLot(ctx, null, 0);
  }
}

function settleLot(ctx: Ctx, winner: Side | null, price: number): void {
  const s = ctx.s;
  const a = s.draft.auction!;
  const id = a.lot!;
  if (winner) {
    s.draft.picks[winner].push(id);
    a.coins[winner] -= price;
    log(ctx, `${SIDE_NAME[winner]} wins ${CARDS[id].name} for ${price} coin${price === 1 ? '' : 's'}.`, 'good', winner);
  } else {
    log(ctx, `Nobody bid for ${CARDS[id].name}; it leaves the auction.`, 'info');
  }
  a.history.push({ cardId: id, winner, price });
  a.lot = null;
  a.high = null;
  a.passed = [];
  // Out of coins: the rest of the team is dealt at random.
  for (const side of ['A', 'D'] as const) if (a.coins[side] <= 0) fillAtRandom(ctx, side);
  nextLot(ctx);
}

/** Deals `side` random cards until its team is full: from the lots still to come, then any unused card. */
function fillAtRandom(ctx: Ctx, side: Side): void {
  const s = ctx.s;
  const a = s.draft.auction!;
  const dealt: string[] = [];
  while (s.draft.picks[side].length < TEAM_SIZE) {
    const fromDeck = a.deck.map((id, i) => ({ id, i })).filter(({ id }) => canBidFor(s, side, id));
    let id: string;
    if (fromDeck.length) {
      const k = fromDeck[ctx.rng.int(fromDeck.length)];
      a.deck.splice(k.i, 1);
      id = k.id;
    } else {
      const used = new Set([...s.draft.picks.A, ...s.draft.picks.D, ...a.history.map((h) => h.cardId)]);
      const spare = s.draft.pool.filter((id) => !used.has(id));
      id = spare[ctx.rng.int(spare.length)];
    }
    s.draft.picks[side].push(id);
    a.history.push({ cardId: id, winner: side, price: 0, random: true });
    dealt.push(CARDS[id].name);
  }
  if (dealt.length) log(ctx, `${SIDE_NAME[side]}'s team is filled at random: ${dealt.join(', ')}.`, 'info', side);
}

/** Reveals the next lot anyone can bid for, or ends the auction. */
function nextLot(ctx: Ctx): void {
  const s = ctx.s;
  const a = s.draft.auction!;
  for (;;) {
    const full = (['A', 'D'] as const).every((side) => s.draft.picks[side].length >= TEAM_SIZE);
    if (full) break;
    if (!a.deck.length) {
      for (const side of ['A', 'D'] as const) fillAtRandom(ctx, side);
      break;
    }
    const id = a.deck.shift()!;
    const can = (['A', 'D'] as const).filter((side) => canBidFor(s, side, id));
    if (!can.length) {
      a.history.push({ cardId: id, winner: null, price: 0 });
      continue;
    }
    a.lot = id;
    a.opener = otherSide(a.opener);
    a.toAct = can.includes(a.opener) ? a.opener : can[0];
    s.side = a.toAct;
    log(ctx, `Up for auction: ${CARDS[id].name}.`, 'system');
    return;
  }
  a.lot = null;
  s.draft.index = 2 * TEAM_SIZE;
  log(ctx, `The auction is over. Attacker: ${s.draft.picks.A.map((id) => CARDS[id].name).join(', ')}. Defender: ${s.draft.picks.D.map((id) => CARDS[id].name).join(', ')}.`, 'system');
  if (s.draft.index >= s.draft.order.length) finishDraft(ctx);
  else s.side = s.draft.order[s.draft.index];
}

/** Secret draft: `side` picks its next Pokémon, legendary or trainer, in secret. */
function secretPick(ctx: Ctx, cardId: string, side: Side): void {
  const s = ctx.s;
  const next = secretNext(s, side);
  if (!next) throw new RuleError('Your picks are done: waiting for the other side.');
  if (!draftOptions(s, side).includes(cardId)) {
    throw new RuleError(next === 'trainer' ? 'Pick one of your trainer options.' : next === 'legend' ? 'Pick one of your legendary options.' : 'That card is not in your pool.');
  }
  if (next === 'trainer') s.trainers!.picks[side] = cardId;
  else s.draft.picks[side].push(cardId);
  log(ctx, `${SIDE_NAME[side]} made a secret pick.`, 'info', side);
  s.draft.index += 1;
  if (secretNext(s, 'A') === null && secretNext(s, 'D') === null) finishDraft(ctx);
  else s.side = decider(s)!;
}

/** Turns the picks into units; placement follows, Attacker first. */
function finishDraft(ctx: Ctx): void {
  const s = ctx.s;
  for (const sd of ['A', 'D'] as const) {
    s.draft.picks[sd].forEach((id, i) => {
      const u = makeUnit(`${sd}${i}`, sd, id);
      const trainerId = trainerOf(s, sd);
      if (trainerId) u.trainerMove = trainerMoveFor(trainerId, s.trainers?.hiddenPowerType[sd]) ?? undefined;
      s.units.push(u);
    });
  }
  s.phase = 'placement';
  s.placement = { order: [...ALTERNATE], index: 0 };
  s.side = 'A';
  for (const u of s.units.filter((x) => abilityOf(x) === 'omnipotent')) {
    s.pending.push({ kind: 'arceusType', side: u.side, unitId: u.id, options: [...TYPES] });
  }
  log(ctx, draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay'
    ? 'Draft complete. Both sides place their Pokémon in secret.'
    : 'Draft complete. The Attacker places first.', 'system');
}

function place(ctx: Ctx, unitId: string, pos: Pos): void {
  const s = ctx.s;
  if (s.phase !== 'placement') throw new RuleError('Not in the placement phase.');
  const u = getUnit(s, unitId);
  // Secret draft: both sides place at the same time, in any order, without seeing each other.
  const secret = isSimultaneous(s);
  const side = secret ? u.side : s.placement.order[s.placement.index];
  if (u.side !== side) throw new RuleError('Not your Pokémon.');
  if (u.pos) throw new RuleError('Already placed.');
  if (!getMap(s.mapId).spawns[side].some((p) => samePos(p, pos))) throw new RuleError('Pokémon must be placed on your spawn tiles.');
  if (unitAt(s, pos)) throw new RuleError('That spawn tile is taken.');
  u.pos = { x: pos.x, y: pos.y };
  log(ctx, secret ? `${SIDE_NAME[side]} placed a Pokémon in secret.` : `${SIDE_NAME[side]} placed ${cardOf(u).name}.`, 'info', side);
  s.placement.index += 1;
  if (s.placement.index >= s.placement.order.length) startBattle(ctx);
  else s.side = secret ? decider(s)! : s.placement.order[s.placement.index];
}

function startBattle(ctx: Ctx): void {
  const s = ctx.s;
  const revealing = draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay';
  s.phase = 'battle';
  s.round = 1;
  if (revealing) {
    const team = (x: Side) => s.draft.picks[x].map((id) => CARDS[id].name).join(', ');
    const trainer = (x: Side) => (s.trainers?.picks[x] ? ` with ${getTrainer(s.trainers.picks[x]!).name}` : '');
    log(ctx, `Revealed! Attacker: ${team('A')}${trainer('A')}. Defender: ${team('D')}${trainer('D')}.`, 'system');
  }
  for (const side of ['A', 'D'] as const) {
    if (trainerOf(s, side) === 'youngster-joey') {
      s.pending.push({ kind: 'trainerType', side, unitId: `${side}0`, options: [...TYPES] });
    }
  }
  log(ctx, 'The battle begins!', 'system');
  const all = liveUnits(s);
  for (const src of withAbility(s, 'sandStream')) {
    emit(ctx, { t: 'field', kind: 'sand', side: src.side });
    log(ctx, `${nameOf(src)}'s Sand Stream whips up a sandstorm.`, 'info', src.side);
    for (const x of all) if (hasType(x, 'Rock')) applyStage(ctx, x, 'def', 1, { source: src, label: 'Sand Stream' });
  }
  for (const src of withAbility(s, 'snowWarning')) {
    emit(ctx, { t: 'field', kind: 'hail', side: src.side });
    log(ctx, `${nameOf(src)}'s Snow Warning brings a snowfall.`, 'info', src.side);
    for (const x of all) if (hasType(x, 'Ice')) applyStage(ctx, x, 'def', 1, { source: src, label: 'Snow Warning' });
  }
  for (const src of withAbility(s, 'drizzle')) {
    emit(ctx, { t: 'field', kind: 'rain', side: src.side });
    log(ctx, `${nameOf(src)}'s Drizzle makes it rain.`, 'info', src.side);
    for (const x of all) {
      if (hasType(x, 'Water')) applyStage(ctx, x, 'atk', 1, { source: src, label: 'Drizzle' });
      if (hasType(x, 'Fire') && !weatherProof(s, x)) applyStage(ctx, x, 'atk', -1, { source: src, label: 'Drizzle' });
    }
  }
  for (const src of withAbility(s, 'drought')) {
    emit(ctx, { t: 'field', kind: 'sun', side: src.side });
    log(ctx, `${nameOf(src)}'s Drought intensifies the sun.`, 'info', src.side);
    for (const x of all) {
      if (hasType(x, 'Fire')) applyStage(ctx, x, 'atk', 1, { source: src, label: 'Drought' });
      if (hasType(x, 'Water') && !weatherProof(s, x)) applyStage(ctx, x, 'atk', -1, { source: src, label: 'Drought' });
    }
    triggerProtosynthesis(ctx);
  }
  startTurn(ctx, 'A');
}

// ---------------------------------------------------------------- turns

function startTurn(ctx: Ctx, side: Side): void {
  const s = ctx.s;
  s.side = side;
  s.active = null;
  log(ctx, `Round ${s.round} — ${SIDE_NAME[side]}'s turn.`, 'system', side);
  for (const u of s.units) {
    if (u.side !== side) continue;
    u.followMe = null;
    u.wideGuard = null;
    if (u.suckerPunchFor === u.side) u.suckerPunchFor = null;
  }

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
    const damage = f.damage ?? 100;
    const range = f.range ?? 3;
    log(ctx, `${nameOf(user)}'s ${f.damage ? 'Doom Desire' : 'Future Sight'} strikes!`, 'info', side);
    emit(ctx, { t: 'attack', unitId: user.id, name: f.damage ? 'Doom Desire' : 'Future Sight', tiles: liveUnits(s).filter((x) => steps(x.pos!, center) <= range).map((x) => x.pos!) });
    for (const x of liveUnits(s)) {
      if (x.id !== user.id && steps(x.pos!, center) <= range) dealDamage(ctx, x, damage, { source: user, label: f.damage ? 'Doom Desire' : 'Future Sight' });
    }
    if (checkWin(ctx)) return;
  }

  const perish = s.perishSongs.filter((x) => x.side === side);
  s.perishSongs = s.perishSongs.filter((x) => x.side !== side);
  for (const song of perish) {
    const user = getUnit(s, song.userId);
    const center = onBoard(user) ? user.pos! : song.center;
    log(ctx, `${nameOf(user)}'s Perish Song takes effect!`, 'bad', side);
    const targets = liveUnits(s).filter((x) => steps(x.pos!, center) <= 4);
    emit(ctx, { t: 'attack', unitId: user.id, name: 'Perish Song', tiles: targets.map((x) => x.pos!) });
    for (const target of targets) faint(ctx, target, null);
    if (checkWin(ctx)) return;
  }

  const wishes = s.wishes.filter((x) => x.side === side);
  s.wishes = s.wishes.filter((x) => x.side !== side);
  for (const wish of wishes) {
    const user = getUnit(s, wish.userId);
    const options = liveUnits(s, side).filter((x) => x.id !== user.id).map((x) => x.id);
    if (options.length) s.pending.push({ kind: 'wish', side, unitId: user.id, options });
    else log(ctx, `${nameOf(user)}'s Wish had no ally to heal.`, 'info', side);
  }

  for (const u of liveUnits(s, side)) {
    if (abilityOf(u) === 'omnipotent') heal(ctx, u, 30, 'Omnipotent');
    u.activated = false;
    u.actAgain = 0;
    u.gotAfterYou = false;
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
    // Truant: it can still move and use status moves, but attacks wait for odd rounds.
    if (truantRests(s, u)) flags.reasons.push('Truant: no attacks this round');
    u.turn = flags;
    if (abilityOf(u) === 'speedBoost' && s.round % 2 === 0) applyStage(ctx, u, 'mov', 1, { source: u, label: 'Speed Boost' });
  }
}

/** Movement left for a fresh activation (0 when the unit can't move this turn). */
export function movementAllowance(s: GameState, u: Unit): number {
  if (u.turn.noMove || u.status === 'slp' || u.status === 'frz') return 0;
  if (verticalOnly(s, u.side)) return getMap(s.mapId).width * getMap(s.mapId).height * 4;
  return effectiveMov(s, u) + u.movBonus + (turnEffect(s, u.side) === 'rally' ? 1 : 0);
}

/** Triage: its holder may walk this many extra tiles to a tile where it then uses a healing move. */
export const TRIAGE_EXTRA = 3;

/** Extra tiles a Triage Pokémon can reach (beyond its allowance) from which it could heal someone. */
export function triageTiles(s: GameState, u: Unit, budget: number): Map<string, ReachInfo> {
  const out = new Map<string, ReachInfo>();
  if (abilityOf(u) !== 'triage' || budget <= 0 || !canActNow(u) || !u.pos) return out;
  const heals = [...cardOf(u).moves, ...(u.trainerMove ? [u.trainerMove] : [])].filter(isHealingMove);
  if (!heals.length) return out;
  const near = reachable(s, u, budget);
  for (const [k, r] of reachable(s, u, budget + TRIAGE_EXTRA)) {
    if (near.has(k)) continue;
    const from = { ...s, units: s.units.map((x) => (x.id === u.id ? { ...x, pos: r.pos } : x)) };
    const at = from.units.find((x) => x.id === u.id)!;
    if (heals.some((m) => aimOptions(from, at, m).length > 0)) out.set(k, r);
  }
  return out;
}

/** Whether `u` could hit an opponent with a damaging move from where it stands (Taunt). */
export function canAttackAnOpponent(s: GameState, u: Unit): boolean {
  if (!u.pos || !canActNow(u)) return false;
  if (isTrebuchet(s, u.pos) && enemiesOf(s, u).length > 0 && !truantRests(s, u)) return true;
  return moveIndexes(u).some((i) => {
    const m = moveOf(u, i);
    if (m.kind !== 'attack' || moveBlocked(s, u, m)) return false;
    return aimOptions(s, u, m).some((a) => {
      const tg = targeting(s, u, m, parseAim(a));
      return tg.targets.some((t) => t.side !== u.side);
    });
  });
}

/** Why `move` can't be used by `u` this turn regardless of aim (cooldown, round parity, Taunt), if so. */
export function moveBlocked(s: GameState, u: Unit, move: MoveDef): string | null {
  const offline = moveOffline(s, u, move);
  if (offline) return offline;
  if (s.taunted === u.side && move.kind === 'status' && canAttackAnOpponent(s, u)) return 'Taunted: must use a damaging move';
  if (s.active?.unitId === u.id && s.active.mustHeal && !isHealingMove(move)) return 'Triage: must use a healing move';
  return null;
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

function walkPath(ctx: Ctx, u: Unit, path: Pos[], iceSlideFrom?: number): void {
  const walked: Pos[] = [];
  for (const p of path) {
    enterTile(ctx, u, p);
    walked.push(p);
    if (u.fainted) break;
  }
  emit(ctx, { t: 'move', unitId: u.id, path: walked, ...(iceSlideFrom !== undefined ? { iceSlideFrom } : {}) });
}

function doMove(ctx: Ctx, unitId: string, to: Pos): void {
  const s = ctx.s;
  const u = controllable(s, unitId);
  if (s.active) throw new RuleError(s.active.unitId === u.id ? 'This Pokémon has already moved.' : `Finish ${cardOf(getUnit(s, s.active.unitId)).name}'s activation first.`);
  if (u.activated) throw new RuleError(`${cardOf(u).name} has already been activated this turn.`);
  const budget = movementAllowance(s, u);
  if (budget <= 0) throw new RuleError(`${cardOf(u).name} can't move this turn.`);
  const triage = triageTiles(s, u, budget).get(posKey(to));
  const info = reachable(s, u, budget).get(posKey(to)) ?? triage;
  if (!info) throw new RuleError('That tile is out of reach.');
  if (verticalOnly(s, u.side) && info.path.some((p) => p.x !== u.pos!.x)) throw new RuleError('Your Pokémon can only move vertically this turn.');
  const fmTiles = followMeTiles(s, u, budget);
  if (fmTiles && !fmTiles.has(posKey(to))) {
    throw new RuleError(`Follow Me: ${cardOf(u).name} must move where it can attack ${followMeUsers(s, u).map((f) => cardOf(f).name).join(' / ')}.`);
  }
  s.active = {
    unitId, stage: 'moved', from: { ...u.pos! }, moveCost: info.cost, movBudget: budget,
    undoable: info.hazards === 0, postMove: 0, movedThisActivation: true,
    mustHeal: !!triage,
  };
  walkPath(ctx, u, info.path, info.iceSlideFrom);
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
  if (a.moveIndex !== 0 && a.moveIndex !== 1 && a.moveIndex !== 2) throw new RuleError('Unknown move.');
  const own = moveOf(u, a.moveIndex);
  const ownBlock = moveBlocked(s, u, own);
  if (ownBlock) throw new RuleError(`${own.name}: ${ownBlock}.`);
  let move = own;
  if (own.fx.special === 'transform' || own.fx.special === 'mimic') {
    const mimic = own.fx.special === 'mimic';
    const src = a.copy ? s.units.find((x) => x.id === a.copy!.unitId) : undefined;
    if (!src || !onBoard(src) || src.id === u.id || (a.copy!.moveIndex !== 0 && a.copy!.moveIndex !== 1)) {
      throw new RuleError(`${mimic ? 'Mimic' : 'Transform'}: choose a move of another Pokémon on the field.`);
    }
    if (mimic && src.side === u.side) throw new RuleError('Mimic can only copy an opponent’s move.');
    move = moveOf(src, a.copy!.moveIndex);
    if (UNCOPYABLE(move)) throw new RuleError(`${mimic ? 'Mimic' : 'Transform'} can't copy ${move.name}.`);
    const block = moveBlocked(s, u, move);
    if (block && !move.fx.none) throw new RuleError(`${move.name}: ${block}.`);
  }
  const tg = targeting(s, u, move, { dir: a.dir, targetId: a.targetId });
  if (!tg.ok) throw new RuleError(tg.reason ?? 'Invalid target.');
  const hitsPokemon = (move.target.kind === 'grid' || move.target.kind === 'range') && !isSupportOnly(move) && move.fx.special !== 'suckerPunch';
  enforceFollowMe(s, u, hitsPokemon ? tg.targets.map((t) => t.id) : null);

  s.active = act;
  act.undoable = false;
  if (u.confused && ctx.rng.chance(1 / 3)) {
    log(ctx, `${nameOf(u)} is confused and hurt itself!`, 'bad', u.side);
    dealDamage(ctx, u, 30, { label: 'confusion' });
    afterAction(ctx, u, 0, 0);
    return;
  }
  const copied = move !== own;
  const copyLabel = own.fx.special === 'mimic' ? 'Mimic' : 'Transform';
  if (copied) log(ctx, `${nameOf(u)} used ${copyLabel} to copy ${move.name}!`, 'info', u.side);
  const res = executeMove(ctx, u, move, { dir: a.dir, targetId: a.targetId, moveIndex: copied ? undefined : a.moveIndex, copied: copied ? copyLabel : undefined });
  afterAction(ctx, u, move.fx.postMove ?? 0, res.kos);
}

function useFusion(ctx: Ctx, a: Extract<Action, { type: 'useFusion' }>): void {
  const s = ctx.s;
  const u = controllable(s, a.unitId);
  const act = activationFor(s, u);
  if (abilityOf(u) !== 'fusion') throw new RuleError('Only Kyurem can use Fusion.');
  if (!canActNow(u)) throw new RuleError(`${cardOf(u).name} can't act this turn.`);
  const src = getUnit(s, a.copy.unitId);
  if (!onBoard(src) || !['zekrom', 'reshiram'].includes(cardOf(src).id)) {
    throw new RuleError('Fusion requires an on-field Zekrom or Reshiram.');
  }
  const move = moveOf(src, a.copy.moveIndex);
  if (move.kind !== 'attack' || move.fx.none) throw new RuleError('Fusion can only copy an attack.');
  const blocked = moveBlocked(s, u, move);
  if (blocked) throw new RuleError(`${move.name}: ${blocked}.`);
  const tg = targeting(s, u, move, { dir: a.dir, targetId: a.targetId });
  if (!tg.ok) throw new RuleError(tg.reason ?? 'Invalid target.');
  enforceFollowMe(s, u, tg.targets.map((t) => t.id));

  s.active = act;
  act.undoable = false;
  if (u.confused && ctx.rng.chance(1 / 3)) {
    log(ctx, `${nameOf(u)} is confused and hurt itself!`, 'bad', u.side);
    dealDamage(ctx, u, 30, { label: 'confusion' });
    afterAction(ctx, u, 0, 0);
    return;
  }
  const res = executeMove(ctx, u, move, { dir: a.dir, targetId: a.targetId, copied: 'Fusion' });
  afterAction(ctx, u, move.fx.postMove ?? 0, res.kos);
}

function useTrebuchet(ctx: Ctx, a: Extract<Action, { type: 'trebuchet' }>): void {
  const s = ctx.s;
  const u = controllable(s, a.unitId);
  const act = activationFor(s, u);
  if (!canActNow(u)) throw new RuleError(`${cardOf(u).name} can't act this turn.`);
  if (act.mustHeal) throw new RuleError('Triage: after walking extra tiles it must use a healing move.');
  if (!isTrebuchet(s, u.pos!)) throw new RuleError('Stand on the trebuchet to fire it.');
  if (truantRests(s, u)) throw new RuleError(`${cardOf(u).name} can only attack in odd-numbered rounds (Truant).`);
  const t = getUnit(s, a.targetId);
  if (!onBoard(t) || t.id === u.id) throw new RuleError('Choose a Pokémon to fire at.');
  if (verticalOnly(s, u.side) && t.pos.x !== u.pos!.x) throw new RuleError('Your Pokémon can only attack vertically this turn.');
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
  // Celebrate: a KO earns a whole extra activation (move and act), taken once this one ends.
  if (abilityOf(u) === 'celebrate' && kos > 0) {
    u.actAgain += 1;
    log(ctx, `${nameOf(u)} celebrates and can act again!`, 'good', u.side);
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
  if (act.mustHeal && canActNow(u)) throw new RuleError('Triage: after walking extra tiles it must use a healing move (or undo the move).');
  enforceFollowMe(s, u, null);
  s.active = act;
  finishActivation(ctx, u);
}

function postMove(ctx: Ctx, unitId: string, to: Pos): void {
  const s = ctx.s;
  const a = s.active;
  if (!a || a.unitId !== unitId || a.stage !== 'acted') throw new RuleError('No movement available after acting.');
  const u = getUnit(s, unitId);
  const budget = verticalOnly(s, u.side) ? movementAllowance(s, u) : a.postMove;
  const info = reachable(s, u, budget).get(posKey(to));
  if (!info) throw new RuleError('That tile is out of reach.');
  if (verticalOnly(s, u.side) && info.path.some((p) => p.x !== u.pos!.x)) throw new RuleError('Your Pokémon can only move vertically this turn.');
  a.movedThisActivation = true;
  walkPath(ctx, u, info.path, info.iceSlideFrom);
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
  if (onBoard(u) && u.actAgain > 0) {
    u.actAgain -= 1;
    u.activated = false;
    log(ctx, `${nameOf(u)} is ready to act again.`, 'good', u.side);
  }
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
    if (hz?.kind === 'spikes') dealDamage(ctx, u, hazardDamage(s, u, 30), { label: 'Spikes' });
    else if (hz?.kind === 'web') applyStage(ctx, u, 'mov', -1, { source: null, label: 'Sticky Web' });
  }
  if (!onBoard(u)) return;
  const ab = abilityOf(u);
  const enemies = enemiesOf(s, u);
  if (ab === 'rainDish' && (terrainAt(s, u.pos) === 'water' || adjacentToType(s, u, 'Water'))) heal(ctx, u, 30, 'Rain Dish');
  if (ab === 'regenerator' && !enemies.some((e) => steps(e.pos!, u.pos!) <= 3)) heal(ctx, u, 30, 'Regenerator');
  if (ab === 'naturalCure' && u.status && enemies.every((e) => steps(e.pos!, u.pos!) > 3)) cureStatus(ctx, u, 'Natural Cure');
  if (ab === 'hospitality') for (const a of alliesOf(s, u)) if (cheb(a.pos!, u.pos!) === 1) heal(ctx, a, 30, 'Hospitality');
  if (onBoard(u) && terrainBonus(s, u) === 'flower') heal(ctx, u, 30 * terrainMult(u), 'flowers');
  if (u.confused) {
    u.confused = false;
    log(ctx, `${nameOf(u)} snapped out of its confusion.`, 'info', u.side);
  }
  if (onBoard(u) && u.locked.length && enemies.every((e) => steps(e.pos!, u.pos!) >= 4)) {
    log(ctx, `${nameOf(u)} is far from its opponents: ${u.locked.join(', ')} can be used again.`, 'good', u.side);
    u.locked = [];
  }
  if (onBoard(u) && terrainAt(s, u.pos) === 'wonder') resetStages(ctx, u);
  if (onBoard(u) && ab === 'imposter') {
    const options = imposterOptions(s, u);
    if (options.length) s.pending.push({ kind: 'imposter', side: u.side, unitId: u.id, options });
  }
}

/** Imposter: adjacent Pokémon whose stat changes differ from the holder's. */
export function imposterOptions(s: GameState, u: Unit): string[] {
  const key = (x: Unit) => `${x.stages.atk},${x.stages.def},${x.stages.mov}`;
  return adjacentUnits(s, u).filter((x) => key(x) !== key(u)).map((x) => x.id);
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
  if (s.pending.length) return; // e.g. Imposter at the end of the last activation: choose first, then end the turn
  for (const u of s.units) {
    if (u.side !== s.side) continue;
    u.dmgBonus = 0;
    u.movBonus = 0;
    u.ignoreDefBoosts = false;
  }
  if (s.trainers?.effect?.side === s.side) s.trainers.effect = null;
  if (s.taunted === s.side) s.taunted = null;
  const stageMist = getMap(s.mapId).stageMist;
  if (s.side === 'A' && stageMist && s.round % stageMist.everyRounds === 0) {
    emit(ctx, { t: 'field', kind: 'stageMist', side: 'A' });
    log(ctx, 'A stage mist swept over the battlefield, removing all stat changes.', 'info');
    for (const u of s.units) resetStages(ctx, u);
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
  switch (p.kind) {
    case 'arceusType': {
      if (option === null || !p.options.includes(option as (typeof TYPES)[number])) throw new RuleError('Choose a type for Arceus.');
      const u = getUnit(s, p.unitId);
      if (u.fainted) throw new RuleError('Fainted Arceus cannot choose a type.');
      u.typeOverride = option as (typeof TYPES)[number];
      s.pending.shift();
      log(ctx, `${nameOf(u)} became ${option}-type.`, 'info', u.side);
      return;
    }
    case 'trainerType': {
      if (option === null || !p.options.includes(option as (typeof TYPES)[number])) throw new RuleError('Choose a type for Hidden Power.');
      if (!s.trainers || trainerOf(s, p.side) !== 'youngster-joey') throw new RuleError('Youngster Joey is not on this team.');
      s.trainers.hiddenPowerType[p.side] = option as (typeof TYPES)[number];
      for (const ally of s.units.filter((x) => x.side === p.side)) {
        ally.trainerMove = trainerMoveFor('youngster-joey', s.trainers.hiddenPowerType[p.side])!;
      }
      s.pending.shift();
      log(ctx, `${SIDE_NAME[p.side]} chose ${option} for Hidden Power.`, 'info', p.side);
      return;
    }
    case 'emergencyExit': {
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
    case 'imposter': {
      if (option !== null && !p.options.includes(option)) throw new RuleError('Choose an adjacent Pokémon to copy, or decline.');
      s.pending.shift();
      const u = getUnit(s, p.unitId);
      if (option === null || !onBoard(u)) return;
      const src = getUnit(s, option);
      u.stages = { ...src.stages };
      log(ctx, `${nameOf(u)} copied ${nameOf(src)}'s stat changes (Imposter).`, 'info', u.side);
      return;
    }
    case 'teleport': {
      if (option === null || !p.options.includes(option)) throw new RuleError('Choose a destination for Teleport.');
      const u = getUnit(s, p.unitId);
      if (!onBoard(u)) throw new RuleError('Fainted Pokémon cannot teleport.');
      const [x, y] = option.split(',').map(Number);
      const to = { x, y };
      if (!teleportDestinations(s, u).some((dest) => samePos(dest, to))) throw new RuleError('That Teleport destination is no longer available.');
      s.pending.shift();
      enterTile(ctx, u, to);
      emit(ctx, { t: 'move', unitId: u.id, path: [to] });
      log(ctx, `${nameOf(u)} teleported to a tile beside an ally!`, 'info', u.side);
      return;
    }
    case 'wish': {
      if (option === null || !p.options.includes(option)) throw new RuleError('Choose an ally for Wish.');
      const target = getUnit(s, option);
      if (!onBoard(target) || target.side !== p.side) throw new RuleError('That ally is no longer available for Wish.');
      s.pending.shift();
      heal(ctx, target, target.maxHp, 'Wish');
      return;
    }
    case 'voltSwitch': {
      if (option === null || !p.options.includes(option)) throw new RuleError('Choose an ally to switch with.');
      const user = getUnit(s, p.unitId);
      const ally = getUnit(s, option);
      if (!onBoard(user) || !onBoard(ally) || ally.side !== user.side) throw new RuleError('That ally is no longer available.');
      const a = { ...user.pos! };
      const b = { ...ally.pos! };
      s.pending.shift();
      (user as Unit).pos = null;
      enterTile(ctx, ally, a);
      if (!user.fainted) enterTile(ctx, user, b);
      emit(ctx, { t: 'move', unitId: user.id, path: [b] });
      emit(ctx, { t: 'move', unitId: ally.id, path: [a] });
      log(ctx, `${nameOf(user)} switched places with ${nameOf(ally)}!`, 'info', user.side);
      checkWin(ctx);
      return;
    }
    case 'metronome': {
      if (option === null || !p.options.includes(option)) throw new RuleError('Choose one of the drawn moves.');
      s.pending.shift();
      const u = getUnit(s, p.unitId);
      if (!onBoard(u)) return;
      const cut = option.indexOf(':');
      const move = getCard(p.cardId).moves[Number(option.slice(0, cut)) as 0 | 1];
      const aim = { ...parseAim(option.slice(cut + 1)), allowEmpty: true };
      if (!targeting(s, u, move, aim).ok) {
        log(ctx, `${nameOf(u)}'s ${move.name} has nothing left to hit.`, 'info', u.side);
        return;
      }
      executeMove(ctx, u, move, { ...aim, copied: 'Metronome' });
      checkWin(ctx);
      return;
    }
    case 'dancer': {
      if (option === null || !p.options.includes(option as Dir)) throw new RuleError('Choose which way to aim the copied dance.');
      s.pending.shift();
      const d = getUnit(s, p.unitId);
      const move = getCard(p.source.cardId).moves[p.source.moveIndex];
      if (!dancerOptions(s, d, move).includes(option as Dir)) {
        log(ctx, `${nameOf(d)}'s copied dance has nothing left to hit.`, 'info', d.side);
        return;
      }
      executeMove(ctx, d, move, { dir: option as Dir, copied: 'Dancer', noEcho: true });
      checkWin(ctx);
      return;
    }
    case 'liquidVoice': {
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
      executeMove(ctx, prim, copy, { dir, moveType: 'Water', copied: 'Liquid Voice copy', noEcho: true });
      checkWin(ctx);
    }
  }
}

// ---------------------------------------------------------------- trainers

/** Whether `side` can use its trainer's Special Move right now (trainer mode, once per game, between activations). */
export function canUseSpecial(s: GameState, side: Side): boolean {
  return s.phase === 'battle' && s.side === side && !!s.trainers && !!trainerOf(s, side) && !s.trainers.used[side]
    && !s.active && !s.pending.length;
}

/** Pokémon Nobunaga's special can boost: the side's Pokémon that haven't been activated this turn. */
export function specialTargets(s: GameState, side: Side): string[] {
  const trainer = trainerOf(s, side);
  return liveUnits(s, side).filter((u) => trainer === 'motochika' || !u.activated).map((u) => u.id);
}

function trainerSpecial(ctx: Ctx, unitId?: string): void {
  const s = ctx.s;
  if (s.phase !== 'battle') throw new RuleError('The battle has not started.');
  const side = s.side;
  const id = trainerOf(s, side);
  if (!s.trainers || !id) throw new RuleError('There are no trainers in this match.');
  if (s.trainers.used[side]) throw new RuleError(`${getTrainer(id).name}'s Special Move has already been used.`);
  if (s.active) throw new RuleError('Finish the current Pokémon’s activation first.');
  const name = getTrainer(id).name;
  let boosted: Unit | null = null;
  if (id === 'nobunaga' || id === 'motochika') {
    boosted = (unitId && s.units.find((x) => x.id === unitId)) || null;
    if (!boosted || boosted.side !== side || boosted.fainted || !specialTargets(s, side).includes(boosted.id)) {
      throw new RuleError(id === 'nobunaga'
        ? `${name}: choose one of your Pokémon that hasn't been activated this turn.`
        : `${name}: choose one of your Pokémon.`);
    }
  }
  emit(ctx, { t: 'special', side, trainer: id });
  log(ctx, `${SIDE_NAME[side]}'s trainer ${name} used their Special Move!`, 'system', side);
  s.trainers.used[side] = true;
  switch (id) {
    case 'mitsuhide':
      for (const x of liveUnits(s)) resetStages(ctx, x);
      s.trainers.effect = { side, kind: 'sureHit' };
      log(ctx, 'Every move hits for the rest of this turn.', 'info', side);
      break;
    case 'n':
      for (const x of liveUnits(s, side)) {
        heal(ctx, x, 50, name);
        cureStatus(ctx, x, name);
      }
      break;
    case 'nobunaga':
      boosted!.movBonus += 2;
      boosted!.dmgBonus += 30;
      boosted!.ignoreDefBoosts = true;
      log(ctx, `${nameOf(boosted!)} can move 2 extra tiles, deals 30 extra damage and ignores defense boosts this turn.`, 'good', side);
      break;
    case 'red':
    case 'blue':
      s.trainers.effect = { side, kind: 'rally' };
      log(ctx, `For the rest of this turn the team moves 1 extra tile and deals 20 extra damage per fainted teammate.`, 'good', side);
      break;
    case 'lance':
      s.trainers.effect = { side, kind: 'push2' };
      log(ctx, 'For the rest of this turn every attack pushes its target back two tiles.', 'good', side);
      break;
    case 'hideyoshi':
      s.trainers.effect = { side, kind: 'perfectRolls' };
      log(ctx, 'All damage dice roll 6, and positive secondary effects are twice as likely for the rest of this turn.', 'good', side);
      break;
    case 'jessie-james':
      s.trainers.effect = { side, kind: 'vertical' };
      log(ctx, 'Your Pokémon can move and attack vertically only for the rest of this turn.', 'good', side);
      break;
    case 'hiker-paul':
      s.trainers.effect = { side, kind: 'terrainBreak' };
      log(ctx, 'Pokémon on terrain without bonuses deal 40 extra damage to Pokémon on bonus terrain this turn.', 'good', side);
      break;
    case 'youngster-joey':
      for (const x of liveUnits(s, side)) heal(ctx, x, x.maxHp, name);
      break;
    case 'motochika':
      for (const x of liveUnits(s, side)) {
        if (x.id === boosted!.id || cheb(x.pos!, boosted!.pos!) === 1) {
          applyStage(ctx, x, 'atk', 2, { source: boosted, label: name });
        }
      }
      break;
    case 'motonari':
      for (const x of liveUnits(s, side)) applyStage(ctx, x, 'mov', 1, { source: x, label: name });
      break;
  }
  checkWin(ctx);
}

// ---------------------------------------------------------------- helpers for tests / quick play

/** Builds a game that skips the draft (and optionally placement). */
/**
 * A match that starts from ready-made teams (Secret draft, Auction, training games): the draft is
 * skipped, then the trainer pick (trainer mode) and placement follow as usual.
 */
export function gameFromTeams(teams: Record<Side, string[]>, opts: { rng: Rng; mapId?: string; trainers?: boolean; trainerPool?: string[] }): GameState {
  const s = newGame({ rng: opts.rng, mapId: opts.mapId, pool: [], legendPool: [], trainers: opts.trainers, trainerPool: opts.trainerPool });
  s.draft.picks = { A: [...teams.A], D: [...teams.D] };
  s.draft.index = 2 * TEAM_SIZE;
  if (s.trainers) s.side = s.draft.order[s.draft.index];
  else finishDraft({ s, rng: opts.rng, events: [], silent: true });
  return s;
}

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
