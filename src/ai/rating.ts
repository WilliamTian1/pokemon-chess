import { type AbilityId, type CardDef, type MoveDef, type PType, type Side, parseGrid, typeMultiplier } from '../engine';

/** Rough strength of a single attack: power × area, plus bonuses for reach and riders. */
export function moveValue(m: MoveDef): number {
  if (m.kind !== 'attack') return 0;
  let p = m.power ?? 60;
  if (m.fx.special === 'foulPlay') p = 70;
  if (m.fx.special === 'powerTrip') p = 40;
  if (m.fx.special === 'gyroBall') p = 70;
  if (m.fx.special === 'endeavor') p = 50;
  if (m.fx.dice) p += 35;
  if (m.fx.graze) p -= m.fx.graze.chance * (p - m.fx.graze.power);
  if (m.fx.missChance) p *= 1 - m.fx.missChance;
  for (const b of m.fx.bonus ?? []) {
    if (b.when === 'chance') p += b.chance * b.amount;
    else if (b.when === 'singleTarget' || b.when === 'normalTerrain') p += b.amount * 0.6;
    else if (b.when === 'targetStatus' || b.when === 'userStatus') p += b.amount * 0.3;
    else if (b.when === 'userDamageAtLeast') p += b.amount * 0.4;
  }
  let area = 1;
  let reach = 1;
  if (m.target.kind === 'grid') {
    const g = parseGrid(m.target.grid);
    area = g.targets.length;
    reach = Math.max(...g.targets.map((t) => Math.max(t.f, Math.abs(t.s))));
  } else if (m.target.kind === 'range') {
    reach = m.target.range;
  }
  let v = p * (1 + 0.08 * (area - 1)) * (1 + 0.06 * (reach - 1));
  if (m.fx.status) v += 35 * m.fx.status.chance;
  if (m.fx.targetStages) v += 12 * m.fx.targetStages.chance;
  if (m.fx.recoil) v -= m.fx.recoil * 0.4;
  if (m.fx.nextTurn) v *= m.fx.nextTurn.noAct ? 0.7 : 0.85;
  if (m.fx.selfFaint) v *= 0.6;
  return v;
}

function utilityValue(m: MoveDef): number {
  if (m.kind === 'attack') return 0;
  const fx = m.fx;
  if (fx.status?.id === 'slp') return 55;
  if (fx.status) return 40;
  if (fx.selfStages) return 30;
  if (fx.heal || fx.healSelfAndAllies || fx.selfHeal) return 30;
  if (fx.special === 'followMe' || fx.special === 'ragePowder') return 25;
  if (fx.special === 'futureSight') return 35;
  if (fx.targetStages) return 25;
  if (fx.alliesStages || fx.special === 'tailwind') return 22;
  if (fx.special === 'sandstorm' || fx.special === 'hail') return 20;
  return 15;
}

const ABILITY_BONUS: Partial<Record<AbilityId, number>> = {
  intimidate: 25, multiscale: 20, shadowShield: 20, sturdy: 20, technician: 20, regenerator: 20, levitate: 15,
  drizzle: 15, drought: 15, compoundEyes: 15, unaware: 15, resistance: 25, thickFat: 15, hardArmor: 15,
  iceScales: 15, ironBarbs: 15, shieldsDownMeteor: 35, airLock: 15, infiltrator: 10, guts: 10, moxie: 15,
  runAway: 10, leech: 15, darkAura: 10, teravolt: 10, turboblaze: 10, pressure: 5, hospitality: 15, rainDish: 15,
  sereneGrace: 10, celebrate: 10, poisonHeal: 10, emergencyExit: 5, truant: -40, defeatist: -15,
};

export interface Rating {
  offense: number;
  bulk: number;
  mobility: number;
  utility: number;
  ability: number;
  total: number;
}

export function rateCard(c: CardDef, role?: Side): Rating {
  const vals = c.moves.map(moveValue).sort((a, b) => b - a);
  const offense = vals[0] + 0.35 * vals[1];
  const bulk = c.hp;
  const flier = c.types.includes('Flying') || c.ability === 'levitate';
  const mobility = c.mov * 22 + (flier ? 18 : 0) + (c.ability === 'shadowDash' ? 20 : 0);
  const utility = Math.max(...c.moves.map(utilityValue));
  const ability = ABILITY_BONUS[c.ability] ?? 0;
  const oW = role === 'A' ? 1.2 : role === 'D' ? 0.95 : 1;
  const bW = role === 'D' ? 0.75 : 0.55;
  const mW = role === 'A' ? 1.15 : 0.9;
  const total = offense * oW + bulk * bW + mobility * mW + utility + ability;
  return { offense, bulk, mobility, utility, ability, total };
}

/** How well `a`'s attacks hit `b` minus how well `b` hits `a` (type matchups only). */
export function matchup(a: CardDef, b: CardDef): number {
  const best = (x: CardDef, y: CardDef): number =>
    Math.max(0.25, ...x.moves.filter((m) => m.kind === 'attack' && m.type).map((m) => typeMultiplier(m.type as PType, y.types)));
  return Math.log2(best(a, b)) - Math.log2(best(b, a));
}
