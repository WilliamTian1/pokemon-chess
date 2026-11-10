import {
  basePower, computeDamage, grazeApplies, isImmune, makeAttackCtx, neverMisses, secondaryMult, trebuchetCtx, typeEffectLabel,
} from './damage';
import { DRAFTABLE, getCard } from './data/cards';
import {
  abilityOf, adjacentToType, alliesOf, canPlaceOn, canStand, gridTile, hasType, inBounds, liveUnits, moveOf,
  onBoard, parseGrid, substituteAt, terrainAt, terrainBonus, trainerOf, turnEffect, unitAt, withAbility, zoneTiles,
} from './query';
import {
  type Ctx, RuleError, applySelfStages, applyStage, applyStatus, dealDamage, emit, enterTile, faint, heal, log,
  nameOf, resetStages, transform, triggerLeech,
} from './mutate';
import type { Dir, GameState, MoveDef, PType, Pos, StatId, StatusId, Unit } from './types';
import { DIRS, otherSide } from './types';
import { DIR_VEC, addPos, cheb, posKey, steps } from './util';

export interface Targeting {
  ok: boolean;
  reason?: string;
  zone: Pos[];
  dashTo: Pos | null;
  targets: Unit[];
  substitute: boolean;
  placeAt?: Pos;
}

const fail = (reason: string): Targeting => ({ ok: false, reason, zone: [], dashTo: null, targets: [], substitute: false });

export interface TargetOpts {
  dir?: Dir;
  targetId?: string;
  /** Hypothetical position of the user (AI / Follow Me checks). */
  origin?: Pos;
  /** Metronome: the drawn move may be fired where it hits nothing. */
  allowEmpty?: boolean;
}

/** Moves that help one ally in the zone (and do nothing to opponents). */
const ALLY_ONLY = (m: MoveDef): boolean => m.fx.alliesStages !== undefined || m.fx.special === 'helpingHand' || m.fx.special === 'afterYou';

/** Moves that only help (stat boosts for allies, healing) never count as "targeting" an opponent. */
export const isSupportOnly = (m: MoveDef): boolean =>
  ALLY_ONLY(m) || m.fx.healSelfAndAllies !== undefined || (m.kind === 'status' && m.fx.heal !== undefined);

/** Moves that restore HP (Triage lets its holder walk farther before one). */
export const isHealingMove = (m: MoveDef): boolean =>
  m.fx.heal !== undefined || m.fx.healSelfAndAllies !== undefined || m.fx.selfHeal !== undefined || m.fx.allyHeal !== undefined;

/** Resolves where a move would land and validates the "must target at least one Pokémon" rule. */
export function targeting(s: GameState, u: Unit, move: MoveDef, opts: TargetOpts): Targeting {
  const origin = opts.origin ?? u.pos;
  if (!origin) return fail('Not on the board');
  const t = move.target;
  switch (t.kind) {
    case 'self':
    case 'global':
      return { ok: true, zone: [], dashTo: null, targets: [], substitute: false };
    case 'range': {
      const tgt = opts.targetId ? s.units.find((x) => x.id === opts.targetId) : undefined;
      if (!tgt || !onBoard(tgt) || tgt.id === u.id) return fail('Choose a Pokémon to hit');
      const d = steps(origin, tgt.pos);
      if (d > t.range || d < (t.min ?? 0)) return fail(t.min ? `Target must be ${t.min}–${t.range} tiles away` : `Target must be within ${t.range} tiles`);
      return { ok: true, zone: [tgt.pos], dashTo: null, targets: [tgt], substitute: false };
    }
    case 'ally': {
      const tgt = opts.targetId ? s.units.find((x) => x.id === opts.targetId) : undefined;
      if (!tgt || !onBoard(tgt) || tgt.side !== u.side || tgt.id === u.id) return fail('Choose an ally to switch with');
      if (t.range !== undefined && steps(origin, tgt.pos) > t.range) return fail(`The ally must be within ${t.range} tiles`);
      if (!canStand(u, terrainAt(s, tgt.pos)) || !canStand(tgt, terrainAt(s, origin))) return fail('Neither can stand on the other’s tile');
      return { ok: true, zone: [tgt.pos], dashTo: null, targets: [tgt], substitute: false };
    }
    case 'place': {
      if (!opts.dir) return fail('Choose a direction');
      const g = parseGrid(t.grid);
      const p = gridTile(origin, g.targets[0], opts.dir);
      if (!inBounds(s, p)) return fail('Off the board');
      if (t.place === 'substitute') {
        if (s.substitute) return fail('A substitute already exists');
        if (u.hp <= 30) return fail('Needs more than 30 HP');
      }
      if (t.place === 'spikes' && s.hazards.filter((h) => h.kind === 'spikes').length >= 5) return fail('5 spikes are already on the field');
      const occ = unitAt(s, p);
      if (occ && occ.id !== u.id) return fail('A Pokémon is in the way');
      if (!canPlaceOn(s, p) && !(occ && occ.id === u.id)) return fail('That tile is blocked');
      return { ok: true, zone: [p], dashTo: null, targets: [], substitute: false, placeAt: p };
    }
    case 'grid': {
      if (!opts.dir) return fail('Choose a direction');
      const g = parseGrid(t.grid);
      let dashTo: Pos | null = null;
      if (g.dash) {
        const p = gridTile(origin, g.dash, opts.dir);
        const occ = inBounds(s, p) ? unitAt(s, p) : undefined;
        if (!inBounds(s, p) || !canStand(u, terrainAt(s, p)) || (occ && occ.id !== u.id) || substituteAt(s, p)) {
          return fail('The charge path is blocked');
        }
        dashTo = p;
      }
      const zone = zoneTiles(s, origin, g, opts.dir);
      const targets = zone.map((p) => unitAt(s, p)).filter((x): x is Unit => !!x && x.id !== u.id);
      const substitute = zone.some((p) => substituteAt(s, p));
      if (move.fx.healSelfAndAllies !== undefined || opts.allowEmpty) return { ok: true, zone, dashTo, targets, substitute };
      if (ALLY_ONLY(move)) {
        if (move.fx.special === 'afterYou') {
          if (!targets.some((x) => x.side === u.side && !x.gotAfterYou)) return fail('No ally in range can act again');
        } else if (!targets.some((x) => x.side === u.side)) {
          return fail('No allies in range');
        }
        return { ok: true, zone, dashTo, targets, substitute };
      }
      // A move must hit at least one Pokémon (ally or opponent) or the substitute.
      if (targets.length === 0 && !substitute) return { ...fail('No Pokémon in range'), zone, dashTo };
      return { ok: true, zone, dashTo, targets, substitute };
    }
  }
}

// ---------------------------------------------------------------- Follow Me

/** Opposing Follow Me / Rage Powder users currently forcing `u`. */
export function followMeUsers(s: GameState, u: Unit): Unit[] {
  return liveUnits(s).filter(
    (f) => f.side !== u.side && f.followMe && f.followMe.duringTurnOf === u.side &&
      !(f.followMe.kind === 'ragePowder' && hasType(u, 'Grass')),
  );
}

/**
 * Why `move` can't be used by `u` this turn whatever the aim (an empty slot, Gigaton Hammer in an odd
 * round, a move on cooldown), or null.
 */
export function moveOffline(s: GameState, u: Unit, move: MoveDef): string | null {
  if (move.fx.none) return 'No second move';
  if (move.fx.evenRoundsOnly && s.round % 2 !== 0) return 'Only on even-numbered rounds';
  if (move.kind === 'attack' && truantRests(s, u)) return 'Truant: attacks only on odd-numbered rounds';
  if (u.locked.includes(move.name)) return 'Cooldown: end a turn 4+ tiles from every opponent';
  return null;
}

/** Truant: its holder can't attack (moves or the trebuchet) in even-numbered rounds. */
export const truantRests = (s: GameState, u: Unit, round = s.round): boolean => abilityOf(u) === 'truant' && round % 2 === 0;

/** Whether `u`, standing at `origin`, has a move that would include `target`. */
export function canTargetFrom(s: GameState, u: Unit, origin: Pos, target: Unit): boolean {
  if (!target.pos) return false;
  for (const idx of [0, 1] as const) {
    const m = moveOf(u, idx);
    if (isSupportOnly(m) || moveOffline(s, u, m)) continue;
    if (m.target.kind === 'range') {
      const d = steps(origin, target.pos);
      if (d <= m.target.range && d >= (m.target.min ?? 0)) return true;
    } else if (m.target.kind === 'grid') {
      for (const d of DIRS) {
        const tg = targeting(s, u, m, { dir: d, origin });
        if (tg.ok && tg.targets.some((x) => x.id === target.id)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- execution

export interface ExecOpts extends TargetOpts {
  moveType?: PType;
  /** How the move was borrowed (Liquid Voice, Transform, Metronome, Dancer), for the log. */
  copied?: string;
  /** A copy made by Liquid Voice or Dancer doesn't set off Liquid Voice or Dancer again. */
  noEcho?: boolean;
  moveIndex?: 0 | 1;
}

export interface ExecResult {
  hits: number;
  kos: number;
}

export function executeMove(ctx: Ctx, u: Unit, move: MoveDef, opts: ExecOpts): ExecResult {
  const s = ctx.s;
  const tg = targeting(s, u, move, opts);
  if (!tg.ok) throw new RuleError(tg.reason ?? 'Invalid target');
  const moveType = opts.moveType ?? move.type;
  log(ctx, `${nameOf(u)} used ${move.name}${opts.copied ? ` (${opts.copied})` : ''}!`, 'info', u.side);
  emit(ctx, { t: 'attack', unitId: u.id, name: move.name, tiles: tg.zone });
  const res: ExecResult = { hits: 0, kos: 0 };

  switch (move.target.kind) {
    case 'self':
      selfMove(ctx, u, move);
      break;
    case 'global':
      globalMove(ctx, u, move);
      break;
    case 'ally': {
      const other = tg.targets[0];
      const a = u.pos!;
      const b = other.pos!;
      u.pos = null;
      enterTile(ctx, other, a);
      if (!u.fainted) enterTile(ctx, u, b);
      emit(ctx, { t: 'move', unitId: u.id, path: [b] });
      emit(ctx, { t: 'move', unitId: other.id, path: [a] });
      log(ctx, `${nameOf(u)} switched places with ${nameOf(other)}.`, 'info', u.side);
      if (move.fx.special === 'batonPass') {
        [u.stages, other.stages] = [other.stages, u.stages];
        log(ctx, `${nameOf(u)} and ${nameOf(other)} swapped their stat changes.`, 'info', u.side);
      }
      break;
    }
    case 'place': {
      const p = tg.placeAt!;
      const kind = move.target.place;
      if (kind === 'substitute') {
        u.hp -= 30;
        emit(ctx, { t: 'damage', unitId: u.id, amount: 30 });
        s.substitute = { pos: p, ownerId: u.id };
        log(ctx, `${nameOf(u)} paid 30 HP to put up a substitute.`, 'info', u.side);
      } else {
        s.hazards.push({ kind, pos: p });
        log(ctx, `${nameOf(u)} laid ${kind === 'spikes' ? 'spikes' : 'a sticky web'}.`, 'info', u.side);
      }
      break;
    }
    case 'range':
    case 'grid':
      zoneMove(ctx, u, move, moveType, tg, opts, res);
      break;
  }

  if (!opts.noEcho) {
    const src = opts.moveIndex !== undefined ? { cardId: u.cardId, moveIndex: opts.moveIndex } : findSource(move);
    if (src) {
      queueLiquidVoice(ctx, u, move, src);
      queueDancer(ctx, u, move, src);
    }
  }
  return res;
}

/** The printed card and slot of a move, for copies of copies (Transform, Metronome). */
function findSource(move: MoveDef): { cardId: string; moveIndex: 0 | 1 } | null {
  for (const c of DRAFTABLE) {
    const i = c.moves.findIndex((m) => m.name === move.name && m.text === move.text);
    if (i >= 0) return { cardId: c.id, moveIndex: i as 0 | 1 };
  }
  return null;
}

function selfMove(ctx: Ctx, u: Unit, move: MoveDef): void {
  const fx = move.fx;
  if (fx.selfStages) applySelfStages(ctx, u, fx.selfStages.stages);
  if (fx.selfHeal) heal(ctx, u, fx.selfHeal, move.name);
  if (fx.special === 'followMe' || fx.special === 'ragePowder') {
    u.followMe = { kind: fx.special, duringTurnOf: otherSide(u.side) };
    log(ctx, `${nameOf(u)} became the centre of attention!`, 'info', u.side);
  }
  if (fx.special === 'futureSight') {
    ctx.s.futureSight.push({ userId: u.id, side: u.side });
    log(ctx, `${nameOf(u)} foresaw an attack! It lands at the start of its next turn.`, 'info', u.side);
  }
  if (fx.special === 'metronome') queueMetronome(ctx, u);
  if (fx.special === 'wideGuard') {
    u.wideGuard = otherSide(u.side);
    emit(ctx, { t: 'field', kind: 'guard', side: u.side });
    log(ctx, `${nameOf(u)} put up a Wide Guard: next turn, attacks that hit it and other Pokémon fail.`, 'info', u.side);
  }
}

function stageAll(ctx: Ctx, target: Unit, stages: Partial<Record<StatId, number>>, source: Unit, ignoreAbilities = false): void {
  for (const k of ['atk', 'def', 'mov'] as const) {
    const d = stages[k];
    if (d) applyStage(ctx, target, k, d, { source, ignoreAbilities });
  }
}

/** Mitsuhide's passive: weather moves and abilities never hurt its side. */
export const weatherProof = (s: GameState, x: Unit): boolean => trainerOf(s, x.side) === 'mitsuhide';

function globalMove(ctx: Ctx, u: Unit, move: MoveDef): void {
  const s = ctx.s;
  const all = liveUnits(s);
  const hurt = all.filter((x) => !weatherProof(s, x));
  const FIELD = {
    sunnyDay: 'sun', rainDance: 'rain', sandstorm: 'sand', hail: 'hail', lightScreen: 'screen', tailwind: 'wind', auroraVeil: 'veil', taunt: 'taunt',
    flowerShield: 'flowers',
  } as const;
  // Weather, Light Screen and Tailwind move a stat one stage, but never past +1 (or, lowering, past -1);
  // Aurora Veil caps at +2.
  const capped = (x: Unit, stat: StatId, delta: 1 | -1, label: string, cap = 1): void => {
    if (delta > 0 ? x.stages[stat] < cap : x.stages[stat] > -cap) applyStage(ctx, x, stat, delta, { source: u, label });
  };
  const kind = move.fx.special && move.fx.special in FIELD ? FIELD[move.fx.special as keyof typeof FIELD] : null;
  if (kind) emit(ctx, { t: 'field', kind, side: u.side });
  switch (move.fx.special) {
    case 'sunnyDay':
      for (const x of all) {
        if (hasType(x, 'Fire')) capped(x, 'atk', 1, 'Sunny Day');
        if (hasType(x, 'Water') && hurt.includes(x)) capped(x, 'atk', -1, 'Sunny Day');
      }
      for (const c of withAbility(s, 'flowerGiftOvercast')) {
        transform(ctx, c, 'cherrim-sunshine', false);
        log(ctx, `${nameOf(c)} basked in the sunshine and transformed!`, 'good', c.side);
      }
      break;
    case 'rainDance':
      for (const x of all) {
        if (hasType(x, 'Water')) capped(x, 'atk', 1, 'Rain Dance');
        if (hasType(x, 'Fire') && hurt.includes(x)) capped(x, 'atk', -1, 'Rain Dance');
      }
      break;
    case 'sandstorm':
      for (const x of all) {
        if (hasType(x, 'Rock')) capped(x, 'def', 1, 'Sandstorm');
        if (!hasType(x, 'Rock') && !hasType(x, 'Ground') && !hasType(x, 'Steel') && hurt.includes(x)) dealDamage(ctx, x, 20, { source: u, label: 'Sandstorm' });
      }
      break;
    case 'hail':
      for (const x of all) {
        if (hasType(x, 'Ice')) capped(x, 'def', 1, 'Hail');
        else if (hurt.includes(x)) dealDamage(ctx, x, 20, { source: u, label: 'Hail' });
      }
      break;
    case 'flowerShield':
      for (const x of all) if (hasType(x, 'Grass')) applyStage(ctx, x, 'def', 1, { source: u, label: 'Flower Shield' });
      break;
    case 'lightScreen':
      // +1 Defense for the whole team, but never above +1.
      for (const x of liveUnits(s, u.side)) capped(x, 'def', 1, 'Light Screen');
      break;
    case 'auroraVeil':
      // +1 Defense for the user and all its allies, up to +2.
      for (const x of liveUnits(s, u.side)) capped(x, 'def', 1, 'Aurora Veil', 2);
      break;
    case 'tailwind':
      // +1 movement for the user and all its allies, but never above +1.
      for (const x of liveUnits(s, u.side)) capped(x, 'mov', 1, 'Tailwind');
      break;
    case 'taunt':
      s.taunted = otherSide(u.side);
      log(ctx, `${nameOf(u)} taunted the opposing team! Next turn they must attack if they can.`, 'info', u.side);
      break;
  }
}

function zoneMove(ctx: Ctx, u: Unit, move: MoveDef, moveType: PType | null, tg: Targeting, opts: ExecOpts, res: ExecResult): void {
  const s = ctx.s;
  const fx = move.fx;
  const rng = ctx.rng;

  if (fx.preSelfStages) applySelfStages(ctx, u, fx.preSelfStages);
  if (tg.dashTo) {
    enterTile(ctx, u, tg.dashTo);
    emit(ctx, { t: 'move', unitId: u.id, path: [tg.dashTo] });
    if (u.fainted) return;
  }
  const attackerPos = u.pos!;
  const hits: Unit[] = [];
  const finish = (): void => afterEffects(ctx, u, move, hits, res);

  // A substitute in the zone soaks up the whole attack; support moves pass it by.
  if (tg.substitute && !isSupportOnly(move) && !fx.heal) {
    s.substitute = null;
    log(ctx, 'The substitute took the hit and broke! No other Pokémon was hit.', 'info');
    finish();
    return;
  }
  if (fx.missAll && !neverMisses(s, u) && rng.chance(fx.missAll.chance)) {
    log(ctx, `${nameOf(u)}'s ${move.name} missed everything!`, 'bad', u.side);
    emit(ctx, { t: 'miss', unitId: u.id });
    dealDamage(ctx, u, fx.missAll.selfDamage, { label: 'crash' });
    finish();
    return;
  }

  const guard = move.kind === 'attack' && tg.targets.length >= 2 ? tg.targets.find((t) => t.wideGuard === u.side && !t.fainted) : undefined;
  if (guard) {
    log(ctx, `${nameOf(guard)}'s Wide Guard blocked ${nameOf(u)}'s ${move.name}!`, 'info', guard.side);
    for (const t of tg.targets) emit(ctx, { t: 'miss', unitId: t.id });
    finish();
    return;
  }

  const ac = makeAttackCtx(u, move, { moveType: moveType ?? 'Normal', attackerPos, targetCount: tg.targets.length, s });
  if (ac.pixilated) log(ctx, `Pixilate turned ${move.name} Fairy type!`, 'info', u.side);
  const dice = fx.dice ? rng.d6() : null;
  if (dice !== null) log(ctx, `${nameOf(u)} rolled a ${dice}! (+${dice * 10} power)`, 'info', u.side);
  const sm = secondaryMult(s, u);
  const chance = (p: number): boolean => rng.chance(Math.min(1, p * sm));

  // Decoy: Wobbuffet is hit first. If it survives, nobody else in the zone takes damage and the
  // attacker takes the same damage in return.
  const isDecoy = (x: Unit): boolean => move.kind === 'attack' && !ac.ignoreAbilities && abilityOf(x) === 'decoy';
  const targets = [...tg.targets].sort((a, b) => Number(isDecoy(b)) - Number(isDecoy(a)));
  let decoyed = false;
  let returned = 0;
  for (const t of targets) {
    if (t.fainted || !t.pos) continue;
    if (move.kind === 'attack') {
      if (fx.allyHeal !== undefined && t.side === u.side) {
        heal(ctx, t, fx.allyHeal, move.name);
        continue;
      }
      const imm = isImmune(ac, t);
      if (imm.absorbed) {
        log(ctx, `${nameOf(t)}'s Storm Drain absorbed the attack!`, 'info', t.side);
        applyStage(ctx, t, 'atk', 1, { source: t, label: 'Storm Drain' });
        immuneHeal(ctx, t);
        continue;
      }
      if (imm.immune) {
        log(ctx, imm.wonderGuard ? `${nameOf(t)}'s Wonder Guard blocked the attack!` : `It doesn't affect ${nameOf(t)}…`, 'info', t.side);
        immuneHeal(ctx, t);
        continue;
      }
      if (fx.missChance && !neverMisses(s, u) && rng.chance(fx.missChance)) {
        log(ctx, `${nameOf(u)}'s attack missed ${nameOf(t)}!`, 'info', u.side);
        emit(ctx, { t: 'miss', unitId: t.id });
        continue;
      }
      const hpBefore = t.hp;
      const posBefore = t.pos;
      if (fx.special === 'endeavor') {
        if (u.hp < t.hp) dealDamage(ctx, t, t.hp - u.hp, { source: u, attack: true, ignoreAbilities: true, label: 'Endeavor' });
        else log(ctx, `${move.name} had no effect on ${nameOf(t)}.`, 'info', t.side);
        hits.push(t);
      } else {
        const grazed = grazeApplies(s, ac) && rng.chance(fx.graze!.chance);
        const bonus = fx.bonus?.find((b) => b.when === 'chance');
        const chanceBonus = !!bonus && bonus.when === 'chance' && chance(bonus.chance);
        const base = basePower(s, ac, t, dice, chanceBonus);
        const dmg = computeDamage(s, ac, t, base, grazed ? fx.graze!.power : null);
        if (grazed) log(ctx, `The attack only grazed ${nameOf(t)}.`, 'info', t.side);
        if (chanceBonus) log(ctx, `A critical blow! (+${bonus!.amount} power)`, 'good', u.side);
        const eff = typeEffectLabel(dmg.mult);
        if (decoyed) log(ctx, `${nameOf(t)} was hit but took no damage (Decoy).`, 'info', t.side);
        const dealt = decoyed ? 0 : dealDamage(ctx, t, dmg.damage, { source: u, attack: true, ignoreAbilities: ac.ignoreAbilities, label: eff ?? undefined });
        hits.push(t);
        triggerLeech(ctx, u, posBefore, t.id, dealt);
        if (!ac.ignoreAbilities) reactiveAbilities(ctx, u, t, attackerPos, posBefore, ac.moveType, dealt > 0);
        if (!t.fainted) secondary(ctx, u, t, move, grazed, chance, ac.ignoreAbilities);
        if (isDecoy(t) && !decoyed && !t.fainted && dealt > 0) {
          decoyed = true;
          returned = dealt;
        }
      }
      if (t.fainted) {
        res.kos += 1;
      } else if (abilityOf(t) === 'emergencyExit' && hpBefore >= 100 && t.hp < 100) {
        queueEmergencyExit(ctx, t);
      }
    } else {
      if (moveType === 'Water' && abilityOf(t) === 'stormDrain') {
        log(ctx, `${nameOf(t)}'s Storm Drain absorbed the move!`, 'info', t.side);
        applyStage(ctx, t, 'atk', 1, { source: t, label: 'Storm Drain' });
        continue;
      }
      if (ALLY_ONLY(move) || fx.healSelfAndAllies !== undefined) {
        if (t.side !== u.side) continue;
      } else if (fx.hitChance !== undefined && !neverMisses(s, u) && !rng.chance(fx.hitChance)) {
        log(ctx, `${move.name} missed ${nameOf(t)}!`, 'info', t.side);
        emit(ctx, { t: 'miss', unitId: t.id });
        continue;
      }
      statusEffects(ctx, u, t, move);
      hits.push(t);
    }
  }
  if (fx.healSelfAndAllies !== undefined) heal(ctx, u, fx.healSelfAndAllies, move.name);
  if (returned > 0 && !u.fainted) dealDamage(ctx, u, returned, { label: 'Decoy' });
  if (fx.clearHazards) {
    const zone = new Set(tg.zone.map(posKey));
    const before = s.hazards.length;
    s.hazards = s.hazards.filter((h) => !zone.has(posKey(h.pos)));
    if (s.hazards.length < before) log(ctx, `${nameOf(u)} cleared away ${before - s.hazards.length} hazard${before - s.hazards.length > 1 ? 's' : ''}.`, 'info', u.side);
  }

  // Knockback, farthest target first so pushed Pokémon don't collide with each other.
  const printed = move.target.kind === 'grid' ? parseGrid(move.target.grid).knockback : 0;
  const k = pushDistance(s, u, move, printed);
  if (k > 0) {
    const far = [...hits].sort((a, b) => cheb(b.pos ?? attackerPos, attackerPos) - cheb(a.pos ?? attackerPos, attackerPos));
    for (const t of far) if (!t.fainted && t.pos) knockback(ctx, t, opts.dir ?? awayFrom(attackerPos, t.pos), k, turnEffect(s, u.side) === 'push2');
  }
  finish();
}

/** Blue's passive turns a one-tile push into two; Lance's special makes every attack push two. */
export function pushDistance(s: GameState, u: Unit, move: MoveDef | null, printed: number): number {
  if ((!move || move.kind === 'attack') && turnEffect(s, u.side) === 'push2') return 2;
  if (printed === 1 && trainerOf(s, u.side) === 'blue') return 2;
  return printed;
}

/** The direction straight away from `from` (vertical on a tie), for pushes by ranged attacks. */
function awayFrom(from: Pos, to: Pos): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

/** Nobunaga's passive: its side's Pokémon heal 30 when an attack they're immune to targets them. */
function immuneHeal(ctx: Ctx, t: Unit): void {
  if (trainerOf(ctx.s, t.side) === 'nobunaga') heal(ctx, t, 30, 'Nobunaga');
}

function reactiveAbilities(ctx: Ctx, u: Unit, t: Unit, attackerPos: Pos, targetPos: Pos, moveType: PType | null, hit: boolean): void {
  const ab = abilityOf(t);
  if (ab === 'unburden' && hit && !t.fainted) applyStage(ctx, t, 'mov', 1, { source: t, label: 'Unburden' });
  const upClose = cheb(attackerPos, targetPos) <= 1;
  if (ab === 'static' && upClose && !u.fainted && ctx.rng.chance(0.3)) {
    log(ctx, `${nameOf(t)}'s Static zapped ${nameOf(u)}!`, 'info', t.side);
    applyStatus(ctx, u, 'par', { source: t });
  }
  if (ab === 'ironBarbs' && upClose && !u.fainted) dealDamage(ctx, u, 30, { label: 'Iron Barbs' });
  if (ab === 'justified' && moveType === 'Dark' && !t.fainted) applyStage(ctx, t, 'atk', 1, { source: u, label: 'Justified' });
}

function secondary(ctx: Ctx, u: Unit, t: Unit, move: MoveDef, grazed: boolean, chance: (p: number) => boolean, ignoreAbilities: boolean): void {
  const fx = move.fx;
  const ok = (c?: { noGraze?: boolean }): boolean => !(c?.noGraze && grazed);
  if (fx.status && ok(fx.status) && chance(fx.status.chance)) {
    applyStatus(ctx, t, fx.status.id, { source: u, ignoreAbilities, quiet: fx.status.chance < 1 });
  }
  if (fx.triStatus && chance(fx.triStatus)) {
    const st: StatusId = (['brn', 'par', 'frz'] as const)[ctx.rng.int(3)];
    applyStatus(ctx, t, st, { source: u, ignoreAbilities, quiet: true });
  }
  if (fx.confuse && ok(fx.confuse) && chance(fx.confuse.chance)) {
    t.confused = true;
    emit(ctx, { t: 'status', unitId: t.id, status: 'confused' });
    log(ctx, `${nameOf(t)} became confused!`, 'bad', t.side);
  }
  if (fx.flinch && ok(fx.flinch) && chance(fx.flinch.chance)) {
    t.flinched = true;
    emit(ctx, { t: 'status', unitId: t.id, status: 'flinched' });
    log(ctx, `${nameOf(t)} flinched! It will lose its next activation.`, 'bad', t.side);
  }
  if (fx.targetStages && chance(fx.targetStages.chance)) stageAll(ctx, t, fx.targetStages.stages, u, ignoreAbilities);
  if (fx.removeDefBoosts && t.stages.def > 0) {
    t.stages.def = 0;
    log(ctx, `${nameOf(t)}'s Defense boosts were removed.`, 'bad', t.side);
  }
  if (fx.resetTargetStages) resetStages(ctx, t);
}

function statusEffects(ctx: Ctx, u: Unit, t: Unit, move: MoveDef): void {
  const fx = move.fx;
  if (fx.status) applyStatus(ctx, t, fx.status.id, { source: u, grassImmune: fx.grassImmune });
  if (fx.targetStages) stageAll(ctx, t, fx.targetStages.stages, u);
  if (fx.resetTargetStages) resetStages(ctx, t);
  if (fx.invertTargetStages) {
    t.stages = { atk: -t.stages.atk, def: -t.stages.def, mov: -t.stages.mov };
    log(ctx, `${nameOf(t)}'s stat changes were turned upside down!`, 'info', t.side);
  }
  if (fx.heal) heal(ctx, t, fx.healOnBonusTerrain !== undefined && terrainBonus(ctx.s, t) ? fx.healOnBonusTerrain : fx.heal, move.name);
  if (fx.alliesStages) stageAll(ctx, t, fx.alliesStages, u);
  if (fx.healSelfAndAllies) heal(ctx, t, fx.healSelfAndAllies, move.name);
  if (fx.special === 'helpingHand') {
    t.dmgBonus += 30;
    log(ctx, `${nameOf(t)} deals 30 extra damage for the rest of this turn (Helping Hand).`, 'good', t.side);
  }
  if (fx.special === 'afterYou') grantAfterYou(ctx, t);
  if (fx.special === 'psycheUp') {
    u.stages = { ...t.stages };
    log(ctx, `${nameOf(u)} copied ${nameOf(t)}'s stat changes (Psyche Up).`, 'info', u.side);
  }
}

/**
 * After You: the ally can act again this turn — another activation, moving and then acting. An ally
 * that is already done is ready again at once; one that hasn't gone yet gets two activations. Each
 * Pokémon can be given this once per turn.
 */
function grantAfterYou(ctx: Ctx, t: Unit): void {
  if (t.gotAfterYou) {
    log(ctx, `${nameOf(t)} already got to act again this turn.`, 'info', t.side);
    return;
  }
  t.gotAfterYou = true;
  if (t.activated) {
    t.activated = false;
    log(ctx, `${nameOf(t)} can act again (After You)!`, 'good', t.side);
  } else {
    t.actAgain += 1;
    log(ctx, `${nameOf(t)} will be able to act twice this turn (After You)!`, 'good', t.side);
  }
}

function knockback(ctx: Ctx, t: Unit, dir: Dir, k: number, collide = false): void {
  const s = ctx.s;
  const path: Pos[] = [];
  let crashed = false;
  for (let i = 0; i < k; i++) {
    const np = addPos(t.pos!, DIR_VEC[dir]);
    // Lance's special: hitting the edge of the board or ground the target can't enter hurts.
    if (!inBounds(s, np) || !canStand(t, terrainAt(s, np))) {
      crashed = collide;
      break;
    }
    if (unitAt(s, np) || substituteAt(s, np)) break;
    path.push(np);
    enterTile(ctx, t, np);
    if (t.fainted) break;
  }
  if (path.length) {
    emit(ctx, { t: 'move', unitId: t.id, path });
    log(ctx, `${nameOf(t)} was knocked back ${path.length} tile${path.length > 1 ? 's' : ''}.`, 'info', t.side);
  }
  if (crashed && !t.fainted) dealDamage(ctx, t, 60, { label: 'collision' });
}

function afterEffects(ctx: Ctx, u: Unit, move: MoveDef, hits: Unit[], res: ExecResult): void {
  const s = ctx.s;
  const fx = move.fx;
  const n = hits.length;
  res.hits = n;
  if (u.fainted) return;
  // N's passive: no recoil for its side.
  const recoil = trainerOf(s, u.side) === 'n' ? 0 : (n > 0 ? (fx.recoil ?? 0) + (fx.recoilPerTarget ?? 0) * n : 0);
  if (recoil > 0) dealDamage(ctx, u, recoil, { label: 'recoil' });
  if (u.fainted) return;
  if (fx.drain && n > 0) heal(ctx, u, fx.drain, move.name);
  if (fx.drainPerTarget && n > 0) heal(ctx, u, fx.drainPerTarget * n, move.name);
  if (fx.removeUserDefBoosts && u.stages.def > 0) {
    u.stages.def = 0;
    log(ctx, `${nameOf(u)} used up its stockpiled Defense.`, 'info', u.side);
  }
  if (fx.selfStages) {
    if (fx.selfStages.chance === undefined) applySelfStages(ctx, u, fx.selfStages.stages);
    else if (n > 0 && ctx.rng.chance(Math.min(1, fx.selfStages.chance * secondaryMult(s, u)))) applySelfStages(ctx, u, fx.selfStages.stages);
  }
  if (fx.selfSleepChance && ctx.rng.chance(fx.selfSleepChance)) {
    log(ctx, `${nameOf(u)} is exhausted from its rampage…`, 'bad', u.side);
    applyStatus(ctx, u, 'slp', { source: u });
  }
  if (fx.nextTurn) {
    const nt = fx.nextTurn;
    const skip = (nt.unlessAdjFire && adjacentToType(s, u, 'Fire')) || (nt.droughtSkips && withAbility(s, 'drought').length > 0);
    if (skip) {
      log(ctx, `${nameOf(u)} doesn't need to recharge.`, 'good', u.side);
    } else if (lanceCooldown(ctx, u)) {
      // Lance took the recharge as recoil instead.
    } else {
      if (nt.noMove) u.nextTurn.noMove = true;
      if (nt.noAct) u.nextTurn.noAct = true;
      log(ctx, `${nameOf(u)} must recharge: it can't ${nt.noAct ? 'move or act' : 'move'} next turn.`, 'info', u.side);
    }
  }
  if (fx.lockUntilFar && !u.fainted && !u.locked.includes(move.name) && !lanceCooldown(ctx, u)) {
    u.locked.push(move.name);
    log(ctx, `${move.name} is on cooldown until ${nameOf(u)} ends its turn ${fx.lockUntilFar}+ tiles from every opponent.`, 'info', u.side);
  }
  if (fx.selfFaint) {
    log(ctx, `${nameOf(u)} is spent from the blast.`, 'info', u.side);
    faint(ctx, u, null);
  }
}

/** Lance's passive: a cooldown becomes 40 recoil instead. True when it applied. */
function lanceCooldown(ctx: Ctx, u: Unit): boolean {
  if (trainerOf(ctx.s, u.side) !== 'lance') return false;
  log(ctx, `${nameOf(u)} skips the cooldown and takes 40 recoil instead (Lance).`, 'info', u.side);
  dealDamage(ctx, u, 40, { label: 'recoil' });
  return true;
}

function queueEmergencyExit(ctx: Ctx, t: Unit): void {
  const s = ctx.s;
  if (s.pending.some((p) => p.kind === 'emergencyExit' && p.unitId === t.id)) return;
  const options = emergencyExitOptions(s, t);
  if (options.length === 0) return;
  log(ctx, `${nameOf(t)}'s Emergency Exit activates!`, 'info', t.side);
  s.pending.push({ kind: 'emergencyExit', side: t.side, unitId: t.id, options });
}

export function emergencyExitOptions(s: GameState, t: Unit): string[] {
  if (!onBoard(t)) return [];
  return alliesOf(s, t)
    .filter((a) => canStand(a, terrainAt(s, t.pos)) && canStand(t, terrainAt(s, a.pos!)))
    .map((a) => a.id);
}

export const LIQUID_VOICE_RE = /voice|boom|roar|screech/i;

export function liquidVoiceCopy(move: MoveDef): MoveDef {
  return { ...move, type: 'Water' };
}

export function liquidVoiceOptions(s: GameState, p: Unit, move: MoveDef): Dir[] {
  if (!onBoard(p) || p.status === 'slp' || p.status === 'frz') return [];
  const copy = liquidVoiceCopy(move);
  return DIRS.filter((d) => targeting(s, p, copy, { dir: d }).ok);
}

function queueLiquidVoice(ctx: Ctx, u: Unit, move: MoveDef, source: { cardId: string; moveIndex: 0 | 1 }): void {
  if (!LIQUID_VOICE_RE.test(move.name)) return;
  const s = ctx.s;
  for (const p of withAbility(s, 'liquidVoice')) {
    if (p.id === u.id) continue;
    const options = liquidVoiceOptions(s, p, move);
    if (options.length === 0) continue;
    log(ctx, `${nameOf(p)}'s Liquid Voice can copy ${move.name}!`, 'info', p.side);
    s.pending.push({ kind: 'liquidVoice', side: p.side, unitId: p.id, source, options });
  }
}

export const DANCE_RE = /dance/i;

/** Directions Dancer can aim a copied dance move (self and field moves are copied on the spot). */
export function dancerOptions(s: GameState, d: Unit, move: MoveDef): Dir[] {
  if (!onBoard(d) || d.status === 'slp' || d.status === 'frz') return [];
  if (move.target.kind !== 'grid' && move.target.kind !== 'place') return [];
  return DIRS.filter((dir) => targeting(s, d, move, { dir }).ok);
}

/** Dancer: Oricorio copies any other Pokémon's dance move. */
function queueDancer(ctx: Ctx, u: Unit, move: MoveDef, source: { cardId: string; moveIndex: 0 | 1 }): void {
  if (!DANCE_RE.test(move.name)) return;
  const s = ctx.s;
  for (const d of withAbility(s, 'dancer')) {
    if (d.id === u.id || d.status === 'slp' || d.status === 'frz') continue;
    if (move.target.kind === 'self' || move.target.kind === 'global') {
      executeMove(ctx, d, move, { copied: 'Dancer', noEcho: true });
      continue;
    }
    const options = dancerOptions(s, d, move);
    if (!options.length) continue;
    log(ctx, `${nameOf(d)}'s Dancer copies ${move.name}!`, 'info', d.side);
    s.pending.push({ kind: 'dancer', side: d.side, unitId: d.id, source, options });
  }
}

/** Moves Transform and Metronome can't borrow. */
export const UNCOPYABLE = (m: MoveDef): boolean => !!m.fx.none || m.fx.special === 'transform' || m.fx.special === 'metronome';

/**
 * Ways `u` could use `move` right now: "dir", "@unitId", or "" for self and field moves. With
 * `allowEmpty`, zone moves may also be aimed where they hit nothing (those directions come last).
 */
export function aimOptions(s: GameState, u: Unit, move: MoveDef, allowEmpty = false): string[] {
  switch (move.target.kind) {
    case 'self':
    case 'global':
      return [''];
    case 'grid':
    case 'place': {
      const hits = DIRS.filter((d) => targeting(s, u, move, { dir: d }).ok);
      return allowEmpty ? [...hits, ...DIRS.filter((d) => !hits.includes(d) && targeting(s, u, move, { dir: d, allowEmpty }).ok)] : hits;
    }
    case 'range':
    case 'ally':
      return liveUnits(s).filter((x) => x.id !== u.id && targeting(s, u, move, { targetId: x.id }).ok).map((x) => `@${x.id}`);
  }
}

/** Splits an aim option back into targeting options. */
export function parseAim(aim: string): TargetOpts {
  if (!aim) return {};
  return aim.startsWith('@') ? { targetId: aim.slice(1) } : { dir: aim as Dir };
}

/**
 * Metronome's choices for the drawn card: "moveIndex:aim". One of them must be used, so zone moves
 * may be aimed at nothing (Explosion still takes its user with it); aims that hit something come first.
 */
export function metronomeOptions(s: GameState, u: Unit, cardId: string): string[] {
  const all = getCard(cardId).moves.flatMap((m, i) => (UNCOPYABLE(m) ? [] : aimOptions(s, u, m, true).map((a) => ({ o: `${i}:${a}`, hits: targeting(s, u, m, parseAim(a)).ok }))));
  return [...all.filter((x) => x.hits), ...all.filter((x) => !x.hits)].map((x) => x.o);
}

/** Metronome: draw a random card nobody drafted, then pick one of its moves and how to aim it. */
function queueMetronome(ctx: Ctx, u: Unit): void {
  const s = ctx.s;
  const used = new Set([...s.draft.picks.A, ...s.draft.picks.D]);
  const pool = DRAFTABLE.filter((c) => !used.has(c.id) && !c.moves.some(UNCOPYABLE));
  const c = pool[ctx.rng.int(pool.length)];
  log(ctx, `${nameOf(u)} waved its finger… and drew ${c.name}!`, 'info', u.side);
  const options = metronomeOptions(s, u, c.id);
  if (!options.length) {
    log(ctx, `…but neither of ${c.name}'s moves can be used from here.`, 'info', u.side);
    return;
  }
  s.pending.push({ kind: 'metronome', side: u.side, unitId: u.id, cardId: c.id, options });
}

/**
 * Trebuchet: a flat 40 at any single Pokémon anywhere, fired as whichever of the user's types does
 * the most damage to it, ignoring stat stages.
 */
export function trebuchetAttack(ctx: Ctx, u: Unit, t: Unit): ExecResult {
  const s = ctx.s;
  const ac = trebuchetCtx(s, u, t);
  log(ctx, `${nameOf(u)} fired the trebuchet at ${nameOf(t)}! (${ac.moveType})`, 'info', u.side);
  emit(ctx, { t: 'attack', unitId: u.id, name: 'Trebuchet', tiles: [t.pos!] });
  const imm = isImmune(ac, t);
  if (imm.absorbed) {
    log(ctx, `${nameOf(t)}'s Storm Drain absorbed the shot!`, 'info', t.side);
    applyStage(ctx, t, 'atk', 1, { source: t, label: 'Storm Drain' });
    immuneHeal(ctx, t);
    return { hits: 0, kos: 0 };
  }
  if (imm.immune) {
    log(ctx, imm.wonderGuard ? `${nameOf(t)}'s Wonder Guard blocked the shot!` : `It doesn't affect ${nameOf(t)}…`, 'info', t.side);
    immuneHeal(ctx, t);
    return { hits: 0, kos: 0 };
  }
  const hpBefore = t.hp;
  const posBefore = t.pos!;
  const dmg = computeDamage(s, ac, t, 40, null);
  const dealt = dealDamage(ctx, t, dmg.damage, { source: u, attack: true, ignoreAbilities: ac.ignoreAbilities, label: typeEffectLabel(dmg.mult) ?? undefined });
  triggerLeech(ctx, u, posBefore, t.id, dealt);
  if (!ac.ignoreAbilities) reactiveAbilities(ctx, u, t, u.pos!, posBefore, ac.moveType, dealt > 0);
  if (!ac.ignoreAbilities && abilityOf(t) === 'decoy' && !t.fainted && dealt > 0 && !u.fainted) dealDamage(ctx, u, dealt, { label: 'Decoy' });
  const k = pushDistance(s, u, null, 0);
  if (k > 0 && !t.fainted && t.pos && u.pos) knockback(ctx, t, awayFrom(u.pos, t.pos), k, true);
  if (!t.fainted && abilityOf(t) === 'emergencyExit' && hpBefore >= 100 && t.hp < 100) queueEmergencyExit(ctx, t);
  return { hits: 1, kos: t.fainted ? 1 : 0 };
}
