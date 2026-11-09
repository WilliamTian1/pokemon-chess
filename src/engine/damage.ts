import { typeMultiplier } from './data/typechart';
import {
  abilityOf, adjacentToType, alliesOf, cardOf, effectiveMov, isNormalTerrain, liveUnits,
  terrainAt, terrainBonus, terrainMult, trainerOf, turnEffect, withAbility,
} from './query';
import type { GameState, MoveDef, PType, Pos, Unit } from './types';
import { cheb, clamp, roundUp5 } from './util';

export interface AttackCtx {
  attacker: Unit;
  /** Where the attacker stands when the hit lands (after any dash). */
  attackerPos: Pos;
  move: MoveDef | null;
  /** The hit's type: the move's, or for the trebuchet whichever of the user's types it fires as. */
  moveType: PType;
  /** Every type the hit carries: `moveType`, plus a dual-type move's second type (Flying Press). */
  types: PType[];
  /** A Normal move turned Fairy by an adjacent ally's Pixilate (+30 damage). */
  pixilated: boolean;
  moveName: string;
  isTrebuchet: boolean;
  /** Moongeist Beam, Teravolt, Turboblaze. */
  ignoreAbilities: boolean;
  /** Number of Pokémon in the attack's zone (Dragon Darts). */
  targetCount: number;
}

/** Whether `u`'s Normal moves from `at` are turned Fairy by an adjacent ally's Pixilate. */
export function pixilateAt(s: GameState, u: Unit, at: Pos | null): boolean {
  return !!at && alliesOf(s, u).some((x) => abilityOf(x) === 'pixilate' && cheb(x.pos!, at) === 1);
}

export function makeAttackCtx(attacker: Unit, move: MoveDef | null, opts: {
  moveType?: PType;
  attackerPos?: Pos;
  targetCount?: number;
  /** Pass the state so Pixilate can turn a Normal move Fairy. */
  s?: GameState;
} = {}): AttackCtx {
  const ab = abilityOf(attacker);
  const attackerPos = opts.attackerPos ?? attacker.pos!;
  let moveType = opts.moveType ?? (move ? move.type ?? 'Normal' : cardOf(attacker).types[0]);
  const pixilated = !!move && !!opts.s && moveType === 'Normal' && pixilateAt(opts.s, attacker, attackerPos);
  if (pixilated) moveType = 'Fairy';
  const extra = move?.extraType && move.extraType !== moveType ? [move.extraType] : [];
  return {
    attacker,
    attackerPos,
    move,
    moveType,
    types: [moveType, ...extra],
    pixilated,
    moveName: move?.name ?? 'Trebuchet',
    isTrebuchet: move === null,
    ignoreAbilities: !!move?.fx.ignoreAbilities || ab === 'teravolt' || ab === 'turboblaze' || ab === 'moldBreaker',
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
    case 'spitUp':
      p += 50 * Math.max(0, A.stages.def);
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
      case 'targetBonusTerrain':
        if (target.pos && terrainBonus(s, target)) p += b.amount;
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
      case 'round':
        p += b.amount * s.round;
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

export function isImmune(ac: AttackCtx, target: Unit): { immune: boolean; absorbed: boolean; wonderGuard?: boolean } {
  const dAb = ac.ignoreAbilities ? null : abilityOf(target);
  if (dAb === 'stormDrain' && ac.types.includes('Water')) return { immune: true, absorbed: true };
  if (dAb === 'levitate' && ac.types.includes('Ground')) return { immune: true, absorbed: false };
  const mult = hitTypeMultiplier(ac, target);
  if (mult === 0) return { immune: true, absorbed: false };
  // Wonder Guard: only super-effective hits get through (Tinted Lens only lifts a hit to neutral).
  if (dAb === 'wonderGuard' && mult <= 1) return { immune: true, absorbed: false, wonderGuard: true };
  return { immune: false, absorbed: false };
}

/**
 * The trebuchet fires as whichever of the user's types does the most damage to `target`. On a tie
 * it avoids setting off the target's Storm Drain or Justified, then keeps the card's type order.
 */
export function trebuchetCtx(s: GameState, attacker: Unit, target: Unit): AttackCtx {
  let best: AttackCtx | null = null;
  let bestScore = -Infinity;
  for (const type of cardOf(attacker).types) {
    const ac = makeAttackCtx(attacker, null, { moveType: type });
    const r = computeDamage(s, ac, target, 40, null);
    const helpsTarget = r.absorbed || (type === 'Dark' && !r.immune && !ac.ignoreAbilities && abilityOf(target) === 'justified');
    const score = r.damage - (helpsTarget ? 0.5 : 0);
    if (score > bestScore) {
      best = ac;
      bestScore = score;
    }
  }
  return best!;
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
  const thickFat = dAb === 'thickFat' && (ac.types.includes('Fire') || ac.types.includes('Ice'));

  // The trebuchet is a flat 40 before type effectiveness: no stages, ability, terrain or burn
  // modifiers, except the ones that are about the trebuchet itself.
  if (ac.isTrebuchet) {
    const extra = (aAb === 'artilleryExpertise' ? 20 : 0) + (trainerOf(s, A.side) === 'nobunaga' ? 10 : 0);
    let raw = (40 + extra) * mult;
    if (thickFat) raw *= 0.5;
    return { damage: roundUp5(raw), mult, immune: false, absorbed: false };
  }

  // ---- stages
  let atkStage = ac.move?.fx.special === 'foulPlay' ? target.stages.atk : A.stages.atk;
  let defStage = target.stages.def;
  if (grazed) {
    atkStage = Math.min(0, atkStage);
    defStage = Math.max(0, defStage);
  }
  if (A.ignoreDefBoosts) defStage = Math.min(0, defStage);
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
    if (ac.moveType === 'Normal' && (aAb === 'adaptability' ||
      liveUnits(s).some((x) => x.id !== A.id && abilityOf(x) === 'adaptability' && cheb(x.pos!, ac.attackerPos) === 1))) mod += 30;
    // Crawdaunt's Adaptability: the same for Water and Dark attacks.
    if ((ac.moveType === 'Water' || ac.moveType === 'Dark') && (aAb === 'adaptabilityWaterDark' ||
      liveUnits(s).some((x) => x.id !== A.id && abilityOf(x) === 'adaptabilityWaterDark' && cheb(x.pos!, ac.attackerPos) === 1))) mod += 30;
    if (ac.pixilated) mod += 30;
  }
  // Helping Hand / Nobunaga, Red and Blue's specials, and Red's Pikachu.
  mod += A.dmgBonus;
  if (turnEffect(s, A.side) === 'rally') mod += 20 * s.units.filter((x) => x.side === A.side && x.fainted).length;
  if (ac.moveName === 'Thunderbolt' && cardOf(A).id === 'pikachu' && trainerOf(s, A.side) === 'red') mod += 45;
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
  if (aAb !== 'airLock' && !ac.move?.fx.ignoreTerrain && terrainBonus(s, target) === 'bush') mod -= 30 * terrainMult(target);

  // ---- status
  if (A.status === 'brn' && aAb !== 'guts') mod -= 30;

  const pre = Math.max(10, (grazed ? grazePower! : base) + dStages + mod);
  let raw = pre * mult;
  if (thickFat && !defBoostsIgnored) raw *= 0.5;
  return { damage: roundUp5(raw), mult, immune: false, absorbed: false };
}

/** Graze is suppressed by Compound Eyes, Drizzle (Hurricane), Snow Warning (Blizzard) and the move's own terrain clause. */
export function grazeApplies(s: GameState, ac: AttackCtx): boolean {
  const g = ac.move?.fx.graze;
  if (!g) return false;
  if (neverMisses(s, ac.attacker, ac.attackerPos)) return false;
  if (ac.moveName === 'Hurricane' && withAbility(s, 'drizzle').length > 0) return false;
  if (ac.moveName === 'Blizzard' && withAbility(s, 'snowWarning').length > 0) return false;
  if (g.negateNear === 'water' && (terrainAt(s, ac.attackerPos) === 'water' || adjacentToType(s, ac.attacker, 'Water', ac.attackerPos))) return false;
  if (g.negateNear === 'ice' && (terrainAt(s, ac.attackerPos) === 'ice' || adjacentToType(s, ac.attacker, 'Ice', ac.attackerPos))) return false;
  return true;
}

/** Compound Eyes (the user or an adjacent ally of its holder) and Mitsuhide's special: no misses or grazes. */
export function neverMisses(s: GameState, u: Unit, at?: Pos): boolean {
  if (turnEffect(s, u.side) === 'sureHit') return true;
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
