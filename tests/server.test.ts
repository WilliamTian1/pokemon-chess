import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, RoomView, ServerMsg } from '../src/net/protocol';
import { DRAFTABLE } from '../src/engine';

const PORT = 18000 + Math.floor(Math.random() * 1000);
let server: ChildProcess;

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    // A throwaway account store; no idle bot games; bots fill the ranked queue after 1.5 s.
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-test-')), DATABASE_URL: '', BOT_IDLE_GAMES: '0',
      BOT_FILL_MS: '1500', BOT_THREADS: '1',
    },
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
  constructor(readonly token: string, readonly name: string, cookie?: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`, cookie ? { headers: { cookie } } : undefined);
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

  it('starts Freeplay in private rooms and permits duplicate picks across teams', async () => {
    const a = new TestClient('freeplay-a', 'Freeplay A');
    const b = new TestClient('freeplay-b', 'Freeplay B');
    await Promise.all([a.open(), b.open()]);
    a.send({ t: 'create' });
    const created = (await a.until((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    b.send({ t: 'join', code: created.room.code });
    await b.until((m) => m.t === 'room');
    b.send({ t: 'seat', side: 'D' });
    await b.until((m) => m.t === 'room' && m.room.players.some((p) => p.side === 'D'));
    a.send({ t: 'start', randomRoles: false, style: 'freeplay', legendaries: false });
    await a.until((m) => m.t === 'room' && !!m.room.game);
    expect(a.room!.rated).toBeFalsy();
    expect(a.room!.game!.draft.style).toBe('freeplay');
    expect(a.room!.game!.draft.secret!.pools.A).toHaveLength(DRAFTABLE.filter((c) => !c.legendary).length);
    expect(a.room!.game!.draft.secret!.legendPools.A).toEqual([]);

    const pick = DRAFTABLE.find((c) => !c.legendary)!.id;
    a.send({ t: 'action', action: { type: 'draftPick', cardId: pick } });
    await a.until((m) => m.t === 'room' && !!m.room.game?.draft.picks.A.includes(pick));
    b.send({ t: 'action', action: { type: 'draftPick', cardId: pick } });
    await b.until((m) => m.t === 'room' && !!m.room.game?.draft.picks.D.includes(pick));
    expect(a.room!.game!.draft.picks.A).toContain(pick);
    expect(b.room!.game!.draft.picks.D).toContain(pick);
    a.close();
    b.close();
  });
});

/** Signs up over HTTP and returns the session cookie. */
async function signup(username: string, password = 'hunter2hunter2'): Promise<string> {
  const r = await fetch(`http://localhost:${PORT}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('accounts and ranked play', () => {
  it('rejects Freeplay from the ranked queue', async () => {
    const cookie = await signup('FreeplayQueue');
    const client = new TestClient('freeplay-queue', 'FreeplayQueue', cookie);
    await client.open();
    client.send({ t: 'queue', timeControl: '5+3', style: 'freeplay' } as unknown as ClientMsg);
    expect(await client.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/only available in private matches/i) });
    client.close();
  });

  it('signs up, logs in, rejects bad passwords and duplicate names', async () => {
    const cookie = await signup('RedFan');
    const me = await (await fetch(`http://localhost:${PORT}/api/me`, { headers: { cookie } })).json();
    expect(me.account).toMatchObject({ username: 'RedFan', rating: 1200 });
    const dup = await fetch(`http://localhost:${PORT}/api/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'redfan', password: 'whatever123' }),
    });
    expect(dup.status).toBe(409);
    const bad = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'RedFan', password: 'wrong-password' }),
    });
    expect(bad.status).toBe(401);
    const good = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'RedFan', password: 'hunter2hunter2' }),
    });
    expect(good.status).toBe(200);
    const board = await (await fetch(`http://localhost:${PORT}/api/leaderboard`)).json();
    expect(Array.isArray(board.players)).toBe(true);
  });

  it('pairs two queued players into a timed, rated match and updates both ratings', async () => {
    const [ca, cb] = await Promise.all([signup('Kanto1'), signup('Johto2')]);
    const a = new TestClient('t1', 'x', ca);
    const b = new TestClient('t2', 'y', cb);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: 'queue', timeControl: '5+3', style: 'classic' });
    b.send({ t: 'queue', timeControl: '5+3', style: 'any' });
    await a.until((m) => m.t === 'room' && !!m.room.game, 5000);
    await b.until((m) => m.t === 'room' && !!m.room.game, 5000);
    expect(a.room!.rated).toBe(true);
    expect(a.room!.clock).toMatchObject({ A: 300_000, D: 300_000, incMs: 3000 });
    expect(a.room!.game!.draft.style).toBe('classic');
    const loser = a.room!.players.find((p) => p.id === a.id)!.side!;
    a.send({ t: 'action', action: { type: 'concede', side: loser } });
    const over = (await b.until((m) => m.t === 'room' && m.room.game?.phase === 'over')) as Extract<ServerMsg, { t: 'room' }>;
    expect(over.room.result?.deltas?.[loser]).toBeLessThan(0);
    const prof = await (await fetch(`http://localhost:${PORT}/api/users/Kanto1`)).json();
    expect(prof.games).toBe(1);
    expect(prof.losses).toBe(1);
    expect(prof.recent[0]).toMatchObject({ result: 'loss', opponent: { username: 'Johto2' } });
    a.close();
    b.close();
  });

  it('fills the queue with a bot account, which plays its moves', async () => {
    const cookie = await signup('Lonely1');
    const a = new TestClient('t3', 'z', cookie);
    await a.open();
    a.send({ t: 'queue', timeControl: '10+5', style: 'classic' });
    await a.until((m) => m.t === 'room' && !!m.room.game, 8000);
    const side = a.room!.players.find((p) => p.id === a.id)!.side!;
    const botSide = side === 'A' ? 'D' : 'A';
    expect(a.room!.accounts?.[botSide]?.bot).toBeTruthy();
    // The Attacker picks first; if that's the bot, wait for its pick, else pick and wait for its reply.
    if (side === 'A') a.send({ t: 'action', action: { type: 'draftPick', cardId: a.room!.game!.draft.pool[0] } });
    await a.until((m) => m.t === 'room' && (m.room.game?.draft.picks[botSide].length ?? 0) > 0, 30000);
    a.send({ t: 'action', action: { type: 'concede', side } });
    await a.until((m) => m.t === 'room' && m.room.game?.phase === 'over');
    a.close();
  }, 60_000);
});
