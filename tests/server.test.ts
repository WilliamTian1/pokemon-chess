import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, RoomView, ServerMsg } from '../src/net/protocol';

const PORT = 18000 + Math.floor(Math.random() * 1000);
let server: ChildProcess;

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout!.on('data', (d) => {
      if (String(d).includes('server on')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
});

afterAll(() => {
  server?.kill();
});

class TestClient {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  room: RoomView | null = null;
  id = '';
  constructor(readonly token: string, readonly name: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.inbox.push(m);
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'welcome') this.id = m.id;
    });
  }
  async open(): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) await new Promise((r) => this.ws.once('open', r));
    this.send({ t: 'hello', token: this.token, name: this.name });
    await this.until((m) => m.t === 'welcome');
  }
  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: (m: ServerMsg) => boolean, ms = 4000): Promise<ServerMsg> {
    const start = Date.now();
    for (;;) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(0, i + 1)[i];
      if (Date.now() - start > ms) throw new Error('timeout waiting for message');
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  close(): void {
    this.ws.close();
  }
}

describe('room server', () => {
  it('runs a validated match between two seated players', async () => {
    const a = new TestClient('tok-a', 'Ash');
    const b = new TestClient('tok-b', 'Misty');
    const c = new TestClient('tok-c', 'Brock');
    await Promise.all([a.open(), b.open(), c.open()]);

    a.send({ t: 'create' });
    const created = (await a.until((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    const code = created.room.code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    b.send({ t: 'join', code });
    await b.until((m) => m.t === 'room');
    b.send({ t: 'seat', side: 'D' });
    await b.until((m) => m.t === 'room' && m.room.players.some((p) => p.side === 'D'));
    c.send({ t: 'join', code });
    await c.until((m) => m.t === 'room');

    // Only the host may start.
    b.send({ t: 'start', randomRoles: false });
    expect(await b.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/host/) });

    a.send({ t: 'start', randomRoles: false });
    await a.until((m) => m.t === 'room' && !!m.room.game);
    expect(a.room!.game!.phase).toBe('draft');
    const [first, second] = a.room!.game!.draft.pool;
    expect(a.room!.game!.draft.pool).toHaveLength(15);

    // Defender may not pick first; spectators may not act at all.
    b.send({ t: 'action', action: { type: 'draftPick', cardId: second } });
    expect(await b.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/not your decision/i) });
    c.send({ t: 'action', action: { type: 'draftPick', cardId: second } });
    expect(await c.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/Spectators/) });

    a.send({ t: 'action', action: { type: 'draftPick', cardId: first } });
    await c.until((m) => m.t === 'room' && m.room.game?.draft.picks.A[0] === first);

    // Illegal engine actions are reported, not applied.
    b.send({ t: 'action', action: { type: 'draftPick', cardId: first } });
    expect(await b.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/already drafted/) });

    // Reconnecting with the same token keeps the seat.
    b.close();
    const b2 = new TestClient('tok-b', 'Misty');
    await b2.open();
    b2.send({ t: 'join', code });
    const rejoined = (await b2.until((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    expect(rejoined.room.players.find((p) => p.id === b2.id)?.side).toBe('D');

    b2.send({ t: 'action', action: { type: 'concede', side: 'D' } });
    await a.until((m) => m.t === 'room' && m.room.game?.phase === 'over');
    expect(a.room!.game!.winner).toBe('A');

    for (const x of [a, b2, c]) x.close();
  });
});
