import {
  basePower, computeDamage, grazeApplies, isImmune, makeAttackCtx, neverMisses, secondaryMult, trebuchetCtx, typeEffectLabel,
} from './damage';
import {
  abilityOf, adjacentToType, alliesOf, canPlaceOn, canStand, gridTile, hasType, inBounds,
  liveUnits, moveOf, onBoard, parseGrid, substituteAt, terrainAt, unitAt, withAbility, zoneTiles,
} from './query';
import {
  type Ctx, RuleError, applySelfStages, applyStage, applyStatus, dealDamage, emit, enterTile, faint, heal, log,
  nameOf, resetStages, transform, triggerLeech,
} from './mutate';
import type { Dir, GameState, MoveDef, PType, Pos, StatId, StatusId, Unit } from './types';
import { DIRS, otherSide } from './types';
import { DIR_VEC, addPos, cheb, steps } from './util';

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
}

/** Moves that only help (stat boosts for allies, healing) never count as "targeting" an opponent. */
export const isSupportOnly = (m: MoveDef): boolean =>
  m.fx.alliesStages !== undefined || m.fx.healSelfAndAllies !== undefined || (m.kind === 'status' && m.fx.heal !== undefined);

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
      if (steps(origin, tgt.pos) > t.range) return fail(`Target must be within ${t.range} tiles`);
      return { ok: true, zone: [tgt.pos], dashTo: null, targets: [tgt], substitute: false };
    }
    case 'ally': {
      const tgt = opts.targetId ? s.units.find((x) => x.id === opts.targetId) : undefined;
      if (!tgt || !onBoard(tgt) || tgt.side !== u.side || tgt.id === u.id) return fail('Choose an ally to switch with');
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
      if (move.fx.healSelfAndAllies !== undefined) return { ok: true, zone, dashTo, targets, substitute };
      if (move.fx.alliesStages) {
        if (!targets.some((x) => x.side === u.side)) return fail('No allies in range');
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

/** Whether `u`, standing at `origin`, has a move that would include `target`. */
export function canTargetFrom(s: GameState, u: Unit, origin: Pos, target: Unit): boolean {
  if (!target.pos) return false;
  for (const idx of [0, 1] as const) {
    const m = moveOf(u, idx);
    if (isSupportOnly(m)) continue;
    if (m.target.kind === 'range') {
      if (steps(origin, target.pos) <= m.target.range) return true;
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
  copied?: boolean;
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
  log(ctx, `${nameOf(u)} used ${move.name}${opts.copied ? ' (Liquid Voice copy)' : ''}!`, 'info', u.side);
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

  if (!opts.copied && opts.moveIndex !== undefined) queueLiquidVoice(ctx, u, move, opts.moveIndex);
  return res;
}

function selfMove(ctx: Ctx, u: Unit, move: MoveDef): void {
  const fx = move.fx;
  if (fx.selfStages) applySelfStages(ctx, u, fx.selfStages.stages);
  if (fx.selfHeal) heal(ctx, u, fx.selfHeal, move.name);
  if (fx.selfAndAdjAlliesStages) {
    const group = [u, ...alliesOf(ctx.s, u).filter((a) => cheb(a.pos!, u.pos!) === 1)];
    for (const g of group) stageAll(ctx, g, fx.selfAndAdjAlliesStages, u);
  }
  if (fx.special === 'followMe' || fx.special === 'ragePowder') {
    u.followMe = { kind: fx.special, duringTurnOf: otherSide(u.side) };
    log(ctx, `${nameOf(u)} became the centre of attention!`, 'info', u.side);
  }
  if (fx.special === 'futureSight') {
    ctx.s.futureSight.push({ userId: u.id, side: u.side });
    log(ctx, `${nameOf(u)} foresaw an attack! It lands at the start of its next turn.`, 'info', u.side);
  }
}

function stageAll(ctx: Ctx, target: Unit, stages: Partial<Record<StatId, number>>, source: Unit, ignoreAbilities = false): void {
  for (const k of ['atk', 'def', 'mov'] as const) {
    const d = stages[k];
    if (d) applyStage(ctx, target, k, d, { source, ignoreAbilities });
  }
}

function globalMove(ctx: Ctx, u: Unit, move: MoveDef): void {
  const s = ctx.s;
  const all = liveUnits(s);
  switch (move.fx.special) {
    case 'sunnyDay':
      for (const x of all) {
        if (hasType(x, 'Fire')) applyStage(ctx, x, 'atk', 1, { source: u, label: 'Sunny Day' });
        if (hasType(x, 'Water')) applyStage(ctx, x, 'atk', -1, { source: u, label: 'Sunny Day' });
      }
      for (const c of withAbility(s, 'flowerGiftOvercast')) {
        transform(ctx, c, 'cherrim-sunshine', false);
        log(ctx, `${nameOf(c)} basked in the sunshine and transformed!`, 'good', c.side);
      }
      break;
    case 'rainDance':
      for (const x of all) {
        if (hasType(x, 'Water')) applyStage(ctx, x, 'atk', 1, { source: u, label: 'Rain Dance' });
        if (hasType(x, 'Fire')) applyStage(ctx, x, 'atk', -1, { source: u, label: 'Rain Dance' });
      }
      break;
    case 'sandstorm':
      for (const x of all) {
        if (hasType(x, 'Rock')) applyStage(ctx, x, 'def', 1, { source: u, label: 'Sandstorm' });
        if (!hasType(x, 'Rock') && !hasType(x, 'Ground') && !hasType(x, 'Steel')) dealDamage(ctx, x, 20, { source: u, label: 'Sandstorm' });
      }
      break;
    case 'hail':
      for (const x of all) {
        if (hasType(x, 'Ice')) applyStage(ctx, x, 'def', 1, { source: u, label: 'Hail' });
        else dealDamage(ctx, x, 20, { source: u, label: 'Hail' });
      }
      break;
    case 'flowerShield':
      for (const x of all) if (hasType(x, 'Grass')) applyStage(ctx, x, 'def', 1, { source: u, label: 'Flower Shield' });
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

  const ac = makeAttackCtx(u, move, { moveType: moveType ?? 'Normal', attackerPos, targetCount: tg.targets.length });
  const dice = fx.dice ? rng.d6() : null;
  if (dice !== null) log(ctx, `${nameOf(u)} rolled a ${dice}! (+${dice * 10} power)`, 'info', u.side);
  const sm = secondaryMult(s, u);
  const chance = (p: number): boolean => rng.chance(Math.min(1, p * sm));

  const targets = [...tg.targets].sort((a, b) => cheb(b.pos!, attackerPos) - cheb(a.pos!, attackerPos));
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
        continue;
      }
      if (imm.immune) {
        log(ctx, `It doesn't affect ${nameOf(t)}…`, 'info', t.side);
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
        const dealt = dealDamage(ctx, t, dmg.damage, { source: u, attack: true, ignoreAbilities: ac.ignoreAbilities, label: eff ?? undefined });
        hits.push(t);
        triggerLeech(ctx, u, posBefore, t.id, dealt);
        if (!ac.ignoreAbilities) reactiveAbilities(ctx, u, t, attackerPos, posBefore, moveType);
        if (!t.fainted) secondary(ctx, u, t, move, grazed, chance, ac.ignoreAbilities);
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
      if (fx.alliesStages || fx.healSelfAndAllies !== undefined) {
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

  // Knockback, farthest target first so pushed Pokémon don't collide with each other.
  const k = move.target.kind === 'grid' ? parseGrid(move.target.grid).knockback : 0;
  if (k > 0 && opts.dir) {
    for (const t of hits) if (!t.fainted && t.pos) knockback(ctx, t, opts.dir, k);
  }
  finish();
}

function reactiveAbilities(ctx: Ctx, u: Unit, t: Unit, attackerPos: Pos, targetPos: Pos, moveType: PType | null): void {
  const ab = abilityOf(t);
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
    log(ctx, `${nameOf(t)} became confused!`, 'bad', t.side);
  }
  if (fx.flinch && ok(fx.flinch) && chance(fx.flinch.chance)) {
    t.flinched = true;
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
  if (fx.heal) heal(ctx, t, fx.heal, move.name);
  if (fx.alliesStages) stageAll(ctx, t, fx.alliesStages, u);
  if (fx.healSelfAndAllies) heal(ctx, t, fx.healSelfAndAllies, move.name);
}

function knockback(ctx: Ctx, t: Unit, dir: Dir, k: number): void {
  const s = ctx.s;
  const path: Pos[] = [];
  for (let i = 0; i < k; i++) {
    const np = addPos(t.pos!, DIR_VEC[dir]);
    const blocked = !inBounds(s, np) || !canStand(t, terrainAt(s, np)) || !!unitAt(s, np) || substituteAt(s, np);
    if (blocked) break;
    path.push(np);
    enterTile(ctx, t, np);
    if (t.fainted) break;
  }
  if (path.length) {
    emit(ctx, { t: 'move', unitId: t.id, path });
    log(ctx, `${nameOf(t)} was knocked back ${path.length} tile${path.length > 1 ? 's' : ''}.`, 'info', t.side);
  }
}

function afterEffects(ctx: Ctx, u: Unit, move: MoveDef, hits: Unit[], res: ExecResult): void {
  const s = ctx.s;
  const fx = move.fx;
  const n = hits.length;
  res.hits = n;
  if (u.fainted) return;
  if (fx.recoil && n > 0) dealDamage(ctx, u, fx.recoil, { label: 'recoil' });
  if (fx.recoilPerTarget && n > 0) dealDamage(ctx, u, fx.recoilPerTarget * n, { label: 'recoil' });
  if (u.fainted) return;
  if (fx.drain && n > 0) heal(ctx, u, fx.drain, move.name);
  if (fx.drainPerTarget && n > 0) heal(ctx, u, fx.drainPerTarget * n, move.name);
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
    } else {
      if (nt.noMove) u.nextTurn.noMove = true;
      if (nt.noAct) u.nextTurn.noAct = true;
      log(ctx, `${nameOf(u)} must recharge: it can't ${nt.noAct ? 'move or act' : 'move'} next turn.`, 'info', u.side);
    }
  }
  if (fx.selfFaint) {
    log(ctx, `${nameOf(u)} is spent from the blast.`, 'info', u.side);
    faint(ctx, u, null);
  }
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

function queueLiquidVoice(ctx: Ctx, u: Unit, move: MoveDef, moveIndex: 0 | 1): void {
  if (!LIQUID_VOICE_RE.test(move.name)) return;
  const s = ctx.s;
  for (const p of withAbility(s, 'liquidVoice')) {
    if (p.id === u.id) continue;
    const options = liquidVoiceOptions(s, p, move);
    if (options.length === 0) continue;
    log(ctx, `${nameOf(p)}'s Liquid Voice can copy ${move.name}!`, 'info', p.side);
    s.pending.push({ kind: 'liquidVoice', side: p.side, unitId: p.id, source: { cardId: u.cardId, moveIndex }, options });
  }
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
    return { hits: 0, kos: 0 };
  }
  if (imm.immune) {
    log(ctx, `It doesn't affect ${nameOf(t)}…`, 'info', t.side);
    return { hits: 0, kos: 0 };
  }
  const hpBefore = t.hp;
  const posBefore = t.pos!;
  const dmg = computeDamage(s, ac, t, 40, null);
  const dealt = dealDamage(ctx, t, dmg.damage, { source: u, attack: true, ignoreAbilities: ac.ignoreAbilities, label: typeEffectLabel(dmg.mult) ?? undefined });
  triggerLeech(ctx, u, posBefore, t.id, dealt);
  if (!ac.ignoreAbilities) reactiveAbilities(ctx, u, t, u.pos!, posBefore, ac.moveType);
  if (!t.fainted && abilityOf(t) === 'emergencyExit' && hpBefore >= 100 && t.hp < 100) queueEmergencyExit(ctx, t);
  return { hits: 1, kos: t.fainted ? 1 : 0 };
}
