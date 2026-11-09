# v1.1 rules interpretations

The README spec, `Conquest Rules.pdf` and `Conquest Cards.pdf` leave some behaviour open. This page lists what v1.1 actually does, so the group can agree on (or change) each call. Each item names the card or rule so it is easy to find in `src/engine/`.

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
- A move can only be used if its zone contains at least one Pokémon, ally or opponent (or the substitute). Ally-boosting moves (Howl, Coaching, Helping Hand, After You) need an ally in the zone. Moves that also heal the user (Life Dew) can always be used.
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

- **Round 1** is a normal round: both sides can move, use moves and fire the trebuchet. (Earlier versions made it movement only.)
- The game lasts 10 rounds. The Defender wins when round 10 ends.
- **Flinch:** the target loses its next activation (no move, no action).
- **Confusion** (Hurricane): lasts through the Pokémon's next activation. When it uses a move or the trebuchet, there is a ⅓ chance the action fails and it takes 30 damage instead.
- **Hyper Beam and Solar Blade** ("cannot move next turn"): the user can still act. **Solar Beam** ("must recharge") and **Meteor Beam**: the user can neither move nor act next turn.
- **Drought** removes the Solar Beam and Solar Blade recharge for everyone while Groudon is alive. **Drizzle** stops Hurricane from grazing while Kyogre is alive.
- **Truant:** on even rounds Slaking can't attack (neither its damaging move nor the trebuchet), but it can still move and use Slack Off.
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
- Substitute:
  - It goes on the tile directly in front of the user (its printed grid).
  - It costs 30 HP, so the user needs more than 30 HP.
  - Only one substitute can be on the field at a time.
  - An attack whose zone includes it hits only the substitute, which breaks.
  - Support moves (Howl, Life Dew, Heal Pulse) ignore it.

## Specific cards and abilities

- **Foul Play:** uses the target's first printed attack power and the target's Attack stage.
- **Ally Switch:** works with any ally on the board.
- **Emergency Exit:** the owner chooses which ally to switch with.
- **Liquid Voice:** Primarina's owner chooses a direction for the copy, or declines it. Copies are Water-type.
- **Follow Me / Rage Powder:** this applies to any opponent that could hit the user this turn from a tile it can reach. That opponent must move to such a tile and use a move whose zone includes the user, or fire the trebuchet at it. The turn can't end until it has done so. Healing and ally-boosting moves (Heal Pulse, Life Dew, Howl) don't count: they neither satisfy nor trigger the requirement.
- **Future Sight:** at the start of the owner's next turn, deals 100 flat damage to every other Pokémon within 3 tiles of Slowbro, allies included. If Slowbro has fainted by then, it fizzles.
- **Leech:** Volcarona heals half of the attack damage that other Pokémon deal to targets within 3 tiles of it, rounded up to a multiple of 5.
- **Heal Pulse** heals every Pokémon in its zone, opponents included. **Pollen Puff** heals allies and damages opponents.
- **Iron Fist** boosts any adjacent Pokémon, because the card says "adjacent pokemon", not allies.
- **Intimidate:** two adjacent Intimidate Pokémon stack.
- **"Ignores abilities"** (Moongeist Beam, Teravolt, Turboblaze): ignores the target's abilities, except Shields Down and Emergency Exit.
- **Air Lock** ignores the opponent's positive stat stages, its ability modifiers and terrain bonuses. **Infiltrator** ignores positive Defense stages and defensive abilities.
- **Trebuchet:** a flat 40 of one of the user's types, always the one that does the most damage to the target (Volcarona, Fire/Bug, fires as Fire at Scizor: 4× = 160; Charizard, Fire/Flying, hits a Grass type for 2× = 80). A type the target is immune to is simply not chosen if the other type can hit. Stat stages, damage-adding or -reducing abilities, berry bushes and burns don't change it; Levitate, Storm Drain, Tinted Lens and Thick Fat still apply, per type. On a tie, the shot avoids setting off Storm Drain or Justified.
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
- During the opponent's own turn, only Pokémon that still have an action left count. Before their turn, Pokémon that are flinched or can't act next turn are left out. Pokémon that can attack but not move next turn (Hyper Beam) count from their current tile only; Slaking doesn't count before an even round (Truant).
- The trebuchet is not painted (it would cover the whole board). The key says "+ trebuchet" when the Pokémon can reach it.

## Not used on this map

Cannons, wooden logs and ice sliding are not implemented. Magma and pit tiles exist in the engine's movement rules, but this map has none.

## Card updates (2026-11-09 card file)

- **Weather caps.** Sunny Day, Rain Dance, Sandstorm and Hail raise (or lower) a stat by one stage, but never past +1 (or −1): a Fire type at +1 Attack gets nothing more from a second Sunny Day. Light Screen and Tailwind work the same way.
- **Tailwind** (Whimsicott, Lumineon) now affects the user and every ally on the field, wherever they are: +1 movement, to at most +1. It needs no aim.
- **Howl** (Arcanine) raises the Attack of adjacent allies by one stage, not the user's. It needs an adjacent ally.
- **Celebrate** (Pikachu) and **After You** (Comfey) now say "act again" (see above).
- **Truant** (Slaking) now stops attacks, not movement (see Turn restrictions).
- **Slowbro** has Regenerator instead of Sturdy. **Future Sight** says "a flat 100 damage", which is what it already did.
- **Meganium's Leaf Storm** lowers the user's Attack by two stages. **Vivillon's Sleep Powder** no longer has an 80% hit chance: it always lands (Grass types are still immune).
- **Amoonguss** is Grass/Poison; **Oricorio** is Flying/Ghost and Revelation Dance is a Ghost move; **Haxorus** has its Dragon icon.
- **Gengar's Shadow Ball** grid now has a red tile: it hits 2 tiles ahead and knocks the target back 1.
- Sudowoodo's Substitute and Breloom's Mach Punch (30) are now printed, matching what the game already did.

## Expansion cards (Conquest Cards.pdf, pages 10–13)

19 Pokémon from the expansion sheet are in the draft pool (pages 10–13 here). Golurk is left out for now: its card is still an unfinished copy of Octillery's (Water type, Octazooka, Helping Hand). In the 2026-11-09 `Conquest Cards.pdf`, Wigglytuff sits on page 13, which is otherwise a work-in-progress page (unfinished copies named Golurk, Pelipper, Ninetales and others are not used).

- **Types read from the icons.** Tinkaton is Steel/Fairy, Corsola Rock/Water, Wigglytuff Fairy, Haxorus Dragon, Oricorio Flying/Ghost (Revelation Dance is Ghost).
- **Flying Press** counts as Fighting and Flying at once: effectiveness multiplies across both, and an immunity to either (Ghost to Fighting) stops it.
- **Fake Out:** after it is used, it can't be used again until the user ends an activation 4+ tiles (counted like movement) from every opponent.
- **Gigaton Hammer** only works in even-numbered rounds.
- **Light Screen:** +1 Defense for the whole team, but no Pokémon goes above +1 from it.
- **Coaching, Helping Hand, After You** only affect allies in the zone. Helping Hand's +30 lasts until the end of the current turn.
- **"Act again"** (After You, Celebrate) means another whole activation in the same turn: the Pokémon can move again and then use a move or the trebuchet. End-of-activation effects (poison, burn, Regenerator, flowers…) happen at the end of each activation. After You on an ally that is already done makes it ready again at once; on one that hasn't gone yet, it gets two activations. Each Pokémon can get After You once per turn (otherwise two Pokémon with it could pass turns back and forth forever). Celebrate gives one extra activation per KO.
- **Octazooka** targets one Pokémon 4–6 steps away.
- **Floral Healing** heals 40, or 80 for a Pokémon standing on a berry bush or flowers (Flying and Levitate Pokémon don't count as on them). Like other heals, it heals every Pokémon in its zone.
- **Taunt:** during the opponent's next turn, a Pokémon that can hit one of its opponents with a damaging move from where it stands can't use status moves.
- **Baton Pass:** switches places with an ally within 4 steps and swaps their stat changes.
- **Transform (Ditto):** uses either move of any other Pokémon on the field as its own (not Transform or Metronome). Ditto prints one move; its second slot is empty.
- **Metronome:** draws a random card that neither side drafted (any card whose moves aren't Transform or Metronome). The player picks one of its moves and how to aim it; if neither can hit anything, nothing happens.
- **Mortal Spin** also removes spikes and webs in its zone.
- **Fury Cutter:** +10 power per round number.
- **Unburden:** +1 Movement each time the Pokémon takes damage from an attack.
- **Pixilate:** an ally next to Sylveon has its Normal moves turned Fairy, with +30 damage.
- **Adaptability:** Porygon-Z and any Pokémon next to it deal 30 extra damage with Normal moves.
- **Leaf Guard / Snow Cloak:** berry bushes reduce damage by 60 and flowers heal 60.
- **Mold Breaker:** the user's attacks ignore the target's abilities (like Teravolt).
- **Artillery Expertise:** the trebuchet does 60 before type effectiveness instead of 40.
- **Triage:** Comfey may walk up to 3 extra tiles, but only to a tile from which it can use a healing move, and it must then use one (the move can be undone).
- **Decoy (Wobbuffet):** an attack that hits Wobbuffet first resolves on Wobbuffet. If Wobbuffet survives, no other Pokémon in the zone takes damage (other effects still apply), and the attacker takes the damage Wobbuffet took.
- **Imposter:** when Ditto ends an activation next to a Pokémon whose stat changes differ, its player may copy them.
- **Wonder Guard:** Shedinja takes no damage from attacks or trebuchet shots that aren't super effective (Tinted Lens only lifts a hit to neutral). Poison, burns, recoil, hazards, weather and Future Sight still hurt it.
- **Speed Boost:** +1 Movement at the start of each of Ninjask's turns in an even-numbered round.
- **Dancer:** when another Pokémon (either side) uses a move with "dance" in its name, Oricorio uses it too: self and field moves at once, aimed moves in a direction its player picks.

## Trainers

Trainer mode is chosen at setup. After the draft, four of the six trainers are offered; the Attacker picks one, then the Defender picks from the remaining three. Passives apply to the trainer's own side. The Special Move can be used once per game, at any point of its own turn while no Pokémon is mid-activation, and doesn't use up an action. Effects that last "the rest of your turn" end when the turn ends.

- **Mitsuhide:** weather moves and abilities (Sunny Day, Rain Dance, Sandstorm, Hail, Drizzle, Drought) never hurt its side. Special: every Pokémon's stat changes are removed; until the turn ends, its side's moves can't miss or graze.
- **N:** its side takes no recoil (Head Smash, Volt Tackle…; crash damage from a missed move still applies). Special: all allied Pokémon heal 50 and are cured of status conditions (the card was updated to say “allied”).
- **Nobunaga:** its Pokémon heal 30 whenever an attack they are immune to targets them; its trebuchet shots do +10. Special: one of its Pokémon that hasn't been activated this turn gets +2 movement, +30 damage and ignores the opponents' Defense boosts for the rest of the turn.
- **Red:** Pikachu's Thunderbolt deals 45 extra damage. Special: for the rest of the turn its team gets +1 movement and deals 20 extra damage per fainted teammate.
- **Blue:** its moves that push one tile push two. Special: the same as Red's (as printed).
- **Lance:** when one of its Pokémon would go on a cooldown (Fake Out's lock, or a "can't move/act next turn" recharge), it takes 40 recoil instead and the cooldown is skipped. Special: for the rest of the turn, every attack its side makes (trebuchet included) pushes the target 2 tiles straight away from the attacker; a target pushed into the board edge or a tile it can't enter takes 60 damage.

## Effect tags

Stat changes and conditions are shown as the tabletop's tags, dropped onto the card at random (but stable) spots with a slight tilt: one tag per stat stage (sword = Attack, shield = Defense, boot = Movement, + or −), the status condition (fire, bubbles, purple bubbles for bad poison, lightning, Zzz; frozen has no printed tag, so a matching snowflake tag is drawn), the sweat drop for flinching and recharging, and “!” for confusion, Taunt, Follow Me, cooldowns, Sturdy and Future Sight. A red number counts the Pokémon's turns the effect still lasts. When a move lands, the affected cards shake and flash with the damage, healing, status or stat change.

