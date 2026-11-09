# v1.0 rules interpretations

The README spec, `Conquest Rules.pdf` and `Conquest Cards.pdf` leave some behaviour open. This page lists what v1.0 actually does, so the group can agree on (or change) each call. Each item names the card or rule so it is easy to find in `src/engine/`.

## Maps

Players choose a map before each match (online, the host chooses). Both maps are transcribed from hand-drawn photos.

### Trebuchet Meadow

- 14 columns × 9 rows. Defenders spawn on the top row at columns 3, 5, 8, 11; Attackers on the bottom row at columns 4, 6, 9, 11 (columns counted from 0 on the left).
- Blue is water. Red is dirt, which is cosmetic.
- Flowers heal 30 HP when a Pokémon ends its activation on them. Berry bushes make the Pokémon on them take 30 less damage. Flying types and Levitate Pokémon hover over both and get neither bonus. Both count as bonus terrain, so neither is "normal" terrain for Acrobatics.
- The green-shaded tile in the middle water channel (column 6, row 1) is a grass land bridge: anyone can walk on it.
- The "✱" at the top of the dirt path is read as a crossed-out spawn arrow, so it is plain dirt.
- The trebuchet sits in the centre of the dirt square (column 10, row 4).
- The green hedges along the border are decoration only.

### Winding River

- 12 columns × 10 rows. Defenders spawn on the top row at columns 3, 5, 7 and 10; Attackers on the bottom row at columns 3, 5, 7 and 8.
- A river winds across the middle. Its bridges are drawn as brown wooden planks but are ordinary ground, so anyone can cross there.
- Five berry bushes and three flower patches, with the same effects as on the meadow.
- The grey stone left of centre (column 4, row 4) is read as the trebuchet.

## Card grids

- **Orange:** the tiles hit. Every Pokémon on them is hit, allies included.
- A move can only be used if its zone contains at least one Pokémon, ally or opponent (or the substitute). Ally-boosting moves (Tailwind) need an ally in the zone. Moves that also heal the user (Life Dew) can always be used.
- **Green:** the user.
- **Blue:** the user charges onto this tile before the hit. The tile must be empty and standable for the user, otherwise the move can't be aimed that way.
- **Red:** where the Pokémon hit are knocked back to. That is 1 tile, or 2 for Roar. Knockback stops at the board edge, at other Pokémon, at a substitute, or at terrain the target can't stand on. Hazards on the tiles it crosses trigger.
- Line of sight follows rules page 3. Only walls block, and this map has none.
- Every printed grid was checked against the card PDF's vector shapes. Fire Spin (Volcarona) had been entered wrongly and is now the printed 3×3 ring: the three rows in front, without the centre tile two ahead.

## Distances and movement

- "Adjacent", "next to" and "beside" mean the 8 surrounding tiles, diagonals included (rules p.2). This covers abilities that affect adjacent allies, such as Technician, Iron Fist, Flower Gift, Hospitality and Intimidate. "Up close" means adjacent in the same 8-way sense; "from afar" means anything farther.
- "Within N tiles" and "N spaces away" count steps the way movement does, with no diagonal steps, so a diagonal neighbour is 2 away. This applies to Mach Punch and Bullet Punch (within 4), Leech, Regenerator, Natural Cure, Shadow Dash and Future Sight (3).
- Pokémon can pass through allies. Enemies and substitutes block movement, except for Ghost types.
- When choosing a path, the game avoids hazards if it can.
- A move can be undone before acting, unless it walked onto a hazard.

## Turn restrictions

- **Round 1** is movement only for both sides: no moves and no trebuchet.
- The game lasts 10 rounds. The Defender wins when round 10 ends.
- **Flinch:** the target loses its next activation (no move, no action).
- **Confusion** (Hurricane): lasts through the Pokémon's next activation. When it uses a move or the trebuchet, there is a ⅓ chance the action fails and it takes 30 damage instead.
- **Hyper Beam and Solar Blade** ("cannot move next turn"): the user can still act. **Solar Beam** ("must recharge") and **Meteor Beam**: the user can neither move nor act next turn.
- **Drought** removes the Solar Beam and Solar Blade recharge for everyone while Groudon is alive. **Drizzle** stops Hurricane from grazing while Kyogre is alive.
- **Truant:** Slaking can't move on even rounds, but can still act.
- **Paralysis:** the 20% "can't act" roll happens at the start of the owner's turn.
- **Sleep and freeze:** roll at the start of the owner's turn; a 5 or 6 frees the Pokémon, and it acts that same turn.

## Status immunities

Only the immunities printed in the rules or on cards apply:

- Poison and Steel types can't be poisoned.
- Fire types can't be burned.
- Grass types are immune to Spore, Stun Spore and Rage Powder.
- Minior in Meteor form is immune to all statuses.

## Hazards and Substitute

- Spikes and sticky webs affect every non-Flying, non-Levitate Pokémon, on either side. They trigger when a Pokémon walks through, lands on, or is knocked onto them. A Pokémon that ends an activation without moving off one is hit again.
- Skarmory's Spikes has no printed grid, so it uses Gliscor's (2 tiles ahead).
- Substitute has no printed grid either:
  - It goes on the tile directly in front of the user.
  - It costs 30 HP, so the user needs more than 30 HP.
  - Only one substitute can be on the field at a time.
  - An attack whose zone includes it hits only the substitute, which breaks.
  - Support moves (Tailwind, Life Dew, Heal Pulse) ignore it.

## Specific cards and abilities

- **Mach Punch:** the power is printed as "-", so it uses 30, the same as Bullet Punch.
- **Foul Play:** uses the target's first printed attack power and the target's Attack stage.
- **Ally Switch:** works with any ally on the board.
- **Emergency Exit:** the owner chooses which ally to switch with.
- **Liquid Voice:** Primarina's owner chooses a direction for the copy, or declines it. Copies are Water-type.
- **Follow Me / Rage Powder:** this applies to any opponent that could hit the user this turn from a tile it can reach. That opponent must move to such a tile and use a move whose zone includes the user, or fire the trebuchet at it. The turn can't end until it has done so. Healing and ally-boosting moves (Heal Pulse, Life Dew, Tailwind) don't count: they neither satisfy nor trigger the requirement.
- **Future Sight:** at the start of the owner's next turn, deals 100 flat damage to every other Pokémon within 3 tiles of Slowbro, allies included. If Slowbro has fainted by then, it fizzles.
- **Leech:** Volcarona heals half of the attack damage that other Pokémon deal to targets within 3 tiles of it, rounded up to a multiple of 5.
- **Heal Pulse** heals every Pokémon in its zone, opponents included. **Pollen Puff** heals allies and damages opponents.
- **Iron Fist** boosts any adjacent Pokémon, because the card says "adjacent pokemon", not allies.
- **Intimidate:** two adjacent Intimidate Pokémon stack.
- **"Ignores abilities"** (Moongeist Beam, Teravolt, Turboblaze): ignores the target's abilities, except Shields Down and Emergency Exit.
- **Air Lock** ignores the opponent's positive stat stages, its ability modifiers and terrain bonuses. **Infiltrator** ignores positive Defense stages and defensive abilities.
- **Trebuchet:** a flat 40 that carries all of the user's types at once, like a dual-type attack: type effectiveness multiplies across them (Fire/Flying against Grass is 2 × 2 = 4×), and a type immunity on any of them stops the shot. Stat stages, damage-adding or -reducing abilities, berry bushes and burns don't change it; Levitate, Storm Drain, Tinted Lens and Thick Fat still apply.
- **Cherrim** turns into its Sunshine form when anyone uses Sunny Day, keeping the damage it has taken.
- **Minior:** Meteor form becomes Core form (full HP) when it would faint. Core form healed at full HP turns back into Meteor form (full HP).
- **Sturdy** only protects from full HP. The Pokémon survives at 1 HP and faints the next time it takes damage.
- If both teams are wiped out at the same moment, the Attacker wins, because its objective was met.

## Draft and placement

- Each match draws 15 random non-legendary cards and 4 random legendaries. The legendaries are the eight cards on page 7: Lunala, Yveltal, Mewtwo, Zekrom, Rayquaza, Reshiram, Kyogre and Groudon.
- Players alternate 3 picks each from the 15 (A → D → A → D → A → D), then each picks one legendary (A, then D). No card can be picked twice.
- **No legendaries** (a setup option): the pool is 20 random non-legendary cards, and players alternate all 8 picks from it (A → D → … → D).
- Cherrim and Minior are each drafted as one card and change form during battle.
- After the draft the Attacker places first, then placement alternates. The Attacker also takes the first battle turn.

## Reach view (danger zone)

- Clicking an opposing Pokémon (on the board or its card) shows every tile it could hit with each of its moves, from its current tile or any tile it can walk to. Its first move's range is filled red; its second move's is outlined in yellow. Moves that only help their own side are left out. Click it again, or press Esc, to hide it.
- There is no all-opponents view any more; it was replaced by this per-Pokémon view.
- Nothing is shown for a Pokémon whose next turn is in round 1, since round 1 is move-only.
- During the opponent's own turn, only Pokémon that still have an action left count. Before their turn, Pokémon that are flinched or can't act next turn are left out. Pokémon that can attack but not move next turn (Hyper Beam, or Truant on an even round) count from their current tile only.
- The trebuchet is not painted (it would cover the whole board). The key says "+ trebuchet" when the Pokémon can reach it.

## Not used on this map

Cannons, wooden logs and ice sliding are not implemented. Magma and pit tiles exist in the engine's movement rules, but this map has none.
