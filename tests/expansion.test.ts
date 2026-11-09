import { describe, expect, it } from 'vitest';
import {
  type GameState, CARD_LIST, applyAction, decider, draftOptions, getCard, hitTypeMultiplier, isTrainerPick, makeAttackCtx,
  moveOptions, moveTargets, movementAllowance, newGame, previewAction, seededRng, targeting,
} from '../src/engine';
import { act, park, scriptedRng, setup, unit } from './helpers';

const P = (x: number, y: number) => ({ x, y });

/** Gives `side` a trainer in a battle state built by `setup`. */
function withTrainer(s: GameState, side: 'A' | 'D', id: string): GameState {
  s.trainers = { pool: [id], picks: { A: null, D: null, [side]: id }, used: { A: false, D: false }, effect: null };
  return s;
}

describe('expansion cards', () => {
  it('adds the 19 expansion Pokémon', () => {
    expect(CARD_LIST).toHaveLength(93);
    const ids = ['flygon', 'hawlucha', 'sylveon', 'tinkaton', 'meganium', 'porygonz', 'corsola', 'vivillon', 'octillery', 'comfey',
      'wobbuffet', 'ditto', 'shedinja', 'ninjask', 'froslass', 'roserade', 'haxorus', 'oricorio', 'wigglytuff'];
    for (const id of ids) expect(getCard(id).draftable && !getCard(id).legendary).toBe(true);
  });

  it('Flying Press counts as Fighting and Flying at once', () => {
    const s = setup(['hawlucha'], ['snorlax', 'gengar', 'scizor', 'butterfree'], { A0: P(9, 8) });
    const ac = makeAttackCtx(unit(s, 'A0'), getCard('hawlucha').moves[0]);
    expect(hitTypeMultiplier(ac, unit(s, 'D0'))).toBe(2);
    expect(hitTypeMultiplier(ac, unit(s, 'D1'))).toBe(0);
    expect(hitTypeMultiplier(ac, unit(s, 'D2'))).toBe(1);
    expect(hitTypeMultiplier(ac, unit(s, 'D3'))).toBe(0.5);
  });

  it('Wonder Guard only lets super-effective attacks through', () => {
    const s = setup(['blastoise', 'charizard'], ['shedinja'], { A0: P(9, 8), A1: P(11, 8), D0: P(9, 6) });
    park(s, ['A0', 'A1', 'D0']);
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0]).toMatchObject({ kind: 'immune', notes: ['Wonder Guard'] });
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(1);
    unit(n, 'D0').pos = P(11, 6);
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').fainted).toBe(true);
  });

  it('Decoy: a surviving Wobbuffet shields the rest of the zone and hits back', () => {
    const s = setup(['blastoise'], ['wobbuffet', 'snorlax'], { A0: P(9, 8), D0: P(9, 7), D1: P(9, 6) });
    park(s, ['A0', 'D0', 'D1']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    const taken = unit(n, 'D0').maxHp - unit(n, 'D0').hp;
    expect(taken).toBeGreaterThan(0);
    expect(unit(n, 'D1').hp).toBe(unit(n, 'D1').maxHp);
    expect(unit(n, 'A0').maxHp - unit(n, 'A0').hp).toBe(taken);
  });

  it('Octazooka only reaches Pokémon 4–6 tiles away', () => {
    const s = setup(['octillery'], ['snorlax', 'tauros', 'blissey'], { A0: P(9, 8), D0: P(9, 6), D1: P(9, 3), D2: P(12, 0) });
    park(s, ['A0', 'D0', 'D1', 'D2']);
    expect(moveOptions(s, unit(s, 'A0'))[0].units).toEqual(['D1']);
  });

  it('Fake Out flinches, then cools down until the user ends a turn 4+ tiles from opponents', () => {
    const s = setup(['tinkaton'], ['snorlax'], { A0: P(9, 8), D0: P(9, 5) });
    park(s, ['A0', 'D0']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'A0').pos).toEqual(P(9, 6));
    expect(unit(n, 'D0').flinched).toBe(true);
    expect(unit(n, 'A0').locked).toEqual(['Fake Out']);
    n = act(act(n, { type: 'endTurn' }), { type: 'endTurn' });
    expect(moveOptions(n, unit(n, 'A0'))[1]).toMatchObject({ usable: false });
    unit(n, 'A0').pos = P(9, 8);
    unit(n, 'D0').pos = P(9, 3);
    n = act(n, { type: 'wait', unitId: 'A0' });
    expect(unit(n, 'A0').locked).toEqual([]);
  });

  it('Gigaton Hammer only works in even rounds', () => {
    const s = setup(['tinkaton'], ['snorlax'], { A0: P(9, 8), D0: P(9, 7) });
    park(s, ['A0', 'D0']);
    expect(moveOptions(s, unit(s, 'A0'))[0].usable).toBe(true);
    s.round = 3;
    expect(moveOptions(s, unit(s, 'A0'))[0]).toMatchObject({ usable: false, reason: 'Only on even-numbered rounds' });
  });

  it('Light Screen raises the team’s defense, but not past +1', () => {
    const s = setup(['meganium', 'snorlax', 'tauros'], ['blissey'], { A0: P(9, 8), A1: P(11, 8), A2: P(12, 8) });
    unit(s, 'A1').stages.def = -1;
    unit(s, 'A2').stages.def = 1;
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect([unit(n, 'A0').stages.def, unit(n, 'A1').stages.def, unit(n, 'A2').stages.def]).toEqual([1, 0, 1]);
  });

  it('Taunt stops the opponent’s status moves while they can attack', () => {
    const s = setup(['froslass'], ['blastoise'], { A0: P(9, 7), D0: P(9, 5) });
    park(s, ['A0', 'D0']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(n.taunted).toBe('D');
    n = act(n, { type: 'endTurn' });
    expect(moveOptions(n, unit(n, 'D0'))[1]).toMatchObject({ usable: false, reason: 'Taunted: must use a damaging move' });
    n = act(n, { type: 'endTurn' });
    expect(n.taunted).toBeNull();
  });

  it('Helping Hand adds 30 damage to the ally’s attacks this turn', () => {
    const s = setup(['octillery', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(9, 7), D0: P(9, 5) });
    park(s, ['A0', 'A1', 'D0']);
    const before = previewAction(s, 'A1', 1, { dir: 'N' })[0].min;
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(previewAction(n, 'A1', 1, { dir: 'N' })[0].min).toBe(before + 30);
    expect(unit(act(act(n, { type: 'endTurn' }), { type: 'endTurn' }), 'A1').dmgBonus).toBe(0);
  });

  it('Baton Pass swaps places and stat changes with an ally within 4 tiles', () => {
    const s = setup(['ninjask', 'snorlax', 'tauros'], ['blissey'], { A0: P(9, 8), A1: P(9, 4), A2: P(9, 3) });
    park(s, ['A0', 'A1', 'A2']);
    unit(s, 'A0').stages.atk = 2;
    unit(s, 'A1').stages.def = -1;
    expect(moveOptions(s, unit(s, 'A0'))[1].units).toEqual(['A1']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, targetId: 'A1' });
    expect(unit(n, 'A0').pos).toEqual(P(9, 4));
    expect(unit(n, 'A1').pos).toEqual(P(9, 8));
    expect(unit(n, 'A0').stages).toEqual({ atk: 0, def: -1, mov: 0 });
    expect(unit(n, 'A1').stages).toEqual({ atk: 2, def: 0, mov: 0 });
  });

  it('Transform uses another Pokémon’s move as Ditto’s own', () => {
    const s = setup(['ditto'], ['charizard'], { A0: P(9, 8), D0: P(9, 6) });
    park(s, ['A0', 'D0']);
    const opt = moveOptions(s, unit(s, 'A0'))[0];
    expect(opt.aim).toBe('copy');
    expect(opt.copies!.some((c) => c.unitId === 'D0' && c.moveIndex === 0)).toBe(true);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N', copy: { unitId: 'D0', moveIndex: 0 } });
    expect(unit(n, 'D0').hp).toBeLessThan(unit(n, 'D0').maxHp);
    expect(n.log.some((l) => l.text.includes('transformed to copy Flamethrower'))).toBe(true);
    expect(moveOptions(s, unit(s, 'A0'))[1]).toMatchObject({ usable: false, reason: 'No second move' });
  });

  it('Metronome draws an unused card and lets the player use one of its moves', () => {
    const s = setup(['wigglytuff'], ['snorlax'], { A0: P(9, 8), D0: P(9, 6) });
    park(s, ['A0', 'D0']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0 });
    const p = n.pending[0];
    expect(p).toMatchObject({ kind: 'metronome', cardId: 'charizard' });
    expect(p.options).toContain('0:N');
    expect(decider(n)).toBe('A');
    n = act(n, { type: 'choose', option: '0:N' });
    expect(unit(n, 'D0').hp).toBeLessThan(unit(n, 'D0').maxHp);
  });

  it('Dancer copies other Pokémon’s dance moves', () => {
    const s = setup(['volcarona', 'oricorio', 'haxorus'], ['snorlax'], { A0: P(9, 8), A1: P(11, 8), A2: P(12, 8) });
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(unit(n, 'A1').stages).toEqual({ atk: 1, def: 1, mov: 1 });
    n = act(n, { type: 'useMove', unitId: 'A2', moveIndex: 1 });
    expect(unit(n, 'A1').stages).toEqual({ atk: 2, def: 1, mov: 2 });
  });

  it('Imposter may copy an adjacent Pokémon’s stat changes at the end of its turn', () => {
    const s = setup(['ditto'], ['snorlax'], { A0: P(9, 8), D0: P(9, 7) });
    park(s, ['A0', 'D0']);
    unit(s, 'D0').stages.atk = 2;
    let n = act(s, { type: 'wait', unitId: 'A0' });
    expect(n.pending[0]).toMatchObject({ kind: 'imposter', options: ['D0'] });
    n = act(n, { type: 'choose', option: 'D0' });
    expect(unit(n, 'A0').stages.atk).toBe(2);
  });

  it('After You lets an ally that already went act again — once per turn', () => {
    const s = setup(['comfey', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(9, 7), D0: P(9, 5) });
    park(s, ['A0', 'A1', 'D0']);
    let n = act(s, { type: 'wait', unitId: 'A1' });
    expect(unit(n, 'A1').activated).toBe(true);
    n = act(n, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(n.pending).toHaveLength(0);
    expect(unit(n, 'A1')).toMatchObject({ activated: false, gotAfterYou: true });
    // A whole new activation: Tauros can attack again.
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'D0').hp).toBeLessThan(unit(n, 'D0').maxHp);
    // After You can't be given to the same Pokémon twice in one turn.
    expect(targeting(n, unit(n, 'A0'), getCard('comfey').moves[0], { dir: 'N' }).ok).toBe(false);
  });

  it('After You on an ally that hasn’t gone yet gives it two activations', () => {
    const s = setup(['comfey', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(9, 7) });
    park(s, ['A0', 'A1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'A1')).toMatchObject({ activated: false, actAgain: 1 });
    n = act(n, { type: 'wait', unitId: 'A1' });
    expect(unit(n, 'A1')).toMatchObject({ activated: false, actAgain: 0 });
    n = act(n, { type: 'wait', unitId: 'A1' });
    expect(unit(n, 'A1').activated).toBe(true);
  });

  it('Speed Boost raises movement at the start of even rounds', () => {
    let s = setup(['ninjask'], ['snorlax'], { A0: P(9, 8) });
    s = act(act(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(s.round).toBe(3);
    expect(unit(s, 'A0').stages.mov).toBe(0);
    s = act(act(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(unit(s, 'A0').stages.mov).toBe(1);
  });

  it('Pixilate turns an adjacent ally’s Normal move Fairy with 30 extra damage', () => {
    const s = setup(['tauros', 'sylveon'], ['snorlax'], { A0: P(9, 8), A1: P(10, 8), D0: P(9, 6) });
    park(s, ['A0', 'A1', 'D0']);
    const [pv] = previewAction(s, 'A0', 1, { dir: 'N' });
    expect(pv.notes).toContain('Pixilate: Fairy');
    expect(pv.min).toBe(125);
  });

  it('Adaptability adds 30 to Normal moves of the holder and adjacent Pokémon', () => {
    const s = setup(['porygonz', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(10, 8), D0: P(9, 6) });
    park(s, ['A0', 'A1', 'D0']);
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(100);
    unit(s, 'D0').pos = P(10, 6);
    expect(previewAction(s, 'A1', 1, { dir: 'N' })[0].min).toBe(125);
  });

  it('Leaf Guard doubles berry bushes and flowers', () => {
    // Meadow: a berry bush at (7,4), flowers at (4,3).
    const s = setup(['tauros'], ['meganium', 'snorlax'], { A0: P(7, 6), D0: P(7, 4), D1: P(4, 3) });
    park(s, ['A0', 'D0']);
    // Hyper Beam 95 Normal on Grass: 95 − 60 = 35.
    expect(previewAction(s, 'A0', 1, { dir: 'N' })[0].min).toBe(35);
    const f = setup(['meganium'], ['snorlax'], { A0: P(4, 3) });
    park(f, ['A0']);
    unit(f, 'A0').hp -= 100;
    expect(unit(act(f, { type: 'wait', unitId: 'A0' }), 'A0').hp).toBe(unit(f, 'A0').hp + 60);
  });

  it('Triage lets Comfey walk 3 extra tiles, but only to heal', () => {
    const s = setup(['comfey', 'snorlax'], ['blissey'], { A0: P(9, 8), A1: P(9, 1) });
    park(s, ['A0', 'A1']);
    unit(s, 'A1').hp -= 100;
    // Mov 3 reaches (9,5); Floral Healing reaches 3 ahead, so (9,4)–(9,2) need the extra tiles.
    const tiles = moveTargets(s, unit(s, 'A0'));
    expect(tiles.has('9,4')).toBe(true);
    expect(tiles.has('12,8')).toBe(true);
    expect(tiles.has('13,8')).toBe(false);
    const n = act(s, { type: 'move', unitId: 'A0', to: P(9, 4) });
    expect(() => act(n, { type: 'wait', unitId: 'A0' })).toThrow(/Triage/);
    expect(moveOptions(n, unit(n, 'A0'))[0]).toMatchObject({ usable: false });
    const healed = act(n, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(healed, 'A1').hp).toBe(unit(s, 'A1').hp + 40);
  });

  it('Artillery Expertise adds 20 to the trebuchet', () => {
    const s = setup(['octillery'], ['snorlax'], { A0: P(10, 4), D0: P(3, 3) });
    expect(previewAction(s, 'A0', 'treb', { targetId: 'D0' })[0].max).toBe(60);
  });
});

describe('trainers', () => {
  it('each side picks one of four trainers after the draft, Attacker first', () => {
    let s = newGame({ rng: seededRng(5), trainers: true });
    expect(s.trainers!.pool).toHaveLength(4);
    const rng = seededRng(9);
    while (!isTrainerPick(s)) s = applyAction(s, { type: 'draftPick', cardId: draftOptions(s)[0] }, rng).state;
    expect(decider(s)).toBe('A');
    const [first] = draftOptions(s);
    s = applyAction(s, { type: 'draftPick', cardId: first }, rng).state;
    expect(decider(s)).toBe('D');
    expect(draftOptions(s)).toHaveLength(3);
    expect(draftOptions(s)).not.toContain(first);
    s = applyAction(s, { type: 'draftPick', cardId: draftOptions(s)[0] }, rng).state;
    expect(s.phase).toBe('placement');
    expect(s.units).toHaveLength(8);
    expect(s.trainers!.picks.A).toBe(first);
  });

  it('N heals the team and cures status, once per game', () => {
    const s = withTrainer(setup(['snorlax', 'tauros'], ['blissey'], { A0: P(9, 8), A1: P(11, 8) }), 'A', 'n');
    unit(s, 'A0').hp -= 80;
    unit(s, 'A1').status = 'brn';
    const n = act(s, { type: 'trainerSpecial' });
    expect(unit(n, 'A0').hp).toBe(unit(s, 'A0').hp + 50);
    expect(unit(n, 'A1').status).toBeNull();
    expect(() => act(n, { type: 'trainerSpecial' })).toThrow(/already been used/);
  });

  it('N’s passive removes recoil', () => {
    const s = withTrainer(setup(['corsola'], ['snorlax'], { A0: P(9, 8), D0: P(9, 6) }), 'A', 'n');
    park(s, ['A0', 'D0']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'D0').hp).toBeLessThan(unit(n, 'D0').maxHp);
    expect(unit(n, 'A0').hp).toBe(unit(n, 'A0').maxHp);
  });

  it('Mitsuhide resets every stat change and makes the turn’s moves sure hits', () => {
    const s = withTrainer(setup(['porygonz'], ['snorlax'], { A0: P(9, 8), D0: P(9, 6) }), 'A', 'mitsuhide');
    park(s, ['A0', 'D0']);
    unit(s, 'D0').stages.def = 2;
    const n = act(s, { type: 'trainerSpecial' });
    expect(unit(n, 'D0').stages.def).toBe(0);
    // Zap Cannon misses half the time; the scripted roll says "miss".
    const hit = applyAction(n, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }, scriptedRng([true])).state;
    expect(unit(hit, 'D0').hp).toBeLessThan(unit(hit, 'D0').maxHp);
    expect(unit(hit, 'D0').status).toBe('par');
  });

  it('Mitsuhide’s passive keeps weather from hurting its side', () => {
    // Cetitan's Hail: 20 to every non-Ice Pokémon, except on Mitsuhide's side.
    const s = withTrainer(setup(['cetitan', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(11, 8), D0: P(9, 3) }), 'A', 'mitsuhide');
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect(unit(n, 'A1').hp).toBe(unit(n, 'A1').maxHp);
    expect(unit(n, 'D0').hp).toBe(unit(n, 'D0').maxHp - 20);
  });

  it('Nobunaga boosts one Pokémon for the turn, and adds 10 to the trebuchet', () => {
    const s = withTrainer(setup(['tauros', 'snorlax'], ['blissey'], { A0: P(9, 8), A1: P(10, 4), D0: P(9, 6) }), 'A', 'nobunaga');
    park(s, ['A0', 'A1', 'D0']);
    expect(previewAction(s, 'A1', 'treb', { targetId: 'D0' })[0].max).toBe(50);
    const before = movementAllowance(s, unit(s, 'A0'));
    const n = act(s, { type: 'trainerSpecial', unitId: 'A0' });
    expect(movementAllowance(n, unit(n, 'A0'))).toBe(before + 2);
    expect(unit(n, 'A0')).toMatchObject({ dmgBonus: 30, ignoreDefBoosts: true });
  });

  it('Nobunaga’s passive heals its Pokémon when an attack can’t affect them', () => {
    const s = withTrainer(setup(['tauros'], ['gengar'], { A0: P(9, 8), D0: P(9, 6) }), 'D', 'nobunaga');
    park(s, ['A0', 'D0']);
    unit(s, 'D0').hp -= 50;
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(unit(s, 'D0').hp + 30);
  });

  it('Red’s Pikachu hits 45 harder; Red and Blue’s special adds movement and damage', () => {
    const s = withTrainer(setup(['pikachu', 'tauros', 'snorlax'], ['furret'], { A0: P(9, 8), A1: P(11, 8), A2: null, D0: P(9, 6) }), 'A', 'red');
    park(s, ['A0', 'A1', 'D0']);
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(90);
    const mov = movementAllowance(s, unit(s, 'A1'));
    const n = act(s, { type: 'trainerSpecial' });
    expect(movementAllowance(n, unit(n, 'A1'))).toBe(mov + 1);
    // One fainted teammate: +20.
    expect(previewAction(n, 'A0', 0, { dir: 'N' })[0].min).toBe(110);
  });

  it('Blue’s passive doubles one-tile knockback', () => {
    const s = withTrainer(setup(['haxorus'], ['snorlax'], { A0: P(9, 8), D0: P(9, 7) }), 'A', 'blue');
    park(s, ['A0', 'D0']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').pos).toEqual(P(9, 5));
  });

  it('Lance trades cooldowns for 40 recoil, and his special pushes every attack two tiles', () => {
    const s = withTrainer(setup(['tinkaton', 'sylveon'], ['snorlax', 'blissey'], { A0: P(9, 8), A1: P(11, 4), D0: P(9, 5), D1: P(11, 1) }), 'A', 'lance');
    park(s, ['A0', 'A1', 'D0', 'D1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'A0').locked).toEqual([]);
    expect(unit(n, 'A0').hp).toBe(unit(n, 'A0').maxHp - 40);
    n = act(n, { type: 'trainerSpecial' });
    n = act(n, { type: 'useMove', unitId: 'A1', moveIndex: 1, dir: 'N' });
    // Hyper Beam: no "can't move next turn" under Lance; the hit pushes Blissey from (11,1) into the edge.
    expect(unit(n, 'A1').nextTurn.noMove).toBe(false);
    const blissey = unit(n, 'D1');
    expect(blissey.pos).toEqual(P(11, 0));
    expect(n.log.some((l) => l.text.includes('collision'))).toBe(true);
  });
});

describe('card updates (2026-11-09 card file)', () => {
  it('reads the new types and abilities', () => {
    expect(getCard('amoonguss').types).toEqual(['Grass', 'Poison']);
    expect(getCard('oricorio').types).toEqual(['Flying', 'Ghost']);
    expect(getCard('oricorio').moves[0]).toMatchObject({ name: 'Revelation Dance', type: 'Ghost' });
    expect(getCard('slowbro').ability).toBe('regenerator');
  });

  it('Celebrate: a KO lets Pikachu move and act again', () => {
    const s = setup(['pikachu'], ['snorlax', 'tauros'], { A0: P(8, 7), D0: P(8, 5), D1: P(8, 4) });
    park(s, ['A0', 'D0', 'D1']);
    unit(s, 'D0').hp = 1;
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').fainted).toBe(true);
    expect(unit(n, 'A0').activated).toBe(false);
    n = act(n, { type: 'move', unitId: 'A0', to: P(8, 6) });
    n = act(n, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D1').hp).toBeLessThan(unit(n, 'D1').maxHp);
    expect(unit(n, 'A0').activated).toBe(true);
  });

  it('Tailwind raises the whole team’s movement, to at most +1', () => {
    let s = setup(['whimsicott', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(2, 8) });
    park(s, ['A0', 'A1']);
    s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect([unit(s, 'A0').stages.mov, unit(s, 'A1').stages.mov, unit(s, 'D0').stages.mov]).toEqual([1, 1, 0]);
    s = act(act(s, { type: 'endTurn' }), { type: 'endTurn' });
    s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    expect([unit(s, 'A0').stages.mov, unit(s, 'A1').stages.mov]).toEqual([1, 1]);
  });

  it('Howl raises adjacent allies’ attack, not the user’s', () => {
    const s = setup(['arcanine', 'tauros'], ['snorlax'], { A0: P(9, 8), A1: P(10, 8) });
    park(s, ['A0', 'A1']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' });
    expect(unit(n, 'A1').stages.atk).toBe(1);
    expect(unit(n, 'A0').stages.atk).toBe(0);
    unit(s, 'A1').pos = P(2, 8);
    expect(targeting(s, unit(s, 'A0'), getCard('arcanine').moves[1], { dir: 'N' }).ok).toBe(false);
  });

  it('weather moves change attack by one stage, never past ±1', () => {
    let s = setup(['milotic'], ['arcanine'], { A0: P(9, 8), D0: P(9, 2) });
    park(s, ['A0', 'D0']);
    for (let i = 0; i < 2; i++) {
      s = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
      expect(unit(s, 'A0').stages.atk).toBe(1);
      expect(unit(s, 'D0').stages.atk).toBe(-1);
      s = act(act(s, { type: 'endTurn' }), { type: 'endTurn' });
    }
  });

  it('Sleep Powder always lands; Leaf Storm lowers the user’s attack by two', () => {
    const s = setup(['vivillon', 'meganium'], ['snorlax'], { A0: P(9, 8), A1: P(4, 8), D0: P(9, 7) });
    park(s, ['A0', 'A1', 'D0']);
    expect(unit(act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1, dir: 'N' }), 'D0').status).toBe('slp');
    unit(s, 'A1').pos = P(9, 8);
    unit(s, 'A0').pos = P(2, 8);
    expect(unit(act(s, { type: 'useMove', unitId: 'A1', moveIndex: 0, dir: 'N' }), 'A1').stages.atk).toBe(-2);
  });
});
