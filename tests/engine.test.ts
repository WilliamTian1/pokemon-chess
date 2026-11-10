import { describe, expect, it } from 'vitest';
import {
  CARD_LIST, DRAFTABLE, DRAFT_POOL_SIZE, MAPS, applyAction, bestHit, canStand, dangerZone, decider, defenseProfile,
  draftOptions, getCard, getUnit, hitMultiplier, isLegendPick, isNormalTerrain, moveOptions, newGame, parseGrid, previewAction, quickGame, reachable,
  seededRng, terrainAt, typeMultiplier, zoneTiles,
} from '../src/engine';
import { act, noLuck, park, scriptedRng, setup, unit } from './helpers';

describe('card data', () => {
  it('has the full pages 1–9 roster', () => {
    expect(CARD_LIST).toHaveLength(100);
    expect(DRAFTABLE).toHaveLength(98);
  });

  it('every grid parses with a user tile and at least one target', () => {
    for (const c of CARD_LIST) {
      for (const m of c.moves) {
        if (m.target.kind === 'grid' || m.target.kind === 'place') {
          const g = parseGrid(m.target.grid);
          expect(g.targets.length, `${c.name} ${m.name}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('derives knockback from red cells', () => {
    const roar = getCard('hydreigon').moves[1].target;
    expect(roar.kind === 'grid' && parseGrid(roar.grid).knockback).toBe(2);
    expect(parseGrid('.R./.O./.G.').knockback).toBe(1);
    expect(parseGrid('.R./ROR/OBO/.G.').dash).toEqual({ f: 1, s: 0 });
  });
});

describe('map', () => {
  const m = MAPS.meadow;
  it('is 14×9 with a trebuchet in the dirt square', () => {
    expect(m.width).toBe(14);
    expect(m.height).toBe(9);
    expect(m.trebuchets).toEqual([{ x: 10, y: 4 }]);
  });
  it('places spawns on dry land', () => {
    for (const side of ['A', 'D'] as const) {
      for (const p of m.spawns[side]) expect(m.tiles[p.y][p.x]).toBe('normal');
    }
  });
  it('marks Nixtorm as a snow map with ice terrain', () => {
    expect(MAPS.ice.theme).toBe('snow');
    expect(MAPS.ice.tiles.flat().some((t) => t === 'ice')).toBe(true);
  });
});

describe('type chart', () => {
  it('matches the rules page', () => {
    expect(typeMultiplier('Fire', ['Grass', 'Poison'])).toBe(2);
    expect(typeMultiplier('Electric', ['Ground', 'Flying'])).toBe(0);
    expect(typeMultiplier('Ice', ['Dragon', 'Flying'])).toBe(4);
    expect(typeMultiplier('Fighting', ['Poison', 'Flying'])).toBe(0.25);
  });
});

describe('damage pipeline', () => {
  it('applies type effectiveness', () => {
    const s = setup(['charizard'], ['venusaur'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 5 } });
    park(s, ['A0', 'D0']);
    const p = previewAction(s, 'A0', 0, { dir: 'N' });
    expect(p[0]).toMatchObject({ unitId: 'D0', min: 120, max: 120 });
  });

  it('rounds not-very-effective damage up to 5', () => {
    // Lumineon Chilling Water 20 vs Blastoise (Water): 20 × 0.5 = 10. Use Golisopod Liquidation 70 vs Kyogre: 35.
    const s = setup(['golisopod'], ['kyogre'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 5 } });
    park(s, ['A0', 'D0']);
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(35);
    unit(s, 'A0').stages.atk = -1; // 50 × 0.5 = 25
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(25);
    unit(s, 'A0').stages.atk = 0;
    unit(s, 'D0').stages.def = 1; // 50 × 0.5 = 25 ... (70-20)*.5
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(25);
  });

  it('floors damage at 10 before type effectiveness', () => {
    const s = setup(['lumineon'], ['snorlax'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 5 } });
    park(s, ['A0', 'D0']);
    unit(s, 'D0').stages.def = 3;
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(10);
  });

  it('graze ignores attack boosts', () => {
    const s = setup(['blastoise'], ['snorlax'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 5 } });
    park(s, ['A0', 'D0']);
    unit(s, 'A0').stages.atk = 2;
    const p = previewAction(s, 'A0', 0, { dir: 'N' })[0];
    expect(p.max).toBe(100); // 60 + 40
    expect(p.min).toBe(20); // graze for 20, boosts ignored
  });

  it('Thick Fat halves fire damage and Multiscale reduces at full HP', () => {
    const s = setup(['charizard'], ['snorlax', 'dragonite'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 5 }, D1: { x: 8, y: 2 } });
    park(s, ['A0', 'D0', 'D1']);
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(30);
    s.units.find((u) => u.id === 'D0')!.pos = { x: 1, y: 1 };
    const t = unit(s, 'D1');
    t.pos = { x: 7, y: 3 };
    // Flamethrower 60 vs Dragonite (Dragon/Flying): (60 - 30 Multiscale) × 0.5 = 15
    expect(previewAction(s, 'A0', 0, { dir: 'N' })[0].min).toBe(15);
  });

  it('bush tiles reduce damage by 30', () => {
    const s = setup(['tauros'], ['snorlax'], { A0: { x: 7, y: 6 }, D0: { x: 7, y: 4 } });
    park(s, ['A0', 'D0']);
    expect(terrainAt(s, { x: 7, y: 4 })).toBe('bush');
    // Hyper Beam 95 - 30 bush = 65
    expect(previewAction(s, 'A0', 1, { dir: 'N' })[0].min).toBe(65);
  });
});

describe('movement', () => {
  it('slides across ice to clear ground and stops at a Pokémon blocking the slide', () => {
    const s = setup(['tauros'], [], {
      A0: { x: 4, y: 6 }, A1: null, A2: null, A3: null,
      D0: null, D1: null, D2: null, D3: null,
    }, { mapId: 'ice' });
    const reach = reachable(s, unit(s, 'A0'), 3);
    expect(reach.get('11,6')).toMatchObject({
      iceStopped: true,
      cost: 1,
      path: [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }],
    });
    expect(reach.has('8,6')).toBe(false);

    unit(s, 'D0').fainted = false;
    unit(s, 'D0').hp = unit(s, 'D0').maxHp;
    unit(s, 'D0').pos = { x: 8, y: 6 };
    const blocked = reachable(s, unit(s, 'A0'), 3);
    expect(blocked.get('7,6')?.iceStopped).toBe(true);
    expect(blocked.has('8,6')).toBe(false);
  });

  it('lets Flying Pokémon cross ice normally and preserves Run Away after attacking from an ice slide', () => {
    const flier = setup(['charizard'], [], {
      A0: { x: 4, y: 6 }, A1: null, A2: null, A3: null, D0: null, D1: null, D2: null, D3: null,
    }, { mapId: 'ice' });
    expect(reachable(flier, unit(flier, 'A0'), 3).get('7,6')?.iceStopped).toBeUndefined();

    const s = setup(['furret'], ['snorlax'], {
      A0: { x: 4, y: 6 }, A1: null, A2: null, A3: null,
      D0: { x: 11, y: 5 }, D1: null, D2: null, D3: null,
    }, { mapId: 'ice' });
    const moved = act(s, { type: 'move', unitId: 'A0', to: { x: 11, y: 6 } });
    expect(unit(moved, 'A0').pos).toEqual({ x: 11, y: 6 });
    expect(moved.active?.moveCost).toBe(1);
    const attacked = act(moved, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(attacked.active).toMatchObject({ stage: 'acted', postMove: 2 });
    const finished = act(attacked, { type: 'postMove', unitId: 'A0', to: { x: 12, y: 6 } });
    expect(unit(finished, 'A0').pos).toEqual({ x: 12, y: 6 });
    expect(finished.active).toBeNull();
  });

  it('only lets water types and fliers onto water', () => {
    const s = setup(['venusaur', 'blastoise', 'charizard'], []);
    const t = { x: 1, y: 3 } as const;
    expect(terrainAt(s, t)).toBe('water');
    expect(canStand(unit(s, 'A0'), 'water')).toBe(false);
    expect(canStand(unit(s, 'A1'), 'water')).toBe(true);
    expect(canStand(unit(s, 'A2'), 'water')).toBe(true);
  });

  it('passes through allies but not enemies', () => {
    const s = setup(['tauros', 'furret'], ['snorlax'], { A0: { x: 8, y: 6 }, A1: { x: 8, y: 5 }, D0: { x: 7, y: 6 } });
    park(s, ['A0', 'A1', 'D0']);
    const r = reachable(s, unit(s, 'A0'), 2);
    expect(r.has('8,4')).toBe(true); // through the ally at (8,5)
    expect(r.has('6,6')).toBe(false); // blocked by the enemy at (7,6) and no way around in 2
  });

  it('Wave Rider halves water cost', () => {
    const s = setup(['lapras'], [], { A0: { x: 5, y: 6 } });
    park(s, ['A0']);
    const r = reachable(s, unit(s, 'A0'), 2);
    // (5,5)w (5,4)w (6,4)w: 1.5 movement
    expect(r.get('6,4')?.cost).toBe(1.5);
  });
});

describe('targeting', () => {
  it('rotates grids to the facing direction', () => {
    const s = setup(['charizard'], [], { A0: { x: 4, y: 6 } });
    const g = parseGrid('.O./.O./.O./.G.');
    expect(zoneTiles(s, { x: 4, y: 6 }, g, 'E')).toEqual([{ x: 7, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 6 }]);
    expect(zoneTiles(s, { x: 4, y: 6 }, g, 'S')).toEqual([{ x: 4, y: 8 }, { x: 4, y: 7 }]);
  });

  it('needs at least one Pokémon in the zone', () => {
    const s = setup(['charizard'], [], { A0: { x: 4, y: 6 } });
    park(s, ['A0']);
    expect(() => act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' })).toThrow(/No Pokémon/);
  });
});

describe('special mechanics', () => {
  it('dash moves the user, knockback pushes the target', () => {
    const s = setup(['heracross'], ['snorlax'], { A0: { x: 8, y: 7 }, D0: { x: 8, y: 5 } });
    park(s, ['A0', 'D0']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'A0').pos).toEqual({ x: 8, y: 6 });
    expect(unit(n, 'D0').pos).toEqual({ x: 8, y: 4 });
    expect(unit(n, 'D0').stages.atk).toBe(-1);
  });

  it('Sturdy endures a one-hit KO from full HP', () => {
    // Groudon's Precipice Blades: 115 Ground vs Rock ×2 = 230 > 145.
    const s = setup(['groudon'], ['sudowoodo'], { A0: { x: 8, y: 7 }, D0: { x: 8, y: 5 } });
    park(s, ['A0', 'D0']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    expect(unit(n, 'D0').hp).toBe(1);
    expect(unit(n, 'D0').fainted).toBe(false);
  });

  it('Shields Down turns Minior into its Core form instead of fainting', () => {
    // Raichu's Thunderbolt: 50 Electric vs Rock/Flying ×2 = 100 > 90.
    const s = setup(['raichu'], ['minior'], { A0: { x: 8, y: 7 }, D0: { x: 8, y: 5 } });
    park(s, ['A0', 'D0']);
    const n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 0, dir: 'N' });
    const m = unit(n, 'D0');
    expect(m.cardId).toBe('minior-core');
    expect(m.hp).toBe(50);
  });

  it('paths avoid spikes when possible and landing on them hurts', () => {
    const s = setup(['tauros'], ['snorlax'], { A0: { x: 8, y: 7 } });
    park(s, ['A0']);
    s.hazards.push({ kind: 'spikes', pos: { x: 8, y: 6 } });
    const around = act(s, { type: 'move', unitId: 'A0', to: { x: 8, y: 5 } });
    expect(unit(around, 'A0').hp).toBe(140);
    const onto = act(s, { type: 'move', unitId: 'A0', to: { x: 8, y: 6 } });
    expect(unit(onto, 'A0').hp).toBe(110);
    expect(() => act(onto, { type: 'undoMove', unitId: 'A0' })).toThrow(/hazard/);
  });

  it('Future Sight lands at the start of the user’s next turn', () => {
    const s = setup(['slowbro', 'furret'], ['snorlax', 'tauros'], { A0: { x: 4, y: 6 }, A1: { x: 4, y: 5 }, D0: { x: 6, y: 6 }, D1: { x: 12, y: 1 } });
    park(s, ['A0', 'A1', 'D0', 'D1']);
    let n = act(s, { type: 'useMove', unitId: 'A0', moveIndex: 1 });
    n = act(n, { type: 'endTurn' });
    n = act(n, { type: 'endTurn' });
    expect(unit(n, 'D0').hp).toBe(260 - 100);
    expect(unit(n, 'A1').hp).toBe(120 - 100);
    expect(unit(n, 'D1').hp).toBe(140);
  });

  it('Follow Me forces opponents that can reach the user', () => {
    const s = setup(['tauros'], ['clefable', 'snorlax'], { A0: { x: 8, y: 7 }, D0: { x: 8, y: 4 }, D1: { x: 9, y: 5 } });
    park(s, ['A0', 'D0', 'D1']);
    s.side = 'D';
    for (const u of s.units) u.activated = false;
    let n = act(s, { type: 'useMove', unitId: 'D0', moveIndex: 1 });
    n = act(n, { type: 'endTurn' });
    // Tauros could hit Snorlax with Body Slam from (9,7) but must aim at Clefable.
    expect(() => act(n, { type: 'endTurn' })).toThrow(/Follow Me/);
    expect(() => act(n, { type: 'move', unitId: 'A0', to: { x: 11, y: 7 } })).toThrow(/Follow Me/);
  });

  it('paralysis, sleep and burn behave per the rules', () => {
    const s = setup(['charizard'], ['snorlax'], { A0: { x: 8, y: 7 }, D0: { x: 8, y: 6 } });
    park(s, ['A0', 'D0']);
    unit(s, 'D0').status = 'brn';
    unit(s, 'A0').status = 'slp';
    // End A's turn; D's burned Snorlax ticks 20 at the end of its activation.
    let n = act(s, { type: 'endTurn' });
    n = act(n, { type: 'endTurn' });
    expect(unit(n, 'D0').hp).toBe(240);
    // A's sleeping Charizard rolls 1 (scripted) and stays asleep.
    expect(unit(n, 'A0').turn.noAct).toBe(true);
    const woke = applyAction(act(s, { type: 'endTurn' }), { type: 'endTurn' }, scriptedRng([], [6])).state;
    expect(unit(woke, 'A0').status).toBe(null);
  });

  it('the Defender wins when round 10 ends', () => {
    let s = setup(['furret'], ['snorlax']);
    s.round = 10;
    s = act(s, { type: 'endTurn' });
    expect(s.phase).toBe('battle');
    s = act(s, { type: 'endTurn' });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('D');
  });
});

describe('full flow', () => {
  it('drafts, places and starts the battle with start-of-battle abilities', () => {
    const rng = seededRng(3);
    // A, D, A, D, A, D from the normal pool, then one legendary each.
    const picks = ['tyranitar', 'charizard', 'sudowoodo', 'furret', 'tauros', 'snorlax', 'mewtwo', 'kyogre'];
    let s = newGame({ rng, pool: picks.slice(0, 6), legendPool: ['mewtwo', 'kyogre', 'lunala', 'zekrom'] });
    for (const c of picks) s = applyAction(s, { type: 'draftPick', cardId: c }, rng).state;
    expect(s.phase).toBe('placement');
    expect(() => applyAction(s, { type: 'draftPick', cardId: 'pikachu' }, rng)).toThrow();
    const m = MAPS.meadow;
    for (let i = 0; i < 8; i++) {
      const side = s.placement.order[i];
      const n = Math.floor(i / 2);
      s = applyAction(s, { type: 'place', unitId: `${side}${n}`, pos: m.spawns[side][n] }, rng).state;
    }
    expect(s.phase).toBe('battle');
    expect(s.maxRounds).toBe(10);
    expect(getUnit(s, 'A0').stages.def).toBe(1); // Tyranitar: Sand Stream
    expect(getUnit(s, 'A1').stages.def).toBe(1); // Sudowoodo is Rock
    expect(getUnit(s, 'D3').stages.atk).toBe(1); // Kyogre: Drizzle on itself
    expect(getUnit(s, 'D0').stages.atk).toBe(-1); // Charizard: Fire under Drizzle
  });

  it('both sides can act from round 1', () => {
    let s = quickGame(['charizard', 'furret', 'tauros', 'snorlax'], ['blissey', 'dodrio', 'cinccino', 'staraptor'], { rng: seededRng(4) });
    expect(s.round).toBe(1);
    const a = getUnit(s, 'A0');
    expect(a.turn.noAct).toBe(false);
    expect(a.turn.noMove).toBe(false);
    // Furret's Follow Me targets itself, so it is usable from the spawn.
    expect(moveOptions(s, getUnit(s, 'A1')).some((o) => o.usable)).toBe(true);
    s = applyAction(s, { type: 'endTurn' }, seededRng(1)).state;
    expect(s.round).toBe(1);
    expect(getUnit(s, 'D0').turn.noAct).toBe(false);
  });

  it('the trebuchet is a flat 40 before type effectiveness', () => {
    const s = setup(['tauros'], ['gengar', 'snorlax'], { A0: { x: 10, y: 4 }, D0: { x: 3, y: 3 }, D1: { x: 6, y: 2 } });
    const tauros = getUnit(s, 'A0');
    tauros.stages.atk = 3;
    getUnit(s, 'D1').stages.def = 3;
    const [hit] = previewAction(s, 'A0', 'treb', { targetId: 'D1' });
    expect(hit.max).toBe(40);
    const [ghost] = previewAction(s, 'A0', 'treb', { targetId: 'D0' });
    expect(ghost.kind).toBe('immune');
  });

  it('the trebuchet fires as whichever of the user\'s types does the most damage', () => {
    const s = setup(['charizard'], ['lurantis', 'blastoise'], { A0: { x: 10, y: 4 }, D0: { x: 3, y: 3 }, D1: { x: 6, y: 2 } });
    // Fire and Flying are both 2× against Grass: one type, 40 × 2.
    expect(previewAction(s, 'A0', 'treb', { targetId: 'D0' })[0].max).toBe(80);
    // Against Water, Flying (1×) beats Fire (½×).
    expect(previewAction(s, 'A0', 'treb', { targetId: 'D1' })[0].max).toBe(40);
    // Volcarona (Fire/Bug) at Scizor (Steel/Bug): Fire is 4×, Bug only ½×.
    const v = setup(['volcarona'], ['scizor'], { A0: { x: 10, y: 4 }, D0: { x: 3, y: 3 } });
    park(v, ['A0', 'D0']);
    const [hit] = previewAction(v, 'A0', 'treb', { targetId: 'D0' });
    expect(hit.max).toBe(160);
    expect(hit.notes).toContain('as Fire');
    const after = applyAction(v, { type: 'trebuchet', unitId: 'A0', targetId: 'D0' }, noLuck()).state;
    expect(unit(after, 'D0').fainted).toBe(true);
    expect(after.log.some((l) => l.text.includes('fired the trebuchet') && l.text.includes('(Fire)'))).toBe(true);
    // A type the target is immune to isn't used when the other can hit: Gengar's Poison hits Snorlax.
    const g = setup(['gengar'], ['snorlax'], { A0: { x: 10, y: 4 }, D0: { x: 3, y: 3 } });
    park(g, ['A0', 'D0']);
    expect(previewAction(g, 'A0', 'treb', { targetId: 'D0' })[0]).toMatchObject({ kind: 'damage', max: 40 });
  });

  it('noLuck helper never procs', () => {
    expect(noLuck().chance(0.9)).toBe(false);
  });
});

describe('draft pool and coin flip', () => {
  it('draws 15 distinct draftable cards per match, and only those can be drafted', () => {
    const a = newGame({ rng: seededRng(1) });
    const b = newGame({ rng: seededRng(2) });
    expect(a.draft.pool).toHaveLength(DRAFT_POOL_SIZE);
    expect(new Set(a.draft.pool).size).toBe(DRAFT_POOL_SIZE);
    expect(a.draft.pool.every((id) => getCard(id).draftable)).toBe(true);
    expect(a.draft.pool).not.toEqual(b.draft.pool);
    const outside = DRAFTABLE.find((c) => !a.draft.pool.includes(c.id))!;
    expect(() => applyAction(a, { type: 'draftPick', cardId: outside.id }, noLuck())).toThrow(/not in this match's draft pool/);
  });

  it('the Attacker places first, then placement alternates', () => {
    const picks = ['tyranitar', 'charizard', 'sudowoodo', 'furret', 'tauros', 'snorlax', 'mewtwo', 'kyogre'];
    const rng = seededRng(4);
    let s = newGame({ rng, pool: picks.slice(0, 6), legendPool: picks.slice(6) });
    for (const c of picks) s = applyAction(s, { type: 'draftPick', cardId: c }, rng).state;
    expect(decider(s)).toBe('A');
    expect(s.placement.order).toEqual(['A', 'D', 'A', 'D', 'A', 'D', 'A', 'D']);
  });

  it('drafts three from the normal pool each, then one legendary each', () => {
    let s = newGame({ rng: seededRng(8) });
    expect(s.draft.pool).toHaveLength(15);
    expect(s.draft.legendPool).toHaveLength(4);
    expect(s.draft.pool.some((id) => getCard(id).legendary)).toBe(false);
    expect(s.draft.legendPool.every((id) => getCard(id).legendary)).toBe(true);
    expect(() => applyAction(s, { type: 'draftPick', cardId: s.draft.legendPool[0] }, noLuck())).toThrow(/Legendaries are drafted last/);
    for (let i = 0; i < 6; i++) s = applyAction(s, { type: 'draftPick', cardId: draftOptions(s)[0] }, noLuck()).state;
    expect(draftOptions(s)).toEqual(s.draft.legendPool);
    expect(() => applyAction(s, { type: 'draftPick', cardId: s.draft.pool[10] }, noLuck())).toThrow(/legendaries/);
    s = applyAction(s, { type: 'draftPick', cardId: s.draft.legendPool[2] }, noLuck()).state;
    s = applyAction(s, { type: 'draftPick', cardId: s.draft.legendPool[0] }, noLuck()).state;
    expect(s.phase).toBe('placement');
    expect(getCard(s.draft.picks.A[3]).legendary && getCard(s.draft.picks.D[3]).legendary).toBe(true);
  });
});

describe('matchups and danger zone', () => {
  it('folds type-based abilities into the matchup helpers', () => {
    const lev = CARD_LIST.find((c) => c.ability === 'levitate')!;
    expect(hitMultiplier('Ground', lev)).toBe(0);
    expect(defenseProfile(lev).find((x) => x.type === 'Ground')?.mult).toBe(0);
    const fat = CARD_LIST.find((c) => c.ability === 'thickFat')!;
    expect(hitMultiplier('Fire', fat)).toBe(typeMultiplier('Fire', fat.types) * 0.5);
    expect(bestHit(getCard('pikachu'), getCard('gyarados'))?.mult).toBe(4);
  });

  it('marks every tile an opponent could hit after moving', () => {
    const s = setup(['furret'], ['snorlax'], { A0: { x: 1, y: 7 }, D0: { x: 7, y: 3 } });
    park(s, ['A0', 'D0']);
    const dz = dangerZone(s, 'D');
    const snorlax = unit(s, 'D0');
    const reach = reachable(s, snorlax, getCard('snorlax').mov);
    // Body Slam dashes one tile and hits the next, so the zone reaches past where Snorlax can walk.
    const keys = [...dz.tiles].filter(([, list]) => list.some((x) => x.unitId === 'D0')).map(([k]) => k);
    expect(keys.some((k) => !reach.has(k) && k !== '7,3')).toBe(true);
    for (const k of keys) {
      const [x, y] = k.split(',').map(Number);
      expect(Math.abs(x - 7) + Math.abs(y - 3)).toBeLessThanOrEqual(getCard('snorlax').mov + 2);
    }
    expect(dz.tiles.has('1,7')).toBe(false);
  });
});

describe('Winding River map', () => {
  const m = MAPS.river;
  it('has open spawns, a trebuchet on land and walkable bridges', () => {
    expect(m.width).toBe(12);
    expect(m.height).toBe(10);
    for (const p of [...m.spawns.A, ...m.spawns.D]) expect(m.tiles[p.y][p.x]).toBe('normal');
    expect(m.trebuchets).toEqual([{ x: 4, y: 4 }]);
    // Bridges are drawn as wood but play as plain ground: (10,1), (4,2), (7,2), (1,3), (1,5), (4,6), (7,7), (8,7), (10,8).
    for (const [x, y] of [[10, 1], [4, 2], [7, 2], [1, 3], [1, 5], [4, 6], [7, 7], [8, 7], [10, 8]]) {
      expect(m.tiles[y][x]).toBe('bridge');
      expect(isNormalTerrain(m.tiles[y][x])).toBe(true);
    }
  });

  it('lets a land Pokémon walk from the Attackers to the Defenders over the bridges', () => {
    const s = quickGame(['snorlax', 'furret', 'tauros', 'blissey'], ['dodrio', 'cinccino', 'staraptor', 'slaking'], { rng: seededRng(2), mapId: 'river' });
    const u = getUnit(s, 'A0');
    u.pos = { x: 3, y: 9 };
    expect(reachable(s, u, 30).has('3,1')).toBe(true);
  });
});

describe('draft without legendaries', () => {
  it('drafts all eight picks from the normal pool and refuses legendaries', () => {
    let s = newGame({ rng: seededRng(4), legendaries: false });
    expect(s.draft.legendPool).toEqual([]);
    expect(s.draft.pool).toHaveLength(20);
    expect(() => applyAction(s, { type: 'draftPick', cardId: 'mewtwo' }, noLuck())).toThrow(/without legendaries/);
    for (let i = 0; i < 8; i++) {
      expect(isLegendPick(s)).toBe(false);
      s = applyAction(s, { type: 'draftPick', cardId: draftOptions(s)[0] }, noLuck()).state;
    }
    expect(s.phase).toBe('placement');
    expect([...s.draft.picks.A, ...s.draft.picks.D].every((id) => s.draft.pool.includes(id))).toBe(true);
  });
});
