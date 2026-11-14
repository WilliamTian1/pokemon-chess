import type { MoveDef, PType } from '../types';

// Trainer cards from page 12 of `Conquest Cards.pdf` (2026-11-09 edition). In trainer mode four of them are
// offered after the draft; each side keeps one. The passive always applies to its own side; the
// Special Move can be used once per game, at any point of its own turn, without using an action.

export interface TrainerDef {
  id: string;
  name: string;
  passive: string;
  special: string;
  /** The special targets one Pokémon of the trainer's team. */
  specialTarget?: 'ally';
}

export const TRAINER_LIST: TrainerDef[] = [
  {
    id: 'mitsuhide',
    name: 'Mitsuhide',
    passive: 'Your side’s Pokémon cannot be negatively afflicted by weather moves or abilities (Sandstorm, Sunny Day, Rain Dance etc.).',
    special: 'Removes the stat changes of every Pokémon. Guarantees every move hits for the rest of this player’s turn.',
  },
  {
    id: 'n',
    name: 'N',
    passive: 'Your Pokémon do not take recoil damage.',
    special: 'Heals all allied Pokémon by 50 HP and removes any status conditions.',
  },
  {
    id: 'nobunaga',
    name: 'Nobunaga',
    passive: 'Any of your Pokémon targeted by an attack it is immune to recovers 30 HP. +10 trebuchet damage.',
    special: 'One Pokémon on your team can move two extra tiles this turn, deals 30 extra damage, and ignores all defense boosts the opponent has.',
    specialTarget: 'ally',
  },
  {
    id: 'red',
    name: 'Red',
    passive: 'Pikachu’s Thunderbolt deals 45 extra damage.',
    special: 'For the rest of your turn, your team gets 1 extra movement and deals 20 extra damage for each fainted Pokémon on your team.',
  },
  {
    id: 'blue',
    name: 'Blue',
    passive: 'Attacks that normally push back one space push back two.',
    special: 'For the rest of your turn, your team gets 1 extra movement and deals 20 extra damage for each fainted Pokémon on your team.',
  },
  {
    id: 'lance',
    name: 'Lance',
    passive: 'If one of your Pokémon is put on the cooldown of an attack, it takes 40 recoil damage instead and the cooldown is removed.',
    special: 'For the rest of your turn, all attacks push the target back two tiles. A target that hits an untraversable tile takes 60 damage from the collision.',
  },
  {
    id: 'hideyoshi',
    name: 'Hideyoshi',
    passive: 'All allied Pokémon can use Shove as a third attack. Shove pushes its target back one tile.',
    special: 'For the rest of your turn, moves that roll a die for damage always roll a 6. Positive secondary effects are twice as likely to occur.',
  },
  {
    id: 'jessie-james',
    name: 'Jessie and James',
    passive: 'All Poison-type attacks inflict poison.',
    special: 'For the rest of your turn, allied Pokémon have unlimited movement, but can only move and attack vertically.',
  },
  {
    id: 'hiker-paul',
    name: 'Hiker Paul',
    passive: 'Opponents take double damage from hazards.',
    special: 'For the rest of your turn, allied Pokémon on terrain without bonuses deal 40 extra damage to Pokémon on terrain with bonuses, ignoring that terrain bonus.',
  },
  {
    id: 'youngster-joey',
    name: 'Youngster Joey',
    passive: 'All allied Pokémon gain Hidden Power (40). Choose one type for the whole team at the start of battle, after seeing the opposing team.',
    special: 'Restores all allied Pokémon to full HP.',
  },
  {
    id: 'motochika',
    name: 'Motochika',
    passive: 'When an allied Pokémon uses a move with “Dance,” “Roar,” or “Boom” in its name, its movement rises by one stage.',
    special: 'Choose one allied Pokémon; it and adjacent allies have their Attack raised by two stages.',
    specialTarget: 'ally',
  },
  {
    id: 'motonari',
    name: 'Motonari',
    passive: 'Allied Pokémon take 30 less damage while on a trebuchet and deal 10 extra damage with the trebuchet.',
    special: 'Raises every allied Pokémon’s movement by one stage.',
  },
];

export const TRAINERS: Record<string, TrainerDef> = Object.fromEntries(TRAINER_LIST.map((t) => [t.id, t]));
/** Trainers offered after the draft in trainer mode. */
export const TRAINER_POOL_SIZE = 4;

const SHOVE: MoveDef = {
  name: 'Shove',
  type: null,
  power: null,
  kind: 'status',
  target: { kind: 'grid', grid: '.R./.O./.G.' },
  text: 'Pushes the target back one tile.',
  fx: {},
};

function hiddenPower(type: PType | null): MoveDef {
  return {
    name: 'Hidden Power',
    type,
    power: 40,
    kind: 'attack',
    target: { kind: 'grid', grid: '.O./.../.G.' },
    text: 'Its type is chosen for the whole team at the start of battle.',
    fx: {},
  };
}

export function trainerMoveFor(id: string, type: PType | null = null): MoveDef | null {
  if (id === 'hideyoshi') return SHOVE;
  if (id === 'youngster-joey') return hiddenPower(type);
  return null;
}

export function getTrainer(id: string): TrainerDef {
  const t = TRAINERS[id];
  if (!t) throw new Error(`Unknown trainer: ${id}`);
  return t;
}
