import crypto from 'node:crypto';
import type http from 'node:http';
import type { Side } from '../src/engine/types';
import type { AccountView, Profile, ProfileGame } from '../src/net/protocol';
import { cleanName } from './names';
import type { SavedGame, Store, User } from './store';

/**
 * Accounts: sign up with a username and password, or Sign in with Google (set GOOGLE_CLIENT_ID);
 * sessions in an HttpOnly cookie; Elo ratings; profiles and the leaderboard; the bot accounts that keep
 * the ranked queue moving.
 */

export const START_RATING = 1200;
/** Players with fewer ranked games than this are provisional (no leaderboard rank yet). */
export const PROVISIONAL_GAMES = 10;
const SESSION_COOKIE = 'pcc_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';

export const accountView = (u: User): AccountView => ({ id: u.id, username: u.username, rating: u.rating, games: u.games, ...(u.bot ? { bot: u.bot } : {}) });

const newId = (): string => crypto.randomBytes(9).toString('base64url');
const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const hash = crypto.scryptSync(pw, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(pw: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64, { N: Number(n), r: 8, p: 1 });
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------------------------------------------------------------- Elo

/** Rating changes for a finished game (score 1 = `a` won, 0.5 draw, 0 lost). */
export function eloDeltas(a: User, b: User, score: number): [number, number] {
  const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  const k = (u: User) => (u.games < PROVISIONAL_GAMES * 2 ? 40 : u.rating >= 2000 ? 16 : 24);
  return [Math.round(k(a) * (score - expected)), Math.round(k(b) * (1 - score - (1 - expected)))];
}

export class Accounts {
  private attempts = new Map<string, { n: number; reset: number }>();

  constructor(readonly store: Store) {}

  // ---------------------------------------------------------------- sessions

  userFromRequest(req: http.IncomingMessage): User | null {
    const cookie = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === SESSION_COOKIE);
    if (!cookie?.[1]) return null;
    const s = this.store.sessions.get(sha256(cookie[1]));
    if (!s || s.expires < Date.now()) return null;
    return this.store.users.get(s.userId) ?? null;
  }

  private startSession(res: http.ServerResponse, req: http.IncomingMessage, u: User): void {
    const token = crypto.randomBytes(32).toString('hex');
    this.store.putSession({ hash: sha256(token), userId: u.id, expires: Date.now() + SESSION_DAYS * 86_400_000 });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  // ---------------------------------------------------------------- users

  private createUser(username: string, extra: Partial<User>): User {
    const u: User = {
      id: newId(), username, createdAt: Date.now(), rating: START_RATING, peak: START_RATING, games: 0, wins: 0, losses: 0, history: [], ...extra,
    };
    this.store.putUser(u);
    return u;
  }

  /** A free username based on `base` (for new Google accounts). */
  private freeName(base: string): string {
    const stripped = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
    const clean = stripped && cleanName(stripped) ? stripped : 'Trainer';
    const root = clean.length >= 3 ? clean : `${clean}Trainer`.slice(0, 16);
    if (!this.store.userByName(root)) return root;
    for (let i = 2; i < 10_000; i++) if (!this.store.userByName(`${root}${i}`)) return `${root}${i}`;
    return `${root}${crypto.randomInt(1e6)}`;
  }

  /** Creates the bot accounts on first run (they keep their ratings afterwards). */
  seedBots(): void {
    const bots: [string, 'easy' | 'medium' | 'hard', number][] = [
      ['SleepySnorer', 'easy', 820], ['BerryPicker', 'easy', 860], ['PuddleJumper', 'easy', 900], ['LostCamper', 'easy', 930],
      ['PebbleKid', 'easy', 960], ['DaisyRoller', 'easy', 990], ['NapTimeNed', 'easy', 1010], ['MuddyBoots', 'easy', 1040],
      ['RiverRanger', 'medium', 1150], ['LanternMoth', 'medium', 1180], ['CopperKite', 'medium', 1200], ['MapleScout', 'medium', 1220],
      ['TideCaller', 'medium', 1240], ['IronSprout', 'medium', 1260], ['HarborHawk', 'medium', 1290], ['CinderTrail', 'medium', 1310],
      ['MossLantern', 'medium', 1330], ['QuarryFox', 'medium', 1360],
      ['RoninKage', 'hard', 1480], ['AzureShogun', 'hard', 1510], ['CrimsonBanner', 'hard', 1540], ['StormWarlord', 'hard', 1560],
      ['JadeTactician', 'hard', 1590], ['ObsidianGeneral', 'hard', 1610], ['ThunderDaimyo', 'hard', 1640], ['SilverStrategist', 'hard', 1660],
      ['EmberWarden', 'hard', 1690], ['FrostMarshal', 'hard', 1710], ['GaleCommander', 'hard', 1740], ['IronVanguard', 'hard', 1770],
    ];
    for (const [name, level, rating] of bots) {
      if (this.store.userByName(name)) continue;
      this.createUser(name, { bot: level, rating, peak: rating });
    }
  }

  bots(): User[] {
    return [...this.store.users.values()].filter((u) => u.bot);
  }

  /** Applies a finished ranked game: Elo for both accounts, records, the saved game. */
  recordGame(g: Omit<SavedGame, 'players'>, users: Record<Side, User>): { deltas: Record<Side, number>; ratings: Record<Side, number>; game: SavedGame } {
    const score = g.winner === 'A' ? 1 : g.winner === 'D' ? 0 : 0.5;
    const [dA, dD] = eloDeltas(users.A, users.D, score);
    const before = { A: users.A.rating, D: users.D.rating };
    const deltas = { A: dA, D: dD };
    for (const side of ['A', 'D'] as const) {
      const u = users[side];
      u.rating += deltas[side];
      u.peak = Math.max(u.peak, u.rating);
      u.games += 1;
      if (g.winner === side) u.wins += 1;
      else if (g.winner) u.losses += 1;
      u.history.push({ t: g.endedAt, r: u.rating });
      if (u.history.length > 300) u.history.splice(0, u.history.length - 300);
      this.store.putUser(u);
    }
    const game: SavedGame = {
      ...g,
      players: {
        A: { userId: users.A.id, username: users.A.username, before: before.A, after: users.A.rating, ...(users.A.bot ? { bot: users.A.bot } : {}) },
        D: { userId: users.D.id, username: users.D.username, before: before.D, after: users.D.rating, ...(users.D.bot ? { bot: users.D.bot } : {}) },
      },
    };
    this.store.putGame(game);
    return { deltas, ratings: { A: users.A.rating, D: users.D.rating }, game };
  }

  // ---------------------------------------------------------------- profiles

  leaderboard(limit = 100): (AccountView & { rank: number; provisional: boolean })[] {
    // Bot accounts start with established ratings, so they're ranked from the first day.
    const ranked = [...this.store.users.values()].filter((u) => u.games >= PROVISIONAL_GAMES || u.bot).sort((a, b) => b.rating - a.rating);
    return ranked.slice(0, limit).map((u, i) => ({ ...accountView(u), rank: i + 1, provisional: false }));
  }

  profile(name: string): Profile | null {
    const u = this.store.userByName(name);
    if (!u) return null;
    const recent: ProfileGame[] = [];
    for (let i = this.store.games.length - 1; i >= 0 && recent.length < 30; i--) {
      const g = this.store.games[i];
      const side = (['A', 'D'] as const).find((s) => g.players[s].userId === u.id);
      if (!side) continue;
      const opp = g.players[side === 'A' ? 'D' : 'A'];
      recent.push({
        id: g.id, endedAt: g.endedAt, style: g.style, mapId: g.mapId, timeControl: g.timeControl, side,
        opponent: { username: opp.username, ...(opp.bot ? { bot: opp.bot } : {}) },
        result: g.winner === side ? 'win' : g.winner ? 'loss' : 'draw', reason: g.reason,
        ratingBefore: g.players[side].before, ratingAfter: g.players[side].after, team: g.teams[side],
      });
    }
    const board = this.leaderboard(10_000);
    const rank = board.find((x) => x.id === u.id)?.rank ?? null;
    return {
      username: u.username, rating: u.rating, peak: u.peak, games: u.games, wins: u.wins, losses: u.losses, createdAt: u.createdAt,
      ...(u.bot ? { bot: u.bot } : {}), history: u.history, recent, rank,
    };
  }

  // ---------------------------------------------------------------- HTTP

  /** Handles /api/… requests (other than the lab's). Returns false if the path isn't one of ours. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, error: string) => send(status, { error });
    const p = url.pathname;
    const me = this.userFromRequest(req);

    if (req.method === 'GET') {
      if (p === '/api/config') return send(200, { googleClientId: GOOGLE_CLIENT_ID || null, storage: this.store.kind }), true;
      if (p === '/api/me') return send(200, { account: me ? accountView(me) : null }), true;
      if (p === '/api/leaderboard') return send(200, { players: this.leaderboard(100) }), true;
      const m = /^\/api\/users\/([^/]+)$/.exec(p);
      if (m) {
        const prof = this.profile(decodeURIComponent(m[1]));
        return prof ? send(200, prof) : fail(404, 'No such player.'), true;
      }
      return false;
    }
    if (req.method !== 'POST' || !p.startsWith('/api/')) return false;
    // JSON only: browsers can't send it cross-site without a CORS preflight we never answer.
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return fail(415, 'Expected JSON.'), true;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      return fail(400, 'Bad request.'), true;
    }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const limited = () => {
      const now = Date.now();
      const a = this.attempts.get(ip);
      if (!a || a.reset < now) {
        this.attempts.set(ip, { n: 1, reset: now + 10 * 60_000 });
        return false;
      }
      a.n += 1;
      return a.n > 30;
    };

    switch (p) {
      case '/api/auth/signup': {
        if (limited()) return fail(429, 'Too many attempts. Try again in a few minutes.'), true;
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        if (!USERNAME_RE.test(username)) return fail(400, 'Usernames are 3–20 letters, digits, _ or -.'), true;
        if (!cleanName(username)) return fail(400, 'That username isn’t allowed. Please pick another.'), true;
        if (password.length < 8) return fail(400, 'Passwords need at least 8 characters.'), true;
        if (this.store.userByName(username)) return fail(409, 'That username is taken.'), true;
        const u = this.createUser(username, { passHash: hashPassword(password) });
        this.startSession(res, req, u);
        return send(200, { account: accountView(u) }), true;
      }
      case '/api/auth/login': {
        if (limited()) return fail(429, 'Too many attempts. Try again in a few minutes.'), true;
        const u = this.store.userByName(String(body.username ?? '').trim());
        if (!u || u.bot || !checkPassword(String(body.password ?? ''), u.passHash)) return fail(401, 'Wrong username or password.'), true;
        this.startSession(res, req, u);
        return send(200, { account: accountView(u) }), true;
      }
      case '/api/auth/google': {
        if (!GOOGLE_CLIENT_ID) return fail(400, 'Google sign-in is not set up on this server.'), true;
        if (limited()) return fail(429, 'Too many attempts. Try again in a few minutes.'), true;
        const info = await verifyGoogle(String(body.credential ?? ''));
        if (!info) return fail(401, 'Google sign-in failed.'), true;
        let u = this.store.userByGoogle(info.sub);
        if (!u) u = this.createUser(this.freeName(info.name ?? info.email?.split('@')[0] ?? 'Trainer'), { googleSub: info.sub, email: info.email });
        this.startSession(res, req, u);
        return send(200, { account: accountView(u) }), true;
      }
      case '/api/auth/logout': {
        const cookie = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === SESSION_COOKIE);
        if (cookie?.[1]) this.store.dropSession(sha256(cookie[1]));
        res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
        return send(200, { account: null }), true;
      }
      case '/api/me/username': {
        if (!me) return fail(401, 'Sign in first.'), true;
        const username = String(body.username ?? '').trim();
        if (!USERNAME_RE.test(username)) return fail(400, 'Usernames are 3–20 letters, digits, _ or -.'), true;
        if (!cleanName(username)) return fail(400, 'That username isn’t allowed. Please pick another.'), true;
        const taken = this.store.userByName(username);
        if (taken && taken.id !== me.id) return fail(409, 'That username is taken.'), true;
        const old = me.username;
        me.username = username;
        this.store.putUser(me, old);
        return send(200, { account: accountView(me) }), true;
      }
    }
    return false;
  }
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 16_384) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** Checks a Google ID token with Google's tokeninfo endpoint. */
async function verifyGoogle(credential: string): Promise<{ sub: string; email?: string; name?: string } | null> {
  if (!credential || credential.length > 4096) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) return null;
    const info = (await r.json()) as Record<string, string>;
    const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    if (info.aud !== GOOGLE_CLIENT_ID || !issOk || Number(info.exp) * 1000 < Date.now() || !info.sub) return null;
    return { sub: info.sub, email: info.email_verified === 'true' ? info.email : undefined, name: info.given_name ?? info.name };
  } catch {
    return null;
  }
}
