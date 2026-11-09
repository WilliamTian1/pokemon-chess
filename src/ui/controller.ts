import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../ai/bot';
import { requestBotActions } from '../ai/client';
import {
  type Action, type GameEvent, type GameState, type Side, RuleError, applyAction, decider, newGame, randomSeed, seededRng,
} from '../engine';
import type { NetClient, NetSnapshot } from '../net/client';

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
}

export type LocalConfig =
  | { mode: 'local'; mapId: string; legendaries: boolean }
  | { mode: 'bot'; human: Side; level: Difficulty; mapId: string; legendaries: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LEVEL_NAME: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Hot-seat and vs-bot games: the engine runs in the browser. */
export function useLocalGame(cfg: LocalConfig): Controller {
  const rng = useRef(seededRng(randomSeed()));
  const [state, setState] = useState<GameState>(() => newGame({ rng: rng.current, mapId: cfg.mapId, legendaries: cfg.legendaries }));
  const [events, setEvents] = useState<EventBatch>({ seq: 0, list: [] });
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [botTick, setBotTick] = useState(0);
  const stateRef = useRef(state);
  const botBusy = useRef(false);
  const botFailures = useRef(0);
  const generation = useRef(0);

  const apply = useCallback((a: Action, fromBot: boolean): boolean => {
    try {
      const r = applyAction(stateRef.current, a, rng.current);
      stateRef.current = r.state;
      setState(r.state);
      setEvents((e) => ({ seq: e.seq + 1, list: r.events }));
      return true;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      if (!fromBot) setError(e.message);
      return false;
    }
  }, []);

  const botSide: Side | null = cfg.mode === 'bot' ? (cfg.human === 'A' ? 'D' : 'A') : null;
  const level = cfg.mode === 'bot' ? cfg.level : 'medium';

  useEffect(() => {
    if (!botSide || botBusy.current) return;
    const s = stateRef.current;
    if (decider(s) !== botSide) return;
    botBusy.current = true;
    setThinking(true);
    const gen = generation.current;
    const started = performance.now();
    void (async () => {
      try {
        const acts = await requestBotActions(s, botSide, level);
        const pace = s.phase === 'battle' ? 380 : 450;
        await sleep(Math.max(0, pace - (performance.now() - started)));
        let applied = 0;
        for (let i = 0; i < acts.length; i++) {
          if (gen !== generation.current || decider(stateRef.current) !== botSide) break;
          if (!apply(acts[i], true)) break;
          applied += 1;
          if (i < acts.length - 1) await sleep(acts[i].type === 'move' ? 520 : 420);
        }
        // Never let a confused bot stall the game: fall back to the simplest legal step.
        botFailures.current = applied === 0 && gen === generation.current ? botFailures.current + 1 : 0;
        if (botFailures.current >= 2) {
          botFailures.current = 0;
          const cur = stateRef.current;
          const fallbacks: Action[] = cur.pending.length
            ? [{ type: 'choose', option: cur.pending[0].kind === 'liquidVoice' ? null : cur.pending[0].options[0] }]
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
    const s = newGame({ rng: rng.current, mapId: cfg.mapId, legendaries: cfg.legendaries });
    stateRef.current = s;
    setState(s);
    setEvents((e) => ({ seq: e.seq + 1, list: [] }));
    setError(null);
  }, [cfg.mapId, cfg.legendaries]);

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
      if (botSide && decider(stateRef.current) === botSide && a.type !== 'concede') return;
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
    rematch: room.hostId === snap.playerId ? () => client.send({ t: 'rematch', swapRoles: true }) : undefined,
    isHost: room.hostId === snap.playerId,
  };
}
