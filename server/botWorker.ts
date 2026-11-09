import { parentPort } from 'node:worker_threads';
import { type Difficulty, decide } from '../src/ai/bot';
import { type GameState, type Side, seededRng } from '../src/engine';

/** One bot thread: answers { id, state, side, level, seed } with the actions the bot takes. */
parentPort!.on('message', (m: { id: number; state: GameState; side: Side; level: Difficulty; seed: number }) => {
  try {
    parentPort!.postMessage({ id: m.id, actions: decide(m.state, m.side, m.level, seededRng(m.seed)) });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error).message ?? String(e) });
  }
});
