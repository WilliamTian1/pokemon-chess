import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../ai/bot';
import { requestBotActions } from '../ai/client';
import { BOT_TURN_START_MS, botPause } from '../ai/pace';
import { DRAFT_TRANSITION_MS } from './components/Effects';
import {
  type Action, type DraftStyle, type GameEvent, type GameState, type Side, RuleError, applyAction, deciders, hiddenView, isSimultaneous, newGame,
  quickGame, randomSeed, seededRng,
} from '../engine';
import type { NetClient, NetSnapshot } from '../net/client';
import type { AccountView, ClockView, MatchResult } from '../net/protocol';

export interface EventBatch {
  seq: number;
  list: GameEvent[];
}

export interface Controller {
  mode: 'local' | 'bot' | 'online';
  state: GameState;
  events: EventBatch;
  /** Sides this screen may act for (both in hot-seat, none when spectating). */
  mySides: Side[];
  names: Record<Side, string>;
  dispatch: (a: Action) => void;
  error: string | null;
  clearError: () => void;
  thinking: boolean;
  /** Start a fresh game with the same settings (local modes) or ask the host (online). */
  rematch?: () => void;
  isHost?: boolean;
  /** Online: chess-style clocks (timed matches), with the local-minus-server time skew. */
  clock?: (ClockView & { skew: number }) | null;
  /** Ranked matches: the accounts behind each side, and the result with rating changes. */
  rated?: boolean;
  accounts?: Record<Side, AccountView | null>;
  result?: MatchResult | null;
}

/** What a match is played with (setup screens, the online lobby and matchmaking). */
export interface MatchOptions {
  mapId: string;
  legendaries: boolean;
  trainers: boolean;
  style?: DraftStyle;
}

export type LocalConfig =
  | ({ mode: 'local'; scenario?: Scenario } & MatchOptions)
  | ({ mode: 'bot'; human: Side; level: Difficulty } & MatchOptions);

/** Development only: a battle that starts with these teams already placed (see App's ?scenario=). */
export interface Scenario {
  A: string[];
  D: string[];
  trainers?: Record<Side, string>;
}

function scenarioGame(sc: Scenario, mapId: string, rng: ReturnType<typeof seededRng>): GameState {
  // Entries are card ids, optionally "id@x.y" to start on that tile.
  const parse = (e: string) => {
    const [id, at] = e.split('@');
    const [x, y] = at ? at.split('.').map(Number) : [NaN, NaN];
    return { id, pos: at ? { x, y } : null };
  };
  const A = sc.A.map(parse);
  const D = sc.D.map(parse);
  const s = quickGame(A.map((e) => e.id), D.map((e) => e.id), { rng, mapId });
  [...A.map((e, i) => [`A${i}`, e.pos] as const), ...D.map((e, i) => [`D${i}`, e.pos] as const)].forEach(([id, pos]) => {
    const u = s.units.find((x) => x.id === id);
    if (u && pos) u.pos = pos;
  });
  if (sc.trainers) s.trainers = { pool: [sc.trainers.A, sc.trainers.D], picks: { ...sc.trainers }, used: { A: false, D: false }, effect: null };
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LEVEL_NAME: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Hot-seat and vs-bot games: the engine runs in the browser. */
export function useLocalGame(cfg: LocalConfig): Controller {
  const rng = useRef(seededRng(randomSeed()));
  const [state, setState] = useState<GameState>(() => (cfg.mode === 'local' && cfg.scenario
    ? scenarioGame(cfg.scenario, cfg.mapId, rng.current)
    : newGame({ rng: rng.current, mapId: cfg.mapId, legendaries: cfg.legendaries, trainers: cfg.trainers, style: cfg.style })));
  const [events, setEvents] = useState<EventBatch>({ seq: 0, list: [] });
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [botTick, setBotTick] = useState(0);
  const stateRef = useRef(state);
  const botBusy = useRef(false);
  const botFailures = useRef(0);
  const generation = useRef(0);

  /** Applies an action; returns what happened, or null if the rules refused it. */
  const apply = useCallback((a: Action, fromBot: boolean): GameEvent[] | null => {
    try {
      const r = applyAction(stateRef.current, a, rng.current);
      stateRef.current = r.state;
      setState(r.state);
      setEvents((e) => ({ seq: e.seq + 1, list: r.events }));
      return r.events;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      if (!fromBot) setError(e.message);
      return null;
    }
  }, []);

  const botSide: Side | null = cfg.mode === 'bot' ? (cfg.human === 'A' ? 'D' : 'A') : null;
  const level = cfg.mode === 'bot' ? cfg.level : 'medium';

  useEffect(() => {
    if (!botSide || botBusy.current) return;
    const s = stateRef.current;
    // In a Secret draft the bot picks and places while you do (deciders has both sides).
    if (!deciders(s).includes(botSide)) return;
    botBusy.current = true;
    setThinking(!isSimultaneous(s));
    const gen = generation.current;
    const started = performance.now();
    void (async () => {
      try {
        // The bot gets the same view a player in its seat would: nothing hidden.
        const acts = await requestBotActions(hiddenView(s, botSide), botSide, level);
        // Right after the draft the versus screen counts down; place once it has gone.
        // In battle its first action waits for the new-turn notice, so nothing happens underneath it.
        const turnStart = s.phase === 'battle' && !s.active && !s.pending.length && !s.units.some((u) => u.side === botSide && u.activated);
        const pace = s.phase === 'placement' && s.placement.index === 0 && !isSimultaneous(s) ? DRAFT_TRANSITION_MS : turnStart ? BOT_TURN_START_MS : 450;
        await sleep(Math.max(0, pace - (performance.now() - started)));
        let applied = 0;
        for (let i = 0; i < acts.length; i++) {
          if (gen !== generation.current || !deciders(stateRef.current).includes(botSide)) break;
          const done = apply(acts[i], true);
          if (!done) break;
          applied += 1;
          // Each step stays on screen long enough to follow (a move's name, its zone, the damage).
          await sleep(stateRef.current.phase === 'battle' || stateRef.current.phase === 'over' ? botPause(done) : 450);
        }
        // Never let a confused bot stall the game: fall back to the simplest legal step.
        botFailures.current = applied === 0 && gen === generation.current ? botFailures.current + 1 : 0;
        if (botFailures.current >= 2) {
          botFailures.current = 0;
          const cur = stateRef.current;
          const fallbacks: Action[] = cur.pending.length
            ? [{ type: 'choose', option: cur.pending[0].options[0] ?? null }, { type: 'choose', option: null }]
            : cur.active
              ? [{ type: 'skipPostMove', unitId: cur.active.unitId }, { type: 'wait', unitId: cur.active.unitId }, { type: 'endTurn' }]
              : [{ type: 'endTurn' }, { type: 'concede', side: botSide }];
          for (const f of fallbacks) if (apply(f, true)) break;
        }
      } finally {
        botBusy.current = false;
        setThinking(false);
        setBotTick((t) => t + 1);
      }
    })();
  }, [state, botTick, botSide, level, apply]);

  const rematch = useCallback(() => {
    generation.current += 1;
    const s = newGame({ rng: rng.current, mapId: cfg.mapId, legendaries: cfg.legendaries, trainers: cfg.trainers, style: cfg.style });
    stateRef.current = s;
    setState(s);
    setEvents((e) => ({ seq: e.seq + 1, list: [] }));
    setError(null);
  }, [cfg.mapId, cfg.legendaries, cfg.trainers, cfg.style]);

  const names = useMemo<Record<Side, string>>(() => {
    if (cfg.mode === 'local') return { A: 'Player 1', D: 'Player 2' };
    const bot = `Bot (${LEVEL_NAME[cfg.level]})`;
    return cfg.human === 'A' ? { A: 'You', D: bot } : { A: bot, D: 'You' };
  }, [cfg]);

  return {
    mode: cfg.mode,
    state,
    events,
    mySides: cfg.mode === 'local' ? ['A', 'D'] : [cfg.human],
    names,
    dispatch: (a) => {
      if (botSide && !deciders(stateRef.current).includes(cfg.mode === 'bot' ? cfg.human : 'A') && a.type !== 'concede') return;
      apply(a, false);
    },
    error,
    clearError: () => setError(null),
    thinking,
    rematch,
    isHost: true,
  };
}

/** Subscribes to a NetClient. */
export function useNet(client: NetClient): NetSnapshot {
  const [snap, setSnap] = useState<NetSnapshot>(client.snapshot);
  useEffect(() => client.subscribe(setSnap), [client]);
  return snap;
}

/** Online games: the server is authoritative; this just mirrors its state. */
export function useOnlineGame(client: NetClient, snap: NetSnapshot): Controller | null {
  const room = snap.room;
  const me = room?.players.find((p) => p.id === snap.playerId);
  const names = useMemo<Record<Side, string>>(() => {
    const n: Record<Side, string> = { A: 'Attacker', D: 'Defender' };
    for (const p of room?.players ?? []) if (p.side) n[p.side] = p.name + (p.connected ? '' : ' (offline)');
    return n;
  }, [room]);
  if (!room?.game) return null;
  return {
    mode: 'online',
    state: room.game,
    events: { seq: room.eventSeq, list: room.events },
    mySides: me?.side ? [me.side] : [],
    names,
    dispatch: (a) => client.send({ t: 'action', action: a }),
    error: snap.error,
    clearError: () => client.clearError(),
    thinking: false,
    rematch: !room.rated && room.hostId === snap.playerId ? () => client.send({ t: 'rematch', swapRoles: true }) : undefined,
    isHost: room.hostId === snap.playerId,
    clock: room.clock ? { ...room.clock, skew: snap.clockSkew } : null,
    rated: !!room.rated,
    accounts: room.accounts,
    result: room.result,
  };
}
