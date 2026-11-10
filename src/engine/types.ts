export type Side = 'A' | 'D';
export const SIDES: readonly Side[] = ['A', 'D'];
export const otherSide = (s: Side): Side => (s === 'A' ? 'D' : 'A');
export const SIDE_NAME: Record<Side, string> = { A: 'Attacker', D: 'Defender' };

export const TYPES = [
  'Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;
export type PType = (typeof TYPES)[number];

export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export interface Pos {
  x: number;
  y: number;
}

/** Terrain of a single map tile. `dirt` and `grass` behave exactly like `normal`. */
export type Terrain =
  | 'normal'
  | 'dirt'
  | 'grass'
  | 'bridge'
  | 'water'
  | 'flower'
  | 'bush'
  | 'wall'
  | 'magma'
  | 'ice'
  | 'pit';

export type StatusId = 'psn' | 'tox' | 'brn' | 'par' | 'slp' | 'frz';
export type StatId = 'atk' | 'def' | 'mov';
export type Stages = Record<StatId, number>;

// ---------------------------------------------------------------- cards

export type AbilityId =
  | 'solarPower' | 'rainDish' | 'chlorophyll' | 'static' | 'thickFat' | 'tintedLens'
  | 'multiscale' | 'sandStream' | 'clearBody' | 'sereneGrace' | 'intimidate' | 'shadowDash'
  | 'angerPoint' | 'levitate' | 'technician' | 'unaware' | 'resistance' | 'synchronize'
  | 'flowerGiftOvercast' | 'flowerGiftSunshine' | 'emergencyExit' | 'naturalCure'
  | 'justified' | 'guts' | 'ironFist' | 'defeatist' | 'shieldsDownMeteor' | 'shieldsDownCore'
  | 'moxie' | 'poisonHeal' | 'runAway' | 'keenEye' | 'stormDrain' | 'hardArmor' | 'contrary'
  | 'regenerator' | 'celebrate' | 'sturdy' | 'truant' | 'competitive' | 'compoundEyes'
  | 'shadowShield' | 'darkAura' | 'pressure' | 'teravolt' | 'airLock' | 'turboblaze'
  | 'drizzle' | 'drought' | 'leech' | 'infiltrator' | 'ironBarbs' | 'waveRider'
  | 'hospitality' | 'liquidVoice' | 'iceScales' | 'slushRush'
  | 'unburden' | 'pixilate' | 'moldBreaker' | 'leafGuard' | 'snowCloak' | 'adaptability' | 'artilleryExpertise'
  | 'triage' | 'decoy' | 'imposter' | 'wonderGuard' | 'speedBoost' | 'dancer'
  | 'snowWarning' | 'swallow' | 'adaptabilityWaterDark';

/** Grid strings are the card's mini-grid, rows top→bottom joined by `/`.
 *  `G` user, `O` target, `B` user dashes here first, `R` knockback destination, `.` empty. */
export type TargetSpec =
  | { kind: 'grid'; grid: string }
  | { kind: 'self' }
  | { kind: 'global' }
  /** A single Pokémon within `range` steps (and at least `min` away, Octazooka). */
  | { kind: 'range'; range: number; min?: number }
  /** An ally anywhere, or within `range` steps (Baton Pass). */
  | { kind: 'ally'; range?: number }
  | { kind: 'place'; grid: string; place: 'spikes' | 'web' | 'substitute' };

export type Bonus =
  | { when: 'userStatus'; amount: number }
  | { when: 'targetStatus'; amount: number }
  | { when: 'normalTerrain'; amount: number }
  /** Knock Off: the target stands on a berry bush or flowers. */
  | { when: 'targetBonusTerrain'; amount: number }
  | { when: 'userHpAtMost'; hp: number; amount: number }
  | { when: 'userDamageAtLeast'; dmg: number; amount: number }
  | { when: 'singleTarget'; amount: number }
  | { when: 'chance'; chance: number; amount: number }
  /** Fury Cutter: `amount` extra per round number. */
  | { when: 'round'; amount: number };

export type SpecialMove =
  | 'foulPlay' | 'powerTrip' | 'endeavor' | 'gyroBall' | 'allySwitch' | 'followMe'
  | 'ragePowder' | 'futureSight' | 'sunnyDay' | 'rainDance' | 'sandstorm' | 'hail'
  | 'flowerShield' | 'lightScreen' | 'tailwind' | 'helpingHand' | 'afterYou' | 'transform' | 'batonPass' | 'taunt' | 'metronome'
  | 'psycheUp' | 'wideGuard' | 'auroraVeil' | 'spitUp';

export interface MoveFx {
  graze?: { chance: number; power: number; negateNear?: 'water' | 'ice' };
  /** Per-target chance to miss completely. */
  missChance?: number;
  /** Single roll: the whole move misses and the user takes damage. */
  missAll?: { chance: number; selfDamage: number };
  /** Per-target chance a status move lands. */
  hitChance?: number;
  dice?: boolean;
  bonus?: Bonus[];
  status?: { id: StatusId; chance: number; noGraze?: boolean };
  triStatus?: number;
  confuse?: { chance: number; noGraze?: boolean };
  flinch?: { chance: number; noGraze?: boolean };
  targetStages?: { stages: Partial<Stages>; chance: number };
  /** Applied to the user after the move (chance defaults to 1; chance moves need a hit). */
  selfStages?: { stages: Partial<Stages>; chance?: number };
  preSelfStages?: Partial<Stages>;
  ignoreDefBoosts?: boolean;
  removeDefBoosts?: boolean;
  /** Clear Smog: all of the target's stages are ignored for this hit. */
  ignoreAllDefStages?: boolean;
  /** Shadow Punch, Knock Off: the target's terrain bonus (berry bush defense) is ignored. */
  ignoreTerrain?: boolean;
  /** Spit Up: the user's defense boosts are removed after the attack. */
  removeUserDefBoosts?: boolean;
  resetTargetStages?: boolean;
  invertTargetStages?: boolean;
  ignoreAbilities?: boolean;
  recoil?: number;
  recoilPerTarget?: number;
  drain?: number;
  drainPerTarget?: number;
  selfSleepChance?: number;
  selfFaint?: boolean;
  nextTurn?: { noMove?: boolean; noAct?: boolean; unlessAdjFire?: boolean; droughtSkips?: boolean };
  postMove?: number;
  allyHeal?: number;
  heal?: number;
  selfHeal?: number;
  healSelfAndAllies?: number;
  alliesStages?: Partial<Stages>;
  grassImmune?: boolean;
  special?: SpecialMove;
  /** Gigaton Hammer: usable only in even-numbered rounds. */
  evenRoundsOnly?: boolean;
  /** Fake Out: can't be used again until the user ends an activation this many steps from every opponent. */
  lockUntilFar?: number;
  /** Mortal Spin: destroys spikes and webs in the zone. */
  clearHazards?: boolean;
  /** Floral Healing: heals this much instead of `heal` for targets on bonus terrain (berry bush, flowers). */
  healOnBonusTerrain?: number;
  /** A card with only one move fills its second slot with a move that can never be used. */
  none?: boolean;
}

export interface MoveDef {
  name: string;
  type: PType | null;
  /** A second type the move carries at the same time (Flying Press: Fighting and Flying). */
  extraType?: PType;
  /** Printed power; null for status moves and variable-power moves. */
  power: number | null;
  powerLabel?: string;
  kind: 'attack' | 'status';
  target: TargetSpec;
  text: string;
  fx: MoveFx;
}

export interface CardDef {
  id: string;
  name: string;
  types: PType[];
  hp: number;
  mov: number;
  moves: [MoveDef, MoveDef];
  ability: AbilityId;
  abilityName: string;
  abilityText: string;
  page: number;
  /** Alternate forms are not draftable; they are reached by transformation. */
  draftable: boolean;
  /** Legendaries are drafted from their own pool, as each side's last pick. */
  legendary: boolean;
  formOf?: string;
  formLabel?: string;
  forms?: string[];
  /** Notes about interpretation choices for this card (shown in the card viewer). */
  notes?: string[];
}

// ---------------------------------------------------------------- map

export interface MapDef {
  id: string;
  name: string;
  theme?: 'snow' | 'volcano';
  width: number;
  height: number;
  tiles: Terrain[][];
  trebuchets: Pos[];
  spawns: Record<Side, Pos[]>;
  /** Purely decorative hedge segments drawn along the board edge. */
  decor?: { hedges: { x: number; y: number; edge: 'N' | 'E' | 'S' | 'W' }[] };
}

// ---------------------------------------------------------------- state

export interface TurnFlags {
  noMove: boolean;
  noAct: boolean;
  reasons: string[];
}

export interface Unit {
  id: string;
  side: Side;
  /** Current form. */
  cardId: string;
  /** The card that was drafted. */
  draftId: string;
  hp: number;
  maxHp: number;
  pos: Pos | null;
  fainted: boolean;
  stages: Stages;
  status: StatusId | null;
  toxicN: number;
  confused: boolean;
  flinched: boolean;
  sturdyBroken: boolean;
  nextTurn: { noMove: boolean; noAct: boolean };
  turn: TurnFlags;
  activated: boolean;
  /**
   * Extra activations this turn, taken after the current one ends ("can act again": Celebrate, or
   * After You on an ally that hasn't gone yet).
   */
  actAgain: number;
  /** After You already gave this Pokémon an extra activation this turn (once per turn). */
  gotAfterYou: boolean;
  followMe: null | { kind: 'followMe' | 'ragePowder'; duringTurnOf: Side };
  /** Wide Guard: during this side's turn, attacks that hit this Pokémon and any other are invalidated. */
  wideGuard: Side | null;
  /** Moves on cooldown (Fake Out) until the user ends an activation far enough from opponents. */
  locked: string[];
  /** Extra damage on this unit's attacks until its side's turn ends (Helping Hand, Nobunaga). */
  dmgBonus: number;
  /** Nobunaga's special: extra movement this turn and opponents' defense boosts ignored. */
  movBonus: number;
  ignoreDefBoosts: boolean;
}

export interface Hazard {
  kind: 'spikes' | 'web';
  pos: Pos;
}

export interface ActiveActivation {
  unitId: string;
  /** moved: has moved, may still act. acted: has acted, may use post-move. */
  stage: 'moved' | 'acted';
  from: Pos;
  moveCost: number;
  movBudget: number;
  undoable: boolean;
  postMove: number;
  movedThisActivation: boolean;
  /** Triage: walked past the normal allowance, so the action must be a healing move. */
  mustHeal?: boolean;
}

export type Pending =
  | { kind: 'emergencyExit'; side: Side; unitId: string; options: string[] }
  /** Imposter: copy the stat changes of one of these adjacent Pokémon (or decline). */
  | { kind: 'imposter'; side: Side; unitId: string; options: string[] }
  /** Metronome: one of the drawn card's moves and how to aim it ("index:dir", "index:@unitId" or "index"). */
  | { kind: 'metronome'; side: Side; unitId: string; cardId: string; options: string[] }
  /** Dancer: copy another Pokémon's dance move, aimed one of these ways. */
  | { kind: 'dancer'; side: Side; unitId: string; source: { cardId: string; moveIndex: 0 | 1 }; options: Dir[] }
  | {
      kind: 'liquidVoice';
      side: Side;
      unitId: string;
      source: { cardId: string; moveIndex: 0 | 1 };
      options: Dir[];
    };

export interface LogEntry {
  n: number;
  text: string;
  side?: Side;
  round: number;
  tone?: 'info' | 'good' | 'bad' | 'system';
}

export type Phase = 'draft' | 'placement' | 'battle' | 'over';

/**
 * How teams are formed. classic: alternating picks from a shared pool; secret: each side picks from its
 * own hidden pool; auction: lots are revealed one at a time and bid for with 20 coins.
 */
export type DraftStyle = 'classic' | 'secret' | 'auction';

export interface AuctionLot {
  cardId: string;
  winner: Side | null;
  price: number;
  /** Dealt at random (a side ran out of coins, or the lots ran out). */
  random?: boolean;
}

export interface AuctionState {
  /** Lots still to come, in order. Hidden from the players (the server sends '?' in their place). */
  deck: string[];
  /** The lot being bid for. */
  lot: string | null;
  coins: Record<Side, number>;
  high: { side: Side; amount: number } | null;
  /** Whose call it is: bid higher, or pass. */
  toAct: Side;
  /** Who opened the current lot (alternates lot by lot). */
  opener: Side;
  /** Sides that passed on the current lot without bidding. */
  passed: Side[];
  history: AuctionLot[];
}

/** Trainer mode: four trainers are offered after the draft; the Attacker picks one, then the Defender. */
export interface TrainerState {
  pool: string[];
  picks: Record<Side, string | null>;
  /** Each trainer's Special Move can be used once per game. */
  used: Record<Side, boolean>;
  /** A special in effect for the rest of `side`'s current turn. */
  effect: { side: Side; kind: 'sureHit' | 'rally' | 'push2' } | null;
}

export interface GameState {
  version: 1;
  mapId: string;
  phase: Phase;
  round: number;
  maxRounds: number;
  side: Side;
  /** `pool` and `legendPool` are this match's random selections of normal and legendary cards. */
  draft: {
    order: Side[]; index: number; picks: Record<Side, string[]>; pool: string[]; legendPool: string[];
    /** Missing on games from before draft styles existed: classic. */
    style?: DraftStyle;
    /**
     * Secret draft: each side's own pools, legendary options and trainer options (the opponent's are
     * hidden from it). Both sides pick at the same time; nothing is revealed until the battle begins.
     */
    secret?: { pools: Record<Side, string[]>; legendPools: Record<Side, string[]>; trainerPools?: Record<Side, string[]> };
    auction?: AuctionState;
  };
  /** Placement alternates A, D, A, D…: the Attacker places first. */
  placement: { order: Side[]; index: number };
  units: Unit[];
  hazards: Hazard[];
  substitute: { pos: Pos; ownerId: string } | null;
  /** Pending Future Sights; each strikes around its user at the start of the user's next turn. */
  futureSight: { userId: string; side: Side }[];
  /** Taunt: the side whose current or next turn is taunted. */
  taunted: Side | null;
  /** Trainer mode (null when played without trainers). */
  trainers: TrainerState | null;
  active: ActiveActivation | null;
  pending: Pending[];
  winner: Side | null;
  winReason: string | null;
  log: LogEntry[];
  logCounter: number;
  seq: number;
}

// ---------------------------------------------------------------- actions & events

export type Action =
  /** `side`: who is picking, in the simultaneous Secret draft (otherwise the side on the clock). */
  | { type: 'draftPick'; cardId: string; side?: Side }
  /** Auction: bid `amount` coins for the current lot (more than the standing bid), or pass. */
  | { type: 'bid'; amount: number }
  | { type: 'passBid' }
  /** Time control: `side` ran out of time (sent by the server). */
  | { type: 'timeout'; side: Side }
  | { type: 'place'; unitId: string; pos: Pos }
  | { type: 'move'; unitId: string; to: Pos }
  | { type: 'undoMove'; unitId: string }
  /** `copy`: Transform uses this move of a Pokémon on the field. */
  | { type: 'useMove'; unitId: string; moveIndex: 0 | 1; dir?: Dir; targetId?: string; copy?: { unitId: string; moveIndex: 0 | 1 } }
  | { type: 'trebuchet'; unitId: string; targetId: string }
  | { type: 'wait'; unitId: string }
  | { type: 'postMove'; unitId: string; to: Pos }
  | { type: 'skipPostMove'; unitId: string }
  | { type: 'endTurn' }
  /** The side's trainer Special Move (Nobunaga's names the Pokémon it boosts). */
  | { type: 'trainerSpecial'; unitId?: string }
  | { type: 'choose'; option: string | null }
  | { type: 'concede'; side: Side };

export type GameEvent =
  | { t: 'move'; unitId: string; path: Pos[]; iceSlideFrom?: number }
  | { t: 'attack'; unitId: string; name: string; tiles: Pos[] }
  | { t: 'damage'; unitId: string; amount: number }
  | { t: 'heal'; unitId: string; amount: number }
  | { t: 'faint'; unitId: string }
  | { t: 'miss'; unitId: string }
  | { t: 'status'; unitId: string; status: StatusId | 'confused' | 'flinched' }
  | { t: 'stage'; unitId: string; stat: StatId; delta: number }
  /** A trainer's Special Move. */
  | { t: 'special'; side: Side; trainer: string }
  /** A Pokémon changed form (Cherrim's Sunshine form, Minior's Core). */
  | { t: 'transform'; unitId: string; cardId: string }
  /** A move or ability that affects the whole field (weather, Light Screen, Taunt…). */
  | { t: 'field'; kind: 'sun' | 'rain' | 'sand' | 'hail' | 'screen' | 'wind' | 'veil' | 'guard' | 'taunt' | 'flowers'; side: Side }
  | { t: 'text'; text: string };

export interface Rng {
  chance(p: number): boolean;
  d6(): number;
  int(n: number): number;
}
