import { describe, expect, it } from 'vitest';
import { decider, previewAction } from '../src/engine';
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
    const n = act(s, { type: 'trebuchet', unitId: 'A0', targetId: 'D0', attackType: 'Normal' });
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

  it('Truant stops Slaking from moving on even rounds', () => {
    let s = setup(['slaking'], ['snorlax'], { A0: P(8, 7) });
    park(s, ['A0']);
    for (let i = 0; i < 4; i++) s = act(s, { type: 'endTurn' });
    expect(s.round).toBe(4);
    expect(() => act(s, { type: 'move', unitId: 'A0', to: P(8, 6) })).toThrow(/can't move/);
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
});
