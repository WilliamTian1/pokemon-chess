import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Difficulty } from '../src/ai/bot';
import { BOT_TURN_START_MS, botPause } from '../src/ai/pace';
import {
  type Action, DEFAULT_MAP_ID, type DraftStyle, type GameEvent, type GameState, MAPS, MAP_LIST, type Rng, RuleError, type Side,
  applyAction, decider, deciders, hiddenView, isSimultaneous, newGame, randomSeed, seededRng,
} from '../src/engine';
import {
  type AccountView, type ClientMsg, type ClockView, type MatchResult, type RoomView, type ServerMsg, type StylePref, TIME_CONTROLS,
  type TimeControl, timeControl,
} from '../src/net/protocol';
import { Accounts, accountView } from './accounts';
import { BotPool } from './botPool';
import { cleanName } from './names';
import { Store, type User } from './store';

const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 8787);
const DIST = path.resolve(import.meta.dirname, '../dist');
const ROOM_TTL_MS = 30 * 60 * 1000;
/** A ranked player waiting this long without a human opponent is matched with a bot account. */
const BOT_FILL_MS = Number(process.env.BOT_FILL_MS ?? 10_000);
/** Bot-vs-bot ranked games played while nobody is waiting (0 turns them off). */
const BOT_IDLE_GAMES = Number(process.env.BOT_IDLE_GAMES ?? 1);
const BOT_STEP_MS = 450;
/**
 * Hosts like Render's free plan put the server to sleep after 15 minutes without a web request, which
 * also stops the bots' games. While idle bot games are on, the server requests its own public address
 * every few minutes to stay awake (KEEP_AWAKE=0 turns that off; KEEP_AWAKE_URL overrides the address).
 */
const KEEP_AWAKE_URL = process.env.KEEP_AWAKE === '0' || BOT_IDLE_GAMES <= 0 ? '' : process.env.KEEP_AWAKE_URL ?? process.env.RENDER_EXTERNAL_URL ?? '';
const KEEP_AWAKE_MS = 5 * 60 * 1000;

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

// ---------------------------------------------------------------- state

interface Player {
  id: string;
  name: string;
  side: Side | null;
  sockets: Set<WebSocket>;
}

interface Clock {
  A: number;
  D: number;
  /** Sides whose clocks are running: both during the simultaneous part of a Secret draft. */
  running: Side[];
  since: number;
  incMs: number;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  game: GameState | null;
  mapId: string;
  legendaries: boolean;
  trainers: boolean;
  style: DraftStyle;
  tc: TimeControl | null;
  rng: Rng;
  events: GameEvent[];
  eventSeq: number;
  emptySince: number | null;
  /** Ranked: the account behind each side (bots included). */
  users: Record<Side, User> | null;
  /** Sides the server plays (bot accounts). */
  bots: Partial<Record<Side, Difficulty>>;
  /** A bot-vs-bot game played while the queue is empty. */
  idle: boolean;
  clock: Clock | null;
  timer: NodeJS.Timeout | null;
  botBusy: Record<Side, boolean>;
  result: MatchResult | null;
  closed: boolean;
}

interface Conn {
  playerId: string | null;
  name: string;
  room: Room | null;
  user: User | null;
}

interface QueueEntry {
  user: User;
  ws: WebSocket;
  conn: Conn;
  tc: TimeControl;
  style: StylePref;
  since: number;
}

const rooms = new Map<string, Room>();
const tokenToId = new Map<string, string>();
const queue = new Map<string, QueueEntry>();
const store = await Store.open();
const accounts = new Accounts(store);
accounts.seedBots();
let bots: BotPool | null = null;
const botPool = (): BotPool => (bots ??= new BotPool());

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

function makeRoom(hostId: string, opts: Partial<Room> = {}): Room {
  const r: Room = {
    code: newCode(), hostId, players: new Map(), game: null, mapId: DEFAULT_MAP_ID, legendaries: true, trainers: false, style: 'classic', tc: null,
    rng: seededRng(randomSeed()), events: [], eventSeq: 0, emptySince: null, users: null, bots: {}, idle: false, clock: null, timer: null,
    botBusy: { A: false, D: false }, result: null, closed: false, ...opts,
  };
  rooms.set(r.code, r);
  return r;
}

// ---------------------------------------------------------------- views (hidden information stays hidden)

function clockView(room: Room): ClockView | null {
  return room.clock && { A: room.clock.A, D: room.clock.D, running: room.clock.running, since: room.clock.since, incMs: room.clock.incMs };
}

function view(room: Room, side: Side | null): RoomView {
  const acc = (s: Side): AccountView | null => (room.users ? accountView(room.users[s]) : null);
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, side: p.side, connected: p.sockets.size > 0 || !!(p.side && room.bots[p.side]) })),
    game: room.game && hiddenView(room.game, side),
    mapId: room.mapId,
    legendaries: room.legendaries,
    trainers: room.trainers,
    style: room.style,
    timeControl: room.tc?.id ?? null,
    events: room.events,
    eventSeq: room.eventSeq,
    rated: !!room.users,
    accounts: room.users ? { A: acc('A'), D: acc('D') } : undefined,
    clock: clockView(room),
    result: room.result,
    serverNow: Date.now(),
  };
}

function broadcast(room: Room): void {
  for (const p of room.players.values()) {
    if (!p.sockets.size) continue;
    const msg: ServerMsg = { t: 'room', room: view(room, p.side) };
    for (const ws of p.sockets) send(ws, msg);
  }
}

// ---------------------------------------------------------------- rooms

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
  if (room.players.size === 0 && !room.users) closeRoom(room);
  else broadcast(room);
}

function closeRoom(room: Room): void {
  room.closed = true;
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(room.code);
}

function startGame(room: Room): void {
  room.rng = seededRng(randomSeed());
  room.game = newGame({ rng: room.rng, mapId: room.mapId, legendaries: room.legendaries, trainers: room.trainers, style: room.style });
  room.events = [];
  room.eventSeq += 1;
  room.result = null;
  room.clock = room.tc ? { A: room.tc.baseMs, D: room.tc.baseMs, running: deciders(room.game), since: Date.now(), incMs: room.tc.incMs } : null;
  armClock(room);
  broadcast(room);
  scheduleBots(room);
}

// ---------------------------------------------------------------- the one place actions are applied

/**
 * Applies an action by `actor` to a room's game, with clocks, ratings and bot turns. Returns an error
 * message, or null.
 */
function applyRoomAction(room: Room, action: Action, actor: Side | null): string | null {
  if (!room.game || room.game.phase === 'over') return 'The match is over.';
  const simultaneous = isSimultaneous(room.game);
  const before = decider(room.game);
  const now = Date.now();
  const c = room.clock;
  if (c && action.type !== 'timeout') {
    const out = c.running.find((x) => c[x] - (now - c.since) <= 0);
    if (out) {
      flag(room, out);
      return 'Out of time.';
    }
  }
  try {
    const r = applyAction(room.game, action, room.rng);
    room.game = r.state;
    room.events = r.events;
    room.eventSeq += 1;
  } catch (e) {
    if (e instanceof RuleError) return e.message;
    console.error('Engine error', e);
    return 'Something went wrong applying that action.';
  }
  if (c) {
    for (const x of c.running) c[x] = Math.max(0, c[x] - (now - c.since));
    const over = room.game.phase === 'over';
    // The increment goes to the side that handed the move over, or (picking at the same time) to whoever moved.
    if (!over && simultaneous && actor) c[actor] += c.incMs;
    else if (!over && before && decider(room.game) !== before) c[before] += c.incMs;
    c.running = over ? [] : deciders(room.game);
    c.since = now;
    armClock(room);
  }
  if (room.game.phase === 'over') finishMatch(room);
  broadcast(room);
  scheduleBots(room);
  return null;
}

function armClock(room: Room): void {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const c = room.clock;
  if (!c || !c.running.length || room.game?.phase === 'over') return;
  const left = (x: Side) => c[x] - (Date.now() - c.since);
  const side = [...c.running].sort((a, b) => left(a) - left(b))[0];
  room.timer = setTimeout(() => {
    if (room.closed || !room.clock || !room.clock.running.includes(side)) return;
    if (room.clock[side] - (Date.now() - room.clock.since) <= 0) flag(room, side);
    else armClock(room);
  }, Math.max(50, left(side) + 20));
}

function flag(room: Room, side: Side): void {
  if (room.clock) {
    room.clock[side] = 0;
    room.clock.running = [];
  }
  applyRoomAction(room, { type: 'timeout', side }, null);
}

/** End of a match: ratings for ranked games, then clean up idle bot games. */
function finishMatch(room: Room): void {
  const g = room.game!;
  if (room.timer) clearTimeout(room.timer);
  if (room.clock) room.clock.running = [];
  room.result = { winner: g.winner, reason: g.winReason ?? '' };
  if (room.users) {
    const rec = accounts.recordGame({
      id: crypto.randomBytes(8).toString('base64url'), endedAt: Date.now(), style: g.draft.style ?? 'classic', mapId: g.mapId,
      legendaries: room.legendaries, trainers: room.trainers, timeControl: room.tc?.id ?? null, winner: g.winner, reason: g.winReason ?? '',
      rounds: g.round, teams: { A: [...g.draft.picks.A], D: [...g.draft.picks.D] },
    }, room.users);
    room.result = { ...room.result, deltas: rec.deltas, ratings: rec.ratings };
  }
  if (room.idle) setTimeout(() => closeRoom(room), 5_000);
}

// ---------------------------------------------------------------- bots

/** Whether the room's game has ended (a function, so checks after actions aren't narrowed away). */
const gameOver = (room: Room): boolean => !room.game || room.game.phase === 'over';

function scheduleBots(room: Room): void {
  const g = room.game;
  if (!g || g.phase === 'over' || room.closed) return;
  for (const side of deciders(g)) {
    const level = room.bots[side];
    if (level && !room.botBusy[side]) runBot(room, side, level);
  }
}

function runBot(room: Room, side: Side, level: Difficulty): void {
  room.botBusy[side] = true;
  const g = room.game!;
  const seq = g.seq;
  // Its first action of a battle turn waits for the players' new-turn notice; later ones for the last step's effects.
  const turnStart = g.phase === 'battle' && !g.active && !g.pending.length && !g.units.some((u) => u.side === side && u.activated);
  setTimeout(() => {
    // The bot sees what a player in its seat would: nothing hidden.
    void botPool().decide(hiddenView(room.game!, side), side, level, room.idle ? 1 : 0).then(async (actions) => {
      room.botBusy[side] = false;
      if (room.closed || !room.game || room.game.phase === 'over') return;
      if (!actions.length) {
        if (room.game.seq !== seq || !deciders(room.game).includes(side)) return scheduleBots(room);
        applyRoomAction(room, { type: 'concede', side }, side);
        return;
      }
      for (const [i, a] of actions.entries()) {
        if (room.closed || gameOver(room) || !deciders(room.game!).includes(side)) break;
        // Against a person, each step stays on screen long enough to follow.
        if (i > 0) await new Promise((r) => setTimeout(r, room.idle || room.game!.phase !== 'battle' ? BOT_STEP_MS : botPause(room.events)));
        room.botBusy[side] = true;
        const err = applyRoomAction(room, a, side);
        room.botBusy[side] = false;
        if (err) break;
      }
      scheduleBots(room);
    }).catch((e) => {
      console.error('[bots] decide failed:', e);
      room.botBusy[side] = false;
      if (!room.closed && room.game && room.game.phase !== 'over') applyRoomAction(room, { type: 'concede', side }, side);
    });
  }, room.idle ? 200 : turnStart ? BOT_TURN_START_MS : g.phase === 'battle' ? Math.max(600, botPause(room.events)) : 600);
}

// ---------------------------------------------------------------- ranked matchmaking

const compatible = (a: StylePref, b: StylePref): boolean => a === b || a === 'any' || b === 'any';
function resolveStyle(a: StylePref, b: StylePref): DraftStyle {
  const s = a !== 'any' ? a : b !== 'any' ? b : (['classic', 'secret', 'auction'] as const)[randomSeed() % 3];
  return s;
}
/** How far apart two ratings may be after waiting `ms`. */
const ratingWindow = (ms: number): number => Math.min(800, 100 + (15 * ms) / 1000);

function queueStatus(e: QueueEntry | null, ws: WebSocket): void {
  send(ws, { t: 'queue', queue: e && { timeControl: e.tc.id, style: e.style, since: e.since, searching: [...queue.values()].filter((x) => x.tc.id === e.tc.id).length } });
}

function matchmake(): void {
  const now = Date.now();
  const waiting = [...queue.values()].sort((a, b) => a.since - b.since);
  const taken = new Set<string>();
  for (const e of waiting) {
    if (taken.has(e.user.id)) continue;
    const opp = waiting.find((o) => o !== e && !taken.has(o.user.id) && o.tc.id === e.tc.id && compatible(o.style, e.style)
      && Math.abs(o.user.rating - e.user.rating) <= Math.min(ratingWindow(now - e.since), ratingWindow(now - o.since)));
    if (opp) {
      taken.add(e.user.id).add(opp.user.id);
      startRanked([e, opp], e.tc, resolveStyle(e.style, opp.style));
    } else if (now - e.since >= BOT_FILL_MS) {
      const busy = new Set([...rooms.values()].filter((r) => r.idle && r.game?.phase !== 'over').flatMap((r) => Object.values(r.users ?? {}).map((u) => u.id)));
      const candidates = accounts.bots().filter((b) => !busy.has(b.id)).sort((a, b) => Math.abs(a.rating - e.user.rating) - Math.abs(b.rating - e.user.rating));
      if (!candidates.length) continue;
      const bot = candidates[randomSeed() % Math.min(3, candidates.length)];
      taken.add(e.user.id);
      startRanked([e, bot], e.tc, resolveStyle(e.style, 'any'));
    }
  }
  for (const id of taken) queue.delete(id);
  for (const e of queue.values()) queueStatus(e, e.ws);
}

/** A ranked match between two queued players, or a queued player and a bot account. */
function startRanked(seats: [QueueEntry, QueueEntry | User], tc: TimeControl | null, style: DraftStyle, idle = false): Room {
  const [a, b] = randomSeed() % 2 ? [seats[0], seats[1]] : [seats[1], seats[0]];
  const userOf = (x: QueueEntry | User): User => ('user' in x ? x.user : x);
  const room = makeRoom('server', {
    mapId: MAP_LIST[randomSeed() % MAP_LIST.length].id, legendaries: true, trainers: true, style, tc,
    users: { A: userOf(a), D: userOf(b) }, idle,
  });
  for (const [side, x] of [['A', a], ['D', b]] as const) {
    const u = userOf(x);
    if (u.bot) {
      room.bots[side] = u.bot;
      room.players.set(`u:${u.id}`, { id: `u:${u.id}`, name: u.username, side, sockets: new Set() });
    } else {
      const e = x as QueueEntry;
      room.players.set(`u:${u.id}`, { id: `u:${u.id}`, name: u.username, side, sockets: new Set() });
      queueStatus(null, e.ws);
      joinRoom(e.ws, e.conn, room);
    }
  }
  startGame(room);
  return room;
}

/** While nobody is waiting, bots play ranked games against each other (keeps the ladder alive). */
function idleBots(): void {
  if (BOT_IDLE_GAMES <= 0 || queue.size > 0) return;
  const running = [...rooms.values()].filter((r) => r.idle && r.game?.phase !== 'over').length;
  const humanBotGames = [...rooms.values()].filter((r) => !r.idle && Object.keys(r.bots).length && r.game?.phase !== 'over').length;
  if (running >= BOT_IDLE_GAMES || humanBotGames > 0 || (bots && !bots.idle)) return;
  const all = accounts.bots();
  // Usually the bot with the fewest games goes next, so every bot's rating gets settled.
  const fewest = Math.min(...all.map((b) => b.games));
  const due = randomSeed() % 4 ? all.filter((b) => b.games === fewest) : all;
  const a = due[randomSeed() % due.length];
  const near = all.filter((b) => b.id !== a.id && Math.abs(b.rating - a.rating) <= 250);
  if (!near.length) return;
  const b = near[randomSeed() % near.length];
  startRanked([a as unknown as QueueEntry, b], null, (['classic', 'secret', 'auction'] as const)[randomSeed() % 3], true);
}

// ---------------------------------------------------------------- messages

function handle(ws: WebSocket, conn: Conn, msg: ClientMsg): void {
  const fail = (message: string) => send(ws, { t: 'error', message });
  if (msg.t === 'hello') {
    if (conn.user) {
      conn.playerId = `u:${conn.user.id}`;
      conn.name = conn.user.username;
    } else {
      const token = String(msg.token ?? '').slice(0, 64);
      if (!token) return fail('Missing player token.');
      let id = tokenToId.get(token);
      if (!id) {
        id = randomId();
        tokenToId.set(token, id);
      }
      conn.playerId = id;
      const guest = String(msg.name ?? '').trim().slice(0, 20);
      conn.name = guest && cleanName(guest) ? guest : 'Trainer';
    }
    send(ws, { t: 'welcome', id: conn.playerId, account: conn.user ? accountView(conn.user) : null });
    return;
  }
  if (!conn.playerId) return fail('Say hello first.');
  const room = conn.room;
  switch (msg.t) {
    case 'queue': {
      if (!conn.user) return fail('Sign in to play ranked.');
      const tc = timeControl(msg.timeControl);
      if (!tc) return fail('Unknown time control.');
      if ((msg.style as string) === 'freeplay') return fail('Freeplay is only available in private matches.');
      const style: StylePref = ['classic', 'secret', 'auction', 'any'].includes(msg.style) ? msg.style : 'any';
      if (room) leaveRoom(ws, conn, true);
      const e: QueueEntry = { user: conn.user, ws, conn, tc, style, since: Date.now() };
      queue.set(conn.user.id, e);
      queueStatus(e, ws);
      return;
    }
    case 'unqueue': {
      if (conn.user) queue.delete(conn.user.id);
      queueStatus(null, ws);
      return;
    }
    case 'create': {
      const r = makeRoom(conn.playerId);
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
      if (room.users) return fail('Seats are fixed in ranked matches.');
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
      if (room.users) return fail('Ranked matches start themselves.');
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
      if (msg.style !== undefined) room.style = msg.style === 'secret' || msg.style === 'auction' || msg.style === 'freeplay' ? msg.style : 'classic';
      if (msg.timeControl !== undefined) room.tc = timeControl(msg.timeControl);
      if (msg.randomRoles && randomSeed() % 2 === 0) for (const p of seated) p.side = p.side === 'A' ? 'D' : 'A';
      startGame(room);
      return;
    }
    case 'rematch': {
      if (room.users) return fail('Ranked matches have no rematch: queue again.');
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
      if (action?.type === 'timeout') return fail('Only the clock can do that.');
      if (action?.type === 'concede') {
        if (action.side !== me.side) return fail('You can only concede for yourself.');
      } else if (!deciders(room.game).includes(me.side)) {
        return fail('It is not your decision.');
      }
      // Picking at the same time: the server says who is picking, and you may only place your own Pokémon.
      if (action.type === 'draftPick') (action as Extract<Action, { type: 'draftPick' }>).side = me.side;
      if (action.type === 'place' && room.game.units.find((u) => u.id === action.unitId)?.side !== me.side) return fail('Not your Pokémon.');
      const err = applyRoomAction(room, action, me.side);
      if (err) fail(err);
      return;
    }
  }
}

// ---------------------------------------------------------------- http + ws

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, queue: queue.size, storage: store.kind, keepAwake: !!KEEP_AWAKE_URL }));
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
  if (url.pathname.startsWith('/api/')) {
    accounts.handle(req, res, url).then((handled) => {
      if (handled) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found.' }));
    }).catch((e) => {
      console.error('[api]', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error.' }));
    });
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

wss.on('connection', (ws, req) => {
  const conn: Conn = { playerId: null, name: 'Trainer', room: null, user: accounts.userFromRequest(req) };
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
  ws.on('close', () => {
    if (conn.user && queue.get(conn.user.id)?.ws === ws) queue.delete(conn.user.id);
    leaveRoom(ws, conn, false);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince !== null && now - room.emptySince > ROOM_TTL_MS && (!room.game || room.game.phase === 'over' || !room.users)) closeRoom(room);
  }
}, 60_000).unref();
setInterval(matchmake, 1_000).unref();
setInterval(idleBots, 15_000).unref();
if (KEEP_AWAKE_URL) {
  const ping = () => void fetch(new URL('/health', KEEP_AWAKE_URL), { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  setInterval(ping, KEEP_AWAKE_MS).unref();
}

server.listen(PORT, () => {
  console.log(`Pokémon Conquest Chess server on http://localhost:${PORT} (ws path /ws, ${store.kind} storage, ${TIME_CONTROLS.length} time controls)${fs.existsSync(DIST) ? '' : ' — client not built'}`);
});

if (store.kind === 'file' && process.env.RENDER) {
  console.warn('[store] DATABASE_URL is not set: accounts, ratings and games are kept in a file that this host deletes on every deploy and restart. See docs/online-setup.md.');
}

process.on('SIGTERM', () => {
  bots?.close();
  process.exit(0);
});
