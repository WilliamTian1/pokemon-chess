import { getCard } from './data/cards';
import { abilityOf, cardOf, hasType, hazardAt, hazardDamage, isFlier, withAbility } from './query';
import type { GameEvent, GameState, LogEntry, Pos, Rng, Side, StatId, StatusId, Unit } from './types';
import { SIDE_NAME } from './types';
import { clamp, roundUp5, steps } from './util';

export interface Ctx {
  s: GameState;
  rng: Rng;
  events: GameEvent[];
  /** AI look-ahead: skip log text and events. */
  silent: boolean;
}

export class RuleError extends Error {}

export const STATUS_NAME: Record<StatusId, string> = {
  psn: 'poisoned',
  tox: 'badly poisoned',
  brn: 'burned',
  par: 'paralyzed',
  slp: 'asleep',
  frz: 'frozen',
};
export const STAT_NAME: Record<StatId, string> = { atk: 'Attack', def: 'Defense', mov: 'Movement' };

const MAX_LOG = 400;

export function log(ctx: Ctx, text: string, tone: LogEntry['tone'] = 'info', side?: Side): void {
  if (ctx.silent) return;
  const s = ctx.s;
  s.logCounter += 1;
  s.log.push({ n: s.logCounter, text, tone, side, round: s.round });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export function emit(ctx: Ctx, e: GameEvent): void {
  if (!ctx.silent) ctx.events.push(e);
}

export const nameOf = (u: Unit): string => `${cardOf(u).name}${u.side === 'A' ? ' (A)' : ' (D)'}`;

// ---------------------------------------------------------------- hp

export interface DamageOpts {
  source?: Unit | null;
  /** Damage from an attack (Sturdy only protects against attacks). */
  attack?: boolean;
  ignoreAbilities?: boolean;
  label?: string;
}

/** Applies damage; returns the HP actually lost (for Leech / Emergency Exit). */
export function dealDamage(ctx: Ctx, u: Unit, amount: number, opts: DamageOpts = {}): number {
  if (u.fainted || amount <= 0) return 0;
  const before = u.hp;
  const label = opts.label ? ` (${opts.label})` : '';
  if (u.sturdyBroken) {
    u.hp = 0;
    u.damageTaken += before;
    emit(ctx, { t: 'damage', unitId: u.id, amount: before });
    log(ctx, `${nameOf(u)} took ${amount} damage${label} and could no longer hold on!`, 'bad', u.side);
    faint(ctx, u, opts.source ?? null);
    return before;
  }
  if (opts.attack && !opts.ignoreAbilities && abilityOf(u) === 'sturdy' && u.hp === u.maxHp && amount >= u.hp) {
    u.hp = 1;
    u.damageTaken += before - 1;
    u.sturdyBroken = true;
    emit(ctx, { t: 'damage', unitId: u.id, amount: before - 1 });
    log(ctx, `${nameOf(u)} took ${amount} damage${label} but endured the hit with Sturdy!`, 'bad', u.side);
    return before - 1;
  }
  u.hp = Math.max(0, u.hp - amount);
  const dealt = before - u.hp;
  u.damageTaken += dealt;
  emit(ctx, { t: 'damage', unitId: u.id, amount });
  log(ctx, `${nameOf(u)} took ${amount} damage${label}.`, 'bad', u.side);
  if (u.cardId === 'zygarde' && u.damageTaken >= 100) {
    transform(ctx, u, 'zygarde-100', false);
    log(ctx, `${nameOf(u)} transformed into its 100% form with Power Construct!`, 'good', u.side);
  }
  if (u.hp <= 0) {
    if (abilityOf(u) === 'shieldsDownMeteor') {
      transform(ctx, u, 'minior-core', true);
      log(ctx, `${nameOf(u)}'s shell broke — it transformed into its Core form!`, 'info', u.side);
      return before;
    }
    faint(ctx, u, opts.source ?? null);
  }
  // Swallow: dropping under 60 HP with Defense boosts trades each boost for 70 HP.
  if (!u.fainted && u.hp < 60 && u.stages.def > 0 && abilityOf(u) === 'swallow' && !(opts.attack && opts.ignoreAbilities)) {
    const n = u.stages.def;
    u.stages.def = 0;
    log(ctx, `${nameOf(u)} swallowed its stockpile!`, 'good', u.side);
    heal(ctx, u, 70 * n, 'Swallow');
  }
  return dealt;
}

export function heal(ctx: Ctx, u: Unit, amount: number, label?: string): number {
  if (u.fainted || amount <= 0) return 0;
  if (u.hp >= u.maxHp) {
    if (abilityOf(u) === 'shieldsDownCore') {
      transform(ctx, u, 'minior', true);
      log(ctx, `${nameOf(u)} was healed at full health and reformed its Meteor shell!`, 'good', u.side);
    }
    return 0;
  }
  const gained = Math.min(amount, u.maxHp - u.hp);
  u.hp += gained;
  emit(ctx, { t: 'heal', unitId: u.id, amount: gained });
  log(ctx, `${nameOf(u)} recovered ${gained} HP${label ? ` (${label})` : ''}.`, 'good', u.side);
  return gained;
}

/** Changes form. `full` restores max HP; otherwise damage taken is preserved. */
export function transform(ctx: Ctx, u: Unit, cardId: string, full: boolean): void {
  const next = getCard(cardId);
  const taken = u.maxHp - u.hp;
  u.cardId = cardId;
  u.maxHp = next.hp;
  u.hp = full ? next.hp : Math.max(1, next.hp - taken);
  if (next.ability === 'shieldsDownMeteor') u.status = null;
  emit(ctx, { t: 'transform', unitId: u.id, cardId });
}

export function faint(ctx: Ctx, u: Unit, source: Unit | null): void {
  if (u.fainted) return;
  u.hp = 0;
  u.fainted = true;
  u.status = null;
  u.followMe = null;
  emit(ctx, { t: 'faint', unitId: u.id });
  log(ctx, `${nameOf(u)} fainted!`, 'system', u.side);
  u.pos = null;
  if (source && source.id !== u.id && source.side !== u.side && !source.fainted && abilityOf(source) === 'moxie') {
    applyStage(ctx, source, 'atk', 1, { source, label: 'Moxie' });
  }
}

// ---------------------------------------------------------------- stages

export interface StageOpts {
  source: Unit | null;
  ignoreAbilities?: boolean;
  label?: string;
}

export function applyStage(ctx: Ctx, u: Unit, stat: StatId, delta: number, opts: StageOpts): number {
  if (u.fainted || delta === 0) return 0;
  const ab = opts.ignoreAbilities ? null : abilityOf(u);
  let d = delta;
  if (ab === 'contrary') d = -d;
  if (d < 0 && ab === 'clearBody') {
    log(ctx, `${nameOf(u)}'s Clear Body prevents its stats from being lowered.`, 'info', u.side);
    return 0;
  }
  if (d < 0 && ab === 'fullMetalBody') {
    log(ctx, `${nameOf(u)}'s Full Metal Body prevents its stats from being lowered.`, 'info', u.side);
    return 0;
  }
  if (d < 0 && stat === 'atk' && ab === 'keenEye') {
    log(ctx, `${nameOf(u)}'s Keen Eye prevents its Attack from being lowered.`, 'info', u.side);
    return 0;
  }
  const before = u.stages[stat];
  const after = clamp(before + d, -3, 3);
  u.stages[stat] = after;
  const change = after - before;
  if (change !== 0) {
    emit(ctx, { t: 'stage', unitId: u.id, stat, delta: change });
    const how = change > 0 ? (change > 1 ? 'rose sharply' : 'rose') : change < -1 ? 'fell harshly' : 'fell';
    log(ctx, `${nameOf(u)}'s ${STAT_NAME[stat]} ${how}${opts.label ? ` (${opts.label})` : ''}.`, change > 0 ? 'good' : 'bad', u.side);
  } else {
    log(ctx, `${nameOf(u)}'s ${STAT_NAME[stat]} won't go any ${d > 0 ? 'higher' : 'lower'}.`, 'info', u.side);
  }
  if (change < 0) {
    if (ab === 'angerPoint' && u.stages.atk < 3) {
      u.stages.atk = 3;
      log(ctx, `${nameOf(u)}'s Anger Point maxed out its Attack!`, 'good', u.side);
    } else if (ab === 'competitive' && opts.source && opts.source.id !== u.id && u.stages.atk < 3) {
      u.stages.atk = 3;
      log(ctx, `${nameOf(u)}'s Competitive maxed out its Attack!`, 'good', u.side);
    }
  }
  return change;
}

export function triggerProtosynthesis(ctx: Ctx): void {
  for (const u of withAbility(ctx.s, 'protosynthesis')) {
    applyStage(ctx, u, 'def', 1, { source: null, label: 'Protosynthesis' });
  }
}

/** Self-inflicted stat drops are doubled while an opposing Pressure Pokémon is on the field. */
export function pressureMult(s: GameState, u: Unit): number {
  return withAbility(s, 'pressure').some((m) => m.side !== u.side) ? 2 : 1;
}

export function applySelfStages(ctx: Ctx, u: Unit, stages: Partial<Record<StatId, number>>, label?: string): void {
  const pm = pressureMult(ctx.s, u);
  for (const k of ['atk', 'def', 'mov'] as const) {
    const d = stages[k];
    if (!d) continue;
    applyStage(ctx, u, k, d < 0 ? d * pm : d, { source: u, label: d < 0 && pm > 1 ? 'Pressure' : label });
  }
}

export function resetStages(ctx: Ctx, u: Unit): void {
  if (u.stages.atk || u.stages.def || u.stages.mov) {
    u.stages = { atk: 0, def: 0, mov: 0 };
    log(ctx, `${nameOf(u)}'s stat changes were removed.`, 'info', u.side);
  }
}

// ---------------------------------------------------------------- status

export interface StatusOpts {
  source: Unit | null;
  ignoreAbilities?: boolean;
  grassImmune?: boolean;
  fromSynchronize?: boolean;
  quiet?: boolean;
}

export function canHaveStatus(u: Unit, status: StatusId, grassImmune = false): boolean {
  if (u.fainted || u.status) return false;
  if (abilityOf(u) === 'shieldsDownMeteor') return false;
  if (status === 'slp' && abilityOf(u) === 'insomnia') return false;
  if ((status === 'psn' || status === 'tox') && (hasType(u, 'Poison') || hasType(u, 'Steel'))) return false;
  if (status === 'brn' && hasType(u, 'Fire')) return false;
  if (grassImmune && hasType(u, 'Grass')) return false;
  return true;
}

export function applyStatus(ctx: Ctx, u: Unit, status: StatusId, opts: StatusOpts): boolean {
  if (!canHaveStatus(u, status, opts.grassImmune)) {
    if (!opts.quiet && !u.fainted && !u.status) log(ctx, `${nameOf(u)} is unaffected.`, 'info', u.side);
    return false;
  }
  u.status = status;
  u.toxicN = 0;
  emit(ctx, { t: 'status', unitId: u.id, status });
  log(ctx, `${nameOf(u)} is ${STATUS_NAME[status]}!`, 'bad', u.side);
  const src = opts.source;
  if (!opts.fromSynchronize && !opts.ignoreAbilities && abilityOf(u) === 'synchronize' && src && src.side !== u.side && !src.fainted) {
    log(ctx, `${nameOf(u)}'s Synchronize passes the condition back!`, 'info', u.side);
    applyStatus(ctx, src, status, { source: u, fromSynchronize: true, grassImmune: opts.grassImmune });
  }
  return true;
}

export function cureStatus(ctx: Ctx, u: Unit, label: string): void {
  if (!u.status) return;
  log(ctx, `${nameOf(u)} was cured of being ${STATUS_NAME[u.status]} (${label}).`, 'good', u.side);
  u.status = null;
  u.toxicN = 0;
}

// ---------------------------------------------------------------- positioning

/** Moves a unit onto a tile, triggering its effects ("walks through, lands on, or is hit into"). */
export function enterTile(ctx: Ctx, u: Unit, p: Pos): void {
  u.pos = { x: p.x, y: p.y };
  if (isFlier(u)) return;
  const hz = hazardAt(ctx.s, p);
  if (!hz) return;
  if (hz.kind === 'spikes') dealDamage(ctx, u, hazardDamage(ctx.s, u, 30), { label: 'Spikes' });
  else applyStage(ctx, u, 'mov', -1, { source: null, label: 'Sticky Web' });
}

/** Leech: Volcarona heals half of attack damage dealt by others to targets within 3 tiles. */
export function triggerLeech(ctx: Ctx, attacker: Unit, targetPos: Pos, targetId: string, dealt: number): void {
  if (dealt <= 0) return;
  for (const v of withAbility(ctx.s, 'leech')) {
    if (v.id === attacker.id || v.id === targetId) continue;
    if (steps(v.pos!, targetPos) <= 3) heal(ctx, v, roundUp5(dealt / 2), 'Leech');
  }
}

// ---------------------------------------------------------------- win check

export function checkWin(ctx: Ctx): boolean {
  const s = ctx.s;
  if (s.phase !== 'battle') return s.phase === 'over';
  const aliveD = s.units.some((u) => u.side === 'D' && !u.fainted && u.hp > 0);
  const aliveA = s.units.some((u) => u.side === 'A' && !u.fainted && u.hp > 0);
  if (!aliveD) endGame(ctx, 'A', 'All of the Defender’s Pokémon fainted.');
  else if (!aliveA) endGame(ctx, 'D', 'All of the Attacker’s Pokémon fainted.');
  return s.winner !== null;
}

export function endGame(ctx: Ctx, winner: Side, reason: string): void {
  const s = ctx.s;
  s.phase = 'over';
  s.winner = winner;
  s.winReason = reason;
  s.pending = [];
  s.active = null;
  log(ctx, `${SIDE_NAME[winner]} wins! ${reason}`, 'system', winner);
}
