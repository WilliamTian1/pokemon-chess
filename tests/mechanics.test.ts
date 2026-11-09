import { describe, expect, it } from 'vitest';
import { decider, getCard, previewAction, reachable, terrainBonus } from '../src/engine';
import { act, park, setup, unit } from './helpers';

const P = (x: number, y: number) => ({ x, y });

describe('field objects', () => {
  it('a substitute soaks up an attack aimed through it', () => {
    const s = setup(['sudowoodo'], ['snorlax'], { A0: P(8, 7), D0: P(8, 4) });
    park(s, ['A0', 'D0']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(n.substitute?.pos).toEqual(P(8, 6));
    expect(unit(n, 'A0').hp).toBe(115);
    n = act(n, { type: 'endTurn' });
    // Snorlax's Body Slam southwards charges to (8,5) and its zone covers the substitute.
    n = act(n, { type: 'useMove', unitId: 'D0', moveIndex: 0, dir: 'S' });
    expect(n.substitute).toBeNull();
    expect(unit(n, 'A0').hp).toBe(115);
  });

  it('support moves pass a substitute by', () => {
    const s = setup(['whimsicott', 'tauros'], ['snorlax'], { A0: P(8, 6), A1: P(7, 6) });
    park(s, ['A0', 'A1']);
    s.substitute = { pos: P(9, 6), ownerId: 'D0' };
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(n.substitute).not.toBeNull();
    expect(unit(n, 'A1').stages.mov).toBe(1);
  });

  it('the trebuchet hits anywhere and ignores stat stages', () => {
    const s = setup(['tauros'], ['snorlax'], { A0: P(10, 4), D0: P(1, 8) });
    park(s, ['A0', 'D0']);
    unit(s, 'A0').stages.atk = 3;
    unit(s, 'D0').stages.def = 3;
    const n = act(s, { type: 'trebuchet', unitId: 'A0', targetId: 'D0' });
    expect(unit(n, 'D0').hp).toBe(220);
  });
});

describe('abilities', () => {
  it('Technician adds 30 to weak moves', () => {
    const s = setup(['scizor'], ['snorlax'], { A0: P(8, 7), D0: P(8, 4) });
    park(s, ['A0', 'D0']);
    expect(previewAction(s, 'A0', 1, { targetId: 'D0' })[0].min).toBe(60);
  });

  it('Intimidate weakens adjacent opponents', () => {
    const s = setup(['tauros'], ['snorlax', 'scrafty'], { A0: P(8, 7), D0: P(8, 4), D1: P(9, 8) });
    park(s, ['A0', 'D0', 'D1']);
    expect(previewAction(s, 'A0', 1, { dir: 'N' })[0].min).toBe(65);
  });

  it('Storm Drain absorbs Water moves and Levitate dodges Ground moves', () => {
    const s = setup(['blastoise', 'groudon'], ['lumineon', 'weezing'], { A0: P(8, 7), D0: P(8, 5), A1: P(4, 7), D1: P(4, 5) });
    park(s, ['A0', 'D0', 'A1', 'D1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(130);
    expect(unit(n, 'D0').stages.atk).toBe(1);
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D1').hp).toBe(145);
  });

  it('Sunny Day turns Cherrim into its Sunshine form', () => {
    const s = setup(['cherrim', 'charizard'], ['blastoise'], {});
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(unit(n, 'A0').cardId).toBe('cherrim-sunshine');
    expect(unit(n, 'A0').hp).toBe(185);
    expect(unit(n, 'A1').stages.atk).toBe(1);
    expect(unit(n, 'D0').stages.atk).toBe(-1);
  });

  it('Contrary reverses drops, Clear Body blocks them, Pressure doubles self-drops', () => {
    const s = setup(['venusaur', 'dragonite'], ['lurantis', 'metagross', 'mewtwo'], {
      A0: P(8, 7), D0: P(8, 5), A1: P(4, 7), D1: P(4, 4), D2: P(12, 1),
    });
    park(s, ['A0', 'D0', 'A1', 'D1', 'D2']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'D0').stages.def).toBe(2);
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'A1').stages.atk).toBe(-3); // Draco Meteor −2, doubled by Pressure, clamped

    // Breaking Swipe (Atk −1) — Acid Spray wouldn't do: Steel is immune to Poison.
    const cb = setup(['dragonite'], ['metagross'], { A0: P(8, 7), D0: P(8, 6) });
    park(cb, ['A0', 'D0']);
    const m = act(cb, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(m, 'D0').hp).toBeLessThan(185);
    expect(unit(m, 'D0').stages.atk).toBe(0);
    expect(m.log.some((l) => l.text.includes('Clear Body'))).toBe(true);
  });

  it('Truant stops Slaking from attacking on even rounds (it can still move and Slack Off)', () => {
    let s = setup(['slaking'], ['snorlax'], { A0: P(8, 7), D0: P(8, 5) });
    park(s, ['A0', 'D0']);
    for (let i = 0; i < 4; i++) s = act(s, { type: 'endTurn' });
    expect(s.round).toBe(4);
    expect(() => act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' })).toThrow(/Truant/);
    expect(act(s, { type: 'move', unitId: 'A0', to: P(8, 6) }).units.find((u) => u.id === 'A0')!.pos).toEqual(P(8, 6));
    unit(s, 'A0').hp = 100;
    expect(unit(act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 }), 'A0').hp).toBe(150);
    s = act(act(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(s.round).toBe(5);
    const hit = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(hit, 'D0').hp).toBeLessThan(unit(hit, 'D0').maxHp);
  });

  it('U-turn and Run Away grant movement after acting', () => {
    const s = setup(['gliscor', 'furret'], ['snorlax'], { A0: P(8, 7), D0: P(8, 5), A1: P(5, 6) });
    park(s, ['A0', 'D0', 'A1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(n.active).toMatchObject({ unitId: 'A0', stage: 'acted', postMove: 3 });
    n = act(n, { type: 'postMove', unitId: 'A0', to: P(11, 6) });
    expect(n.active).toBeNull();
    expect(unit(n, 'A0').activated).toBe(true);
    // Furret walks 1, Follow Me, then may spend the 2 movement it has left.
    n = act(n, { type: 'move', unitId: 'A1', to: P(4, 6) });
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 1 });
    expect(n.active).toMatchObject({ unitId: 'A1', stage: 'acted', postMove: 2 });
  });

  it('Poison Heal heals instead of hurting', () => {
    const s = setup(['gliscor'], ['snorlax'], { A0: P(8, 7) });
    park(s, ['A0']);
    const g = unit(s, 'A0');
    g.status = 'psn';
    g.hp = 100;
    const n = act(s, { type: 'wait', unitId: 'A0' });
    expect(unit(n, 'A0').hp).toBe(130);
  });
});

describe('interrupt choices', () => {
  it('Emergency Exit lets the owner pick an ally to swap with', () => {
    const s = setup(['tauros'], ['golisopod'], { A0: P(8, 7), D0: P(8, 5) });
    park(s, ['A0', 'D0']);
    unit(s, 'D0').hp = 110;
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(55);
    expect(n.pending[0]).toMatchObject({ kind: 'emergencyExit', side: 'D' });
    expect(decider(n)).toBe('D');
    expect(() => act(n, { type: 'endTurn' })).toThrow(/choice/);
    const allyPos = unit(n, 'D1').pos;
    n = act(n, { type: 'choose', option: 'D1' });
    expect(unit(n, 'D0').pos).toEqual(allyPos);
    expect(unit(n, 'D1').pos).toEqual(P(8, 5));
    expect(decider(n)).toBe('A');
  });

  it('Liquid Voice copies sound moves as Water', () => {
    const s = setup(['zoroark-hisui'], ['primarina', 'snorlax'], { A0: P(8, 7), D0: P(10, 6), D1: P(8, 5) });
    park(s, ['A0', 'D0', 'D1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D1').hp).toBe(185);
    expect(n.pending[0]).toMatchObject({ kind: 'liquidVoice', side: 'D', options: ['W'] });
    n = act(n, { type: 'choose', option: 'W' });
    expect(unit(n, 'A0').hp).toBe(15);
    expect(unit(n, 'D1').hp).toBe(110);
    expect(n.pending).toHaveLength(0);
  });

  it('Future Sight fizzles if Slowbro faints before it lands', () => {
    let s = setup(['slowbro'], ['snorlax'], { A0: P(6, 5), D0: P(6, 3) });
    park(s, ['A0', 'D0']);
    const fs = getCard('slowbro').moves.findIndex((m) => m.name === 'Future Sight') as 0 | 1;
    s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: fs });
    expect(s.futureSight).toHaveLength(1);
    s = act(s, { type: 'endTurn' });
    // Slowbro faints during the Defender's turn.
    const slowbro = unit(s, 'A0');
    slowbro.hp = 0;
    slowbro.fainted = true;
    slowbro.pos = null;
    const hp = unit(s, 'D0').hp;
    s = act(s, { type: 'endTurn' });
    expect(unit(s, 'D0').hp).toBe(hp);
    expect(s.futureSight).toHaveLength(0);
    expect(s.log.some((l) => /fizzles/.test(l.text))).toBe(true);
  });
});

describe('distance, terrain and grids', () => {
  it('"within 4 tiles" counts steps like movement, so diagonals cost 2', () => {
    const s = setup(['breloom'], ['snorlax', 'tauros'], { A0: P(5, 5), D0: P(7, 7), D1: P(8, 8) });
    park(s, ['A0', 'D0', 'D1']);
    // (7,7) is 2 + 2 = 4 steps away; (8,8) is 6 (only 3 tiles on the diagonal).
    expect(previewAction(s, 'A0', 1, { targetId: 'D0' })).toHaveLength(1);
    expect(() => act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, targetId: 'D1' })).toThrow(/within 4 tiles/);
  });

  it('Flying and Levitate Pokémon get no berry bush or flower bonus', () => {
    // Meadow: a berry bush at (7,4), flowers at (4,3).
    const s = setup(['breloom'], ['snorlax', 'dodrio', 'weezing'], { A0: P(7, 6), D0: P(7, 4), D1: P(11, 5), D2: P(4, 3) });
    park(s, ['A0', 'D0', 'D1', 'D2']);
    expect(terrainBonus(s, unit(s, 'D0'))).toBe('bush');
    expect(terrainBonus(s, unit(s, 'D2'))).toBeNull();
    // Mach Punch + Technician = 60 Fighting: Snorlax on the bush takes (60 − 30) × 2.
    expect(previewAction(s, 'A0', 1, { targetId: 'D0' })[0].min).toBe(60);
    const onBush = setup(['breloom'], ['noivern'], { A0: P(7, 6), D0: P(7, 4) });
    const offBush = setup(['breloom'], ['noivern'], { A0: P(7, 6), D0: P(9, 4) });
    park(onBush, ['A0', 'D0']);
    park(offBush, ['A0', 'D0']);
    expect(previewAction(onBush, 'A0', 1, { targetId: 'D0' })[0].min).toBe(previewAction(offBush, 'A0', 1, { targetId: 'D0' })[0].min);
  });

  it('flowers don\'t heal Flying or Levitate Pokémon', () => {
    // Meadow flowers at (4,3) and (3,4); waiting there ends the activation on them.
    const s = setup(['noivern', 'snorlax', 'weezing'], ['blissey'], { A0: P(4, 3), A1: P(3, 4) });
    park(s, ['A0', 'A1']);
    for (const id of ['A0', 'A1']) unit(s, id).hp -= 60;
    let n = act(s, { type: 'wait', unitId: 'A0' });
    n = act(n, { type: 'wait', unitId: 'A1' });
    expect(unit(n, 'A0').hp).toBe(unit(s, 'A0').hp);
    expect(unit(n, 'A1').hp).toBe(unit(s, 'A1').hp + 30);
    const w = setup(['weezing'], ['blissey'], { A0: P(4, 3) });
    park(w, ['A0']);
    unit(w, 'A0').hp -= 60;
    expect(unit(act(w, { type: 'wait', unitId: 'A0' }), 'A0').hp).toBe(unit(w, 'A0').hp);
  });

  it('Fire Spin hits the 3×3 ring in front, three tiles deep', () => {
    const s = setup(['volcarona'], ['snorlax', 'tauros', 'blissey'], { A0: P(5, 7), D0: P(5, 4), D1: P(4, 5), D2: P(5, 5) });
    park(s, ['A0', 'D0', 'D1', 'D2']);
    const hit = previewAction(s, 'A0', 0, { dir: 'N' }).map((p) => p.unitId).sort();
    // (5,4) is 3 ahead and (4,5) is 2 ahead and 1 left; (5,5), 2 straight ahead, is the gap.
    expect(hit).toEqual(['D0', 'D1']);
  });

  it('only Ghost types move through opponents', () => {
    const s = setup(['tauros', 'gengar'], ['snorlax'], { A0: P(8, 7), A1: P(3, 7), D0: P(8, 6) });
    park(s, ['A0', 'A1', 'D0']);
    // Two steps straight through Snorlax; going around takes four.
    expect(reachable(s, unit(s, 'A0'), 2).has('8,5')).toBe(false);
    unit(s, 'D0').pos = P(3, 6);
    unit(s, 'A0').pos = P(10, 7);
    expect(reachable(s, unit(s, 'A1'), 2).has('3,5')).toBe(true);
  });
});
