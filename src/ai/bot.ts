import {
  type Action, type CardDef, type Dir, type GameState, type Pos, type Rng, type Side, type Unit,
  basePower, cardOf, cheb, computeDamage, decider, effectiveMov, expectedRng, getCard, getMap, getUnit, grazeApplies,
  canPass, draftOptions, isImmune, isSupportOnly, isTrebuchet, liveUnits, makeAttackCtx, mapOf, moveOf, moveOptions, moveTargets, onBoard,
  otherSide, parseGrid, posKey, reachable, simulate, terrainAt, trebuchetOption, typeMultiplier, waitBlock, zoneTiles,
} from '../engine';
import { bestDraftPick, hasDraftModel } from './draft';
import { matchup, rateCard } from './rating';

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const DIRS4: Dir[] = ['N', 'E', 'S', 'W'];

/** The next action(s) the bot wants to take for `side`. Empty when it isn't the bot's decision. */
export function decide(s: GameState, side: Side, level: Difficulty, rng: Rng): Action[] {
  if (s.phase === 'over' || decider(s) !== side) return [];
  if (s.pending.length) return [choosePending(s, side, level)];
  if (s.phase === 'draft') return [{ type: 'draftPick', cardId: draftPick(s, side, level, rng) }];
  if (s.phase === 'placement') return [placeNext(s, side, level, rng)];
  return battleStep(s, side, level, rng);
}

// ---------------------------------------------------------------- draft & placement

function draftPick(s: GameState, side: Side, level: Difficulty, rng: Rng): string {
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

/**
 * Tries each unplaced Pokémon on each free spawn, finishes the placement with the simple rule for
 * both sides, and keeps the choice whose opening position evaluates best.
 */
function bestPlacement(s: GameState, side: Side, rng: Rng): Action {
  const units = s.units.filter((u) => u.side === side && !u.pos);
  const spawns = getMap(s.mapId).spawns[side].filter((p) => !liveUnits(s).some((u) => u.pos && u.pos.x === p.x && u.pos.y === p.y));
  let bestAct: Action | null = null;
  let bestScore = -Infinity;
  for (const u of units) {
    for (const pos of spawns) {
      const act: Action = { type: 'place', unitId: u.id, pos };
      let n = simulate(s, act, expectedRng);
      for (let guard = 0; n && n.phase === 'placement' && guard < 8; guard++) {
        n = simulate(n, simplePlacement(n, decider(n)!, 'medium', rng), expectedRng);
      }
      if (!n) continue;
      const score = new Evaluator(n, side, 'hard').evaluate(n);
      if (score > bestScore) {
        bestScore = score;
        bestAct = act;
      }
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
  /** The side whose next turn is round 1, which is move-only (it threatens nothing). */
  private readonly idle: Side | null;
  readonly w: Weights;

  constructor(readonly s0: GameState, readonly side: Side, level: Difficulty) {
    this.w = WEIGHTS[level];
    this.width = mapOf(s0).width;
    this.idle = s0.round === 1 && s0.side === 'A' ? 'D' : null;
    if (this.w.threat > 0 || this.w.opportunity > 0) {
      for (const e of liveUnits(s0)) this.threatMasks.set(e.id, this.computeMask(s0, e));
    }
  }

  /** Bitmask per tile of which of `e`'s attacks (bit 0/1) or the trebuchet (bit 2) could land there next turn. */
  private computeMask(s: GameState, e: Unit): Uint8Array {
    const m = mapOf(s);
    const mask = new Uint8Array(m.width * m.height);
    const budget = e.nextTurn.noMove ? 0 : effectiveMov(s, e);
    const tiles: Pos[] = [e.pos!, ...[...reachable(s, e, budget).values()].map((r) => r.pos)];
    for (const idx of [0, 1] as const) {
      const mv = moveOf(e, idx);
      if (isSupportOnly(mv) || (mv.kind !== 'attack' && !mv.fx.status && !mv.fx.targetStages)) continue;
      const bit = 1 << idx;
      if (mv.target.kind === 'grid') {
        const g = parseGrid(mv.target.grid);
        for (const p of tiles) for (const d of DIRS4) for (const z of zoneTiles(s, p, g, d)) mask[z.y * m.width + z.x] |= bit;
      } else if (mv.target.kind === 'range') {
        const r = mv.target.range;
        for (let y = 0; y < m.height; y++) {
          for (let x = 0; x < m.width; x++) {
            if (tiles.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= r)) mask[y * m.width + x] |= bit;
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
    return 95 + 0.45 * this.offense(u) + 0.15 * u.maxHp;
  }

  /** Expected damage of attacker `a`'s move `idx` (2 = trebuchet) against `t` in state `s`. */
  expDamage(s: GameState, a: Unit, idx: 0 | 1 | 2, t: Unit): number {
    const key = `${a.id}|${a.cardId}|${idx}|${a.stages.atk}|${a.status}|${a.hp === a.maxHp}|${t.id}|${t.cardId}|${t.stages.def}|${t.hp === t.maxHp}|${t.status}`;
    const hit = this.dmgCache.get(key);
    if (hit !== undefined) return hit;
    let dmg = 0;
    if (idx === 2) {
      const types = cardOf(a).types;
      const type = [...types].sort((x, y) => typeMultiplier(y, cardOf(t).types) - typeMultiplier(x, cardOf(t).types))[0];
      const ac = makeAttackCtx(a, null, { moveType: type });
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
    if (u.side === this.idle || u.flinched || u.nextTurn.noAct) return 0;
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
    v += u.stages.atk * (off > 40 ? 15 : 4) + u.stages.def * 12 + u.stages.mov * 6;
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
    // Attack turns left: the rest of this one (round 1 is move-only), then one per later round.
    const unacted = s.side === 'A' && s.phase === 'battle' && s.round > 1 ? atk.filter((u) => !u.activated).length / atk.length : 0;
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
    const ownHpW = atk ? 0.7 : 1;
    const ownKoW = atk ? 0.8 : 1.3;
    const oppHpW = atk ? 1 + 0.6 * rf : 0.8;
    const oppKoW = atk ? 1.2 + 0.8 * rf : 1;
    const threatW = atk ? 0.45 - 0.2 * rf : 1;
    const oppW = atk ? 0.5 + 0.3 * rf : 0.2;
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
    score += atk ? -ATT_ENEMY_ALIVE[oppAlive] : DEF_ALIVE[ownAlive];

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
        const t = terrainAt(s, u.pos!);
        if (t === 'bush') score += 10;
        if (t === 'flower' && u.hp < u.maxHp) score += 12;
        if (isTrebuchet(s, u.pos!)) score += 8;
        if (atk && enemies.length) score -= this.approach(s, u, rf);
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
      const c = user?.pos ?? f.pos;
      for (const x of liveUnits(s)) {
        if (x.id === f.userId || cheb(x.pos!, c) > 3) continue;
        const v = Math.min(100, x.hp) + (x.hp <= 100 ? 0.4 * this.koValue(x) : 0);
        score += (x.side === f.side) === (f.side === me) ? -0.8 * v : 0.8 * v;
      }
    }
    if (s.substitute) score += getUnit(s, s.substitute.ownerId).side === me ? 25 : -25;
    return score;
  }
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
  for (const o of moveOptions(s, u)) {
    if (!o.usable) continue;
    const mv = o.move;
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
        if (useful(d.tg.targets.map((t) => t.id))) out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex, dir: d.dir });
      }
    } else if (o.aim === 'unit') {
      for (const id of o.units) {
        const t = getUnit(s, id);
        if (mv.target.kind === 'range' && t.side === u.side) continue;
        out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex, targetId: id });
      }
    } else {
      out.push({ type: 'useMove', unitId: u.id, moveIndex: o.moveIndex });
    }
  }
  const tr = trebuchetOption(s, u);
  if (tr.usable) {
    for (const id of tr.targets) {
      const t = getUnit(s, id);
      if (t.side === u.side) continue;
      const type = [...tr.types].sort((a, b) => typeMultiplier(b, cardOf(t).types) - typeMultiplier(a, cardOf(t).types))[0];
      out.push({ type: 'trebuchet', unitId: u.id, targetId: id, attackType: type });
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
  for (let guard = 0; guard < 8 && s.phase === 'battle' && decider(s) === side; guard++) {
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

/** Resolves pending choices with their first option (look-ahead only). */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 4 && s.pending.length; i++) {
    const p = s.pending[0];
    const next = simulate(s, { type: 'choose', option: p.kind === 'liquidVoice' ? null : p.options[0] }, expectedRng);
    if (!next) break;
    s = next;
  }
  return s;
}

// ---------------------------------------------------------------- hard: whole-turn search

/** Everything that matters for play, so a cached plan is reused only if the dice went as predicted. */
function signature(s: GameState): string {
  return JSON.stringify([
    s.phase, s.round, s.side, s.active, s.pending, s.hazards, s.substitute, s.futureSight,
    s.units.map((u) => [u.id, u.cardId, u.hp, u.pos, u.fainted, u.stages, u.status, u.toxicN, u.confused, u.flinched,
      u.sturdyBroken, u.nextTurn, u.turn, u.activated, u.followMe]),
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
  beam: 6,
  /** Best plans per Pokémon expanded from each partial turn. */
  perUnit: 3,
  /** Finished turns checked against the opponent's reply. */
  replies: 5,
  /** Soft time limit per search. */
  budgetMs: 2500,
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
 * Beam search over whole turns: each partial turn is extended by the best few plans of every
 * Pokémon that hasn't activated, keeping the best partial turns. Finished turns are then scored by
 * letting the opponent answer with its greedy best reply, so plans that leave a Pokémon open to a
 * focused counter-attack lose out.
 */
function searchTurn(s0: GameState, side: Side): Step[] {
  const deadline = performance.now() + SEARCH.budgetMs;
  const ev = new Evaluator(s0, side, 'hard');
  let beam: TurnNode[] = [{ s: s0, steps: [], score: ev.evaluate(s0) }];
  const finished: TurnNode[] = [];
  const end = (n: TurnNode): void => {
    const e = n.s.phase === 'battle' && decider(n.s) === side ? simulate(n.s, { type: 'endTurn' }, expectedRng) : null;
    finished.push(e ? { s: e, steps: [...n.steps, { actions: [{ type: 'endTurn' }], after: signature(e) }], score: n.score } : n);
  };
  for (let depth = 0; depth < 8 && beam.length; depth++) {
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
          if (kept >= SEARCH.perUnit) break;
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
    }).slice(0, SEARCH.beam);
    if (performance.now() > deadline) {
      // Out of time: finish the best partial turns as they stand.
      for (const n of beam) end(n);
      beam = [];
    }
  }
  if (!finished.length) return [];
  finished.sort((a, b) => b.score - a.score);
  const candidates = finished.slice(0, SEARCH.replies);
  let bestNode = candidates[0];
  let bestValue = -Infinity;
  for (const c of candidates) {
    const v = replyValue(c.s, side, deadline + SEARCH.budgetMs);
    if (v > bestValue) {
      bestValue = v;
      bestNode = c;
    }
  }
  return bestNode.steps;
}

/** Value of a finished turn for `side` after the opponent's greedy reply. */
function replyValue(s0: GameState, side: Side, deadline: number): number {
  let s = settle(s0);
  if (s.phase === 'battle' && s.side !== side) {
    s = greedyTurn(s, s.side, deadline);
    const e = s.phase === 'battle' && decider(s) === s.side ? simulate(s, { type: 'endTurn' }, expectedRng) : null;
    if (e) s = settle(e);
  }
  return new Evaluator(s, side, 'hard').evaluate(s);
}

// ---------------------------------------------------------------- pending choices

function choosePending(s: GameState, side: Side, level: Difficulty): Action {
  const p = s.pending[0];
  const options: (string | null)[] = p.kind === 'liquidVoice' ? [...p.options, null] : [...p.options];
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
