import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  type Action, DEFAULT_MAP_ID, type GameEvent, type GameState, MAPS, type Rng, RuleError, type Side, applyAction, decider, newGame,
  randomSeed, seededRng,
} from '../src/engine';
import type { ClientMsg, RoomView, ServerMsg } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8787);
const DIST = path.resolve(import.meta.dirname, '../dist');
const ROOM_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------- private draft lab
// The draft analysis page is for the owner only. Set LAB_KEY on the host, then open
// /lab?key=<LAB_KEY> once: that stores a cookie, and only browsers with it are sent the lab's code.
const LAB_KEY = process.env.LAB_KEY ?? '';
const LAB_COOKIE = 'pcc_lab';
const labToken = LAB_KEY ? crypto.createHash('sha256').update(`pcc-lab:${LAB_KEY}`).digest('hex') : '';
/** Built file names of the lab's code (Vite names the chunk after the module). */
const LAB_CHUNK = /^DraftLab-[\w-]+\.js$/;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hasLabAccess(req: http.IncomingMessage): boolean {
  if (!labToken) return false;
  const cookie = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === LAB_COOKIE);
  return !!cookie && sameSecret(cookie[1] ?? '', labToken);
}

interface Player {
  id: string;
  name: string;
  side: Side | null;
  sockets: Set<WebSocket>;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  game: GameState | null;
  mapId: string;
  legendaries: boolean;
  trainers: boolean;
  rng: Rng;
  events: GameEvent[];
  eventSeq: number;
  emptySince: number | null;
}

interface Conn {
  playerId: string | null;
  name: string;
  room: Room | null;
}

const rooms = new Map<string, Room>();
const tokenToId = new Map<string, string>();

const randomId = (): string => Math.random().toString(36).slice(2, 10) + randomSeed().toString(36);

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const code = Array.from({ length: 4 }, () => A[randomSeed() % A.length]).join('');
    if (!rooms.has(code)) return code;
  }
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function view(room: Room): RoomView {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, side: p.side, connected: p.sockets.size > 0 })),
    game: room.game,
    mapId: room.mapId,
    legendaries: room.legendaries,
    trainers: room.trainers,
    events: room.events,
    eventSeq: room.eventSeq,
  };
}

function broadcast(room: Room): void {
  const msg: ServerMsg = { t: 'room', room: view(room) };
  for (const p of room.players.values()) for (const ws of p.sockets) send(ws, msg);
}

function joinRoom(ws: WebSocket, conn: Conn, room: Room): void {
  if (conn.room && conn.room !== room) leaveRoom(ws, conn, false);
  let p = room.players.get(conn.playerId!);
  if (!p) {
    p = { id: conn.playerId!, name: conn.name, side: null, sockets: new Set() };
    room.players.set(p.id, p);
  }
  p.name = conn.name;
  p.sockets.add(ws);
  room.emptySince = null;
  conn.room = room;
  broadcast(room);
}

function leaveRoom(ws: WebSocket, conn: Conn, explicit: boolean): void {
  const room = conn.room;
  if (!room || !conn.playerId) return;
  const p = room.players.get(conn.playerId);
  conn.room = null;
  if (p) {
    p.sockets.delete(ws);
    // Seated players in a running game keep their seat so they can reconnect.
    const midGame = room.game && room.game.phase !== 'over' && p.side;
    if (explicit && !midGame && p.sockets.size === 0) room.players.delete(p.id);
    if (room.hostId === p.id && !room.players.has(p.id)) {
      const next = [...room.players.values()][0];
      if (next) room.hostId = next.id;
    }
  }
  if ([...room.players.values()].every((x) => x.sockets.size === 0)) room.emptySince = Date.now();
  if (explicit) send(ws, { t: 'left' });
  if (room.players.size === 0) rooms.delete(room.code);
  else broadcast(room);
}

function handle(ws: WebSocket, conn: Conn, msg: ClientMsg): void {
  const fail = (message: string) => send(ws, { t: 'error', message });
  if (msg.t === 'hello') {
    const token = String(msg.token ?? '').slice(0, 64);
    if (!token) return fail('Missing player token.');
    let id = tokenToId.get(token);
    if (!id) {
      id = randomId();
      tokenToId.set(token, id);
    }
    conn.playerId = id;
    conn.name = String(msg.name ?? '').trim().slice(0, 20) || 'Trainer';
    send(ws, { t: 'welcome', id });
    return;
  }
  if (!conn.playerId) return fail('Say hello first.');
  const room = conn.room;
  switch (msg.t) {
    case 'create': {
      const r: Room = {
        code: newCode(), hostId: conn.playerId, players: new Map(), game: null, mapId: DEFAULT_MAP_ID, legendaries: true, trainers: false, rng: seededRng(randomSeed()),
        events: [], eventSeq: 0, emptySince: null,
      };
      rooms.set(r.code, r);
      joinRoom(ws, conn, r);
      r.players.get(conn.playerId)!.side = 'A';
      broadcast(r);
      return;
    }
    case 'join': {
      const r = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!r) return fail('No room with that code.');
      joinRoom(ws, conn, r);
      return;
    }
    case 'leave':
      leaveRoom(ws, conn, true);
      return;
  }
  if (!room) return fail('You are not in a room.');
  const me = room.players.get(conn.playerId)!;
  const isHost = room.hostId === me.id;
  switch (msg.t) {
    case 'seat': {
      if (room.game && room.game.phase !== 'over') return fail('Seats are locked while a match is running.');
      if (msg.side === null) me.side = null;
      else if (msg.side === 'A' || msg.side === 'D') {
        if ([...room.players.values()].some((p) => p.side === msg.side && p.id !== me.id)) return fail('That seat is taken.');
        me.side = msg.side;
      }
      broadcast(room);
      return;
    }
    case 'start': {
      if (!isHost) return fail('Only the host can start the match.');
      if (room.game && room.game.phase !== 'over') return fail('A match is already running.');
      const seated = [...room.players.values()].filter((p) => p.side);
      if (seated.length < 2) return fail('Both seats must be filled.');
      if (msg.mapId !== undefined) {
        if (typeof msg.mapId !== 'string' || !MAPS[msg.mapId]) return fail('Unknown map.');
        room.mapId = msg.mapId;
      }
      if (msg.legendaries !== undefined) room.legendaries = msg.legendaries !== false;
      if (msg.trainers !== undefined) room.trainers = msg.trainers === true;
      if (msg.randomRoles && randomSeed() % 2 === 0) for (const p of seated) p.side = p.side === 'A' ? 'D' : 'A';
      startGame(room);
      return;
    }
    case 'rematch': {
      if (!isHost) return fail('Only the host can start a rematch.');
      if (!room.game || room.game.phase !== 'over') return fail('The match is still running.');
      if (msg.swapRoles) for (const p of room.players.values()) if (p.side) p.side = p.side === 'A' ? 'D' : 'A';
      startGame(room);
      return;
    }
    case 'action': {
      if (!room.game) return fail('The match has not started.');
      const action = msg.action as Action;
      if (!me.side) return fail('Spectators cannot act.');
      if (action?.type === 'concede') {
        if (action.side !== me.side) return fail('You can only concede for yourself.');
      } else if (decider(room.game) !== me.side) {
        return fail('It is not your decision.');
      }
      try {
        const r = applyAction(room.game, action, room.rng);
        room.game = r.state;
        room.events = r.events;
        room.eventSeq += 1;
      } catch (e) {
        if (e instanceof RuleError) return fail(e.message);
        console.error('Engine error', e);
        return fail('Something went wrong applying that action.');
      }
      broadcast(room);
      return;
    }
  }
}

function startGame(room: Room): void {
  room.rng = seededRng(randomSeed());
  room.game = newGame({ rng: room.rng, mapId: room.mapId, legendaries: room.legendaries, trainers: room.trainers });
  room.events = [];
  room.eventSeq += 1;
  broadcast(room);
}

// ---------------------------------------------------------------- http + ws

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (url.pathname === '/lab') {
    if (!labToken || !sameSecret(url.searchParams.get('key') ?? '', LAB_KEY)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(302, {
      'set-cookie': `${LAB_COOKIE}=${labToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
      location: '/?lab',
    });
    res.end();
    return;
  }
  if (url.pathname === '/api/lab') {
    const ok = hasLabAccess(req);
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok }));
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Pokémon Conquest Chess server is running. Build the client with `npm run build` to serve it from here.');
    return;
  }
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (LAB_CHUNK.test(path.basename(rel)) && !hasLabAccess(req)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // The lab's code must not sit in shared caches.
    'cache-control': ext === '.html' ? 'no-cache' : LAB_CHUNK.test(path.basename(file)) ? 'private, max-age=86400' : 'public, max-age=86400',
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const conn: Conn = { playerId: null, name: 'Trainer', room: null };
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    handle(ws, conn, msg);
  });
  ws.on('close', () => leaveRoom(ws, conn, false));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`Pokémon Conquest Chess server on http://localhost:${PORT} (ws path /ws)${fs.existsSync(DIST) ? '' : ' — client not built'}`);
});
