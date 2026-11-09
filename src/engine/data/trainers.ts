// Trainer cards from page 3 of `Conquest Cards - Google Slides.pdf`. In trainer mode four of them are
// offered after the draft; each side keeps one. The passive always applies to its own side; the
// Special Move can be used once per game, at any point of its own turn, without using an action.

export interface TrainerDef {
  id: string;
  name: string;
  passive: string;
  special: string;
  /** The special boosts one Pokémon of the trainer's team (Nobunaga). */
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
    special: 'Heals all of your Pokémon by 50 HP and removes their status conditions.',
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
];

export const TRAINERS: Record<string, TrainerDef> = Object.fromEntries(TRAINER_LIST.map((t) => [t.id, t]));
/** Trainers offered after the draft in trainer mode. */
export const TRAINER_POOL_SIZE = 4;

export function getTrainer(id: string): TrainerDef {
  const t = TRAINERS[id];
  if (!t) throw new Error(`Unknown trainer: ${id}`);
  return t;
}
