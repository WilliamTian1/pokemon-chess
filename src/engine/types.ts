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
  | 'hospitality' | 'liquidVoice' | 'iceScales' | 'slushRush';

/** Grid strings are the card's mini-grid, rows top→bottom joined by `/`.
 *  `G` user, `O` target, `B` user dashes here first, `R` knockback destination, `.` empty. */
export type TargetSpec =
  | { kind: 'grid'; grid: string }
  | { kind: 'self' }
  | { kind: 'global' }
  | { kind: 'range'; range: number }
  | { kind: 'ally' }
  | { kind: 'place'; grid: string; place: 'spikes' | 'web' | 'substitute' };

export type Bonus =
  | { when: 'userStatus'; amount: number }
  | { when: 'targetStatus'; amount: number }
  | { when: 'normalTerrain'; amount: number }
  | { when: 'userHpAtMost'; hp: number; amount: number }
  | { when: 'userDamageAtLeast'; dmg: number; amount: number }
  | { when: 'singleTarget'; amount: number }
  | { when: 'chance'; chance: number; amount: number };

export type SpecialMove =
  | 'foulPlay' | 'powerTrip' | 'endeavor' | 'gyroBall' | 'allySwitch' | 'followMe'
  | 'ragePowder' | 'futureSight' | 'sunnyDay' | 'rainDance' | 'sandstorm' | 'hail'
  | 'flowerShield';

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
  selfAndAdjAlliesStages?: Partial<Stages>;
  grassImmune?: boolean;
  special?: SpecialMove;
}

export interface MoveDef {
  name: string;
  type: PType | null;
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
  followMe: null | { kind: 'followMe' | 'ragePowder'; duringTurnOf: Side };
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
}

export type Pending =
  | { kind: 'emergencyExit'; side: Side; unitId: string; options: string[] }
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

export interface GameState {
  version: 1;
  mapId: string;
  phase: Phase;
  round: number;
  maxRounds: number;
  side: Side;
  /** `pool` and `legendPool` are this match's random selections of normal and legendary cards. */
  draft: { order: Side[]; index: number; picks: Record<Side, string[]>; pool: string[]; legendPool: string[] };
  /** `first` is the winner of the coin flip at the end of the draft (null until then). */
  placement: { order: Side[]; index: number; first: Side | null };
  units: Unit[];
  hazards: Hazard[];
  substitute: { pos: Pos; ownerId: string } | null;
  futureSight: { userId: string; side: Side; pos: Pos }[];
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
  | { type: 'draftPick'; cardId: string }
  | { type: 'place'; unitId: string; pos: Pos }
  | { type: 'move'; unitId: string; to: Pos }
  | { type: 'undoMove'; unitId: string }
  | { type: 'useMove'; unitId: string; moveIndex: 0 | 1; dir?: Dir; targetId?: string }
  | { type: 'trebuchet'; unitId: string; targetId: string; attackType: PType }
  | { type: 'wait'; unitId: string }
  | { type: 'postMove'; unitId: string; to: Pos }
  | { type: 'skipPostMove'; unitId: string }
  | { type: 'endTurn' }
  | { type: 'choose'; option: string | null }
  | { type: 'concede'; side: Side };

export type GameEvent =
  | { t: 'move'; unitId: string; path: Pos[] }
  | { t: 'attack'; unitId: string; name: string; tiles: Pos[] }
  | { t: 'damage'; unitId: string; amount: number }
  | { t: 'heal'; unitId: string; amount: number }
  | { t: 'faint'; unitId: string }
  | { t: 'miss'; unitId: string }
  | { t: 'text'; text: string };

export interface Rng {
  chance(p: number): boolean;
  d6(): number;
  int(n: number): number;
}
