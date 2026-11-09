import {
  basePower, computeDamage, grazeApplies, isImmune, makeAttackCtx, neverMisses, secondaryMult, trebuchetCtx, typeEffectLabel,
} from './damage';
import { canActNow, cloneState, followMeTiles, moveBlocked, movementAllowance, triageTiles } from './engine';
import { STATUS_NAME, canHaveStatus, pressureMult } from './mutate';
import { UNCOPYABLE, type Targeting, canTargetFrom, followMeUsers, isSupportOnly, liquidVoiceCopy, pushDistance, targeting } from './moves';
import {
  abilityOf, cardOf, getUnit, isTrebuchet, liveUnits, moveOf, onBoard, parseGrid, reachable, type ReachInfo, terrainBonus,
} from './query';
import type { Dir, GameState, MoveDef, PType, StatId, Unit } from './types';
import { DIRS } from './types';
import { clamp } from './util';

// ---------------------------------------------------------------- unit state

export interface UnitTurnInfo {
  canMove: boolean;
  canAct: boolean;
  done: boolean;
  reasons: string[];
}

export function unitTurnInfo(s: GameState, u: Unit): UnitTurnInfo {
  const active = s.active?.unitId === u.id ? s.active : null;
  const isTurn = s.phase === 'battle' && u.side === s.side && onBoard(u);
  const done = !isTurn || u.activated;
  const reasons = [...u.turn.reasons];
  if (u.status === 'slp' && !reasons.includes('Asleep')) reasons.push('Asleep');
  if (u.status === 'frz' && !reasons.includes('Frozen')) reasons.push('Frozen');
  const canAct = !done && canActNow(u) && (!active || active.stage === 'moved');
  const canMove = !done && !active && !s.active && movementAllowance(s, u) > 0;
  return { canMove, canAct, done, reasons };
}

/** Reachable tiles for the unit's movement step, already filtered by Follow Me. */
export function moveTargets(s: GameState, u: Unit): Map<string, ReachInfo> {
  if (s.active) {
    if (s.active.unitId === u.id && s.active.stage === 'acted') return reachable(s, u, s.active.postMove);
    return new Map();
  }
  if (u.activated || u.side !== s.side) return new Map();
  const budget = movementAllowance(s, u);
  const all = reachable(s, u, budget);
  const fm = followMeTiles(s, u, budget);
  if (!fm) {
    // Triage: a few extra tiles, if it heals from there.
    for (const [k, r] of triageTiles(s, u, budget)) all.set(k, r);
    return all;
  }
  return new Map([...all].filter(([k]) => fm.has(k)));
}

// ---------------------------------------------------------------- move options

export interface DirOption {
  dir: Dir;
  tg: Targeting;
}

export interface MoveOption {
  moveIndex: 0 | 1;
  move: MoveDef;
  usable: boolean;
  reason?: string;
  /** 'copy': Transform — pick one of `copies` first, then aim it. */
  aim: 'dir' | 'unit' | 'none' | 'copy';
  dirs: DirOption[];
  units: string[];
  copies?: CopyOption[];
}

/** A move Transform could borrow: another Pokémon's move, with the ways Ditto could aim it. */
export interface CopyOption {
  unitId: string;
  moveIndex: 0 | 1;
  move: MoveDef;
  aim: 'dir' | 'unit' | 'none';
  dirs: DirOption[];
  units: string[];
}

/** When Follow Me binds `u` from where it stands, a predicate its chosen targets must satisfy. */
function fmFilter(s: GameState, u: Unit): ((ids: string[]) => boolean) | null {
  const users = followMeUsers(s, u);
  if (!users.length || !canActNow(u) || !u.pos) return null;
  if (!users.some((f) => canTargetFrom(s, u, u.pos!, f))) return null;
  return (ids) => ids.some((id) => users.some((f) => f.id === id));
}

/**
 * Follow Me reason that blocks every action from the current tile: the unit could reach a tile
 * in range of the decoy but hasn't moved there yet. Null when nothing is blocked.
 */
export function followMeBlock(s: GameState, u: Unit): string | null {
  const users = followMeUsers(s, u);
  if (!users.length || !canActNow(u) || !u.pos || s.active?.unitId === u.id) return null;
  if (users.some((f) => canTargetFrom(s, u, u.pos!, f))) return null;
  if (!followMeTiles(s, u, movementAllowance(s, u))) return null;
  return `Follow Me: move into range of ${users.map((f) => cardOf(f).name).join(' / ')} first`;
}

/** Why `wait` is currently illegal for `u`, if it is. */
export function waitBlock(s: GameState, u: Unit): string | null {
  const block = followMeBlock(s, u);
  if (block) return block;
  return fmFilter(s, u) ? `Follow Me: must attack ${followMeUsers(s, u).map((f) => cardOf(f).name).join(' / ')}` : null;
}

/** How `u` could aim `move` from where it stands (Follow Me applied), and whether it can at all. */
function aimFor(s: GameState, u: Unit, move: MoveDef): Pick<MoveOption, 'aim' | 'dirs' | 'units' | 'usable' | 'reason'> {
  const fm = fmFilter(s, u);
  const fmOk = (tg: Targeting): boolean => {
    if (!fm) return true;
    const hits = (move.target.kind === 'grid' || move.target.kind === 'range') && !isSupportOnly(move);
    return hits && fm(tg.targets.map((t) => t.id));
  };
  const t = move.target;
  if (t.kind === 'grid' || t.kind === 'place') {
    const dirs = DIRS.map((dir) => ({ dir, tg: targeting(s, u, move, { dir }) }));
    const okDirs = dirs.filter((d) => d.tg.ok && fmOk(d.tg));
    return {
      aim: 'dir', dirs: okDirs, units: [], usable: okDirs.length > 0,
      reason: okDirs.length ? undefined : fm ? 'Follow Me: must target the decoy' : dirs.find((d) => !d.tg.ok)?.tg.reason ?? 'No valid direction',
    };
  }
  if (t.kind === 'range' || t.kind === 'ally') {
    const units = liveUnits(s).filter((x) => x.id !== u.id).filter((x) => {
      const tg = targeting(s, u, move, { targetId: x.id });
      return tg.ok && fmOk(tg);
    }).map((x) => x.id);
    return { aim: 'unit', dirs: [], units, usable: units.length > 0, reason: units.length ? undefined : t.kind === 'ally' ? 'No ally can switch' : 'No target in range' };
  }
  if (fm) return { aim: 'none', dirs: [], units: [], usable: false, reason: 'Follow Me: must target the decoy' };
  return { aim: 'none', dirs: [], units: [], usable: true };
}

/** Moves Transform could use for `u` right now. */
export function copyOptions(s: GameState, u: Unit): CopyOption[] {
  const out: CopyOption[] = [];
  for (const src of liveUnits(s)) {
    if (src.id === u.id) continue;
    for (const moveIndex of [0, 1] as const) {
      const move = moveOf(src, moveIndex);
      if (UNCOPYABLE(move) || moveBlocked(s, u, move)) continue;
      const a = aimFor(s, u, move);
      if (a.usable && a.aim !== 'copy') out.push({ unitId: src.id, moveIndex, move, aim: a.aim, dirs: a.dirs, units: a.units });
    }
  }
  return out;
}

export function moveOptions(s: GameState, u: Unit): MoveOption[] {
  const info = unitTurnInfo(s, u);
  return ([0, 1] as const).map((moveIndex) => {
    const move = moveOf(u, moveIndex);
    const base: MoveOption = { moveIndex, move, usable: false, aim: 'none', dirs: [], units: [] };
    if (!info.canAct) return { ...base, reason: info.done ? 'Already activated' : info.reasons.join(', ') || 'Cannot act' };
    const block = followMeBlock(s, u);
    if (block) return { ...base, reason: block };
    const blocked = moveBlocked(s, u, move);
    if (blocked) return { ...base, reason: blocked };
    if (move.fx.special === 'transform') {
      const copies = copyOptions(s, u);
      return { ...base, aim: 'copy', copies, usable: copies.length > 0, reason: copies.length ? undefined : 'Nothing to copy from here' };
    }
    return { ...base, ...aimFor(s, u, move) };
  });
}

export interface TrebuchetOption {
  usable: boolean;
  types: PType[];
  targets: string[];
}

export function trebuchetOption(s: GameState, u: Unit): TrebuchetOption {
  const info = unitTurnInfo(s, u);
  const types = cardOf(u).types;
  if (!info.canAct || !u.pos || !isTrebuchet(s, u.pos) || followMeBlock(s, u)) return { usable: false, types, targets: [] };
  const users = followMeUsers(s, u);
  let targets = liveUnits(s).filter((x) => x.id !== u.id).map((x) => x.id);
  if (users.length && fmFilter(s, u)) targets = targets.filter((id) => users.some((f) => f.id === id));
  return { usable: targets.length > 0, types, targets };
}

// ---------------------------------------------------------------- previews

export interface TargetPreview {
  unitId: string;
  kind: 'damage' | 'heal' | 'immune' | 'absorb' | 'effect';
  min: number;
  max: number;
  expected: number;
  koChance: number;
  notes: string[];
}

const STAT_SHORT: Record<StatId, string> = { atk: 'Atk', def: 'Def', mov: 'Mov' };
const pct = (p: number): string => `${Math.round(p * 100)}%`;

function stageNotes(stages: Partial<Record<StatId, number>>): string[] {
  return (['atk', 'def', 'mov'] as const).filter((k) => stages[k]).map((k) => `${STAT_SHORT[k]} ${stages[k]! > 0 ? '+' : ''}${stages[k]}`);
}

interface Outcome {
  p: number;
  dmg: number;
}

function koChanceOf(t: Unit, outcomes: Outcome[], ignoreAbilities: boolean): number {
  const sturdy = !ignoreAbilities && abilityOf(t) === 'sturdy' && t.hp === t.maxHp && !t.sturdyBroken;
  return outcomes.reduce((acc, o) => {
    if (o.dmg <= 0) return acc;
    if (t.sturdyBroken) return acc + o.p;
    if (o.dmg >= t.hp && !sturdy) return acc + o.p;
    return acc;
  }, 0);
}

export interface PreviewOpts {
  dir?: Dir;
  targetId?: string;
  /** Liquid Voice: preview a copied move as Water. */
  copyOf?: MoveDef;
  /** Preview this move as the user's own (Transform, Metronome, Dancer). */
  move?: MoveDef;
}

/** Per-target outcome ranges for a move or the trebuchet ('treb'). Pure: does not mutate `s`. */
export function previewAction(s0: GameState, unitId: string, which: 0 | 1 | 'treb', opts: PreviewOpts): TargetPreview[] {
  const s = cloneState(s0, true);
  const u = getUnit(s, unitId);
  if (!onBoard(u)) return [];
  if (which === 'treb') {
    const t = opts.targetId ? getUnit(s, opts.targetId) : null;
    if (!t || !onBoard(t)) return [];
    const ac = trebuchetCtx(s, u, t);
    const imm = isImmune(ac, t);
    if (imm.immune) return [{ unitId: t.id, kind: imm.absorbed ? 'absorb' : 'immune', min: 0, max: 0, expected: 0, koChance: 0, notes: [imm.absorbed ? 'Storm Drain' : 'No effect'] }];
    const r = computeDamage(s, ac, t, 40, null);
    const eff = typeEffectLabel(r.mult);
    // Which of a dual-type user's types the shot fires as against this target.
    const as = cardOf(u).types.length > 1 ? [`as ${ac.moveType}`] : [];
    return [{ unitId: t.id, kind: 'damage', min: r.damage, max: r.damage, expected: r.damage, koChance: koChanceOf(t, [{ p: 1, dmg: r.damage }], ac.ignoreAbilities), notes: [...(eff ? [eff] : []), ...as] }];
  }
  const move = opts.move ?? (opts.copyOf ? liquidVoiceCopy(opts.copyOf) : moveOf(u, which));
  const tg = targeting(s, u, move, { dir: opts.dir, targetId: opts.targetId });
  if (!tg.ok) return [];
  const fx = move.fx;
  // Hypothetical pre-steps: dash and pre-attack boosts.
  if (tg.dashTo) u.pos = { ...tg.dashTo };
  if (fx.preSelfStages) {
    for (const k of ['atk', 'def', 'mov'] as const) {
      const d = fx.preSelfStages[k];
      if (d) u.stages[k] = clamp(u.stages[k] + (abilityOf(u) === 'contrary' ? -d : d), -3, 3);
    }
  }
  if (tg.substitute) return [];
  const moveType = move.type ?? 'Normal';
  const out: TargetPreview[] = [];
  const knock = pushDistance(s, u, move, move.target.kind === 'grid' ? parseGrid(move.target.grid).knockback : 0);
  for (const t of tg.targets) {
    const notes: string[] = [];
    if (move.kind === 'status') {
      const allyOnly = fx.alliesStages || fx.healSelfAndAllies || fx.special === 'helpingHand' || fx.special === 'afterYou';
      if (allyOnly && t.side !== u.side) continue;
      if (fx.special === 'helpingHand') notes.push('+30 damage this turn');
      if (fx.special === 'afterYou') notes.push('Moves again');
      if (fx.status) {
        const ok = canHaveStatus(t, fx.status.id, fx.grassImmune);
        notes.push(ok ? `${STATUS_NAME[fx.status.id]}${fx.hitChance && !neverMisses(s, u) ? ` (${pct(fx.hitChance)})` : ''}` : 'Status won’t stick');
      }
      if (fx.targetStages) notes.push(...stageNotes(fx.targetStages.stages));
      if (fx.alliesStages) notes.push(...stageNotes(fx.alliesStages));
      if (fx.resetTargetStages) notes.push('Reset stats');
      if (fx.invertTargetStages) notes.push('Invert stats');
      if (knock) notes.push(`Knockback ${knock}`);
      const healAmt = (fx.healOnBonusTerrain !== undefined && terrainBonus(s, t) ? fx.healOnBonusTerrain : fx.heal) ?? fx.healSelfAndAllies ?? 0;
      if (healAmt) {
        const h = Math.min(healAmt, t.maxHp - t.hp);
        out.push({ unitId: t.id, kind: 'heal', min: h, max: h, expected: h, koChance: 0, notes });
      } else {
        out.push({ unitId: t.id, kind: 'effect', min: 0, max: 0, expected: 0, koChance: 0, notes });
      }
      continue;
    }
    if (fx.allyHeal !== undefined && t.side === u.side) {
      const h = Math.min(fx.allyHeal, t.maxHp - t.hp);
      out.push({ unitId: t.id, kind: 'heal', min: h, max: h, expected: h, koChance: 0, notes: ['Ally healed'] });
      continue;
    }
    out.push(attackPreview(s, u, move, moveType, t, tg.targets.length, knock));
  }
  return out;
}

/** Outcome range of attack `move` (as `moveType`) hitting `t`, with `targetCount` Pokémon in the zone. */
function attackPreview(s: GameState, u: Unit, move: MoveDef, moveType: PType, t: Unit, targetCount: number, knock: number): TargetPreview {
  const fx = move.fx;
  const sm = secondaryMult(s, u);
  const notes: string[] = [];
  const ac = makeAttackCtx(u, move, { moveType, attackerPos: u.pos!, targetCount, s });
  const imm = isImmune(ac, t);
  if (imm.immune) {
    const why = imm.absorbed ? 'Storm Drain' : imm.wonderGuard ? 'Wonder Guard' : 'No effect';
    return { unitId: t.id, kind: imm.absorbed ? 'absorb' : 'immune', min: 0, max: 0, expected: 0, koChance: 0, notes: [why] };
  }
  if (fx.special === 'endeavor') {
    const d = Math.max(0, t.hp - u.hp);
    return { unitId: t.id, kind: 'damage', min: d, max: d, expected: d, koChance: 0, notes: ['HP set to user’s'] };
  }
  // Enumerate outcomes: miss-all, per-target miss, graze, bonus proc, dice.
  const outcomes: Outcome[] = [];
  const missAll = fx.missAll && !neverMisses(s, u) ? fx.missAll.chance : 0;
  const miss = fx.missChance && !neverMisses(s, u) ? fx.missChance : 0;
  const graze = grazeApplies(s, ac) ? fx.graze!.chance : 0;
  const bonus = fx.bonus?.find((b) => b.when === 'chance');
  const bonusP = bonus && bonus.when === 'chance' ? Math.min(1, bonus.chance * sm) : 0;
  const dice = fx.dice ? [1, 2, 3, 4, 5, 6] : [null];
  const pHit = (1 - missAll) * (1 - miss);
  if (pHit < 1) outcomes.push({ p: 1 - pHit, dmg: 0 });
  for (const d of dice) {
    const pd = 1 / dice.length;
    for (const g of graze > 0 ? [true, false] : [false]) {
      const pg = graze > 0 ? (g ? graze : 1 - graze) : 1;
      for (const b of bonusP > 0 ? [true, false] : [false]) {
        const pb = bonusP > 0 ? (b ? bonusP : 1 - bonusP) : 1;
        const base = basePower(s, ac, t, d, b);
        const r = computeDamage(s, ac, t, base, g ? fx.graze!.power : null);
        outcomes.push({ p: pHit * pd * pg * pb, dmg: r.damage });
      }
    }
  }
  const hits = outcomes.filter((o) => o.dmg > 0);
  const min = hits.length ? Math.min(...hits.map((o) => o.dmg)) : 0;
  const max = hits.length ? Math.max(...hits.map((o) => o.dmg)) : 0;
  const expected = outcomes.reduce((a, o) => a + o.p * o.dmg, 0);
  const eff = typeEffectLabel(computeDamage(s, ac, t, 50, null).mult);
  if (eff) notes.push(eff);
  if (ac.pixilated) notes.push('Pixilate: Fairy');
  if (graze > 0) notes.push(`Graze ${pct(graze)}`);
  if (miss > 0 || missAll > 0) notes.push(`Miss ${pct(1 - pHit)}`);
  if (fx.status && canHaveStatus(t, fx.status.id)) notes.push(`${STATUS_NAME[fx.status.id]} ${pct(Math.min(1, fx.status.chance * sm))}`);
  if (fx.triStatus) notes.push(`Tri-status ${pct(Math.min(1, fx.triStatus * sm))}`);
  if (fx.flinch) notes.push(`Flinch ${pct(Math.min(1, fx.flinch.chance * sm))}`);
  if (fx.confuse) notes.push(`Confuse ${pct(Math.min(1, fx.confuse.chance * sm))}`);
  if (fx.targetStages) {
    const p = Math.min(1, fx.targetStages.chance * sm);
    notes.push(...stageNotes(fx.targetStages.stages).map((n) => (p < 1 ? `${n} ${pct(p)}` : n)));
  }
  if (fx.removeDefBoosts) notes.push('Removes Def boosts');
  if (fx.resetTargetStages) notes.push('Reset stats');
  if (knock) notes.push(`Knockback ${knock}`);
  return { unitId: t.id, kind: 'damage', min, max, expected, koChance: koChanceOf(t, outcomes, ac.ignoreAbilities), notes };
}

/**
 * What `attackerId`'s attack would do to `targetId` if it landed from where the attacker stands,
 * ignoring range. Null for status moves.
 */
export function damageVs(s0: GameState, attackerId: string, moveIndex: 0 | 1, targetId: string): TargetPreview | null {
  const s = cloneState(s0, true);
  const u = getUnit(s, attackerId);
  const t = getUnit(s, targetId);
  const move = moveOf(u, moveIndex);
  if (!onBoard(u) || !onBoard(t) || move.kind !== 'attack') return null;
  if (move.fx.allyHeal !== undefined && t.side === u.side) return null;
  return attackPreview(s, u, move, move.type ?? 'Normal', t, 1, 0);
}

/** Short summary of what a move does to its user (recoil, drains, self stat changes). */
export function selfEffectNotes(s: GameState, u: Unit, move: MoveDef): string[] {
  const fx = move.fx;
  const notes: string[] = [];
  if (fx.recoil) notes.push(`Recoil ${fx.recoil}`);
  if (fx.recoilPerTarget) notes.push(`Recoil ${fx.recoilPerTarget}/target`);
  if (fx.drain) notes.push(`Heals ${fx.drain}`);
  if (fx.drainPerTarget) notes.push(`Heals ${fx.drainPerTarget}/target`);
  if (fx.selfStages) {
    const pm = pressureMult(s, u);
    const st = Object.fromEntries(Object.entries(fx.selfStages.stages).map(([k, v]) => [k, v! < 0 ? v! * pm : v])) as Partial<Record<StatId, number>>;
    const n = stageNotes(st);
    notes.push(...(fx.selfStages.chance ? n.map((x) => `${x} ${pct(fx.selfStages!.chance!)}`) : n));
  }
  if (fx.preSelfStages) notes.push(...stageNotes(fx.preSelfStages).map((x) => `${x} first`));
  if (fx.postMove) notes.push(`Move ${fx.postMove} after`);
  if (fx.selfFaint) notes.push('User faints');
  if (fx.selfSleepChance) notes.push(`Sleep ${pct(fx.selfSleepChance)}`);
  if (fx.nextTurn) notes.push(fx.nextTurn.noAct ? 'Recharge next turn' : 'Can’t move next turn');
  if (fx.selfHeal) notes.push(`Heals ${fx.selfHeal}`);
  if (fx.lockUntilFar) notes.push(`Cooldown until ${fx.lockUntilFar}+ tiles from opponents`);
  if (fx.evenRoundsOnly) notes.push('Even rounds only');
  return notes;
}
