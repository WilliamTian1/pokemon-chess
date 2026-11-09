import fs from 'node:fs';
import path from 'node:path';
import type { DraftStyle, Side } from '../src/engine/types';

/**
 * Accounts, sessions and finished ranked games. Everything is kept in memory and written through to
 * storage: Postgres when DATABASE_URL is set (needed on hosts whose disk is wiped on every deploy, like
 * Render's free plan — a free Neon or Supabase database works), otherwise a JSON file in DATA_DIR
 * (default .data/) for local development.
 */

export interface User {
  id: string;
  username: string;
  /** scrypt$<N>$<salt hex>$<hash hex> */
  passHash?: string;
  /** Google account id ("sub") for Sign in with Google. */
  googleSub?: string;
  email?: string;
  createdAt: number;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  /** Bot accounts: the difficulty the server plays them at. */
  bot?: 'easy' | 'medium' | 'hard';
  /** Rating after each game (the last 300). */
  history: { t: number; r: number }[];
}

export interface Session {
  /** sha256 of the cookie token. */
  hash: string;
  userId: string;
  expires: number;
}

export interface SavedGame {
  id: string;
  endedAt: number;
  style: DraftStyle;
  mapId: string;
  legendaries: boolean;
  trainers: boolean;
  timeControl: string | null;
  players: Record<Side, { userId: string; username: string; before: number; after: number; bot?: string }>;
  winner: Side | null;
  reason: string;
  rounds: number;
  teams: Record<Side, string[]>;
}

interface Backend {
  load(): Promise<{ users: User[]; sessions: Session[]; games: SavedGame[] }>;
  saveUser(u: User): void;
  saveSession(s: Session): void;
  deleteSession(hash: string): void;
  saveGame(g: SavedGame): void;
}

/** Games kept in memory for profiles (older ones stay in the database). */
const MEMORY_GAMES = 20_000;

export class Store {
  users = new Map<string, User>();
  private byName = new Map<string, User>();
  private byGoogle = new Map<string, User>();
  sessions = new Map<string, Session>();
  games: SavedGame[] = [];
  private constructor(private backend: Backend) {}

  static async open(): Promise<Store> {
    const backend = process.env.DATABASE_URL ? await postgresBackend(process.env.DATABASE_URL) : fileBackend(process.env.DATA_DIR ?? '.data');
    const store = new Store(backend);
    const data = await backend.load();
    for (const u of data.users) store.index(u);
    const now = Date.now();
    for (const s of data.sessions) if (s.expires > now) store.sessions.set(s.hash, s);
    store.games = data.games.sort((a, b) => a.endedAt - b.endedAt).slice(-MEMORY_GAMES);
    return store;
  }

  get kind(): string {
    return process.env.DATABASE_URL ? 'postgres' : 'file';
  }

  private index(u: User): void {
    this.users.set(u.id, u);
    this.byName.set(u.username.toLowerCase(), u);
    if (u.googleSub) this.byGoogle.set(u.googleSub, u);
  }

  userByName(name: string): User | undefined {
    return this.byName.get(name.toLowerCase());
  }

  userByGoogle(sub: string): User | undefined {
    return this.byGoogle.get(sub);
  }

  /** Inserts or updates a user (renames update the name index). */
  putUser(u: User, oldName?: string): void {
    if (oldName && oldName.toLowerCase() !== u.username.toLowerCase()) this.byName.delete(oldName.toLowerCase());
    this.index(u);
    this.backend.saveUser(u);
  }

  putSession(s: Session): void {
    this.sessions.set(s.hash, s);
    this.backend.saveSession(s);
  }

  dropSession(hash: string): void {
    this.sessions.delete(hash);
    this.backend.deleteSession(hash);
  }

  putGame(g: SavedGame): void {
    this.games.push(g);
    if (this.games.length > MEMORY_GAMES) this.games.splice(0, this.games.length - MEMORY_GAMES);
    this.backend.saveGame(g);
  }
}

// ---------------------------------------------------------------- JSON file (development)

function fileBackend(dir: string): Backend {
  const file = path.resolve(dir, 'store.json');
  let data: { users: Record<string, User>; sessions: Record<string, Session>; games: SavedGame[] } = { users: {}, sessions: {}, games: [] };
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };
  const later = () => {
    if (!timer) timer = setTimeout(flush, 500);
  };
  process.on('exit', () => timer && flush());
  return {
    async load() {
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // First run.
      }
      return { users: Object.values(data.users), sessions: Object.values(data.sessions), games: data.games };
    },
    saveUser(u) {
      data.users[u.id] = u;
      later();
    },
    saveSession(s) {
      data.sessions[s.hash] = s;
      later();
    },
    deleteSession(hash) {
      delete data.sessions[hash];
      later();
    },
    saveGame(g) {
      data.games.push(g);
      if (data.games.length > MEMORY_GAMES) data.games.splice(0, data.games.length - MEMORY_GAMES);
      later();
    },
  };
}

// ---------------------------------------------------------------- Postgres (production)

async function postgresBackend(url: string): Promise<Backend> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }, max: 4 });
  await pool.query(`
    create table if not exists pcc_users (id text primary key, data jsonb not null);
    create table if not exists pcc_sessions (hash text primary key, user_id text not null, expires bigint not null);
    create table if not exists pcc_games (id text primary key, ended_at bigint not null, data jsonb not null);
    create index if not exists pcc_games_ended on pcc_games (ended_at);
  `);
  // Writes go out in order; a failed write is logged, not fatal (the next update of that row retries).
  let chain: Promise<unknown> = Promise.resolve();
  const write = (sql: string, args: unknown[]) => {
    chain = chain.then(() => pool.query(sql, args)).catch((e) => console.error('[store] write failed:', (e as Error).message));
  };
  return {
    async load() {
      const users = (await pool.query('select data from pcc_users')).rows.map((r) => r.data as User);
      const sessions = (await pool.query('select hash, user_id, expires from pcc_sessions where expires > $1', [Date.now()])).rows
        .map((r) => ({ hash: r.hash as string, userId: r.user_id as string, expires: Number(r.expires) }));
      const games = (await pool.query('select data from pcc_games order by ended_at desc limit $1', [MEMORY_GAMES])).rows.map((r) => r.data as SavedGame);
      return { users, sessions, games };
    },
    saveUser(u) {
      write('insert into pcc_users (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', [u.id, u]);
    },
    saveSession(s) {
      write('insert into pcc_sessions (hash, user_id, expires) values ($1, $2, $3) on conflict (hash) do update set expires = excluded.expires', [s.hash, s.userId, s.expires]);
    },
    deleteSession(hash) {
      write('delete from pcc_sessions where hash = $1', [hash]);
    },
    saveGame(g) {
      write('insert into pcc_games (id, ended_at, data) values ($1, $2, $3) on conflict (id) do nothing', [g.id, g.endedAt, g]);
    },
  };
}
