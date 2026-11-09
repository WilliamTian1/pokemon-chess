import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Difficulty } from '../src/ai/bot';
import type { Action, GameState, Side } from '../src/engine';

interface Task {
  id: number;
  msg: { id: number; state: GameState; side: Side; level: Difficulty; seed: number };
  /** 0: a game with a human in it; 1: bots playing each other while idle. */
  priority: 0 | 1;
  resolve: (a: Action[]) => void;
  reject: (e: Error) => void;
}

/**
 * Bot moves for the server's bot accounts, computed in worker threads (BOT_THREADS, default 2) so a
 * Hard bot's search never blocks the server. Games with a human in them go first.
 */
export class BotPool {
  private workers: { w: Worker; busy: Task | null }[] = [];
  private queue: Task[] = [];
  private nextId = 1;

  constructor(threads = Number(process.env.BOT_THREADS ?? 2)) {
    const file = pathToFileURL(path.resolve(import.meta.dirname, 'botWorker.ts')).href;
    // Workers don't inherit tsx's loader, so each one registers it before loading the worker module.
    const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(file)}); })`;
    for (let i = 0; i < Math.max(1, threads); i++) this.spawn(boot);
  }

  private spawn(boot: string): void {
    const slot: { w: Worker; busy: Task | null } = { w: new Worker(boot, { eval: true }), busy: null };
    slot.w.on('message', (m: { id: number; actions?: Action[]; error?: string }) => {
      const t = slot.busy;
      slot.busy = null;
      if (t && t.id === m.id) (m.error ? t.reject(new Error(m.error)) : t.resolve(m.actions ?? []));
      this.pump();
    });
    slot.w.on('error', (e) => {
      console.error('[bots] worker crashed:', e);
      slot.busy?.reject(e instanceof Error ? e : new Error(String(e)));
      this.workers = this.workers.filter((x) => x !== slot);
      this.spawn(boot);
    });
    this.workers.push(slot);
    this.pump();
  }

  /** Whether the idle bot-vs-bot games may queue more work. */
  get idle(): boolean {
    return this.queue.length === 0 && this.workers.some((w) => !w.busy);
  }

  decide(state: GameState, side: Side, level: Difficulty, priority: 0 | 1): Promise<Action[]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({ id, msg: { id, state, side, level, seed: Math.floor(Math.random() * 2 ** 31) }, priority, resolve, reject });
      this.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
      this.pump();
    });
  }

  private pump(): void {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      const t = this.queue.shift()!;
      slot.busy = t;
      slot.w.postMessage(t.msg);
    }
  }

  close(): void {
    for (const s of this.workers) void s.w.terminate();
  }
}
