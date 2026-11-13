import {
  type Action, CARD_LIST, type CardDef, type CopyOption, type Dir, type GameState, type MoveOption, type Pos, type Rng, type Side, type Unit,
  basePower, canUseSpecial, cardOf, cheb, computeDamage, decider, effectiveMov, expectedRng, getCard, getMap, getUnit, grazeApplies,
  auctionOpen, deciders, draftStyle, isTrainerPick, secretNext, specialTargets, trainerOf,
  canPass, draftOptions, isImmune, isSupportOnly, isTrebuchet, liveUnits, makeAttackCtx, mapOf, moveOf, moveOptions, moveTargets, onBoard,
  otherSide, parseGrid, posKey, reachable, seededRng, simulate, steps, terrainAt, terrainBonus, trebuchetCtx, trebuchetOption, waitBlock, zoneTiles,
} from '../engine';
import { bestDraftPick, bestTrainerPick, hasDraftModel } from './draft';
import { auctionAction, bestSecretPick, secretTrainerPick, simpleSecretPick } from './styles';
import { matchup, rateCard } from './rating';
import { type ValueModel, predictValue } from './value';

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const DIRS4: Dir[] = ['N', 'E', 'S', 'W'];

/** The next action(s) the bot wants to take for `side`. Empty when it isn't the bot's decision. */
export function decide(s: GameState, side: Side, level: Difficulty, rng: Rng): Action[] {
  // Both sides may act at once in the simultaneous Secret draft and its blind placement.
  if (s.phase === 'over' || !deciders(s).includes(side)) return [];
  if (s.pending.length) return [choosePending(s, side, level)];
  if (s.phase === 'draft') {
    if (auctionOpen(s)) return [auctionAction(s, side, level, rng)];
    if (draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay') return [{ type: 'draftPick', cardId: secretDraftPick(s, side, level, rng), side }];
    return [{ type: 'draftPick', cardId: draftPick(s, side, level, rng) }];
  }
  // Secret draft: placement is blind, so there's no opponent to plan against yet.
  if (s.phase === 'placement' && (draftStyle(s) === 'secret' || draftStyle(s) === 'freeplay')) return [simplePlacement(s, side, level === 'easy' ? 'easy' : 'medium', rng)];
  if (s.phase === 'placement') return [placeNext(s, side, level, rng)];
  return battleStep(s, side, level, rng);
}

// ---------------------------------------------------------------- draft & placement

function draftPick(s: GameState, side: Side, level: Difficulty, rng: Rng): string {
  if (isTrainerPick(s)) {
    const options = draftOptions(s);
    return level === 'easy' ? options[rng.int(options.length)] : bestTrainerPick(s, side);
  }
  if (level === 'hard' && SEARCH.draftModel && hasDraftModel(s.mapId)) return bestDraftPick(s, side);
  const pool = draftOptions(s).map(getCard);
  const mine = s.draft.picks[side].map(getCard);
  const theirs = s.draft.picks[otherSide(side)].map(getCard);
  // A little noise keeps bot drafts from repeating game after game.
  const noise = (): number => 1 + (rng.int(1000) / 1000 - 0.5) * (level === 'hard' ? 0.12 : 0.3);
  const scored = pool.map((c) => ({ c, v: draftValue(c, side, mine, theirs, level) * noise() })).sort((a, b) => b.v - a.v);
  if (level === 'easy') return scored[rng.int(Math.min(8, scored.length))].c.id;
  if (level === 'medium') return scored[rng.int(Math.min(4, scored.length))].c.id;
  return scored[0].c.id;
}

/** Secret draft: the next pick from `side`'s own options (Pokémon, legendary or trainer), seeing nothing of the other side. */
function secretDraftPick(s: GameState, side: Side, level: Difficulty, rng: Rng): string {
  if (secretNext(s, side) === 'trainer') return secretTrainerPick(s, side, level, rng);
  return draftStyle(s) === 'secret' && level === 'hard' && SEARCH.draftModel && hasDraftModel(s.mapId)
    ? bestSecretPick(s, side)
    : simpleSecretPick(s, side, level, rng);
}

function draftValue(c: CardDef, side: Side, mine: CardDef[], theirs: CardDef[], level: Difficulty): number {
  let v = rateCard(c, side).total;
  if (level !== 'hard') return v;
  // Counter-picks and synergy.
  for (const t of theirs) v += 14 * matchup(c, t);
  const types = new Set(mine.flatMap((m) => m.types));
  const sharedWeak = mine.filter((m) => m.types.some((t) => c.types.includes(t))).length;
  v -= 10 * sharedWeak;
  if (c.ability === 'drought' && mine.some((m) => m.types.includes('Fire'))) v += 25;
  if (c.ability === 'drizzle' && mine.some((m) => m.types.includes('Water'))) v += 25;
  if (c.types.includes('Fire') && mine.some((m) => m.ability === 'drought')) v += 20;
  if (c.types.includes('Water') && mine.some((m) => m.ability === 'drizzle')) v += 20;
  if (c.ability === 'chlorophyll' && types.has('Fire')) v += 15;
  if (c.ability === 'technician' && mine.some((m) => m.moves.some((mv) => mv.power !== null && mv.power <= 40))) v += 10;
  if (c.ability === 'truant') v -= 20;
  return v;
}

function placeNext(s: GameState, side: Side, level: Difficulty, rng: Rng): Action {
  if (level === 'hard') return bestPlacement(s, side, rng);
  return simplePlacement(s, side, level, rng);
}

/** Every legal placement for the side placing next in `s`. */
function placements(s: GameState): Action[] {
  const side = decider(s)!;
  const spawns = getMap(s.mapId).spawns[side].filter((p) => !liveUnits(s).some((u) => u.pos && u.pos.x === p.x && u.pos.y === p.y));
  return s.units.filter((u) => u.side === side && !u.pos).flatMap((u) => spawns.map((pos): Action => ({ type: 'place', unitId: u.id, pos })));
}

/**
 * Finishes the placement with the simple rule for both sides and scores the opening for `side`
 * (by the value network with `SEARCH.netPlacement`).
 */
function openingValue(s0: GameState, side: Side, rng: Rng): number {
  let n: GameState | null = s0;
  for (let guard = 0; n && n.phase === 'placement' && guard < 8; guard++) {
    n = simulate(n, simplePlacement(n, decider(n)!, 'medium', rng), expectedRng);
  }
  if (!n) return -Infinity;
  if (valueNet && SEARCH.netPlacement) return netValue(n, side);
  return new Evaluator(n, side, 'hard').evaluate(n);
}

/**
 * Tries each unplaced Pokémon on each free spawn and assumes the opponent answers with the
 * placement that is worst for us (one step of minimax); the rest is filled in with the simple
 * rule, and the resulting opening position is scored.
 */
function bestPlacement(s: GameState, side: Side, rng: Rng): Action {
  let bestAct: Action | null = null;
  let bestScore = -Infinity;
  for (const act of placements(s)) {
    const n = simulate(s, act, expectedRng);
    if (!n) continue;
    let score = Infinity;
    if (n.phase === 'placement' && decider(n) !== side) {
      for (const reply of placements(n)) {
        const r = simulate(n, reply, expectedRng);
        if (r) score = Math.min(score, openingValue(r, side, rng));
        if (score <= bestScore) break; // Can't beat the best choice so far.
      }
    } else {
      score = openingValue(n, side, rng);
    }
    if (score > bestScore) {
      bestScore = score;
      bestAct = act;
    }
  }
  return bestAct ?? simplePlacement(s, side, 'medium', rng);
}

function simplePlacement(s: GameState, side: Side, level: Difficulty, rng: Rng): Action {
  const spawns = getMap(s.mapId).spawns[side].filter((p) => !liveUnits(s).some((u) => u.pos && u.pos.x === p.x && u.pos.y === p.y));
  const units = s.units.filter((u) => u.side === side && !u.pos);
  if (level === 'easy') {
    return { type: 'place', unitId: units[rng.int(units.length)].id, pos: spawns[rng.int(spawns.length)] };
  }
  // Place the bulkiest Pokémon first on the most central free spawn; fast ones go to the flanks.
  const m = getMap(s.mapId);
  const cx = (m.width - 1) / 2;
  const u = [...units].sort((a, b) => rateCard(cardOf(b)).bulk - rateCard(cardOf(a)).bulk)[0];
  const fast = cardOf(u).mov >= 4;
  const pos = [...spawns].sort((a, b) => (fast ? -1 : 1) * (Math.abs(a.x - cx) - Math.abs(b.x - cx)))[0];
  return { type: 'place', unitId: u.id, pos };
}

// ---------------------------------------------------------------- evaluation

const DEF_ALIVE = [0, 420, 540, 620, 680];
const ATT_ENEMY_ALIVE = [0, 160, 280, 380, 460];

/**
 * Multipliers on the parts of the Hard evaluation, tuned by self-play (scripts/tune-eval.ts).
 * 1 everywhere reproduces the hand-set evaluation.
 */
export const EVAL = {
  /** Bonus for Pokémon still standing (Defender) / penalty per standing enemy (Attacker). */
  alive: 1,
  /** Value of a faint beyond the HP it removes. */
  ko: 1,
  /** Own and opposing HP. */
  ownHp: 1,
  oppHp: 1,
  /** Stat stages and status conditions. */
  stages: 1,
  status: 1,
  /** Attacker's pull towards the nearest reachable Defender. */
  approach: 1,
  /** Penalty for standing where the opponent can hit next turn, per role. */
  atkThreat: 1,
  defThreat: 1,
  /** Bonus for standing where this Pokémon can hit next turn, per role. */
  atkOpp: 1,
  defOpp: 1,
};

interface Weights {
  threat: number;
  opportunity: number;
  positional: boolean;
  /** Weight of the race against the round limit (0 = ignored). */
  clock: number;
}

export const WEIGHTS: Record<Difficulty, Weights> = {
  easy: { threat: 0, opportunity: 0, positional: false, clock: 0 },
  medium: { threat: 0.55, opportunity: 0.7, positional: true, clock: 0 },
  hard: { threat: 1, opportunity: 1, positional: true, clock: 120 },
};

class Evaluator {
  private readonly threatMasks = new Map<string, Uint8Array>();
  private readonly dmgCache = new Map<string, number>();
  private readonly offenseCache = new Map<string, number>();
  private readonly walkCache = new Map<string, Int16Array>();
  private readonly width: number;
  /** Hard applies the self-play-tuned EVAL multipliers; Medium keeps the hand-set evaluation. */
  private readonly tuned: boolean;
  readonly w: Weights;

  constructor(readonly s0: GameState, readonly side: Side, level: Difficulty, shareWith?: Evaluator) {
    this.w = WEIGHTS[level];
    this.tuned = level === 'hard';
    this.width = mapOf(s0).width;
    if (shareWith) {
      // Same position, other point of view: the threat masks don't depend on the side.
      for (const [k, v] of shareWith.threatMasks) this.threatMasks.set(k, v);
    } else if (this.w.threat > 0 || this.w.opportunity > 0) {
      for (const e of liveUnits(s0)) this.threatMasks.set(e.id, this.computeMask(s0, e));
    }
  }

  gapToPublic(s: GameState, u: Unit, e: Unit): number {
    return this.gapTo(s, u, e);
  }

  /** How many opponents could aim an attack at `u`'s tile next turn. */
  threatCount(s: GameState, u: Unit): number {
    const idx = u.pos!.y * this.width + u.pos!.x;
    return liveUnits(s).filter((e) => e.side !== u.side && this.actWeight(e) > 0 && (this.threatMasks.get(e.id)?.[idx] ?? 0) !== 0).length;
  }

  /** Whether `u` could faint some opponent with one attack from a tile it can reach next turn. */
  canKo(s: GameState, u: Unit): boolean {
    if (this.actWeight(u) === 0) return false;
    const mask = this.threatMasks.get(u.id);
    if (!mask) return false;
    return liveUnits(s).some((e) => {
      if (e.side === u.side) return false;
      const bits = mask[e.pos!.y * this.width + e.pos!.x];
      for (const i of [0, 1, 2] as const) if (bits & (1 << i) && this.expDamage(s, u, i, e) >= e.hp) return true;
      return false;
    });
  }

  /** Bitmask per tile of which of `e`'s attacks (bit 0/1) or the trebuchet (bit 2) could land there next turn. */
  private computeMask(s: GameState, e: Unit): Uint8Array {
    const m = mapOf(s);
    const mask = new Uint8Array(m.width * m.height);
    const budget = e.nextTurn.noMove ? 0 : effectiveMov(s, e);
    const tiles: Pos[] = [e.pos!, ...[...reachable(s, e, budget).values()].map((r) => r.pos)];
    // The round of e's next turn (Gigaton Hammer only works in even rounds).
    const round = e.side === s.side || e.side === 'D' ? s.round : s.round + 1;
    for (const idx of [0, 1] as const) {
      const mv = moveOf(e, idx);
      if (isSupportOnly(mv) || (mv.kind !== 'attack' && !mv.fx.status && !mv.fx.targetStages)) continue;
      if (e.locked.includes(mv.name) || (mv.fx.evenRoundsOnly && round % 2 !== 0)) continue;
      const bit = 1 << idx;
      if (mv.target.kind === 'grid') {
        const g = parseGrid(mv.target.grid);
        for (const p of tiles) for (const d of DIRS4) for (const z of zoneTiles(s, p, g, d)) mask[z.y * m.width + z.x] |= bit;
      } else if (mv.target.kind === 'range') {
        const r = mv.target.range;
        const min = mv.target.min ?? 0;
        for (let y = 0; y < m.height; y++) {
          for (let x = 0; x < m.width; x++) {
            if (tiles.some((p) => {
              const d = Math.abs(p.x - x) + Math.abs(p.y - y);
              return d <= r && d >= min;
            })) mask[y * m.width + x] |= bit;
          }
        }
      }
    }
    if (tiles.some((p) => isTrebuchet(s, p))) for (let i = 0; i < mask.length; i++) mask[i] |= 4;
    return mask;
  }

  /** Walking distance (4-way, ignoring units) from every tile to `target`'s tile for `u`'s terrain class. */
  private walkField(s: GameState, u: Unit, target: Unit): Int16Array {
    const cls = `${canPass(u, 'water') ? 'w' : ''}${canPass(u, 'magma') ? 'm' : ''}${canPass(u, 'pit') ? 'p' : ''}`;
    const key = `${target.id}@${target.pos!.x},${target.pos!.y}|${cls}`;
    let f = this.walkCache.get(key);
    if (f) return f;
    const m = mapOf(s);
    f = new Int16Array(m.width * m.height).fill(999);
    const start = target.pos!.y * m.width + target.pos!.x;
    f[start] = 0;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % m.width;
      const y = (i - x) / m.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const ni = ny * m.width + nx;
        if (f[ni] !== 999 || !canPass(u, m.tiles[ny][nx])) continue;
        f[ni] = f[i] + 1;
        queue.push(ni);
      }
    }
    this.walkCache.set(key, f);
    return f;
  }

  /** Movement still needed (beyond this turn's allowance) before `u` could hit `e`. */
  private gapTo(s: GameState, u: Unit, e: Unit): number {
    const walk = this.walkField(s, u, e)[u.pos!.y * this.width + u.pos!.x];
    return Math.max(0, walk - this.maxReach(u) - effectiveMov(s, u));
  }

  offense(u: Unit): number {
    let v = this.offenseCache.get(u.cardId);
    if (v === undefined) {
      v = rateCard(cardOf(u)).offense;
      this.offenseCache.set(u.cardId, v);
    }
    return v;
  }

  koValue(u: Unit): number {
    return (95 + 0.45 * this.offense(u) + 0.15 * u.maxHp) * (this.tuned ? EVAL.ko : 1);
  }

  /** Expected damage of attacker `a`'s move `idx` (2 = trebuchet) against `t` in state `s`. */
  expDamage(s: GameState, a: Unit, idx: 0 | 1 | 2, t: Unit): number {
    const key = `${a.id}|${a.cardId}|${idx}|${a.stages.atk}|${a.status}|${a.hp === a.maxHp}|${t.id}|${t.cardId}|${t.stages.def}|${t.hp === t.maxHp}|${t.status}`;
    const hit = this.dmgCache.get(key);
    if (hit !== undefined) return hit;
    let dmg = 0;
    if (idx === 2) {
      const ac = trebuchetCtx(s, a, t);
      if (!isImmune(ac, t).immune) dmg = computeDamage(s, ac, t, 40, null).damage;
    } else {
      const mv = moveOf(a, idx);
      if (mv.kind === 'attack' && !(mv.fx.allyHeal !== undefined && a.side === t.side)) {
        const ac = makeAttackCtx(a, mv, { attackerPos: a.pos ?? t.pos! });
        if (!isImmune(ac, t).immune) {
          if (mv.fx.special === 'endeavor') {
            dmg = Math.max(0, t.hp - a.hp);
          } else {
            const base = basePower(s, ac, t, mv.fx.dice ? 3.5 : null, false);
            const full = computeDamage(s, ac, t, base, null).damage;
            const g = grazeApplies(s, ac) ? mv.fx.graze! : null;
            dmg = g ? (1 - g.chance) * full + g.chance * computeDamage(s, ac, t, base, g.power).damage : full;
            if (mv.fx.missChance) dmg *= 1 - mv.fx.missChance;
            if (mv.fx.missAll) dmg *= 1 - mv.fx.missAll.chance;
          }
        }
      } else if (mv.kind === 'status' && a.side !== t.side) {
        // Value disabling moves as "damage equivalents".
        if (mv.fx.status?.id === 'slp' && !t.status) dmg = 0.5 * this.offense(t);
        else if (mv.fx.status && !t.status) dmg = 35;
        else if (mv.fx.targetStages) dmg = 20;
      }
    }
    this.dmgCache.set(key, dmg);
    return dmg;
  }

  private actWeight(u: Unit): number {
    if (u.flinched || u.nextTurn.noAct) return 0;
    if (u.status === 'slp' || u.status === 'frz') return 1 / 3;
    if (u.status === 'par') return 0.8;
    return 1;
  }

  /** Sum of the best attack each enemy could aim at `u` next turn. */
  threatOn(s: GameState, u: Unit): number {
    if (!u.pos) return 0;
    const idx = u.pos.y * this.width + u.pos.x;
    let total = 0;
    for (const e of liveUnits(s)) {
      if (e.side === u.side) continue;
      const mask = this.threatMasks.get(e.id)?.[idx] ?? 0;
      if (!mask) continue;
      const w = this.actWeight(e);
      if (!w) continue;
      let best = 0;
      for (const i of [0, 1, 2] as const) if (mask & (1 << i)) best = Math.max(best, this.expDamage(s, e, i, u));
      total += w * best;
    }
    return total;
  }

  private maxReach(u: Unit): number {
    let r = 1;
    for (const mv of cardOf(u).moves) {
      if (mv.target.kind === 'grid') r = Math.max(r, ...parseGrid(mv.target.grid).targets.map((t) => Math.max(t.f, Math.abs(t.s))));
      if (mv.target.kind === 'range') r = Math.max(r, mv.target.range);
    }
    return r;
  }

  /** How much damage `u` could threaten next turn from where it stands (fading with distance). */
  opportunity(s: GameState, u: Unit): number {
    if (!u.pos || this.actWeight(u) === 0) return 0;
    let best = 0;
    for (const e of liveUnits(s)) {
      if (e.side === u.side) continue;
      const gap = this.gapTo(s, u, e);
      if (gap > 3) continue;
      const d = Math.max(this.expDamage(s, u, 0, e), this.expDamage(s, u, 1, e));
      const v = Math.min(e.hp, d) + (d >= e.hp ? 0.45 * this.koValue(e) : 0);
      best = Math.max(best, v * [1, 0.45, 0.25, 0.12][gap]);
    }
    return best;
  }

  /** Attacker pull: walking distance to the nearest reachable enemy. */
  approach(s: GameState, u: Unit, rf: number): number {
    let gap = 99;
    let walk = 99;
    for (const e of liveUnits(s)) {
      if (e.side === u.side) continue;
      gap = Math.min(gap, this.gapTo(s, u, e));
      walk = Math.min(walk, this.walkField(s, u, e)[u.pos!.y * this.width + u.pos!.x]);
    }
    if (walk >= 999) return 0;
    return (4 + 8 * rf) * gap + (1 + 2 * rf) * walk;
  }

  private stateValue(u: Unit): number {
    const off = this.offense(u);
    let v = 0;
    const ab = cardOf(u).ability;
    switch (u.status) {
      case 'slp':
      case 'frz':
        v -= 45 + 0.5 * off;
        break;
      case 'par':
        v -= 28;
        break;
      case 'brn':
        v -= ab === 'guts' ? -15 : 55;
        break;
      case 'psn':
        v -= ab === 'poisonHeal' ? -30 : 35;
        break;
      case 'tox':
        v -= ab === 'poisonHeal' ? -30 : 20 + 20 * Math.min(4, u.toxicN + 1);
        break;
    }
    if (this.tuned) v *= EVAL.status;
    v += (u.stages.atk * (off > 40 ? 15 : 4) + u.stages.def * 12 + u.stages.mov * 6) * (this.tuned ? EVAL.stages : 1);
    if (u.flinched) v -= 0.5 * off;
    if (u.nextTurn.noAct) v -= 0.6 * off;
    else if (u.nextTurn.noMove) v -= 12;
    if (u.confused) v -= 12;
    if (u.sturdyBroken) v -= 20;
    return v;
  }

  /**
   * The Attacker's spare turns: Attacker turns left minus an estimate of the turns its team needs to
   * faint every Defender (each Defender's HP over the team's combined best damage on it, plus the
   * walk to reach it). Positive means the Attacker is ahead of the clock.
   */
  clockMargin(s: GameState): number {
    const atk = liveUnits(s, 'A');
    const def = liveUnits(s, 'D');
    if (!def.length) return 8;
    if (!atk.length) return -8;
    // Attack turns left: the rest of this one, then one per later round.
    const unacted = s.side === 'A' && s.phase === 'battle' ? atk.filter((u) => !u.activated).length / atk.length : 0;
    const left = s.maxRounds - s.round + unacted;
    let need = 0;
    let travel = 0;
    for (const d of def) {
      let dps = 0;
      let delay = 99;
      for (const a of atk) {
        dps += this.actWeight(a) * Math.max(this.expDamage(s, a, 0, d), this.expDamage(s, a, 1, d));
        delay = Math.min(delay, this.gapTo(s, a, d) / Math.max(1, effectiveMov(s, a)));
      }
      need += d.hp / Math.max(10, dps);
      travel += Math.min(delay, 6);
    }
    return left - need - 0.6 * (travel / def.length);
  }

  evaluate(s: GameState): number {
    if (s.phase === 'over') return s.winner === this.side ? 1e6 - s.round : -1e6 + s.round;
    if (this.w.clock > 0) {
      const v = this.w.clock * Math.tanh(this.clockMargin(s) / 2);
      return this.baseEvaluate(s) + (this.side === 'A' ? v : -v);
    }
    return this.baseEvaluate(s);
  }

  private baseEvaluate(s: GameState): number {
    const me = this.side;
    // The Attacker loses by running out the clock, so it trades HP for tempo and grows more
    // aggressive each round; the Defender only has to keep one Pokémon alive.
    const rf = s.round / s.maxRounds;
    const atk = me === 'A';
    const tw = this.tuned ? EVAL : null;
    const ownHpW = (atk ? 0.7 : 1) * (tw ? tw.ownHp : 1);
    const ownKoW = atk ? 0.8 : 1.3;
    const oppHpW = (atk ? 1 + 0.6 * rf : 0.8) * (tw ? tw.oppHp : 1);
    const oppKoW = atk ? 1.2 + 0.8 * rf : 1;
    const threatW = (atk ? 0.45 - 0.2 * rf : 1) * (tw ? (atk ? tw.atkThreat : tw.defThreat) : 1);
    const oppW = (atk ? 0.5 + 0.3 * rf : 0.2) * (tw ? (atk ? tw.atkOpp : tw.defOpp) : 1);
    let score = 0;
    let ownAlive = 0;
    let oppAlive = 0;
    for (const u of s.units) {
      const mine = u.side === me;
      if (u.fainted) {
        const ko = this.koValue(u);
        score += mine ? -ko * ownKoW : ko * oppKoW;
        continue;
      }
      if (mine) ownAlive += 1;
      else oppAlive += 1;
      const v = u.hp * (mine ? ownHpW : oppHpW) + this.stateValue(u);
      score += mine ? v : -v;
    }
    score += (atk ? -ATT_ENEMY_ALIVE[oppAlive] : DEF_ALIVE[ownAlive]) * (tw ? tw.alive : 1);

    const enemies = liveUnits(s, otherSide(me));
    for (const u of liveUnits(s, me)) {
      if (this.w.threat > 0) {
        const threat = this.threatOn(s, u);
        let pen = 0.45 * Math.min(u.hp, threat) + (threat >= u.hp ? 0.5 * this.koValue(u) : 0);
        if (!atk && ownAlive <= 1) pen *= 1.6;
        score -= this.w.threat * threatW * pen;
      }
      if (this.w.opportunity > 0) score += this.w.opportunity * oppW * this.opportunity(s, u);
      if (this.w.positional) {
        const t = terrainBonus(s, u);
        if (t === 'bush') score += 10;
        if (t === 'flower' && u.hp < u.maxHp) score += 12;
        if (isTrebuchet(s, u.pos!)) score += 8;
        if (atk && enemies.length) score -= this.approach(s, u, rf) * (tw ? tw.approach : 1);
      }
    }
    for (const h of s.hazards) {
      let nearest: Unit | null = null;
      let nd = 99;
      for (const u of liveUnits(s)) {
        const d = cheb(u.pos!, h.pos);
        if (d < nd) {
          nd = d;
          nearest = u;
        }
      }
      if (nearest) score += nearest.side === me ? -8 : 8;
    }
    for (const f of s.futureSight) {
      const user = s.units.find((u) => u.id === f.userId);
      if (!user || !onBoard(user)) continue; // Fizzles if Slowbro has fainted.
      const c = user.pos;
      for (const x of liveUnits(s)) {
        if (x.id === f.userId || steps(x.pos!, c) > 3) continue;
        const v = Math.min(100, x.hp) + (x.hp <= 100 ? 0.4 * this.koValue(x) : 0);
        score += (x.side === f.side) === (f.side === me) ? -0.8 * v : 0.8 * v;
      }
    }
    if (s.substitute) score += getUnit(s, s.substitute.ownerId).side === me ? 25 : -25;
    return score;
  }
}

// ---------------------------------------------------------------- value-network features

const CARD_INDEX = new Map(CARD_LIST.map((c, i) => [c.id, i]));
export const CARD_COUNT = CARD_LIST.length;
const STATUSES = ['psn', 'tox', 'brn', 'par', 'slp', 'frz'] as const;

/** Per-Pokémon numeric features, in order (the card itself is passed as an index). */
export const UNIT_FEATURES = [
  'hpFrac', 'hp', 'maxHp', 'x', 'y', 'atk', 'def', 'mov', 'effMov',
  'psn', 'tox', 'brn', 'par', 'slp', 'frz', 'toxicN', 'flinched', 'noAct', 'noMove', 'confused', 'sturdyBroken', 'decoy',
  'bush', 'flower', 'water', 'trebuchet', 'threat', 'threatKo', 'threatCount', 'opportunity', 'oppKo', 'gap', 'nearEnemy', 'nearAlly',
] as const;
/** Whole-position features, in order. */
export const GLOBAL_FEATURES = [
  'round', 'aToMove', 'meadow', 'river', 'aliveA', 'aliveD', 'hpA', 'hpD', 'clock', 'clockT', 'evalA', 'evalD',
  'subA', 'subD', 'fsA', 'fsD', 'spikes', 'webs',
] as const;

export interface PositionFeatures {
  /** Live Pokémon per side: card index and numeric features. */
  units: Record<Side, { card: number; x: number[] }[]>;
  global: number[];
}

/**
 * Features of a position for the value network: each live Pokémon's card, state and tactical
 * situation (who can hit it next turn, what it can hit), plus global facts such as the clock.
 */
export function positionFeatures(s: GameState): PositionFeatures {
  const evA = new Evaluator(s, 'A', 'hard');
  const evD = new Evaluator(s, 'D', 'hard', evA);
  const m = mapOf(s);
  const units: PositionFeatures['units'] = { A: [], D: [] };
  for (const u of liveUnits(s)) {
    const enemies = liveUnits(s, otherSide(u.side));
    const allies = liveUnits(s, u.side).filter((x) => x.id !== u.id);
    const threat = evA.threatOn(s, u);
    let gap = 9;
    for (const e of enemies) gap = Math.min(gap, evA.gapToPublic(s, u, e));
    const opp = evA.opportunity(s, u);
    const t = terrainBonus(s, u);
    const nearest = (list: Unit[]) => list.reduce((d, x) => Math.min(d, steps(x.pos!, u.pos!)), 20);
    const x = [
      u.hp / u.maxHp, u.hp / 200, u.maxHp / 200, u.pos!.x / (m.width - 1), u.pos!.y / (m.height - 1),
      u.stages.atk / 3, u.stages.def / 3, u.stages.mov / 3, effectiveMov(s, u) / 5,
      ...STATUSES.map((k) => (u.status === k ? 1 : 0)), u.toxicN / 4,
      u.flinched ? 1 : 0, u.nextTurn.noAct ? 1 : 0, u.nextTurn.noMove ? 1 : 0, u.confused ? 1 : 0, u.sturdyBroken ? 1 : 0, u.followMe ? 1 : 0,
      t === 'bush' ? 1 : 0, t === 'flower' ? 1 : 0, terrainAt(s, u.pos!) === 'water' ? 1 : 0, isTrebuchet(s, u.pos!) ? 1 : 0,
      Math.min(threat, 400) / 200, threat >= u.hp ? 1 : 0, evA.threatCount(s, u) / 4, Math.min(opp, 400) / 200, evA.canKo(s, u) ? 1 : 0,
      gap / 5, nearest(enemies) / 10, nearest(allies) / 10,
    ];
    units[u.side].push({ card: CARD_INDEX.get(u.cardId) ?? 0, x });
  }
  const side = (sd: Side) => s.units.filter((u) => u.side === sd);
  const hpFrac = (sd: Side) => side(sd).reduce((a, u) => a + u.hp, 0) / Math.max(1, side(sd).reduce((a, u) => a + u.maxHp, 0));
  const clock = s.phase === 'battle' ? evA.clockMargin(s) : 0;
  const global = [
    s.round / 10, s.side === 'A' ? 1 : 0, s.mapId === 'meadow' ? 1 : 0, s.mapId === 'river' ? 1 : 0,
    units.A.length / 4, units.D.length / 4, hpFrac('A'), hpFrac('D'), Math.max(-8, Math.min(8, clock)) / 5, Math.tanh(clock / 2),
    Math.max(-3, Math.min(3, evA.evaluate(s) / 1000)), Math.max(-3, Math.min(3, evD.evaluate(s) / 1000)),
    s.substitute && getUnit(s, s.substitute.ownerId).side === 'A' ? 1 : 0, s.substitute && getUnit(s, s.substitute.ownerId).side === 'D' ? 1 : 0,
    s.futureSight.filter((f) => f.side === 'A').length, s.futureSight.filter((f) => f.side === 'D').length,
    s.hazards.filter((h) => h.kind === 'spikes').length / 5, s.hazards.filter((h) => h.kind === 'web').length / 5,
  ];
  return { units, global };
}

// ---------------------------------------------------------------- battle planning

interface Plan {
  actions: Action[];
  score: number;
  state: GameState;
}

/** Candidate actions for `u` from its current tile, minus obviously pointless ones. */
function actionCandidates(s: GameState, u: Unit): Action[] {
  const out: Action[] = [];
  // A Pokémon bound by Follow Me must take whatever attack it is allowed, useful or not.
  const forced = waitBlock(s, u) !== null;
  const options: (MoveOption | (CopyOption & { moveIndex: 0 | 1; copy: { unitId: string; moveIndex: 0 | 1 } }))[] = [];
  for (const o of moveOptions(s, u)) {
    if (!o.usable) continue;
    // Transform: every borrowable move becomes its own candidate.
    if (o.aim === 'copy') for (const c of o.copies ?? []) options.push({ ...c, moveIndex: o.moveIndex, copy: { unitId: c.unitId, moveIndex: c.moveIndex } });
    else options.push(o);
  }
  for (const o of options) {
    const mv = o.move;
    const copy = 'copy' in o ? { copy: o.copy } : {};
    const useful = (targetIds: string[]): boolean => {
      if (forced) return true;
      if (mv.target.kind === 'self' || mv.target.kind === 'global' || mv.target.kind === 'place' || mv.target.kind === 'ally') return true;
      const ts = targetIds.map((id) => getUnit(s, id));
      if (mv.fx.healSelfAndAllies !== undefined) return true;
      if (isSupportOnly(mv) || mv.fx.heal) return ts.some((t) => t.side === u.side);
      return ts.some((t) => t.side !== u.side) || (mv.fx.allyHeal !== undefined && ts.some((t) => t.hp < t.maxHp));
    };
    if (o.aim === 'dir') {
      const seen = new Set<string>();
      for (const d of o.dirs) {
        const sig = d.tg.targets.map((t) => t.id).sort().join(',') + (d.tg.dashTo ? posKey(d.tg.dashTo) : '') + (d.tg.placeAt ? posKey(d.tg.placeAt) : '');
        if (seen.has(sig) && !parseGrid((mv.target as { grid: string }).grid).knockback) continue;
        seen.add(sig);
        if (useful(d.tg.targets.map((t) => t.id))) out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex, dir: d.dir, ...copy });
      }
    } else if (o.aim === 'unit') {
      for (const id of o.units) {
        const t = getUnit(s, id);
        if (mv.target.kind === 'range' && t.side === u.side) continue;
        out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex, targetId: id, ...copy });
      }
    } else {
      out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex, ...copy });
    }
  }
  const tr = trebuchetOption(s, u);
  if (tr.usable) {
    for (const id of tr.targets) {
      const t = getUnit(s, id);
      if (t.side === u.side) continue;
      out.push({ type: 'trebuchet', unitId: u.id, targetId: id });
    }
  }
  out.push({ type: 'wait', unitId: u.id });
  return out;
}

function bestPostMove(ev: Evaluator, s: GameState, u: Unit): Action {
  const skip: Action = { type: 'skipPostMove', unitId: u.id };
  let best: Action = skip;
  let bestScore = (() => {
    const n = simulate(s, skip, expectedRng);
    return n ? ev.evaluate(n) : -Infinity;
  })();
  for (const r of moveTargets(s, u).values()) {
    const a: Action = { type: 'postMove', unitId: u.id, to: r.pos };
    const n = simulate(s, a, expectedRng);
    if (!n) continue;
    const sc = ev.evaluate(n);
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}

function planFor(ev: Evaluator, s: GameState, u: Unit, opts: { tiles?: Pos[]; sample?: (n: number) => number } = {}): Plan[] {
  const plans: Plan[] = [];
  const starts: (Pos | null)[] = [null];
  if (!s.active) {
    let tiles = opts.tiles ?? [...moveTargets(s, u).values()].map((r) => r.pos);
    if (opts.sample) {
      const n = Math.min(tiles.length, 7);
      const picked: Pos[] = [];
      const pool = [...tiles];
      for (let i = 0; i < n; i++) picked.push(pool.splice(opts.sample(pool.length), 1)[0]);
      tiles = picked;
    }
    starts.push(...tiles);
  }
  for (const to of starts) {
    const moveAct: Action | null = to ? { type: 'move', unitId: u.id, to } : null;
    const s1 = moveAct ? simulate(s, moveAct, expectedRng) : s;
    if (!s1) continue;
    const u1 = getUnit(s1, u.id);
    if (!onBoard(u1)) {
      plans.push({ actions: [moveAct!], score: ev.evaluate(s1), state: s1 });
      continue;
    }
    if (s1.active?.unitId === u.id && s1.active.stage === 'acted') continue;
    for (const a of actionCandidates(s1, u1)) {
      let s2 = simulate(s1, a, expectedRng);
      if (!s2) continue;
      const acts: Action[] = moveAct ? [moveAct, a] : [a];
      if (s2.active?.unitId === u.id && s2.active.stage === 'acted') {
        const pm = bestPostMove(ev, s2, getUnit(s2, u.id));
        const s3 = simulate(s2, pm, expectedRng);
        if (s3) {
          s2 = s3;
          acts.push(pm);
        }
      }
      plans.push({ actions: acts, score: ev.evaluate(s2), state: s2 });
    }
  }
  return plans;
}

const best = (plans: Plan[]): Plan | null => plans.reduce<Plan | null>((b, p) => (!b || p.score > b.score ? p : b), null);

function battleStep(s: GameState, side: Side, level: Difficulty, rng: Rng): Action[] {
  const ev = new Evaluator(s, side, level);
  if (s.active) {
    const u = getUnit(s, s.active.unitId);
    if (s.active.stage === 'acted') return [bestPostMove(ev, s, u)];
    return best(planFor(ev, s, u))?.actions ?? [{ type: 'wait', unitId: u.id }];
  }
  const ready = liveUnits(s, side).filter((u) => !u.activated);
  if (!ready.length) return [{ type: 'endTurn' }];

  // A trainer's Special Move is weighed at the start of each turn, before anything moves.
  if (level !== 'easy' && canUseSpecial(s, side) && ready.length === liveUnits(s, side).length) {
    const special = chooseSpecial(s, side, level);
    if (special) return [special];
  } else if (level === 'easy' && canUseSpecial(s, side) && rng.chance(0.15)) {
    const targets = specialTargets(s, side);
    return [{ type: 'trainerSpecial', unitId: trainerOf(s, side) === 'nobunaga' ? targets[rng.int(targets.length)] : undefined }];
  }

  if (level === 'hard') return hardBattle(s, side);
  if (level === 'medium') {
    // Fixed order: fastest first.
    const u = [...ready].sort((a, b) => effectiveMov(s, b) - effectiveMov(s, a))[0];
    return best(planFor(ev, s, u))?.actions ?? legalFallback(s, side);
  }
  // Easy: random unit, a handful of random tiles, and often a random (legal) choice.
  const u = ready[rng.int(ready.length)];
  const plans = planFor(ev, s, u, { sample: (n) => rng.int(n) });
  if (!plans.length) return legalFallback(s, side);
  if (rng.chance(0.35)) return plans[rng.int(plans.length)].actions;
  return best(plans)!.actions;
}

/**
 * Whether to spend the trainer's once-per-game Special Move now: the best turn found with it is
 * compared with the best turn without it, and it's used only if the gain beats a margin that
 * shrinks as the rounds run out (it can't be used later once spent). Nobunaga's is tried on each
 * Pokémon that hasn't moved.
 */
function chooseSpecial(s: GameState, side: Side, level: Difficulty): Action | null {
  const [width, perUnit] = level === 'hard' ? [6, 3] : [3, 2];
  const deadline = performance.now() + SEARCH.budgetMs / 2;
  const turnValue = (st: GameState): number => beamTurn(st, side, new Evaluator(st, side, 'hard'), width, perUnit, deadline)[0]?.score ?? -Infinity;
  const base = turnValue(s);
  const options: Action[] = trainerOf(s, side) === 'nobunaga'
    ? specialTargets(s, side).map((unitId): Action => ({ type: 'trainerSpecial', unitId }))
    : [{ type: 'trainerSpecial' }];
  let bestAct: Action | null = null;
  let bestGain = -Infinity;
  for (const a of options) {
    const n = simulate(s, a, expectedRng);
    if (!n) continue;
    const gain = turnValue(n) - base;
    if (gain > bestGain) {
      bestGain = gain;
      bestAct = a;
    }
  }
  const turnsLeft = s.maxRounds - s.round;
  return bestAct && bestGain > SEARCH.specialMargin * turnsLeft ? bestAct : null;
}

/** The first legal action found for `side`, so a bot can never stall the game. */
function legalFallback(s: GameState, side: Side): Action[] {
  const tries: Action[] = [];
  const units = s.active ? [getUnit(s, s.active.unitId)] : liveUnits(s, side).filter((u) => !u.activated);
  for (const u of units) {
    if (s.active?.stage === 'acted') tries.push({ type: 'skipPostMove', unitId: u.id });
    for (const a of actionCandidates(s, u)) tries.push(a);
    for (const r of moveTargets(s, u).values()) tries.push({ type: 'move', unitId: u.id, to: r.pos });
  }
  tries.push({ type: 'endTurn' });
  for (const a of tries) if (simulate(s, a, expectedRng)) return [a];
  return [{ type: 'concede', side }];
}

/** The best plan for each Pokémon `side` still has to activate, applied one after another. */
function greedyTurn(s0: GameState, side: Side, deadline: number): GameState {
  let s = s0;
  const ev = new Evaluator(s0, side, 'hard');
  for (let guard = 0; guard < 12 && s.phase === 'battle' && decider(s) === side; guard++) {
    if (performance.now() > deadline) break;
    const units = s.active ? [getUnit(s, s.active.unitId)] : liveUnits(s, side).filter((u) => !u.activated);
    let top: Plan | null = null;
    for (const u of units) {
      const p = s.active?.stage === 'acted' ? null : best(planFor(ev, s, u));
      if (p && (!top || p.score > top.score)) top = p;
    }
    if (!top) break;
    s = settle(top.state);
  }
  return s;
}

/** Choices a pending decision may be answered with (null: decline, where that's allowed). */
function pendingChoices(p: GameState['pending'][number]): (string | null)[] {
  const optional = p.kind === 'liquidVoice' || p.kind === 'imposter';
  return optional ? [...p.options, null] : [...p.options];
}

/** Resolves pending choices neutrally: decline where allowed, else the first option (look-ahead only). */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 4 && s.pending.length; i++) {
    const choices = pendingChoices(s.pending[0]);
    const next = simulate(s, { type: 'choose', option: choices.includes(null) ? null : choices[0] }, expectedRng);
    if (!next) break;
    s = next;
  }
  return s;
}

// ---------------------------------------------------------------- hard: whole-turn search

/** Everything that matters for play, so a cached plan is reused only if the dice went as predicted. */
function signature(s: GameState): string {
  return JSON.stringify([
    s.phase, s.round, s.side, s.active, s.pending, s.hazards, s.substitute, s.futureSight, s.taunted,
    s.trainers && [s.trainers.used, s.trainers.effect],
    s.units.map((u) => [u.id, u.cardId, u.hp, u.pos, u.fainted, u.stages, u.status, u.toxicN, u.confused, u.flinched,
      u.sturdyBroken, u.nextTurn, u.turn, u.activated, u.actAgain, u.gotAfterYou, u.followMe, u.locked, u.dmgBonus, u.movBonus,
      u.ignoreDefBoosts]),
  ]);
}

interface Step {
  actions: Action[];
  /** Predicted signature once `actions` have been applied. */
  after: string;
}

interface TurnNode {
  s: GameState;
  steps: Step[];
  score: number;
}

export const SEARCH = {
  /** Partial turns kept after each activation. */
  beam: 16,
  /** Best plans per Pokémon expanded from each partial turn. */
  perUnit: 5,
  /** Finished turns checked against the opponent's reply. */
  replies: 16,
  /**
   * The opponent's reply: 0 = greedy (best single Pokémon plan at a time); otherwise a whole-turn
   * beam search of this width, so the bot expects coordinated focus fire like a human's.
   */
  replyBeam: 4,
  replyPerUnit: 2,
  /** After the opponent's reply, also play out the bot's own next turn before scoring (3-ply). */
  followUp: true,

  /**
   * Experimental: score each candidate's line by this many playouts to the end of the game (Medium
   * policy for both sides, real dice) instead of the static evaluation. 0 = off.
   */
  leafRollouts: 0,
  /**
   * Weight of the value network in the leaf score (0 = hand evaluation only, 1 = network only), in
   * logit units; `handScale` converts the hand evaluation to logits for the blend.
   */
  net: 1,
  handScale: 0.002,
  /**
   * With a value network: the opponent's reply is the one of its best `netReplies` turns (by its own
   * evaluation) that leaves the bot worst off by the network, instead of simply its best (≤ 1 = off).
   */
  netReplies: 0,
  /** With a value network: score placements by it instead of the hand evaluation. */
  netPlacement: false,

  /** Soft time limit per search. */
  budgetMs: 2500,
  /** A trainer's Special Move is used when it improves the turn by more than this per round left. */
  specialMargin: 15,
  /** Draft with the self-play team model (otherwise the heuristic ratings). */
  draftModel: true,
};

let planCache: { side: Side; expect: string; rest: Step[] } | null = null;

function hardBattle(s: GameState, side: Side): Action[] {
  const sig = signature(s);
  if (planCache && planCache.side === side && planCache.expect === sig && planCache.rest.length) {
    const step = planCache.rest.shift()!;
    planCache.expect = step.after;
    return step.actions;
  }
  planCache = null;
  const steps = searchTurn(s, side);
  if (!steps.length) return legalFallback(s, side);
  const [first, ...rest] = steps;
  planCache = { side, expect: first.after, rest };
  return first.actions;
}

/**
 * Beam search over one whole turn for `side`: each partial turn is extended by the best few plans of
 * every Pokémon that hasn't activated, keeping the best partial turns by `ev`. Returns the finished
 * turns (ended, so the opponent is to move), best first.
 */
function beamTurn(s0: GameState, side: Side, ev: Evaluator, width: number, perUnit: number, deadline: number): TurnNode[] {
  let beam: TurnNode[] = [{ s: s0, steps: [], score: ev.evaluate(s0) }];
  const finished: TurnNode[] = [];
  const end = (n: TurnNode): void => {
    const e = n.s.phase === 'battle' && decider(n.s) === side ? simulate(n.s, { type: 'endTurn' }, expectedRng) : null;
    finished.push(e ? { s: e, steps: [...n.steps, { actions: [{ type: 'endTurn' }], after: signature(e) }], score: n.score } : n);
  };
  // Up to 12 steps: activations, post-moves, and extra activations (Celebrate, After You).
  for (let depth = 0; depth < 12 && beam.length; depth++) {
    const children: TurnNode[] = [];
    for (const node of beam) {
      const s = node.s;
      if (s.phase !== 'battle' || decider(s) !== side) {
        finished.push(node);
        continue;
      }
      if (s.active?.stage === 'acted') {
        const u = getUnit(s, s.active.unitId);
        const pm = bestPostMove(ev, s, u);
        const n = simulate(s, pm, expectedRng);
        if (n) children.push({ s: n, steps: [...node.steps, { actions: [pm], after: signature(n) }], score: ev.evaluate(n) });
        continue;
      }
      const units = s.active ? [getUnit(s, s.active.unitId)] : liveUnits(s, side).filter((u) => !u.activated);
      if (!units.length) {
        end(node);
        continue;
      }
      for (const u of units) {
        const seen = new Set<string>();
        const plans = planFor(ev, s, u).sort((a, b) => b.score - a.score);
        let kept = 0;
        for (const p of plans) {
          if (kept >= perUnit) break;
          const sig = signature(p.state);
          if (seen.has(sig)) continue;
          seen.add(sig);
          kept += 1;
          children.push({ s: p.state, steps: [...node.steps, { actions: p.actions, after: sig }], score: p.score });
        }
      }
    }
    const seen = new Set<string>();
    beam = children.sort((a, b) => b.score - a.score).filter((c) => {
      const k = signature(c.s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, width);
    if (performance.now() > deadline) {
      // Out of time: finish the best partial turns as they stand.
      for (const n of beam) end(n);
      beam = [];
    }
  }
  return finished.sort((a, b) => b.score - a.score);
}

/**
 * The bot's turn: beam search over whole turns, then each of the best finished turns is scored by
 * letting the opponent answer (greedily, or with its own whole-turn search) and, optionally, the
 * bot play its next turn too. Plans that leave a Pokémon open to a coordinated counter lose out.
 */
function searchTurn(s0: GameState, side: Side): Step[] {
  const deadline = performance.now() + SEARCH.budgetMs;
  const finished = beamTurn(s0, side, new Evaluator(s0, side, 'hard'), SEARCH.beam, SEARCH.perUnit, deadline);
  if (!finished.length) return [];
  const replyDeadline = deadline + SEARCH.budgetMs;
  const scored = finished.slice(0, SEARCH.replies)
    .map((c) => ({ c, ...replyLine(c.s, side, replyDeadline) }))
    .sort((a, b) => b.v - a.v);
  searchHooks.onLeaves?.(side, scored.map((x) => x.leaf));
  const pick = searchHooks.pick ? Math.min(scored.length - 1, searchHooks.pick(scored.length)) : 0;
  return scored[pick].c.steps;
}

/** For data generation (scripts/gen-values.ts): see the positions the search compared, and vary its choice. */
export const searchHooks: {
  onLeaves: ((side: Side, leaves: GameState[]) => void) | null;
  /** Index of the candidate to play (0 = best), given how many there are. */
  pick: ((n: number) => number) | null;
} = { onLeaves: null, pick: null };

/** Plays `side`'s turn with its own evaluation and ends it. */
function playTurn(s0: GameState, side: Side, beamWidth: number, perUnit: number, deadline: number): GameState {
  if (beamWidth > 0) {
    const best = beamTurn(s0, side, new Evaluator(s0, side, 'hard'), beamWidth, perUnit, deadline)[0];
    return best ? settle(best.s) : s0;
  }
  const s = greedyTurn(s0, side, deadline);
  const e = s.phase === 'battle' && decider(s) === side ? simulate(s, { type: 'endTurn' }, expectedRng) : null;
  return e ? settle(e) : s;
}

/** A finished turn for `side` after the opponent's reply (and optionally its own next turn). */
function replyLeaf(s0: GameState, side: Side, deadline: number): GameState {
  let s = settle(s0);
  if (s.phase === 'battle' && s.side !== side) s = playTurn(s, s.side, SEARCH.replyBeam, SEARCH.replyPerUnit, deadline);
  return followUp(s, side, deadline);
}

function followUp(s: GameState, side: Side, deadline: number): GameState {
  return SEARCH.followUp && s.phase === 'battle' && s.side === side ? playTurn(s, side, 0, 0, deadline) : s;
}

/**
 * The line after one of `side`'s finished turns, and its value. With a value network and
 * `netReplies`, the opponent picks whichever of its best few replies the network likes least for us.
 */
function replyLine(s0: GameState, side: Side, deadline: number): { leaf: GameState; v: number } {
  const s = settle(s0);
  if (valueNet && SEARCH.netReplies > 1 && SEARCH.replyBeam > 0 && s.phase === 'battle' && s.side !== side) {
    const replies = beamTurn(s, s.side, new Evaluator(s, s.side, 'hard'), SEARCH.replyBeam, SEARCH.replyPerUnit, deadline).slice(0, SEARCH.netReplies);
    let worst: { leaf: GameState; v: number } | null = null;
    for (const r of replies) {
      const leaf = followUp(settle(r.s), side, deadline);
      const v = leafValue(leaf, side);
      if (!worst || v < worst.v) worst = { leaf, v };
    }
    if (worst) return worst;
  }
  const leaf = replyLeaf(s, side, deadline);
  return { leaf, v: leafValue(leaf, side) };
}

/** The value network (scripts/train-value.ts); null = hand evaluation only. */
let valueNet: ValueModel | null = null;
export function setValueModel(m: ValueModel | null): void {
  valueNet = m;
}

/** P(`side` wins) according to the value network. */
export function netValue(s: GameState, side: Side): number {
  if (s.phase === 'over') return s.winner === side ? 1 : 0;
  const p = predictValue(valueNet!, positionFeatures(s));
  return side === 'A' ? p : 1 - p;
}

const logit = (p: number): number => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

function leafValue(s: GameState, side: Side): number {
  if (SEARCH.leafRollouts > 0) return rolloutValue(s, side, SEARCH.leafRollouts);
  const w = valueNet ? SEARCH.net : 0;
  if (s.phase === 'over') return s.winner === side ? 1e6 - s.round : -1e6 + s.round;
  const hand = w < 1 ? new Evaluator(s, side, 'hard').evaluate(s) * SEARCH.handScale : 0;
  return w > 0 ? w * logit(netValue(s, side)) + (1 - w) * hand : hand;
}

let rolloutSeed = 1;

/** Fraction of `n` Medium-vs-Medium playouts from `s0` (real dice) that `side` wins. */
export function rolloutValue(s0: GameState, side: Side, n: number): number {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const rng = seededRng(rolloutSeed++ * 2654435761);
    let s = s0;
    for (let guard = 0; s.phase !== 'over' && guard < 2000; guard++) {
      const who = decider(s)!;
      const acts = decide(s, who, 'medium', rng);
      let moved = false;
      for (const a of acts) {
        if (decider(s) !== who) break;
        const next = simulate(s, a, rng);
        if (!next) break;
        s = next;
        moved = true;
      }
      if (!moved) {
        const fb = legalFallback(s, who)[0];
        s = simulate(s, fb, rng) ?? s;
      }
    }
    if (s.phase === 'over' && s.winner === side) wins += 1;
  }
  return wins / n;
}

// ---------------------------------------------------------------- pending choices

function choosePending(s: GameState, side: Side, level: Difficulty): Action {
  const options = pendingChoices(s.pending[0]);
  if (level === 'easy') return { type: 'choose', option: options[0] };
  const ev = new Evaluator(s, side, level);
  let bestOpt = options[0];
  let bestScore = -Infinity;
  for (const o of options) {
    const n = simulate(s, { type: 'choose', option: o }, expectedRng);
    if (!n) continue;
    const sc = ev.evaluate(n);
    if (sc > bestScore) {
      bestScore = sc;
      bestOpt = o;
    }
  }
  return { type: 'choose', option: bestOpt };
}
