import { typeMultiplier } from './data/typechart';
import {
  abilityOf, adjacentToType, alliesOf, cardOf, effectiveMov, isNormalTerrain, liveUnits,
  terrainAt, terrainBonus, withAbility,
} from './query';
import type { GameState, MoveDef, PType, Pos, Unit } from './types';
import { cheb, clamp, roundUp5 } from './util';

export interface AttackCtx {
  attacker: Unit;
  /** Where the attacker stands when the hit lands (after any dash). */
  attackerPos: Pos;
  move: MoveDef | null;
  moveType: PType;
  /** Every type the hit carries: the move's type, or all of the user's types for the trebuchet. */
  types: PType[];
  moveName: string;
  isTrebuchet: boolean;
  /** Moongeist Beam, Teravolt, Turboblaze. */
  ignoreAbilities: boolean;
  /** Number of Pokémon in the attack's zone (Dragon Darts). */
  targetCount: number;
}

export function makeAttackCtx(attacker: Unit, move: MoveDef | null, opts: {
  moveType?: PType;
  attackerPos?: Pos;
  targetCount?: number;
} = {}): AttackCtx {
  const ab = abilityOf(attacker);
  const moveType = opts.moveType ?? (move ? move.type ?? 'Normal' : cardOf(attacker).types[0]);
  return {
    attacker,
    attackerPos: opts.attackerPos ?? attacker.pos!,
    move,
    moveType,
    types: move ? [moveType] : cardOf(attacker).types,
    moveName: move?.name ?? 'Trebuchet',
    isTrebuchet: move === null,
    ignoreAbilities: !!move?.fx.ignoreAbilities || ab === 'teravolt' || ab === 'turboblaze',
    targetCount: opts.targetCount ?? 1,
  };
}

/** The target's first attack with a printed power (Foul Play). */
export function firstAttackPower(u: Unit): number {
  const m = cardOf(u).moves.find((mv) => mv.kind === 'attack' && mv.power !== null);
  return m?.power ?? 0;
}

const stageCount = (u: Unit, sign: 1 | -1): number =>
  (['atk', 'def', 'mov'] as const).reduce((n, k) => n + Math.max(0, sign * u.stages[k]), 0);

/**
 * Base power before graze substitution: printed power, dice, conditional bonuses.
 * `dice` is the rolled d6 (or null), `chanceBonus` whether a "chance to deal extra" proc hit.
 */
export function basePower(s: GameState, ac: AttackCtx, target: Unit, dice: number | null, chanceBonus: boolean): number {
  const m = ac.move;
  if (!m) return 40; // trebuchet
  const A = ac.attacker;
  let p = m.power ?? 0;
  switch (m.fx.special) {
    case 'foulPlay':
      p = firstAttackPower(target);
      break;
    case 'powerTrip':
      p = 20 + 20 * stageCount(A, 1) - 20 * stageCount(A, -1);
      break;
    case 'gyroBall': {
      const diff = effectiveMov(s, target) - effectiveMov(s, A, ac.attackerPos);
      if (diff > 0) p += 40 * diff;
      break;
    }
  }
  if (m.fx.dice && dice !== null) p += 10 * dice;
  for (const b of m.fx.bonus ?? []) {
    switch (b.when) {
      case 'userStatus':
        if (A.status) p += b.amount;
        break;
      case 'targetStatus':
        if (target.status) p += b.amount;
        break;
      case 'normalTerrain':
        if (target.pos && isNormalTerrain(terrainAt(s, ac.attackerPos)) && isNormalTerrain(terrainAt(s, target.pos))) p += b.amount;
        break;
      case 'userHpAtMost':
        if (A.hp <= b.hp) p += b.amount;
        break;
      case 'userDamageAtLeast':
        if (A.maxHp - A.hp >= b.dmg) p += b.amount;
        break;
      case 'singleTarget':
        if (ac.targetCount === 1) p += b.amount;
        break;
      case 'chance':
        if (chanceBonus) p += b.amount;
        break;
    }
  }
  return p;
}

export interface DamageResult {
  damage: number;
  mult: number;
  immune: boolean;
  /** Storm Drain soaked up a Water move. */
  absorbed: boolean;
}

/** Type effectiveness of the hit: the product over every type it carries. */
export function hitTypeMultiplier(ac: AttackCtx, target: Unit): number {
  return ac.types.reduce((m, t) => m * typeMultiplier(t, cardOf(target).types), 1);
}

export function isImmune(ac: AttackCtx, target: Unit): { immune: boolean; absorbed: boolean } {
  const dAb = ac.ignoreAbilities ? null : abilityOf(target);
  if (dAb === 'stormDrain' && ac.types.includes('Water')) return { immune: true, absorbed: true };
  if (dAb === 'levitate' && ac.types.includes('Ground')) return { immune: true, absorbed: false };
  if (hitTypeMultiplier(ac, target) === 0) return { immune: true, absorbed: false };
  return { immune: false, absorbed: false };
}

function flowerGiftAdjacent(s: GameState, u: Unit): boolean {
  return alliesOf(s, u).some((a) => abilityOf(a) === 'flowerGiftSunshine' && cheb(a.pos!, u.pos!) === 1);
}

/** README §5: PreType = max(10, Base + ΔStages + ΔAbilities + ΔStatus) → × type × Thick Fat → round up to 5. */
export function computeDamage(s: GameState, ac: AttackCtx, target: Unit, base: number, grazePower: number | null): DamageResult {
  const imm = isImmune(ac, target);
  if (imm.immune) return { damage: 0, mult: 0, immune: true, absorbed: imm.absorbed };
  const A = ac.attacker;
  const aAb = abilityOf(A);
  const dAb = ac.ignoreAbilities ? null : abilityOf(target);
  const grazed = grazePower !== null;
  const dist = cheb(ac.attackerPos, target.pos!);

  let mult = hitTypeMultiplier(ac, target);
  if (aAb === 'tintedLens' && mult < 1) mult = 1;

  // The trebuchet is a flat 40 before type effectiveness: no stages, ability, terrain or burn modifiers.
  if (ac.isTrebuchet) {
    let raw = 40 * mult;
    if (dAb === 'thickFat' && (ac.types.includes('Fire') || ac.types.includes('Ice'))) raw *= 0.5;
    return { damage: roundUp5(raw), mult, immune: false, absorbed: false };
  }

  // ---- stages
  let atkStage = ac.move?.fx.special === 'foulPlay' ? target.stages.atk : A.stages.atk;
  let defStage = target.stages.def;
  if (grazed) {
    atkStage = Math.min(0, atkStage);
    defStage = Math.max(0, defStage);
  }
  if (aAb === 'unaware') defStage = 0;
  if (dAb === 'unaware') atkStage = 0;
  if (aAb === 'airLock') defStage = Math.min(0, defStage);
  if (dAb === 'airLock') atkStage = Math.min(0, atkStage);
  if (ac.move?.fx.ignoreDefBoosts || aAb === 'infiltrator') defStage = Math.min(0, defStage);
  if (ac.move?.fx.ignoreAllDefStages) defStage = 0;
  const dStages = 20 * (clamp(atkStage, -3, 3) - clamp(defStage, -3, 3));

  // ---- abilities & positional modifiers
  let mod = 0;
  const atkBoostsIgnored = dAb === 'airLock';
  if (!atkBoostsIgnored) {
    const technician = !ac.isTrebuchet && ac.move?.power != null && ac.move.power <= 40 &&
      (aAb === 'technician' || alliesOf(s, A).some((x) => abilityOf(x) === 'technician' && cheb(x.pos!, ac.attackerPos) === 1));
    if (technician) mod += 30;
    if (aAb === 'solarPower' && (adjacentToType(s, A, 'Fire', ac.attackerPos) || terrainAt(s, ac.attackerPos) === 'magma')) mod += 30;
    if (alliesOf(s, A).some((x) => abilityOf(x) === 'flowerGiftSunshine' && cheb(x.pos!, ac.attackerPos) === 1)) mod += 30;
    if (aAb === 'guts' && A.status) mod += 30;
    if (/punch|mash|fist/i.test(ac.moveName) && (aAb === 'ironFist' ||
      liveUnits(s).some((x) => x.id !== A.id && abilityOf(x) === 'ironFist' && cheb(x.pos!, ac.attackerPos) === 1))) mod += 20;
    if (ac.moveType === 'Dark' && withAbility(s, 'darkAura').length > 0) mod += 20;
  }
  if (aAb === 'defeatist' && A.maxHp - A.hp >= 60) mod -= 40;
  // Intimidate: each adjacent opposing Intimidate holder.
  mod -= 30 * liveUnits(s).filter((x) => x.side !== A.side && abilityOf(x) === 'intimidate' && cheb(x.pos!, ac.attackerPos) === 1).length;

  const defBoostsIgnored = aAb === 'airLock' || aAb === 'infiltrator';
  if (dAb && !defBoostsIgnored) {
    if ((dAb === 'multiscale' || dAb === 'shadowShield') && target.hp === target.maxHp) mod -= 30;
    if (dAb === 'hardArmor' && dist <= 1) mod -= 30;
    if (dAb === 'iceScales' && dist >= 2) mod -= 30;
    if (dAb === 'resistance' && dist >= 2) mod -= 40;
  }
  if (dAb === 'resistance' && dist <= 1) mod += 20;
  if (!ac.ignoreAbilities && !defBoostsIgnored && flowerGiftAdjacent(s, target)) mod -= 30;
  if (aAb !== 'airLock' && terrainBonus(s, target) === 'bush') mod -= 30;

  // ---- status
  if (A.status === 'brn' && aAb !== 'guts') mod -= 30;

  const pre = Math.max(10, (grazed ? grazePower! : base) + dStages + mod);
  let raw = pre * mult;
  if (dAb === 'thickFat' && !defBoostsIgnored && (ac.moveType === 'Fire' || ac.moveType === 'Ice')) raw *= 0.5;
  return { damage: roundUp5(raw), mult, immune: false, absorbed: false };
}

/** Graze is suppressed by Compound Eyes, Drizzle (Hurricane) and the move's own terrain clause. */
export function grazeApplies(s: GameState, ac: AttackCtx): boolean {
  const g = ac.move?.fx.graze;
  if (!g) return false;
  if (neverMisses(s, ac.attacker, ac.attackerPos)) return false;
  if (ac.moveName === 'Hurricane' && withAbility(s, 'drizzle').length > 0) return false;
  if (g.negateNear === 'water' && (terrainAt(s, ac.attackerPos) === 'water' || adjacentToType(s, ac.attacker, 'Water', ac.attackerPos))) return false;
  if (g.negateNear === 'ice' && (terrainAt(s, ac.attackerPos) === 'ice' || adjacentToType(s, ac.attacker, 'Ice', ac.attackerPos))) return false;
  return true;
}

/** Compound Eyes: the user or an adjacent ally of Galvantula never misses or grazes. */
export function neverMisses(s: GameState, u: Unit, at?: Pos): boolean {
  const p = at ?? u.pos;
  if (abilityOf(u) === 'compoundEyes') return true;
  return !!p && alliesOf(s, u).some((a) => abilityOf(a) === 'compoundEyes' && cheb(a.pos!, p) === 1);
}

/** Serene Grace doubles secondary-effect chances for Togekiss's adjacent allies. */
export function secondaryMult(s: GameState, u: Unit, at?: Pos): number {
  const p = at ?? u.pos;
  return p && alliesOf(s, u).some((a) => abilityOf(a) === 'sereneGrace' && cheb(a.pos!, p) === 1) ? 2 : 1;
}

export function typeEffectLabel(mult: number): string | null {
  if (mult === 0) return 'No effect';
  if (mult >= 4) return 'Super effective ×4';
  if (mult >= 2) return 'Super effective';
  if (mult <= 0.25) return 'Not very effective ×¼';
  if (mult < 1) return 'Not very effective';
  return null;
}
