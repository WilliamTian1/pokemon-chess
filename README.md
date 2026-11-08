# Pokémon Conquest Tactics — Web Adaptation (v1.0 Spec)

A turn-based tactical grid game inspired by *Pokémon Conquest* and tabletop miniature games. Built as a lightweight, cross-device web application for private matches among friends.

## 1. Recommended Tech Stack (6-Player Private Group)

**Note**: These design choices are up to the programmer and can be subject to change if an alternative is better suited/discovered.

Because this project is strictly for a small group of ~6 friends playing across desktop and mobile browsers, the architecture should prioritize **zero hosting costs**, **rapid development**, and **server-authoritative RNG** (since dice rolls and proc chances are central to gameplay).

* **Frontend:** **React** (or Vue/Svelte) + **Tailwind CSS** (for responsive UI/cards) + **HTML5 Canvas / PixiJS** (or simple CSS Grid for the board, since animations are minimal).
* **Backend / Multiplayer State:** **PartyKit** or **Colyseus** (hosted on free tiers), OR **Firebase Realtime Database / Supabase** (if using a host-authoritative peer model).
  * *Recommendation:* **Boardgame.io** or a lightweight **Node.js + Socket.io** server hosted on Render/Fly.io. Boardgame.io is specifically designed for turn-based tabletop ports and handles turn order, phases, and state synchronization out of the box.
  
* **Deployment:** Vercel or Netlify (Frontend), PartyKit/Render (Backend).


---

## 2. Core Game Loop & Match Structure

### 2.1 Setup, Roles & Drafting
1. **Players & Asymmetric Roles:** 2 Players per match (with spectator support for remaining friends in the lobby). One player is assigned **Attacker** (goes first) and the other is assigned **Defender** (goes second).
2. **Drafting (4v4):** Players draft **4 unique Pokémon** each from the v1.0 roster (Pages 1–9 of `Conquest Cards - Google Slides.pdf`), alternating picks one at a time ($A \to D \to A \to D \to A \to D \to A \to D$).
3. **Map Loading:** Load a $W \times H$ grid map containing predefined terrain tiles, Attacker/Defender spawn zones, and interactive objects (Trebuchets, Cannons, Wooden Logs).
4. **Initial Placement:** Players alternate placing their drafted Pokémon onto their designated spawn tiles.
5. **Start-of-Battle Triggers:** Resolve all start-of-battle passive abilities (e.g., Tyranitar's *Sand Stream*, Kyogre's *Drizzle*, Groudon's *Drought*).

### 2.2 Turn & Round Structure (8-Round Limit)
The game is played over a maximum of **8 Rounds**. A `Round Counter` starts at $1$ and increments by $1$ after both the Attacker and Defender complete their full team turns.

Each player's turn follows three strict phases:

1. **Start of Turn Phase:**
   * Trigger start-of-turn delayed attacks (e.g., Slowbro's *Future Sight* deals $100$ flat damage to all units within $3$ tiles).
   * Trigger start-of-turn abilities (e.g., Slaking's *Truant* allows moving only on odd-numbered rounds: $1, 3, 5, 7$).
   * **Sleep / Freeze Check:** For each allied Pokémon currently `Asleep` or `Frozen`, roll $1\text{d}6$. On a $5$ or $6$, remove the status condition immediately; the unit may act normally this turn.

2. **Activation Phase:**
   * The active player may activate each of their living, un-incapacitated Pokémon once, in any order they choose.
   * **Paralysis Check:** When a `Paralyzed` unit is selected to activate (or at the start of turn), roll a $20\%$ check; if triggered, that unit cannot move or attack this turn.
   * A valid unit activation consists of **Movement** (up to its modified `Mov` stat, minimum $0$) and **1 Action** (Using a Move, firing a Trebuchet/Cannon, or passing).
   * *Standard Order:* A unit moves first, then executes an action. (Exceptions: Abilities like *Run Away* allow spending unused movement *after* acting; moves like *U-turn* and *Parting Shot* grant fixed bonus movement after acting).

3. **End of Unit Activation / End of Turn Phase:**
   * **Poison / Burn Tick:** At the end of a Pokémon's movement/activation each turn, apply status damage:
     * `Poisoned`: $20$ flat damage.
     * `Badly Poisoned (Toxic)`: $20 \times N$ flat damage, where $N$ is the number of turns the unit has been badly poisoned (starts at $20$, then $40, 60, \dots$).
     * `Burned`: $20$ flat damage.
   * **Hazard Persist Tick:** If a unit ends its turn standing on `Spikes` ($30$ damage) or `Sticky Web` ($-1$ Mov stage), trigger the hazard effect again.
   * **Positional End-of-Turn Abilities:** Trigger abilities that check end-of-turn positioning (e.g., Venusaur's water healing, Reuniclus/Amoonguss's *Regenerator*, Altaria's *Natural Cure*, Sinistcha's *Hospitality*).

### 2.3 Asymmetric Win Conditions
* **Attacker Win Condition:** The Attacker wins **only** by reducing all 4 of the Defender's Pokémon to $0\text{ HP}$ (Fainted) before the end of Round 8.
* **Defender Win Condition:** The Defender wins immediately if all 4 of the Attacker's Pokémon are reduced to $0\text{ HP}$, **OR automatically if Round 8 finishes** (both Attacker and Defender complete their 8th turn) and at least one Defender Pokémon is still alive.

---

## 3. Grid, Movement & Line of Sight

### 3.1 Movement vs. Adjacency
* **4-Directional Movement:** Units move strictly orthogonally (Up, Down, Left, Right). Diagonal stepping is not permitted ($1\text{ tile} = 1\text{ Mov}$ cost).
* **Adjacency (8-Way):** Per the rulebook, moves and abilities that reference "adjacent" or "next to" check all **8 surrounding tiles** (orthogonal + diagonal, i.e., Chebyshev distance $= 1$: $\max(\vert x_1 - x_2 \vert, \vert y_1 - y_2 \vert) = 1$).
* **Range Checks ("Within $X$ tiles/spaces"):** Used by *Bullet Punch*, *Mach Punch*, *Regenerator*, *Shadow Dash*, *Future Sight*. `[TODO: Confirm if "within 3 or 4 tiles" uses 4-way Manhattan distance (|dx| + |dy| <= X) or 8-way Chebyshev distance (max(|dx|, |dy|) <= X).]`.

### 3.2 Terrain Matrix

| Terrain Type | Traversable By | Movement Cost | Special Effects |
| :--- | :--- | :--- | :--- |
| **Normal** | All | $1$ | Triggers Archeops's *Acrobatics* bonus ($+50$ dmg) if both user and target are on Normal terrain. |
| **Bonus Terrain** | All | $1$ | Grants innate terrain bonuses. |
| **Water** | `Water`, `Flying`, or `Levitate` | $1$ ($0.5$ for Lapras *Wave Rider*) | Triggers Venusaur healing ($+30\text{ HP}$), Golisopod *Liquidation* accuracy. Blocks Cannon fire. |
| **Magma** | `Fire`, `Flying`, or `Levitate` | $1$ | Triggers Charizard *Solar Power* ($+30$ dmg). |
| **Ice** | All | Slide | Non-`Ice`, non-`Flying`/`Levitate` units stepping onto Ice slide in their movement direction until hitting a non-ice tile, another unit, or a wall. Remaining movement is lost, but the unit may still attack. Triggers *Slush Rush* ($+2$ Mov) and *Blizzard* accuracy. |
| **Pit (Pitch Black)** | `Flying` or `Levitate` (Pass-through only) | $1$ | **No unit may end its movement/land on a Pit tile.** |
| **Wall / Obstacle** | None | Impassable | Blocks movement, Line of Sight, and Cannon fire. |

---

## 4. Combat & Targeting Engine

### 4.1 Reading the $3 \times 3$ Attack Grids (4-Way Rotation)
Every move on a Pokémon card features a $3 \times 3$ mini-grid indicating its targeting zone:
* **Green Square:** The user's position.
* **Orange Square(s):** Affected target tiles relative to the user's facing direction.
* **4-Directional Aiming:** When attacking, the player rotates the $3 \times 3$ grid to face one of the **4 cardinal directions** (North, South, East, West).
* **Multi-Target Execution:** A move hits **all** valid units occupying the orange tiles simultaneously (including allies, unless specified otherwise or healed via moves like *Pollen Puff*).
* **Minimum Target Requirement:** Moves that target other Pokémon **must have at least one valid target in the orange zone** to be legally executed.

### 4.2 Line of Sight (Raycasting / Blocking)
Per Page 3 of `Conquest Rules.pdf`, attack tiles propagate outward from the user (Green tile):
1. All $8$ immediately adjacent tiles originate directly from the Green tile.
2. Tiles $2$ or $3$ spaces forward in the center column propagate straight up the center spine.
3. Side-column tiles at distance $2+$ branch horizontally outward from the center column at their respective row.
* **Wall Blocking Rule:** If a tile in the propagation chain is occupied by a **Wall**, that tile and **all downstream tiles pointing from it** are blocked and cannot hit targets.
* **Up-Close vs. Afar Definitions:**
  * **Up Close (Melee):** Target is within the $8$ adjacent tiles (distance $= 1$).
  * **From Afar (Ranged):** Target is at distance $\ge 2$ tiles away.

---

## 5. Damage Calculation Pipeline

All damage calculations follow a strict sequential pipeline, with rounding occurring **only at the very final step**.

### 5.1 Variable Base Power Pre-Calculation
* **Dice-Roll Moves** (*Icicle Spear*, *Scale Shot*, *Fire Spin*, *Whirlpool*, *Tail Slap*): Roll $1\text{d}6$ **once** per move usage. Calculate $\text{BasePower} = \text{MoveBase} + (10 \times \text{DieResult})$. This single roll applies to all targets hit by the AoE.
* **Graze Rolls:** Roll accuracy/graze independently for each individual target. If a move **Grazes**:
  * $\text{BasePower}$ is replaced by the flat Graze value listed on the move (e.g., $20, 25, 30, 35, 40, 60$).
  * **CRITICAL RULE:** Graze damage **ignores Attack boosts and Defense debuffs** (positive Attack stages on the attacker and negative Defense stages on the defender are treated as $0$). Negative Attack stages on the attacker and positive Defense stages on the defender still apply.

### 5.2 Step 1: Pre-Type Damage Formula
For each target hit by an attack:

$$\text{PreTypeDamage} = \max\Big(10, \; \text{BasePower} + \Delta\text{Stages} + \Delta\text{Abilities} + \Delta\text{Status}\Big)$$

Where:
1. $\text{BasePower}$: The move's printed power (or Graze power / Dice-modified power / Krookodile's *Power Trip* modified power).
2. $\Delta\text{Stages}$: Stat stages are clamped to $[-3, +3]$. Each stage adds or subtracts $20$ flat damage:

   $$\Delta\text{Stages} = 20 \times (\text{Attacker}_{\text{AtkStage}} - \text{Defender}_{\text{DefStage}})$$

   * *Stage Modifiers:*
     * If the attack **Grazed**, use $\min(0, \text{Attacker}_{\text{AtkStage}})$ and $\max(0, \text{Defender}_{\text{DefStage}})$.
     * If Attacker or Defender has *Unaware* (Clefable) or *Air Lock* (Rayquaza), ignore the opponent's stat stages.
     * If Move/Ability ignores Defense boosts (*Psychic Fangs*, *Brick Break*, *Psystrike*, *Infiltrator*), set $\text{Defender}_{\text{DefStage}} = \min(0, \text{Defender}_{\text{DefStage}})$ (positive defense stages are treated as $0$).
3. $\Delta\text{Abilities}$ **& Positional Modifiers**:
   * **Add flat damage bonuses:**
     * *Technician* (User or adjacent ally, printed Base Power $\le 40$): $+30$
     * *Solar Power* (Charizard adjacent to Fire-type or on Magma): $+30$
     * *Flower Gift* (User or adjacent ally next to Sunshine Cherrim): $+30$
     * *Guts* (Arcanine/Heracross with a status condition): $+30$
     * *Iron Fist* (Infernape or adjacent unit using "Punch", "Mash", "Fist"): $+20$
     * *Dark Aura* (Yveltal on field, Dark-type move): $+20$
     * *Defeatist* (Archeops with $\ge 60$ damage taken): $-40$
   * **Subtract flat damage reductions:**
     * *Intimidate* (Attacker is adjacent to opposing Scrafty/Staraptor): $-30$
     * *Multiscale* / *Shadow Shield* (Defender at full HP): $-30$
     * *Flower Gift* (Defender adjacent to Sunshine Cherrim): $-30$
     * *Hard Armor* (Skarmory hit from distance $= 1$): $-30$
     * *Ice Scales* (Frosmoth hit from distance $\ge 2$): $-30$
     * *Blissey Passive* ($-40$ if distance $\ge 2$; $+20$ if distance $= 1$).
4. $\Delta\text{Status}$:
   * If Attacker is `Burned` and does **not** have the *Guts* ability: $-30$.
5. **Minimum Floor:**
   * Before type effectiveness is applied, $\text{PreTypeDamage}$ cannot be less than $10$.

### 5.3 Step 2: Type Effectiveness & Final End-of-Pipeline Rounding
Multiply $\text{PreTypeDamage}$ by the Type Effectiveness multiplier $M_{\text{type}} \in \{0, 0.25, 0.5, 1, 2, 4\}$ (per the 18-type chart on Page 4 of Rules) and ability multipliers (e.g., *Thick Fat* $M_{\text{ThickFat}} = 0.5$ against Fire/Ice moves; *Tinted Lens* upgrades any $M_{\text{type}} < 1$ to $1$, except $0$):

$$\text{RawFinalDamage} = \text{PreTypeDamage} \times M_{\text{type}} \times M_{\text{ThickFat}}$$

* **Immunity ($M_{\text{type}} = 0$):** Deals $0$ damage. If the only target is immune, **secondary effects do not activate**.
* **Final Rounding Rule:** At the very end of the calculation, round **UP** to the nearest multiple of $5$:

$$\text{FinalDamage} = \lceil \text{RawFinalDamage} / 5 \rceil \times 5$$

---

## 6. Stat Stages & Status Conditions

### 6.1 Stat Stage Stacking (Cap: $\pm 3$)
* Each Pokémon tracks three independent stat stages: **Attack (`Atk`)**, **Defense (`Def`)**, and **Movement (`Mov`)**.
* **Stage Cap:** All stat stages are strictly clamped between **$-3$ and $+3$**.
  * `Atk` stage $\pm 1 = \pm 20$ damage dealt ($+3 = +60$ max, $-3 = -60$ min).
  * `Def` stage $\pm 1 = \mp 20$ damage taken ($+3 = -60$ damage taken, $-3 = +60$ damage taken).
  * `Mov` stage $\pm 1 = \pm 1$ tile movement speed ($+3 = +3\text{ Mov}$, $-3 = -3\text{ Mov}$).
* Abilities that "max out" Attack (e.g., Tauros's *Anger Point*, Milotic's *Competitive*) immediately set `Atk` stage to $+3$.
* **Weather / Field Buffs:** Moves like *Sunny Day*, *Rain Dance*, *Sandstorm*, *Hail*, and abilities like *Drizzle*, *Drought*, and *Sand Stream* modify the relevant types' `Atk` or `Def` by $1$ stage (respecting the $\pm 3$ cap).

### 6.2 Status Conditions (Non-Stacking Rule)
* **No Stacking / No Overwriting:** Status conditions **do not stack**. If a Pokémon already has a status condition (e.g., `Burned`), casting another status-inflicting move on it (e.g., another `Burn` or `Poison`) **does nothing** unless a move/ability explicitly states otherwise.
* **Major Status Conditions:**
  * **Poison:** Takes $20$ flat damage at the end of its move each turn. `Poison` and `Steel` types are immune.
  * **Badly Poisoned (Toxic):** Takes $20 \times N$ flat damage at the end of its move each turn, where $N$ increments each turn ($20, 40, 60, \dots$). `Poison` and `Steel` types are immune.
  * **Burn:** Takes $20$ flat damage at the end of its move each turn. Deals $30$ less damage per attack. `Fire` types are immune.
  * **Paralysis:** Loses $1$ Movement speed ($\text{Mov} - 1$). Has a $20\%$ chance each turn to be unable to move or attack.
  * **Sleep:** Cannot move or attack. At the start of the owner's turn, roll $1\text{d}6$; wakes up on $5$ or $6$ and can act immediately.
  * **Freeze:** Cannot move or attack. At the start of the owner's turn, roll $1\text{d}6$; thaws on $5$ or $6$ and can act immediately.
* **Volatile Conditions:**
  * **Flinch:** Triggered by *Dragon Rush*, *Iron Head*, *Dark Pulse*. `[TODO: Confirm if Flinch prevents the target from moving/acting on its next activation]`.
  * **Confusion:** Triggered by Golisopod's *Liquidation*. `[TODO: Define Confusion mechanic]`.
  * **Follow Me / Rage Powder:** Forces opposing units that are able to directly target the user with an attack on their next turn to do so (`Grass` types are immune to *Rage Powder*).

---

## 7. Interactive Map Objects & Hazards

| Object | Placement / Trigger | Mechanic |
| :--- | :--- | :--- |
| **Trebuchet** | Fixed center map tile | Base Power $40$, takes one of the user's elemental types. Targets **any single Pokémon anywhere on the map**. Ignores stat boosts, respects abilities and type chart. |
| **Cannon** | Fixed map tile(s) | Base Power $60$, takes one of the user's elemental types. Fires in a straight cardinal line until hitting a non-traversable tile (Water, Wall), hitting **all** Pokémon along that line. Ignores stat boosts, respects abilities and type chart. |
| **Wooden Log** | Pre-placed obstacle | Blocks landing (except `Flying`/`Ghost` can pass through). When hit by an attack, slides $1$ tile backward in the direction the attack was aimed. If it collides with a Pokémon, it deals $30$ flat damage (ignoring stats/abilities) and is **destroyed**. |
| **Spikes** | Placed by *Spikes* move | Max $5$ on the field. Cannot be placed on occupied tiles or the Trebuchet. Deals $30$ flat damage when a non-`Flying`/`Levitate` unit walks through, lands on, is knocked into, or stays on the tile. |
| **Sticky Web** | Placed by *Sticky Web* | Cannot be placed on occupied tiles or the Trebuchet. Lowers `Mov` by $1$ stage (up to the $-3$ cap) when a non-`Flying`/`Levitate` unit walks through, lands on, is knocked into, or stays on the tile. |
| **Substitute** | Placed by Sudowoodo | Costs $30\text{ HP}$. Blocks movement for all non-`Ghost` units; no unit can land on it. **Intercepts AoE:** Any attack whose targeting grid includes a Substitute **fails to hit any other Pokémon**, even if they are in range. Breaks in $1$ hit. |

---

## 8. Version 1.0 Roster & JSON Schema

### 8.1 Version 1.0 Scope (Pages 1–9 Only)
* **Included:** All 52 Pokémon cards across **Pages 1–9** of `Conquest Cards - Google Slides.pdf` (from *Charizard* on Page 1 through *Cetitan* on Page 9, including dual-form cards *Cherrim* and *Minior*).
* **Excluded (WIP):** Pages 10 and 11 are excluded from Version 1.0.

### 8.2 Minor Card Target Grid Clarifications for v1.0 (Pages 1–9)
Before finalizing the JSON file for Pages 1–9, confirm the targeting behavior for the three support moves that do not display a $3 \times 3$ grid on their card:
1. **Clefable & Furret — *Follow Me* (Pages 3 & 5):** Self-cast buff (no target required).
2. **Cherrim — *Flower Shield* & *Sunny Day* (Page 3):** Global field effects (no target grid required; affects all qualifying units on the board).
3. **Furret — *Endeavor* (Page 5):** `[TODO: Supply the 3x3 target grid for Furret's Endeavor, as the grid graphic is blank on Page 5]`.

### 8.3 Declarative Card JSON Schema
```json
{
  "id": "butterfree",
  "name": "Butterfree",
  "hp": 100,
  "types": ["Bug", "Flying"],
  "baseMov": 3,
  "moves": [
    {
      "name": "Pollen Puff",
      "type": "Bug",
      "basePower": 50,
      "grid": [
        [0, 1, 0],
        [0, 0, 0],
        [0, 2, 0]
      ],
      "effects": [
        { "type": "allyHealInstead", "amount": 50 }
      ]
    },
    {
      "name": "Quiver Dance",
      "type": "Bug",
      "basePower": 0,
      "targetSelf": true,
      "effects": [
        { "type": "statStage", "target": "self", "stats": { "atk": 1, "def": 1, "mov": 1 } }
      ]
    }
  ],
  "ability": {
    "name": "Tinted Lens",
    "trigger": "onModifyTypeEffectiveness",
    "effect": "ignoreResistance"
  }
}
```

---

## 9. Running the v1.0 implementation

The game is called **Pokémon Conquest Chess**. It is a Vite + React + TypeScript client with a pure rules engine (`src/engine`) shared by the browser, the bot and the server. Rule decisions the spec leaves open are listed in [`docs/rules-interpretations.md`](docs/rules-interpretations.md).

```bash
npm install
npm run dev        # http://localhost:5173 — "Play vs Bot" and "Hot-seat" need no server
npm run server     # second terminal, for "Online match" (Vite proxies /ws to it)
npm test           # engine, mechanics, bot-vs-bot games, server integration
```

**Playing with friends (no install for them).** The game needs one small Node server for online rooms, so the simplest option is to host the whole thing on Render's free tier:

1. Push this repository to GitHub (a private repository works).
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repository. `render.yaml` sets everything up: it runs `npm ci && npm run build`, then `npm start`.
3. Share the `https://….onrender.com` address. Online rooms, vs Bot and hot-seat all work there.

Free Render services sleep after 15 minutes without visitors, so the first visit after a break takes about a minute to load. Rooms live in memory and are lost when the service restarts.

**GitHub Pages (optional).** `.github/workflows/pages.yml` publishes the client on every push to `main` (enable it under Settings → Pages → Source: GitHub Actions). Pages only serves static files: vs Bot and hot-seat work, but online rooms need the Render server. To connect them, add a repository variable `SERVER_URL` set to `wss://<your-service>.onrender.com/ws`. On a free GitHub plan, Pages requires a public repository.

To run the production build yourself: `npm run build && npm start` serves the client and the rooms on `$PORT` (default 8787).

**Modes**
- **vs Bot:** Easy, Medium or Hard, and you pick your role. The bot runs in a Web Worker.
  - Easy plays loosely.
  - Medium plans each Pokémon greedily.
  - Hard drafts with a team-strength model learned from self-play and searches the draft to the end (including denial picks). In battle it plans whole turns: it searches orders of activations, checks each finished turn against the opponent's best reply, with an evaluation that tracks the race against the round limit.
- **Online:** private 4-letter rooms with two seats and any number of spectators. The server rolls all dice. Players who drop rejoin their seat from the same browser.
- **Hot-seat:** two players on one device.

**Rule changes since the spec above** (constants in `src/engine/engine.ts`):
- Each match deals 15 random Pokémon and 4 random legendaries. Players alternate 3 picks each from the 15, then each picks one legendary.
- After the draft, a coin flip decides which side places first; placement then alternates.
- The battle lasts 10 rounds instead of 8. Round 1 is movement only.
- The trebuchet deals a flat 40 before type effectiveness.
- Two maps, chosen before each match: Trebuchet Meadow and Winding River (`src/engine/data/maps.ts`).

**Battle aids**
- **Danger zone** (button or the D key): red tiles show everywhere the opponent's Pokémon could attack after moving, with either move. Darker red means more attacks overlap. Hover a tile to see which attacks reach it.
- **Damage previews:** hover a move button to see everything it could hit from where the Pokémon stands, with damage on each target. The card panel shows each attack's damage against every opponent.
- **Type matchups:** hovering or selecting a Pokémon puts its best type multiplier on each opponent's token. The Matchups tab compares both teams. Every card lists its weaknesses, resistances and what its attacks hit hard. A full type chart is one click away in the draft, battle and card gallery.
- **Draft matchups:** hover or pin a card to see how every card in the pool hits it and is hit by it. Card details list the available cards that counter it.

**Layout**

| Path | Contents |
| :--- | :--- |
| `src/engine/` | Rules engine: card data (pages 1–9), map, damage pipeline, turn flow, previews, matchups and danger zone (`insight.ts`) |
| `src/ai/` | Bot (draft, placement, battle) and its Web Worker wrapper |
| `src/ui/` | React screens: menus, draft, placement, battle board |
| `src/net/`, `server/` | WebSocket protocol, client and room server |
| `public/art/`, `public/cards/` | Card art and the full printed cards, cropped from `Conquest Cards.pdf` |
| `tests/` | Vitest suites |
| `scripts/` | Bot arena and the training script for the Hard bot's draft model |

**Retraining the Hard bot** after changing cards or rules:

```bash
# once per map (meadow, river): the Hard bot keeps a separate draft model for each map
npx tsx scripts/arena.ts --a hard --d hard --draft random --map river --games 6000 --out draft.jsonl
npx tsx scripts/train-draft.ts --map river draft.jsonl   # writes src/ai/models/river.json
npx tsx scripts/arena.ts --a hard --d medium --games 100 --swap   # check the result
```
