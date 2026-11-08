import { type Action, type GameState, type Side, randomSeed, seededRng } from '../engine';
import { type Difficulty, decide } from './bot';

export interface BotRequest {
  id: number;
  state: GameState;
  side: Side;
  level: Difficulty;
  seed: number;
}

export interface BotResponse {
  id: number;
  actions: Action[];
  error?: string;
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (r: BotResponse) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BotResponse>) => {
      const cb = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      cb?.(e.data);
    };
    worker.onerror = () => {
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Asks the bot (in a Web Worker when available) for its next action(s). */
export function requestBotActions(state: GameState, side: Side, level: Difficulty): Promise<Action[]> {
  const seed = randomSeed();
  const w = getWorker();
  if (!w) return Promise.resolve(decide(state, side, level, seededRng(seed)));
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, (r) => {
      if (r.error) console.error('Bot error:', r.error);
      resolve(r.actions);
    });
    w.postMessage({ id, state, side, level, seed } satisfies BotRequest);
  });
}
