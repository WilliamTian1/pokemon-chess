import type { AbilityId, CardDef, MoveDef, MoveFx, PType, TargetSpec } from '../types';

// Transcribed from `Conquest Cards.pdf` (2026-11-09 edition): pages 1–9 are the v1.2 roster, 10–12
// the expansion, and Wigglytuff is on page 13 (otherwise a work-in-progress page). Moves are listed in
// the order they appear on the card (top first) — Foul Play reads the target's *first* attack.

const grid = (g: string): TargetSpec => ({ kind: 'grid', grid: g });
const SELF: TargetSpec = { kind: 'self' };
const GLOBAL: TargetSpec = { kind: 'global' };

function atk(name: string, type: PType, power: number | null, target: TargetSpec, text: string, fx: MoveFx = {}): MoveDef {
  return { name, type, power, kind: 'attack', target, text, fx };
}
function sts(name: string, target: TargetSpec, text: string, fx: MoveFx = {}): MoveDef {
  return { name, type: null, power: null, kind: 'status', target, text, fx };
}

interface CardInput {
  id: string;
  name: string;
  types: PType[];
  hp: number;
  mov: number;
  page: number;
  moves: [MoveDef, MoveDef];
  ability: [AbilityId, string, string];
  draftable?: boolean;
  formOf?: string;
  formLabel?: string;
  forms?: string[];
  notes?: string[];
}

/** Page 7 of the card PDF. */
const LEGENDARIES = new Set(['lunala', 'yveltal', 'mewtwo', 'zekrom', 'rayquaza', 'reshiram', 'kyogre', 'groudon']);

function card(c: CardInput): CardDef {
  const { ability, ...rest } = c;
  return {
    ...rest, ability: ability[0], abilityName: ability[1], abilityText: ability[2], draftable: c.draftable ?? true,
    legendary: LEGENDARIES.has(c.id),
  };
}

// Shared move texts / definitions used by several cards.
const QUIVER_DANCE = sts('Quiver Dance', SELF, 'Raises the user’s attack, defense, and mov by one stage.', {
  selfStages: { stages: { atk: 1, def: 1, mov: 1 } },
});
const TAILWIND = sts('Tailwind', GLOBAL, 'Raises the movement speed of all allies and this pokemon by one stage to a maximum of one stage.', {
  special: 'tailwind',
});
const HAZE = sts('Haze', grid('OOO/OOO/.../.G.'), 'The target(s) have their stat changes reset.', { resetTargetStages: true });
const FOLLOW_ME_TEXT = 'During your opponent’s next turn, any pokemon who can target this pokemon must do so.';
const ALLY_SWITCH = sts('Ally Switch', { kind: 'ally' }, 'The user switches positions with an ally.', { special: 'allySwitch' });
const SPIKES_TEXT = 'Places spikes down. Cannot be used if a pokemon or hazard is in the way, or 5 spikes are on the field.';
const FOUL_PLAY = (): MoveDef => ({
  ...atk('Foul Play', 'Dark', null, grid('.../.O./.G.'),
    'Uses the base power of the opponent’s first attack. Uses the Opponent’s attack changes instead of the user’s.',
    { special: 'foulPlay' }),
  powerLabel: '?',
});
const DRAGON_PULSE = (power: number) => atk('Dragon Pulse', 'Dragon', power, grid('.O./.O./.O./.G.'), '');
const METEOR_BEAM = (power: number) => atk('Meteor Beam', 'Rock', power, grid('.O./.O./.O./.G.'),
  'Raises the user’s attack by one stage before attacking. The user cannot move or act next turn.',
  { preSelfStages: { atk: 1 }, nextTurn: { noMove: true, noAct: true } });
const U_TURN = (power: number) => atk('U-turn', 'Bug', power, grid('.O./.B./.G.'),
  'The user can move 3 spaces immediately after using this attack.', { postMove: 3 });
const PSYCHIC = (power: number, text: string) => atk('Psychic', 'Psychic', power, grid('.O./O.O/.O./.G.'), text, {
  targetStages: { stages: { def: -1 }, chance: 0.1 },
});

const A = {
  solarPower: ['solarPower', 'Solar Power', 'This pokemon deals 30 extra damage when attacking beside a fire type pokemon or on a magma tile.'],
  rainDish: ['rainDish', 'Rain Dish', 'This pokemon recovers 30 hp every turn when on a water tile or standing next to a water type pokemon.'],
  chlorophyll: ['chlorophyll', 'Chlorophyll', 'This pokemon gains 2 Mov when next to a fire type.'],
  static: ['static', 'Static', 'When a pokemon adjacent to this pokemon hits this pokemon, it has a 30% chance of being paralyzed.'],
  thickFat: ['thickFat', 'Thick Fat', 'This pokemon takes half damage from ice and fire type moves.'],
  tintedLens: ['tintedLens', 'Tinted Lens', 'This pokemon’s attacks cannot be resisted.'],
  multiscale: ['multiscale', 'Multiscale', 'This pokemon takes 30 less damage when at full hp.'],
  sandStream: ['sandStream', 'Sand Stream', 'All rock types start the battle with a one stage defense boost.'],
  clearBody: ['clearBody', 'Clear Body', 'This pokemon cannot have its stats lowered.'],
  sereneGrace: ['sereneGrace', 'Serene Grace', 'Adjacent allies have the chance of secondary effects on their moves doubled.'],
  intimidate: ['intimidate', 'Intimidate', 'Opposing pokemon adjacent to this pokemon deal 30 less damage per attack.'],
  shadowDash: ['shadowDash', 'Shadow Dash', '+2 mov when over 3 spaces away from any allies.'],
  angerPoint: ['angerPoint', 'Anger Point', 'If this pokemon’s stats get lowered, its attack gets boosted to its maximum.'],
  levitate: ['levitate', 'Levitate', 'This pokemon is immune to ground type attacks.'],
  technician: ['technician', 'Technician', 'Moves used by this pokemon and adjacent allies that have 40 base power or less do 30 extra damage.'],
  unaware: ['unaware', 'Unaware', 'This pokemon ignores opponent stat changes when attacking and getting hit by attacks.'],
  resistance: ['resistance', 'Resistance', 'This pokemon takes 40 less damage from attacks done from afar, but 20 more damage from up close attacks.'],
  synchronize: ['synchronize', 'Synchronize', 'When an opposing pokemon gives this pokemon a status condition, they receive the status condition as well.'],
  runAway: ['runAway', 'Run Away', 'This pokemon can use its unused movement after acting.'],
  regenerator: ['regenerator', 'Regenerator', 'This pokemon gets healed by 30 hp every time it ends its turn with no enemies within 3 spaces of it.'],
  sturdy: ['sturdy', 'Sturdy', 'This pokemon cannot be knocked out in one hit. If all of their health is taken in one attack, they will faint the next time they are hurt.'],
  moxie: ['moxie', 'Moxie', 'The user’s attack goes up after KOing an opponent.'],
  guts: ['guts', 'Guts', 'The user deals 30 extra damage per attack if they have a status condition. Ignores the attack drop from burns.'],
  contrary: ['contrary', 'Contrary', 'Stat boosts and drops applied to this pokemon are reversed.'],
  infiltrator: ['infiltrator', 'Infiltrator', 'The pokemon ignores opponent’s defense boosts, whether by stat changes or abilities.'],
  moldBreaker: ['moldBreaker', 'Mold Breaker', 'Opponents’ abilities are ignored when this pokemon attacks them.'],
  compoundEyes: ['compoundEyes', 'Compound Eyes', 'This pokemon and adjacent allies cannot miss their attacks.'],
  competitive: ['competitive', 'Competitive', 'If this pokemon has their stats lowered by another pokemon, max out their attack.'],
} satisfies Record<string, [AbilityId, string, string]>;

// Expansion moves shared by several cards.
const FAKE_OUT = (g: string) => atk('Fake Out', 'Normal', 20, grid(g),
  'The target flinches. This attack cannot be used again until this pokemon ends their turn 4+ tiles away from opponents.',
  { flinch: { chance: 1 }, lockUntilFar: 4 });
const HELPING_HAND = sts('Helping Hand', grid('.../.O./.G.'), 'The target deals 30 extra damage this turn.', { special: 'helpingHand' });
/** Fills the second move slot of a card that prints only one move. */
const NO_MOVE: MoveDef = { name: '—', type: null, power: null, kind: 'status', target: SELF, text: '', fx: { none: true } };

export const CARD_LIST: CardDef[] = [
  // ------------------------------------------------------------ page 1
  card({
    id: 'charizard', name: 'Charizard', types: ['Fire', 'Flying'], hp: 145, mov: 3, page: 1,
    moves: [
      atk('Flamethrower', 'Fire', 60, grid('.O./.O./.O./.G.'), '10% chance to burn the target.', { status: { id: 'brn', chance: 0.1 } }),
      atk('Dragon Rush', 'Dragon', 60, grid('.O./OBO/.G.'), '20% chance to graze and deal 25 damage. 20%, if the attack hits, to make the target flinch.', {
        graze: { chance: 0.2, power: 25 }, flinch: { chance: 0.2, noGraze: true },
      }),
    ],
    ability: A.solarPower,
  }),
  card({
    id: 'blastoise', name: 'Blastoise', types: ['Water'], hp: 175, mov: 3, page: 1,
    moves: [
      atk('Hydro Pump', 'Water', 60, grid('.O./.O./.O./.G.'), '20% chance to graze and deal 20 damage.', { graze: { chance: 0.2, power: 20 } }),
      sts('Shell Smash', SELF, 'Lowers defense by one stage, but raises attack by two stages and raises movement speed by one.', {
        selfStages: { stages: { def: -1, atk: 2, mov: 1 } },
      }),
    ],
    ability: A.rainDish,
  }),
  card({
    id: 'venusaur', name: 'Venusaur', types: ['Grass', 'Poison'], hp: 160, mov: 3, page: 1,
    moves: [
      atk('Solar Beam', 'Grass', 75, grid('.O./OOO/.O./.G.'), 'The user must recharge the next turn, unless they are adjacent to a fire type pokemon.', {
        nextTurn: { noMove: true, noAct: true, unlessAdjFire: true, droughtSkips: true },
      }),
      atk('Acid Spray', 'Poison', 25, grid('.O./.O./.G.'), 'Lowers the target’s defense by 2 stages.', { targetStages: { stages: { def: -2 }, chance: 1 } }),
    ],
    ability: A.chlorophyll,
  }),
  card({
    id: 'raichu', name: 'Raichu', types: ['Electric'], hp: 105, mov: 4, page: 1,
    moves: [
      atk('Thunderbolt', 'Electric', 50, grid('OOO/.../.G.'), '10% chance to paralyze the target.', { status: { id: 'par', chance: 0.1 } }),
      atk('Volt Tackle', 'Electric', 70, grid('.O./OBO/.G.'), 'Deals 20 recoil damage.', { recoil: 20 }),
    ],
    ability: A.static,
  }),
  card({
    id: 'mamoswine', name: 'Mamoswine', types: ['Ground', 'Ice'], hp: 160, mov: 3, page: 1,
    moves: [
      atk('High Horsepower', 'Ground', 75, grid('.O./OBO/.G.'), ''),
      atk('Icicle Spear', 'Ice', 30, grid('.O./.O./.G.'), 'Roll a 6 sided die and add the result * 10 in addition to the base damage of this move.', { dice: true }),
    ],
    ability: A.thickFat,
  }),
  card({
    id: 'butterfree', name: 'Butterfree', types: ['Bug', 'Flying'], hp: 100, mov: 3, page: 1,
    moves: [
      atk('Pollen Puff', 'Bug', 50, grid('OOO/OOO/.../.G.'), 'Heals allies hit by 50 instead of damaging them.', { allyHeal: 50 }),
      QUIVER_DANCE,
    ],
    ability: A.tintedLens,
  }),
  card({
    id: 'dragonite', name: 'Dragonite', types: ['Dragon', 'Flying'], hp: 185, mov: 3, page: 1,
    moves: [
      atk('Breaking Swipe', 'Dragon', 50, grid('.../OOO/.G.'), 'Lowers the target’s attack by one stage.', { targetStages: { stages: { atk: -1 }, chance: 1 } }),
      atk('Draco Meteor', 'Dragon', 105, grid('.O./OOO/.O./.G.'), '10% chance to graze and deal 30 damage. Either way, lowers the user’s attack by two stages.', {
        graze: { chance: 0.1, power: 30 }, selfStages: { stages: { atk: -2 } },
      }),
    ],
    ability: A.multiscale,
  }),
  card({
    id: 'tyranitar', name: 'Tyranitar', types: ['Dark', 'Rock'], hp: 210, mov: 2, page: 1,
    moves: [
      atk('Stone Edge', 'Rock', 80, grid('.O./OOO/.O./.G.'), '20% chance to graze and deal 35 damage.', { graze: { chance: 0.2, power: 35 } }),
      atk('Crunch', 'Dark', 65, grid('.../.O./.G.'), '20% chance to lower the opponent’s defense stat by one stage.', { targetStages: { stages: { def: -1 }, chance: 0.2 } }),
    ],
    ability: A.sandStream,
  }),
  card({
    id: 'metagross', name: 'Metagross', types: ['Steel', 'Psychic'], hp: 185, mov: 3, page: 1,
    moves: [
      atk('Meteor Mash', 'Steel', 80, grid('.R./.O./.G.'), '20% chance to raise the user’s attack stat.', { selfStages: { stages: { atk: 1 }, chance: 0.2 } }),
      atk('Psychic Fangs', 'Psychic', 75, grid('.../O.O/.G.'), 'Ignores and removes any defense boosts that the target(s) have.', { ignoreDefBoosts: true, removeDefBoosts: true }),
    ],
    ability: A.clearBody,
  }),
  // ------------------------------------------------------------ page 2
  card({
    id: 'togekiss', name: 'Togekiss', types: ['Fairy', 'Flying'], hp: 190, mov: 3, page: 2,
    moves: [atk('Dazzling Gleam', 'Fairy', 60, grid('OOO/OOO/.../.G.'), ''), ALLY_SWITCH],
    ability: A.sereneGrace,
  }),
  card({
    id: 'scrafty', name: 'Scrafty', types: ['Dark', 'Fighting'], hp: 170, mov: 2, page: 2,
    moves: [
      atk('Brick Break', 'Fighting', 40, grid('.../.O./.G.'), 'Ignores and removes any defense buffs that the target has.', { ignoreDefBoosts: true, removeDefBoosts: true }),
      sts('Parting Shot', grid('.O./.../.G.'), 'Lowers the opponent’s defense by one stage. The user can move three more spaces after this move.', {
        targetStages: { stages: { def: -1 }, chance: 1 }, postMove: 3,
      }),
    ],
    ability: A.intimidate,
  }),
  card({
    id: 'gengar', name: 'Gengar', types: ['Ghost', 'Poison'], hp: 105, mov: 4, page: 2,
    moves: [
      atk('Shadow Ball', 'Ghost', 65, grid('.R./.O./.../.G.'), '20% chance to lower the target’s defense.', { targetStages: { stages: { def: -1 }, chance: 0.2 } }),
      sts('Will-O-Wisp', grid('.O./.../.G.'), '80% chance to hit. Burns the target. Fire types are immune.', { hitChance: 0.8, status: { id: 'brn', chance: 1 } }),
    ],
    ability: A.shadowDash,
  }),
  card({
    id: 'staraptor', name: 'Staraptor', types: ['Normal', 'Flying'], hp: 130, mov: 3, page: 2,
    moves: [
      atk('Brave Bird', 'Flying', 90, grid('.O./OBO/.G.'), 'Deals 30 recoil damage.', { recoil: 30 }),
      atk('Close Combat', 'Fighting', 70, grid('.O./OBO/.G.'), 'Lowers the user’s defense by one stage.', { selfStages: { stages: { def: -1 } } }),
    ],
    ability: A.intimidate,
  }),
  card({
    id: 'dewgong', name: 'Dewgong', types: ['Water', 'Ice'], hp: 170, mov: 3, page: 2,
    moves: [
      atk('Icy Wind', 'Ice', 25, grid('OOO/OOO/.G.'), 'The target(s)’ movement speed goes down by one stage.', { targetStages: { stages: { mov: -1 }, chance: 1 } }),
      HAZE,
    ],
    ability: A.thickFat,
  }),
  card({
    id: 'tauros', name: 'Tauros', types: ['Normal'], hp: 140, mov: 4, page: 2,
    moves: [
      atk('Body Slam', 'Normal', 55, grid('.O./.B./.G.'), '30% chance to paralyze each target.', { status: { id: 'par', chance: 0.3 } }),
      atk('Hyper Beam', 'Normal', 95, grid('.O./.O./.O./.G.'), 'The user cannot move next turn.', { nextTurn: { noMove: true } }),
    ],
    ability: ['angerPoint', 'Anger Point', 'If this pokemon’s stats get lowered, its attack gets boosted to its maximum.'],
  }),
  card({
    id: 'snorlax', name: 'Snorlax', types: ['Normal'], hp: 260, mov: 2, page: 2,
    moves: [
      atk('Body Slam', 'Normal', 60, grid('.O./.B./.G.'), '30% chance to paralyze each target.', { status: { id: 'par', chance: 0.3 } }),
      atk('Crunch', 'Dark', 45, grid('.../.O./.G.'), '10% chance to lower the opponent’s defense by one stage.', { targetStages: { stages: { def: -1 }, chance: 0.1 } }),
    ],
    ability: A.thickFat,
  }),
  card({
    id: 'whimsicott', name: 'Whimsicott', types: ['Fairy', 'Grass'], hp: 120, mov: 4, page: 2,
    moves: [
      sts('Stun Spore', grid('.O./.O./.G.'), '80% chance to hit each target. Paralyzes the target. Grass types are immune.', {
        hitChance: 0.8, status: { id: 'par', chance: 1 }, grassImmune: true,
      }),
      TAILWIND,
    ],
    ability: A.chlorophyll,
  }),
  card({
    id: 'weezing', name: 'Weezing', types: ['Poison'], hp: 145, mov: 2, page: 2,
    moves: [
      atk('Gunk Shot', 'Poison', 60, grid('.R./.O./.../.G.'), '20% chance miss and deal 30 damage. Otherwise, 30% chance to poison.', {
        graze: { chance: 0.2, power: 30 }, status: { id: 'psn', chance: 0.3, noGraze: true },
      }),
      atk('Clear Smog', 'Poison', 30, grid('OOO/OOO/.G.'), 'Ignores and removes all stat changes that the opponent has.', { ignoreAllDefStages: true, resetTargetStages: true }),
    ],
    ability: A.levitate,
  }),
  // ------------------------------------------------------------ page 3
  card({
    id: 'scizor', name: 'Scizor', types: ['Steel', 'Bug'], hp: 145, mov: 3, page: 3,
    moves: [
      atk('X-Scissor', 'Bug', 65, grid('O.O/.O./OGO'), ''),
      atk('Bullet Punch', 'Steel', 30, { kind: 'range', range: 4 }, 'Hits any single pokemon within 4 tiles of the user.'),
    ],
    ability: A.technician,
  }),
  card({
    id: 'clefable', name: 'Clefable', types: ['Fairy'], hp: 165, mov: 2, page: 3,
    moves: [
      atk('Moonblast', 'Fairy', 60, grid('.O./.../.G.'), '30% chance to lower attack.', { targetStages: { stages: { atk: -1 }, chance: 0.3 } }),
      sts('Follow Me', SELF, FOLLOW_ME_TEXT, { special: 'followMe' }),
    ],
    ability: A.unaware,
  }),
  card({
    id: 'blissey', name: 'Blissey', types: ['Normal'], hp: 330, mov: 2, page: 3,
    moves: [
      atk('Double Edge', 'Normal', 60, grid('.O./OBO/.G.'), 'Deals 30 recoil damage.', { recoil: 30 }),
      sts('Life Dew', grid('OOO/OGO/OOO'), 'Heals the user and adjacent allies by 30 hp.', { healSelfAndAllies: 30 }),
    ],
    ability: A.resistance,
  }),
  card({
    id: 'umbreon', name: 'Umbreon', types: ['Dark'], hp: 225, mov: 3, page: 3,
    moves: [
      FOUL_PLAY(),
      atk('Snarl', 'Dark', 25, grid('OOO/OGO/OOO'), 'Lowers target’s attack.', { targetStages: { stages: { atk: -1 }, chance: 1 } }),
    ],
    ability: A.synchronize,
  }),
  card({
    id: 'espeon', name: 'Espeon', types: ['Psychic'], hp: 120, mov: 4, page: 3,
    moves: [
      PSYCHIC(75, '10% chance to lower the opponent’s defense.'),
      sts('Fake Tears', grid('.O./.../.G.'), 'Lowers the target’s defense by two stages.', { targetStages: { stages: { def: -2 }, chance: 1 } }),
    ],
    ability: A.synchronize,
  }),
  card({
    id: 'cherrim', name: 'Cherrim', types: ['Grass'], hp: 125, mov: 3, page: 3,
    formLabel: 'Overcast', forms: ['cherrim', 'cherrim-sunshine'],
    moves: [
      sts('Flower Shield', GLOBAL, 'Raises the defense of all grass types on the field by one stage.', { special: 'flowerShield' }),
      sts('Sunny Day', GLOBAL, 'Raises the attack of all fire types. Lowers the attack of all water types. Both are to a maximum of one stage.', { special: 'sunnyDay' }),
    ],
    ability: ['flowerGiftOvercast', 'Flower Gift (Overcast)', 'When a pokemon on the field uses sunny day, this pokemon changes into its sunshine form.'],
  }),
  card({
    id: 'golisopod', name: 'Golisopod', types: ['Water', 'Bug'], hp: 185, mov: 2, page: 3,
    moves: [
      atk('Liquidation', 'Water', 70, grid('.O./OOO/.G.'), '20% chance to lower the target’s defense by one stage.', { targetStages: { stages: { def: -1 }, chance: 0.2 } }),
      atk('Leech Life', 'Bug', 65, grid('.../O.O/.G.'), 'Heals the user by 30 hp per target hit.', { drainPerTarget: 30 }),
    ],
    ability: ['emergencyExit', 'Emergency Exit', 'When brought below 100 hp by an attack, this pokemon must switch positions with an ally of your choice if possible.'],
  }),
  card({
    id: 'altaria', name: 'Altaria', types: ['Dragon', 'Flying'], hp: 160, mov: 3, page: 3,
    moves: [
      atk('Hurricane', 'Flying', 50, grid('OOO/O.O/OOO/.G.'), '30% chance to graze for 20 damage unless on a water tile or next to a water type. Otherwise, 30% chance to confuse.', {
        graze: { chance: 0.3, power: 20, negateNear: 'water' }, confuse: { chance: 0.3, noGraze: true },
      }),
      sts('Feather Dance', grid('.O./.../.G.'), 'Lowers the target’s defense by two stages.', { targetStages: { stages: { def: -2 }, chance: 1 } }),
    ],
    ability: ['naturalCure', 'Natural Cure', 'Heals status conditions when this pokemon ends its turn more than 3 spaces away from enemies.'],
  }),
  card({
    id: 'cherrim-sunshine', name: 'Cherrim', types: ['Grass'], hp: 185, mov: 3, page: 3,
    draftable: false, formOf: 'cherrim', formLabel: 'Sunshine',
    moves: [
      atk('Giga Drain', 'Grass', 60, grid('.../.O./.G.'), 'Heals the user by 30 hp.', { drain: 30 }),
      sts('Heal Pulse', grid('.O./.O./.O./.G.'), 'Heals the target(s) by 60 hp.', { heal: 60 }),
    ],
    ability: ['flowerGiftSunshine', 'Flower Gift (Sunshine)', 'Adjacent allied pokemon deal 30 extra damage and take 30 less damage from attacks.'],
  }),
  // ------------------------------------------------------------ page 4
  card({
    id: 'arcanine', name: 'Arcanine', types: ['Fire'], hp: 155, mov: 3, page: 4,
    moves: [
      atk('Flare Blitz', 'Fire', 85, grid('.O./OBO/.G.'), 'Deals 25 recoil damage. 10% chance to burn.', { recoil: 25, status: { id: 'brn', chance: 0.1 } }),
      sts('Howl', grid('OOO/OGO/OOO'), 'Raises the attack of adjacent allies by one stage.', { alliesStages: { atk: 1 } }),
    ],
    ability: ['justified', 'Justified', 'If this pokemon gets hit by a dark type attack, its attack goes up by one stage.'],
  }),
  card({
    id: 'luxray', name: 'Luxray', types: ['Electric'], hp: 145, mov: 3, page: 4,
    moves: [
      atk('Supercell Slam', 'Electric', 65, grid('OOO/OBO/.G.'), '10% chance to miss all targets and deal 40 damage to the user.', { missAll: { chance: 0.1, selfDamage: 40 } }),
      atk('Facade', 'Normal', 35, grid('.../.O./.G.'), 'Deals 35 extra damage if the user has a status condition.', { bonus: [{ when: 'userStatus', amount: 35 }] }),
    ],
    ability: A.guts,
  }),
  card({
    id: 'heracross', name: 'Heracross', types: ['Fighting', 'Bug'], hp: 150, mov: 3, page: 4,
    moves: [
      atk('Lunge', 'Bug', 65, grid('.R./.O./.B./.G.'), 'Lowers the target’s attack by one stage.', { targetStages: { stages: { atk: -1 }, chance: 1 } }),
      atk('Close Combat', 'Fighting', 100, grid('.O./OBO/.G.'), 'Lowers the user’s defense by one stage.', { selfStages: { stages: { def: -1 } } }),
    ],
    ability: A.guts,
  }),
  card({
    id: 'infernape', name: 'Infernape', types: ['Fire', 'Fighting'], hp: 125, mov: 4, page: 4,
    moves: [
      atk('Drain Punch', 'Fighting', 50, grid('.../.O./.G.'), 'Heals 25 hp to the user.', { drain: 25 }),
      atk('Flare Blitz', 'Fire', 85, grid('.O./OBO/.G.'), 'Deals 25 recoil damage. 10% chance to burn.', { recoil: 25, status: { id: 'brn', chance: 0.1 } }),
    ],
    ability: ['ironFist', 'Iron Fist', 'This pokemon and adjacent pokemon deal 20 extra damage when using moves with “Punch”, “Mash”, or “Fist” in their name.'],
  }),
  card({
    id: 'archeops', name: 'Archeops', types: ['Rock', 'Flying'], hp: 120, mov: 4, page: 4,
    moves: [
      atk('Stone Edge', 'Rock', 90, grid('.O./OOO/.O./.G.'), '20% chance to graze and deal 25 damage.', { graze: { chance: 0.2, power: 25 } }),
      atk('Acrobatics', 'Flying', 50, grid('.../.O./.G.'), 'Deals 50 extra damage if both the user and target are on normal terrain.', { bonus: [{ when: 'normalTerrain', amount: 50 }] }),
    ],
    ability: ['defeatist', 'Defeatist', 'If this pokemon has taken 60 or more damage, its attacks deal 40 less damage.'],
  }),
  card({
    id: 'minior', name: 'Minior', types: ['Rock', 'Flying'], hp: 90, mov: 2, page: 4,
    formLabel: 'Meteor', forms: ['minior', 'minior-core'],
    moves: [
      atk('Ancient Power', 'Rock', 20, grid('OOO/OOO/.G.'), '10% chance to raise the user’s attack, speed and defense.', {
        selfStages: { stages: { atk: 1, def: 1, mov: 1 }, chance: 0.1 },
      }),
      sts('Sandstorm', GLOBAL, 'Does 20 flat damage to all pokemon other than rock/ground/steel types. The defense of all rock types gets raised by one stage to a maximum of one stage.', { special: 'sandstorm' }),
    ],
    ability: ['shieldsDownMeteor', 'Shields Down (Meteor)', 'When this pokemon runs out of hp, instead of fainting, heal all damage and transform into core form. Immune to status conditions.'],
  }),
  card({
    id: 'gyarados', name: 'Gyarados', types: ['Water', 'Flying'], hp: 180, mov: 3, page: 4,
    moves: [
      atk('Aqua Tail', 'Water', 75, grid('RRR/OOO/.G.'), '10% chance to graze for 25 damage.', { graze: { chance: 0.1, power: 25 } }),
      atk('Scale Shot', 'Dragon', 25, grid('.O./.../.G.'), 'Roll a 6 sided die and add the result * 10 to the damage of this attack. Lowers defense and raises speed of the user.', {
        dice: true, selfStages: { stages: { def: -1, mov: 1 } },
      }),
    ],
    ability: A.moxie,
  }),
  card({
    id: 'gliscor', name: 'Gliscor', types: ['Ground', 'Flying'], hp: 165, mov: 3, page: 4,
    moves: [U_TURN(35), sts('Spikes', { kind: 'place', grid: '.O./.../.G.', place: 'spikes' }, SPIKES_TEXT)],
    ability: ['poisonHeal', 'Poison Heal', 'When poisoned, this pokemon gains 30 hp per turn instead of taking damage.'],
  }),
  card({
    id: 'minior-core', name: 'Minior', types: ['Rock', 'Flying'], hp: 50, mov: 4, page: 4,
    draftable: false, formOf: 'minior', formLabel: 'Core',
    moves: [
      METEOR_BEAM(75),
      atk('Explosion', 'Normal', 125, grid('OOO/OGO/OOO'), 'The user faints after hitting the opponent.', { selfFaint: true }),
    ],
    ability: ['shieldsDownCore', 'Shields Down (Core)', 'If this pokemon gets healed while at full health, transform into meteor form.'],
  }),
  // ------------------------------------------------------------ page 5
  card({
    id: 'furret', name: 'Furret', types: ['Normal'], hp: 120, mov: 3, page: 5,
    moves: [
      atk('Endeavor', 'Normal', null, grid('.../.O./.G.'), 'The target now has the same amount of HP as the user, unless the user has more HP than the target did.', { special: 'endeavor' }),
      sts('Follow Me', SELF, FOLLOW_ME_TEXT, { special: 'followMe' }),
    ],
    ability: A.runAway,
  }),
  card({
    id: 'drapion', name: 'Drapion', types: ['Poison', 'Dark'], hp: 150, mov: 3, page: 5,
    moves: [
      atk('Cross Poison', 'Poison', 55, grid('O.O/.O./OGO'), '10% chance to poison. 10% chance to deal 55 extra damage.', {
        status: { id: 'psn', chance: 0.1 }, bonus: [{ when: 'chance', chance: 0.1, amount: 55 }],
      }),
      sts('Toxic', grid('.O./.../.G.'), 'Badly poisons the target.', { status: { id: 'tox', chance: 1 } }),
    ],
    ability: ['keenEye', 'Keen Eye', 'This pokemon cannot have its attack lowered.'],
  }),
  card({
    id: 'lumineon', name: 'Lumineon', types: ['Water'], hp: 130, mov: 3, page: 5,
    moves: [
      atk('Chilling Water', 'Water', 20, grid('OOO/.O./.G.'), 'Lowers the target(s)’ attack by one stage.', { targetStages: { stages: { atk: -1 }, chance: 1 } }),
      TAILWIND,
    ],
    ability: ['stormDrain', 'Storm Drain', 'When this pokemon is hit by a water type attack, it has no effect and instead raises the user’s attack stat.'],
  }),
  card({
    id: 'krookodile', name: 'Krookodile', types: ['Ground', 'Dark'], hp: 155, mov: 3, page: 5,
    moves: [
      atk('Earth Power', 'Ground', 70, grid('.O./OOO/.O./.G.'), '10% chance to lower the target(s)’ defense.', { targetStages: { stages: { def: -1 }, chance: 0.1 } }),
      atk('Power Trip', 'Dark', 20, grid('.../.O./.G.'), 'This move gains 20 power for each stat boost that the user has, but loses 20 power for each stat drop.', { special: 'powerTrip' }),
    ],
    ability: A.moxie,
  }),
  card({
    id: 'dodrio', name: 'Dodrio', types: ['Normal', 'Flying'], hp: 100, mov: 4, page: 5,
    moves: [
      atk('Tri Attack', 'Normal', 55, grid('.O./.O./.O./.G.'), '30% chance to randomly either burn, paralyze, or freeze.', { triStatus: 0.3 }),
      atk('Drill Peck', 'Flying', 55, grid('.O./OOO/.G.'), ''),
    ],
    ability: A.runAway,
  }),
  card({
    id: 'crobat', name: 'Crobat', types: ['Poison', 'Flying'], hp: 150, mov: 4, page: 5,
    moves: [
      atk('Cross Poison', 'Poison', 40, grid('O.O/.O./OGO'), '10% chance to poison. 10% chance to deal 40 extra damage.', {
        status: { id: 'psn', chance: 0.1 }, bonus: [{ when: 'chance', chance: 0.1, amount: 40 }],
      }),
      HAZE,
    ],
    ability: A.shadowDash,
  }),
  // ------------------------------------------------------------ page 6
  card({
    id: 'skarmory', name: 'Skarmory', types: ['Flying', 'Steel'], hp: 160, mov: 3, page: 6,
    moves: [
      atk('Iron Head', 'Steel', 40, grid('.R./.O./.G.'), '30% chance to make the target flinch.', { flinch: { chance: 0.3 } }),
      sts('Spikes', { kind: 'place', grid: '.O./.../.G.', place: 'spikes' }, SPIKES_TEXT),
    ],
    ability: ['hardArmor', 'Hard Armor', 'This pokemon takes 30 less damage from attacks that are done from up close.'],
    notes: ['Spikes has no grid printed on this card; it uses the same placement as Gliscor’s Spikes (2 tiles ahead).'],
  }),
  card({
    id: 'malamar', name: 'Malamar', types: ['Psychic', 'Dark'], hp: 155, mov: 3, page: 6,
    moves: [
      FOUL_PLAY(),
      sts('Topsy-Turvy', grid('.../.O./.G.'), 'Reverses all stat boosts and drops of the target.', { invertTargetStages: true }),
    ],
    ability: A.contrary,
  }),
  card({
    id: 'reuniclus', name: 'Reuniclus', types: ['Psychic'], hp: 180, mov: 2, page: 6,
    moves: [PSYCHIC(70, '10% chance to lower each target’s defense.'), ALLY_SWITCH],
    ability: A.regenerator,
  }),
  card({
    id: 'pikachu', name: 'Pikachu', types: ['Electric'], hp: 80, mov: 4, page: 6,
    moves: [
      atk('Thunderbolt', 'Electric', 45, grid('OOO/.../.G.'), '20% chance to paralyze each target.', { status: { id: 'par', chance: 0.2 } }),
      atk('Nuzzle', 'Electric', 10, grid('.../.O./.G.'), 'Paralyzes the target.', { status: { id: 'par', chance: 1 } }),
    ],
    ability: ['celebrate', 'Celebrate', 'This pokemon can act again if they KO a pokemon that they hit.'],
  }),
  card({
    id: 'sudowoodo', name: 'Sudowoodo', types: ['Rock'], hp: 145, mov: 2, page: 6,
    moves: [
      atk('Head Smash', 'Rock', 95, grid('.R./ROR/OBO/.G.'), '40 recoil damage per target hit.', { recoilPerTarget: 40 }),
      sts('Substitute', { kind: 'place', grid: '.O./.G.', place: 'substitute' },
        'Uses 30 hp to make a substitute that absorbs attacks. Fails if a pokemon or hazard is in the way, or if a substitute already exists.'),
    ],
    ability: A.sturdy,
  }),
  card({
    id: 'slaking', name: 'Slaking', types: ['Normal'], hp: 235, mov: 3, page: 6,
    moves: [
      atk('Giga Impact', 'Normal', 150, grid('.O./OBO/.G.'), '10% chance to graze and deal 60 damage.', { graze: { chance: 0.1, power: 60 } }),
      sts('Slack Off', SELF, 'The user recovers 50 hp.', { selfHeal: 50 }),
    ],
    ability: ['truant', 'Truant', 'This pokemon can only attack on odd numbered turns.'],
  }),
  card({
    id: 'milotic', name: 'Milotic', types: ['Water'], hp: 200, mov: 3, page: 6,
    moves: [
      atk('Scald', 'Water', 50, grid('.O./.O./.G.'), '30% chance to burn each target.', { status: { id: 'brn', chance: 0.3 } }),
      sts('Rain Dance', GLOBAL, 'The attack of all water types goes up. The attack of all fire types goes down. Both are to a maximum of one stage.', { special: 'rainDance' }),
    ],
    ability: ['competitive', 'Competitive', 'If this pokemon has their stats lowered by another pokemon, max out their attack.'],
  }),
  card({
    id: 'galvantula', name: 'Galvantula', types: ['Bug', 'Electric'], hp: 105, mov: 4, page: 6,
    moves: [
      atk('Thunder', 'Electric', 70, grid('.O./.../.../.G.'), '30% chance to paralyze the target.', { status: { id: 'par', chance: 0.3 } }),
      sts('Sticky Web', { kind: 'place', grid: '.O./.../.G.', place: 'web' }, 'Places a sticky web down that can lower the opponent’s speed. Fails if an opponent or hazard is in the way.'),
    ],
    ability: ['compoundEyes', 'Compound Eyes', 'This pokemon and adjacent allies never miss or graze attacks.'],
  }),
  // ------------------------------------------------------------ page 7
  card({
    id: 'lunala', name: 'Lunala', types: ['Psychic', 'Ghost'], hp: 250, mov: 3, page: 7,
    moves: [
      atk('Moongeist Beam', 'Ghost', 90, grid('.O./.O./.O./.G.'), 'Ignores abilities.', { ignoreAbilities: true }),
      METEOR_BEAM(85),
    ],
    ability: ['shadowShield', 'Shadow Shield', 'This pokemon takes 30 less damage when at full hp.'],
  }),
  card({
    id: 'yveltal', name: 'Yveltal', types: ['Flying', 'Dark'], hp: 230, mov: 3, page: 7,
    moves: [
      atk('Oblivion Wing', 'Flying', 65, grid('.O./.O./.O./.G.'), 'Recovers 45 hp per target hit.', { drainPerTarget: 45 }),
      atk('Dark Pulse', 'Dark', 65, grid('OOO/OGO/OOO'), '20% chance of making each target flinch.', { flinch: { chance: 0.2 } }),
    ],
    ability: ['darkAura', 'Dark Aura', 'Dark type moves deal 20 extra damage for all pokemon on the field.'],
  }),
  card({
    id: 'mewtwo', name: 'Mewtwo', types: ['Psychic'], hp: 190, mov: 4, page: 7,
    moves: [
      atk('Psystrike', 'Psychic', 100, grid('OOO/.O./.G.'), 'Ignores boosts to defense.', { ignoreDefBoosts: true }),
      atk('Aura Sphere', 'Fighting', 65, grid('.R./.O./.../.G.'), ''),
    ],
    ability: ['pressure', 'Pressure', 'While this pokemon is on the field, and the opponent uses a move that lowers their own stats, their stats get lowered by twice as many stages.'],
  }),
  card({
    id: 'zekrom', name: 'Zekrom', types: ['Electric', 'Dragon'], hp: 220, mov: 3, page: 7,
    moves: [
      atk('Bolt Strike', 'Electric', 120, grid('.R./.O./.B./.G.'), '20% chance to paralyze the target.', { status: { id: 'par', chance: 0.2 } }),
      atk('Outrage', 'Dragon', 115, grid('.O./OGO/.O.'), '50% chance to put the user to sleep.', { selfSleepChance: 0.5 }),
    ],
    ability: ['teravolt', 'Teravolt', 'Ignores abilities when attacking.'],
  }),
  card({
    id: 'rayquaza', name: 'Rayquaza', types: ['Flying', 'Dragon'], hp: 190, mov: 3, page: 7,
    moves: [
      atk('Dragon Ascent', 'Flying', 115, grid('.R./ROR/OBO/.G.'), 'The user’s defense goes down by one stage.', { selfStages: { stages: { def: -1 } } }),
      DRAGON_PULSE(80),
    ],
    ability: ['airLock', 'Air Lock', 'This pokemon ignores opponent’s attack and defense boosts of ANY kind including terrain and abilities.'],
  }),
  card({
    id: 'reshiram', name: 'Reshiram', types: ['Fire', 'Dragon'], hp: 220, mov: 3, page: 7,
    moves: [
      atk('Blue Flare', 'Fire', 120, grid('.O./OOO/.O./.G.'), '20% chance to graze for 40 damage. Otherwise, 20% to burn each target.', {
        graze: { chance: 0.2, power: 40 }, status: { id: 'brn', chance: 0.2, noGraze: true },
      }),
      DRAGON_PULSE(80),
    ],
    ability: ['turboblaze', 'Turboblaze', 'Ignores abilities when attacking.'],
  }),
  card({
    id: 'kyogre', name: 'Kyogre', types: ['Water'], hp: 225, mov: 3, page: 7,
    moves: [
      atk('Water Spout', 'Water', 140, grid('.O./OOO/OGO/OOO'), 'Deals 70 less damage when the user has 100 or more damage.', {
        bonus: [{ when: 'userDamageAtLeast', dmg: 100, amount: -70 }],
      }),
      atk('Thunder', 'Electric', 85, grid('.O./.../.../.G.'), ''),
    ],
    ability: ['drizzle', 'Drizzle', 'At the start of the battle, all water types have their attack go up and all fire types have their attack go down. Hurricane and Thunder always hit.'],
  }),
  card({
    id: 'groudon', name: 'Groudon', types: ['Ground'], hp: 225, mov: 3, page: 7,
    moves: [
      atk('Precipice Blades', 'Ground', 115, grid('O.O/OOO/.O./.G.'), '10% chance to graze for 40 damage.', { graze: { chance: 0.1, power: 40 } }),
      atk('Solar Beam', 'Grass', 90, grid('.O./OOO/.O./.G.'), ''),
    ],
    ability: ['drought', 'Drought', 'At the start of the battle, all fire types have their attack go up and all water types have their attack go down. Solar Beam and Solar Blade can be used without recharging.'],
  }),
  // ------------------------------------------------------------ page 8
  card({
    id: 'volcarona', name: 'Volcarona', types: ['Fire', 'Bug'], hp: 160, mov: 3, page: 8,
    moves: [
      atk('Fire Spin', 'Fire', 45, grid('OOO/O.O/OOO/.G.'), 'Roll a 6 sided die and add the result * 10 to this move’s power.', { dice: true }),
      QUIVER_DANCE,
    ],
    ability: ['leech', 'Leech', 'When damage is done by a different pokemon to a target within 3 spaces of the user, the user recovers ½ of the damage dealt.'],
  }),
  card({
    id: 'breloom', name: 'Breloom', types: ['Grass', 'Fighting'], hp: 110, mov: 3, page: 8,
    moves: [
      atk('Seed Bomb', 'Grass', 65, grid('.O./OOO/.O./.G.'), ''),
      atk('Mach Punch', 'Fighting', 30, { kind: 'range', range: 4 }, 'Hits any single pokemon within 4 tiles of the user.'),
    ],
    ability: A.technician,
  }),
  card({
    id: 'zoroark-hisui', name: 'Zoroark (Hisuian)', types: ['Ghost', 'Normal'], hp: 90, mov: 4, page: 8,
    moves: [
      atk('Hyper Voice', 'Normal', 75, grid('OOO/.O./.G.'), ''),
      atk('Bitter Malice', 'Ghost', 55, grid('.../OOO/OGO'), 'Deals 55 extra damage to any target who has a major status condition.', {
        bonus: [{ when: 'targetStatus', amount: 55 }],
      }),
    ],
    ability: A.shadowDash,
  }),
  card({
    id: 'hydreigon', name: 'Hydreigon', types: ['Dragon', 'Dark'], hp: 175, mov: 3, page: 8,
    moves: [DRAGON_PULSE(65), sts('Roar', grid('RRR/RRR/OOO/OOO/.G.'), 'Removes the target(s)’ stat changes.', { resetTargetStages: true })],
    ability: A.levitate,
  }),
  card({
    id: 'dragapult', name: 'Dragapult', types: ['Ghost', 'Dragon'], hp: 145, mov: 5, page: 8,
    moves: [
      atk('Dragon Darts', 'Dragon', 40, grid('.O./.O./.../.G.'), 'Deals 40 extra damage if it only hits one target.', { bonus: [{ when: 'singleTarget', amount: 40 }] }),
      U_TURN(40),
    ],
    ability: A.infiltrator,
  }),
  card({
    id: 'ferrothorn', name: 'Ferrothorn', types: ['Steel', 'Grass'], hp: 195, mov: 2, page: 8,
    moves: [
      atk('Power Whip', 'Grass', 70, grid('OOO/OOO/.G.'), '20% chance to miss.', { missChance: 0.2 }),
      atk('Gyro Ball', 'Steel', 30, grid('.R./.O./.B./.G.'), 'If the target has more movement speed than the user, this attack deals 40 extra damage for each point of movement (including stat changes and conditions).', {
        special: 'gyroBall',
      }),
    ],
    ability: ['ironBarbs', 'Iron Barbs', 'When a pokemon hits this pokemon up close, they take 30 damage.'],
  }),
  card({
    id: 'lapras', name: 'Lapras', types: ['Ice', 'Water'], hp: 220, mov: 2, page: 8,
    moves: [
      atk('Ice Beam', 'Ice', 50, grid('.O./.O./.O./.G.'), '10% chance to freeze each target.', { status: { id: 'frz', chance: 0.1 } }),
      atk('Whirlpool', 'Water', 10, grid('OOO/O.O/OOO/.G.'), 'Roll a 6 sided die and add the result * 10 to this move’s power.', { dice: true }),
    ],
    ability: ['waveRider', 'Wave Rider', 'Water tiles cost half as much movement speed to move through.'],
  }),
  card({
    id: 'amoonguss', name: 'Amoonguss', types: ['Grass', 'Poison'], hp: 175, mov: 2, page: 8,
    moves: [
      sts('Spore', grid('.../.O./.G.'), 'Puts the target to sleep. Grass types are immune.', { status: { id: 'slp', chance: 1 }, grassImmune: true }),
      sts('Rage Powder', SELF, 'During your opponent’s next turn, any pokemon who can target this pokemon must do so. Grass types are immune.', { special: 'ragePowder' }),
    ],
    ability: A.regenerator,
  }),
  // ------------------------------------------------------------ page 9
  card({
    id: 'sinistcha', name: 'Sinistcha', types: ['Ghost', 'Grass'], hp: 150, mov: 3, page: 9,
    moves: [
      atk('Matcha Gotcha', 'Grass', 60, grid('.O./OOO/.G.'), '20% chance to burn each target. Heals 30 damage to the user per target hit.', {
        status: { id: 'brn', chance: 0.2 }, drainPerTarget: 30,
      }),
      atk('Hex', 'Ghost', 45, grid('.O./OOO/.G.'), 'Deals 45 more damage if the opponent has a major status condition.', { bonus: [{ when: 'targetStatus', amount: 45 }] }),
    ],
    ability: ['hospitality', 'Hospitality', 'Restores 30 hp to adjacent allies when ending its turn near them.'],
  }),
  card({
    id: 'noivern', name: 'Noivern', types: ['Dragon', 'Flying'], hp: 150, mov: 4, page: 9,
    moves: [
      atk('Boomburst', 'Normal', 70, grid('OOO/OOO/.O./.G.'), ''),
      sts('Screech', grid('OOO/.O./.G.'), 'Lowers the target(s)’ defense by two stages.', { targetStages: { stages: { def: -2 }, chance: 1 } }),
    ],
    ability: A.infiltrator,
  }),
  card({
    id: 'cinccino', name: 'Cinccino', types: ['Normal'], hp: 110, mov: 4, page: 9,
    moves: [
      atk('Tail Slap', 'Normal', 20, grid('.../OOO/.G.'), 'Roll a 6-sided die and add 10 damage times the number you rolled.', { dice: true }),
      sts('Tickle', grid('.../.O./.G.'), 'Lowers the attack and defense of the target.', { targetStages: { stages: { atk: -1, def: -1 }, chance: 1 } }),
    ],
    ability: A.technician,
  }),
  card({
    id: 'lurantis', name: 'Lurantis', types: ['Grass'], hp: 145, mov: 2, page: 9,
    moves: [
      atk('Leaf Blade', 'Grass', 60, grid('.../.O./.G.'), '10% chance to deal 60 extra damage.', { bonus: [{ when: 'chance', chance: 0.1, amount: 60 }] }),
      atk('Solar Blade', 'Grass', 85, grid('RRR/OOO/.G.'), 'The user cannot move next turn UNLESS the user attacks adjacent to a fire type pokemon.', {
        nextTurn: { noMove: true, unlessAdjFire: true, droughtSkips: true },
      }),
    ],
    ability: A.contrary,
  }),
  card({
    id: 'slowbro', name: 'Slowbro', types: ['Water', 'Psychic'], hp: 185, mov: 2, page: 9,
    moves: [
      atk('Surf', 'Water', 55, grid('OOO/OBO/.G.'), ''),
      sts('Future Sight', SELF, 'At the start of your next turn, any pokemon within 3 tiles of the user takes a flat 100 damage.', { special: 'futureSight' }),
    ],
    ability: A.regenerator,
  }),
  card({
    id: 'frosmoth', name: 'Frosmoth', types: ['Ice', 'Bug'], hp: 125, mov: 3, page: 9,
    moves: [
      atk('Blizzard', 'Ice', 90, grid('OOO/OOO/.../.G.'), '30% chance to graze for 25 damage unless the user is on ice or next to an ice type. Otherwise, 10% chance to freeze each target.', {
        graze: { chance: 0.3, power: 25, negateNear: 'ice' }, status: { id: 'frz', chance: 0.1, noGraze: true },
      }),
      QUIVER_DANCE,
    ],
    ability: ['iceScales', 'Ice Scales', 'Attacks done from afar deal 30 less damage to this pokemon.'],
  }),
  card({
    id: 'primarina', name: 'Primarina', types: ['Water', 'Fairy'], hp: 165, mov: 2, page: 9,
    moves: [
      atk('Hyper Voice', 'Water', 70, grid('OOO/.O./.G.'), ''),
      atk('Moonblast', 'Fairy', 75, grid('.O./.../.G.'), '30% chance to lower the target’s attack.', { targetStages: { stages: { atk: -1 }, chance: 0.3 } }),
    ],
    ability: ['liquidVoice', 'Liquid Voice', 'When another pokemon uses an attack with “voice”, “boom”, “roar” or “screech” in the name, this pokemon copies that attack as a water type move.'],
  }),
  card({
    id: 'cetitan', name: 'Cetitan', types: ['Ice'], hp: 200, mov: 3, page: 9,
    moves: [
      atk('Avalanche', 'Ice', 40, grid('OOO/.../.G.'), 'Deals 40 extra damage if the user has 100 hp or less.', { bonus: [{ when: 'userHpAtMost', hp: 100, amount: 40 }] }),
      sts('Hail', GLOBAL, 'Deals a flat 20 damage to all pokemon except ice types. Raises the defense of all ice types to a maximum of one stage.', { special: 'hail' }),
    ],
    ability: ['slushRush', 'Slush Rush', 'This pokemon gets +2 mov while next to another ice type pokemon or while standing on ice.'],
  }),
  // ------------------------------------------------------------ expansion page 1
  card({
    id: 'flygon', name: 'Flygon', types: ['Dragon', 'Ground'], hp: 145, mov: 3, page: 10,
    moves: [
      atk('Earth Power', 'Ground', 55, grid('.O./.O./.O./.G.'), '10% chance to lower the opponent’s defense by one stage.', {
        targetStages: { stages: { def: -1 }, chance: 0.1 },
      }),
      atk('Dragon Tail', 'Dragon', 40, grid('RRR/.../OOO/.G.'), 'Removes all stat changes from the target(s).', { resetTargetStages: true }),
    ],
    ability: A.levitate,
  }),
  card({
    id: 'hawlucha', name: 'Hawlucha', types: ['Fighting', 'Flying'], hp: 125, mov: 4, page: 10,
    moves: [
      { ...atk('Flying Press', 'Fighting', 55, grid('.O./OBO/.O./.G.'), 'Counts as both Fighting and Flying type.'), extraType: 'Flying' },
      sts('Coaching', grid('.../.O./.G.'), 'Raises the target’s attack and defense by one stage.', { alliesStages: { atk: 1, def: 1 } }),
    ],
    ability: ['unburden', 'Unburden', 'When this pokemon gets hit, its movement speed goes up by one stage.'],
  }),
  card({
    id: 'sylveon', name: 'Sylveon', types: ['Fairy'], hp: 190, mov: 2, page: 10,
    moves: [
      atk('Hyper Voice', 'Fairy', 60, grid('OOO/.O./.G.'), ''),
      atk('Hyper Beam', 'Fairy', 105, grid('.O./.O./.O./.G.'), 'The user cannot move next turn.', { nextTurn: { noMove: true } }),
    ],
    ability: ['pixilate', 'Pixilate', 'Normal type moves of adjacent allies become fairy type and deal 30 extra damage.'],
  }),
  card({
    id: 'tinkaton', name: 'Tinkaton', types: ['Steel', 'Fairy'], hp: 165, mov: 3, page: 10,
    moves: [
      atk('Gigaton Hammer', 'Steel', 80, grid('OOO/OOO/.O./.G.'), 'This attack can only be used on even numbered turns.', { evenRoundsOnly: true }),
      FAKE_OUT('.O./.B./.../.G.'),
    ],
    ability: A.moldBreaker,
  }),
  card({
    id: 'meganium', name: 'Meganium', types: ['Grass'], hp: 175, mov: 3, page: 10,
    moves: [
      atk('Leaf Storm', 'Grass', 65, grid('OOO/O.O/OOO/.G.'), 'Lowers the user’s attack by two stages.', { selfStages: { stages: { atk: -2 } } }),
      sts('Light Screen', GLOBAL, 'Raises the defense of this pokemon’s entire team, to a maximum of 1 stage.', { special: 'lightScreen' }),
    ],
    ability: ['leafGuard', 'Leaf Guard', 'This pokemon gets double the effects of terrain bonuses.'],
  }),
  card({
    id: 'porygonz', name: 'Porygon-Z', types: ['Normal'], hp: 140, mov: 3, page: 10,
    moves: [
      atk('Tri Attack', 'Normal', 70, grid('.O./.O./.O./.G.'), '30% chance to randomly either burn, paralyze, or freeze.', { triStatus: 0.3 }),
      atk('Zap Cannon', 'Electric', 85, grid('.O./.O./.../.G.'), '50% chance to miss completely. Otherwise, paralyzes the target.', {
        missAll: { chance: 0.5, selfDamage: 0 }, status: { id: 'par', chance: 1 },
      }),
    ],
    ability: ['adaptability', 'Adaptability', 'This pokemon, and adjacent pokemon, deal 30 extra damage when using normal type attacks.'],
  }),
  card({
    id: 'corsola', name: 'Corsola', types: ['Rock', 'Water'], hp: 145, mov: 2, page: 10,
    moves: [
      atk('Scald', 'Water', 35, grid('.O./.O./.G.'), '30% chance to burn each target.', { status: { id: 'brn', chance: 0.3 } }),
      atk('Head Smash', 'Rock', 65, grid('.R./ROR/OBO/.G.'), 'The user takes 35 recoil per target hit.', { recoilPerTarget: 35 }),
    ],
    ability: A.regenerator,
  }),
  card({
    id: 'vivillon', name: 'Vivillon', types: ['Bug', 'Flying'], hp: 100, mov: 3, page: 10,
    moves: [
      atk('Hurricane', 'Flying', 60, grid('OOO/O.O/OOO/.G.'), '30% chance to confuse the opponent.', { confuse: { chance: 0.3 } }),
      sts('Sleep Powder', grid('.O./.O./.G.'), 'Puts the target to sleep. Grass types are immune.', {
        status: { id: 'slp', chance: 1 }, grassImmune: true,
      }),
    ],
    ability: A.compoundEyes,
  }),
  // ------------------------------------------------------------ expansion page 2
  card({
    id: 'octillery', name: 'Octillery', types: ['Water'], hp: 130, mov: 3, page: 11,
    moves: [
      atk('Octazooka', 'Water', 45, { kind: 'range', range: 6, min: 4 }, 'Targets any single pokemon 4-6 tiles away from the user. 10% chance to miss completely.', {
        missChance: 0.1,
      }),
      HELPING_HAND,
    ],
    ability: ['artilleryExpertise', 'Artillery Expertise', 'This pokemon deals 20 extra damage with the trebuchet.'],
  }),
  card({
    id: 'comfey', name: 'Comfey', types: ['Fairy'], hp: 130, mov: 3, page: 11,
    moves: [
      sts('After You', grid('.../.O./.G.'), 'The target can act again.', { special: 'afterYou' }),
      sts('Floral Healing', grid('.O./OOO/.O./.G.'), 'Heals the targets by 40 hp, or 80 hp if they are on terrain with bonuses.', {
        heal: 40, healOnBonusTerrain: 80,
      }),
    ],
    ability: ['triage', 'Triage', 'This pokemon can move 3 extra tiles when about to use a healing move.'],
  }),
  card({
    id: 'wobbuffet', name: 'Wobbuffet', types: ['Psychic'], hp: 215, mov: 2, page: 11,
    moves: [
      sts('Charm', grid('.O./.../.G.'), 'Lowers the target’s attack by two stages.', { targetStages: { stages: { atk: -2 }, chance: 1 } }),
      sts('Amnesia', SELF, 'Raises the user’s defense by two stages.', { selfStages: { stages: { def: 2 } } }),
    ],
    ability: ['decoy', 'Decoy', 'Attacks that hit this pokemon, but do not KO it, do not damage any other pokemon hit by them, and the attacker receives the same amount of damage in return.'],
  }),
  card({
    id: 'ditto', name: 'Ditto', types: ['Normal'], hp: 70, mov: 2, page: 11,
    moves: [
      sts('Transform', SELF, 'Uses the attack of any pokemon currently on the field.', { special: 'transform' }),
      NO_MOVE,
    ],
    ability: ['imposter', 'Imposter', 'When ending this pokemon’s turn beside another pokemon, you may choose to copy their stat changes.'],
    notes: ['Transform copies either move of any other Pokémon on the field (not Transform or Metronome) and aims it as Ditto’s own.'],
  }),
  card({
    id: 'shedinja', name: 'Shedinja', types: ['Ghost', 'Bug'], hp: 1, mov: 2, page: 11,
    moves: [
      atk('Phantom Force', 'Ghost', 50, grid('.O./.B./.../.G.'), 'Ignores the target’s defense boosts.', { ignoreDefBoosts: true }),
      sts('Will-O-Wisp', grid('.O./.../.G.'), '80% chance to hit and burn the target.', { hitChance: 0.8, status: { id: 'brn', chance: 1 } }),
    ],
    ability: ['wonderGuard', 'Wonder Guard', 'This pokemon takes no damage from attacks that are not super effective against it, including trebuchet attacks.'],
  }),
  card({
    id: 'ninjask', name: 'Ninjask', types: ['Flying', 'Bug'], hp: 80, mov: 5, page: 11,
    moves: [
      atk('Fury Cutter', 'Bug', 25, grid('.../OOO/.G.'), 'This move deals 10 extra damage * the current turn count.', { bonus: [{ when: 'round', amount: 10 }] }),
      sts('Baton Pass', { kind: 'ally', range: 4 }, 'The user switches position with an ally within 4 spaces, and switches stat boosts with them.', { special: 'batonPass' }),
    ],
    ability: ['speedBoost', 'Speed Boost', 'This pokemon’s movement speed rises at the beginning of every even numbered turn.'],
  }),
  card({
    id: 'froslass', name: 'Froslass', types: ['Ice', 'Ghost'], hp: 120, mov: 4, page: 11,
    moves: [
      atk('Icy Wind', 'Ice', 30, grid('OOO/OOO/.G.'), 'Lowers the target’s speed by one stage.', { targetStages: { stages: { mov: -1 }, chance: 1 } }),
      sts('Taunt', GLOBAL, 'On your opponent’s next turn, they cannot use moves with no base power if they can attack an enemy of theirs with a damaging move.', { special: 'taunt' }),
    ],
    ability: ['snowCloak', 'Snow Cloak', 'This pokemon gets double the effects of terrain bonuses.'],
  }),
  card({
    id: 'roserade', name: 'Roserade', types: ['Grass', 'Poison'], hp: 125, mov: 3, page: 11,
    moves: [
      atk('Giga Drain', 'Grass', 60, grid('.../.O./.G.'), 'Heals the user by 30 hp.', { drain: 30 }),
      atk('Mortal Spin', 'Poison', 25, grid('OOO/OGO/OOO'), 'Poisons the target. Destroys any spikes or webs that are targeted.', {
        status: { id: 'psn', chance: 1 }, clearHazards: true,
      }),
    ],
    ability: A.technician,
  }),
  // ------------------------------------------------------------ expansion pages 3–4
  card({
    id: 'haxorus', name: 'Haxorus', types: ['Dragon'], hp: 140, mov: 3, page: 12,
    moves: [
      atk('Dragon Claw', 'Dragon', 75, grid('.R./.O./.G.'), ''),
      sts('Dragon Dance', SELF, 'Raises the user’s attack and speed by one stage.', { selfStages: { stages: { atk: 1, mov: 1 } } }),
    ],
    ability: A.moldBreaker,
  }),
  card({
    id: 'oricorio', name: 'Oricorio', types: ['Flying', 'Ghost'], hp: 95, mov: 3, page: 12,
    moves: [
      atk('Revelation Dance', 'Ghost', 55, grid('.O./OBO/.O./.G.'), ''),
      atk('Air Slash', 'Flying', 45, grid('.O./.O./.G.'), '30% chance to make each target flinch.', { flinch: { chance: 0.3 } }),
    ],
    ability: ['dancer', 'Dancer', 'When another pokemon uses an attack with “dance” in the name, this pokemon copies that attack.'],
  }),
  card({
    id: 'wigglytuff', name: 'Wigglytuff', types: ['Fairy', 'Normal'], hp: 145, mov: 2, page: 13,
    moves: [
      sts('Metronome', SELF, 'Draw a random unused pokemon, and choose to use one of their moves in any direction if possible.', { special: 'metronome' }),
      FAKE_OUT('.O./OOO/.O./.G.'),
    ],
    ability: A.competitive,
  }),
];

export const CARDS: Record<string, CardDef> = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));
export const DRAFTABLE: CardDef[] = CARD_LIST.filter((c) => c.draftable);

export function getCard(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}
