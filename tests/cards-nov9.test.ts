import { describe, expect, it } from 'vitest';
import { getCard, grazeApplies, makeAttackCtx, quickGame, seededRng } from '../src/engine';
import { act, park, scriptedRng, setup, unit } from './helpers';

const P = (x: number, y: number) => ({ x, y });

describe('2026-11-09 card sheet', () => {
  it('Wide Guard stops attacks that hit Pelipper and another Pokémon, not single-target ones', () => {
    let s = setup(['pelipper', 'snorlax'], ['dewgong'], { A0: P(5, 5), A1: P(6, 5), D0: P(5, 3) });
    park(s, ['A0', 'A1', 'D0']);
    s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(unit(s, 'A0').wideGuard).toBe('D');
    s = act(s, { type: 'endTurn' });
    // Icy Wind (two rows of three) would hit both Pelipper and Snorlax.
    const n = act(s, { type: 'useMove', unitId: 'D0', moveIndex: 0, dir: 'S' });
    expect(unit(n, 'A0').hp).toBe(unit(n, 'A0').maxHp);
    expect(unit(n, 'A1').hp).toBe(unit(n, 'A1').maxHp);
    // With Snorlax out of the way only Pelipper is hit, so it isn't protected.
    unit(s, 'A1').pos = P(1, 0);
    const single = act(s, { type: 'useMove', unitId: 'D0', moveIndex: 0, dir: 'S' });
    expect(unit(single, 'A0').hp).toBeLessThan(unit(single, 'A0').maxHp);
  });

  it('Wide Guard wears off when its side’s next turn starts', () => {
    let s = setup(['pelipper'], ['snorlax'], { A0: P(5, 5), D0: P(5, 1) });
    park(s, ['A0', 'D0']);
    s = act(act(act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 }), { type: 'endTurn' }), { type: 'endTurn' });
    expect(unit(s, 'A0').wideGuard).toBeNull();
  });

  it('Psyche Up copies the target’s stat changes', () => {
    const s = setup(['ninetales'], ['snorlax'], { A0: P(8, 7), D0: P(8, 5) });
    park(s, ['A0', 'D0']);
    unit(s, 'D0').stages = { atk: 2, def: -1, mov: 1 };
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'A0').stages).toEqual({ atk: 2, def: -1, mov: 1 });
  });

  it('Aurora Veil raises the whole team’s defense, to at most +2', () => {
    let s = setup(['aurorus', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(2, 8) });
    park(s, ['A0', 'A1']);
    unit(s, 'A1').stages.def = 1;
    s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect([unit(s, 'A0').stages.def, unit(s, 'A1').stages.def, unit(s, 'D0').stages.def]).toEqual([1, 2, 0]);
    s = act(act(act(s, { type: 'endTurn' }), { type: 'endTurn' }), { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect([unit(s, 'A0').stages.def, unit(s, 'A1').stages.def]).toEqual([2, 2]);
  });

  it('Snow Warning boosts Ice types at the start and stops Blizzard grazing', () => {
    const s = quickGame(['aurorus', 'snorlax', 'tauros', 'furret'], ['dewgong', 'frosmoth', 'slaking', 'staraptor'], { rng: seededRng(1) });
    expect(s.units.find((u) => u.cardId === 'dewgong')!.stages.def).toBe(1);
    expect(s.units.find((u) => u.cardId === 'snorlax')!.stages.def).toBe(0);
    const frosmoth = s.units.find((u) => u.cardId === 'frosmoth')!;
    const blizzard = getCard('frosmoth').moves[0];
    expect(grazeApplies(s, makeAttackCtx(frosmoth, blizzard))).toBe(false);
    const without = quickGame(['snorlax', 'tauros', 'furret', 'dodrio'], ['frosmoth', 'slaking', 'staraptor', 'blissey'], { rng: seededRng(1) });
    expect(grazeApplies(without, makeAttackCtx(without.units.find((u) => u.cardId === 'frosmoth')!, blizzard))).toBe(true);
  });

  it('Spit Up hits 50 harder per Defense boost, then uses them up', () => {
    const s = setup(['swalot'], ['snorlax'], { A0: P(8, 7), D0: P(8, 6) });
    park(s, ['A0', 'D0']);
    unit(s, 'A0').stages.def = 2;
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(260 - 120);
    expect(unit(n, 'A0').stages.def).toBe(0);
  });

  it('Swallow trades Defense boosts for 70 HP each when Swalot drops under 60', () => {
    const s = setup(['swalot'], ['snorlax'], { A0: P(8, 7) });
    park(s, ['A0']);
    const sw = unit(s, 'A0');
    sw.hp = 70;
    sw.stages.def = 2;
    sw.status = 'psn';
    const n = act(s, { type: 'wait', unitId: 'A0' });
    expect(unit(n, 'A0')).toMatchObject({ hp: 175, stages: { atk: 0, def: 0, mov: 0 } });
  });

  it('Knock Off: +50 against a Pokémon on bonus terrain, and the bush’s defense is ignored', () => {
    // The berry bush at (12,2); Crawdaunt's own Adaptability adds 30 to its Dark move.
    const onBush = setup(['crawdaunt'], ['snorlax'], { A0: P(12, 3), D0: P(12, 2) });
    park(onBush, ['A0', 'D0']);
    expect(unit(act(onBush, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }), 'D0').hp).toBe(260 - 130);
    const plain = setup(['crawdaunt'], ['snorlax'], { A0: P(1, 5), D0: P(1, 4) });
    park(plain, ['A0', 'D0']);
    expect(unit(act(plain, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }), 'D0').hp).toBe(260 - 80);
  });

  it('Dynamic Punch misses half the time, and confuses when it hits', () => {
    const s = setup(['golurk'], ['snorlax'], { A0: P(8, 7), D0: P(8, 6) });
    park(s, ['A0', 'D0']);
    const miss = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }, scriptedRng([true]));
    expect(unit(miss, 'D0').hp).toBe(260);
    const hit = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }, scriptedRng([false]));
    expect(unit(hit, 'D0').hp).toBeLessThan(260);
    expect(unit(hit, 'D0').confused).toBe(true);
  });

  it('Swords Dance and Stockpile raise the user’s stats', () => {
    const s = setup(['rampardos', 'swalot'], ['snorlax'], { A0: P(8, 7), A1: P(4, 8) });
    park(s, ['A0', 'A1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(unit(n, 'A0').stages.atk).toBe(2);
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 1 });
    expect(unit(n, 'A1').stages.def).toBe(1);
  });
});
