import crypto from 'node:crypto';
import type http from 'node:http';
import type { DraftStyle, Side } from '../src/engine/types';
import { DRAFT_STYLES, type AccountView, type ModeProfile, type Profile, type ProfileGame, type RankedDraftStyle } from '../src/net/protocol';
import { cleanName } from './names';
import type { ModeStats, SavedGame, Store, User } from './store';

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

/** The user's rating and record in one draft style, seeded from their overall record the first time. */
export function modeStats(u: User, style: DraftStyle): ModeStats {
  u.modes ??= {};
  return (u.modes[style] ??= { rating: u.rating, peak: u.peak, games: u.games, wins: u.wins, losses: u.losses, history: [...u.history] });
}

const perMode = <T>(f: (style: RankedDraftStyle) => T): Record<RankedDraftStyle, T> => ({ classic: f('classic'), secret: f('secret'), auction: f('auction') });

export const accountView = (u: User): AccountView => ({
  id: u.id, username: u.username, ratings: perMode((s) => modeStats(u, s).rating), games: perMode((s) => modeStats(u, s).games), ...(u.bot ? { bot: u.bot } : {}),
});

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
export function eloDeltas(a: User, b: User, score: number, style: DraftStyle): [number, number] {
  const [sa, sb] = [modeStats(a, style), modeStats(b, style)];
  const expected = 1 / (1 + 10 ** ((sb.rating - sa.rating) / 400));
  const k = (m: ModeStats) => (m.games < PROVISIONAL_GAMES * 2 ? 40 : m.rating >= 2000 ? 16 : 24);
  return [Math.round(k(sa) * (score - expected)), Math.round(k(sb) * (1 - score - (1 - expected)))];
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

  /** Applies a finished ranked game: Elo (in the game's draft style) for both accounts, records, the saved game. */
  recordGame(g: Omit<SavedGame, 'players'>, users: Record<Side, User>): { deltas: Record<Side, number>; ratings: Record<Side, number>; game: SavedGame } {
    const score = g.winner === 'A' ? 1 : g.winner === 'D' ? 0 : 0.5;
    const style = g.style;
    const [dA, dD] = eloDeltas(users.A, users.D, score, style);
    const before = { A: modeStats(users.A, style).rating, D: modeStats(users.D, style).rating };
    const deltas = { A: dA, D: dD };
    for (const side of ['A', 'D'] as const) {
      const u = users[side];
      const m = modeStats(u, style);
      m.rating += deltas[side];
      m.peak = Math.max(m.peak, m.rating);
      m.games += 1;
      if (g.winner === side) m.wins += 1;
      else if (g.winner) m.losses += 1;
      m.history.push({ t: g.endedAt, r: m.rating });
      if (m.history.length > 300) m.history.splice(0, m.history.length - 300);
      this.store.putUser(u);
    }
    const game: SavedGame = {
      ...g,
      players: {
        A: { userId: users.A.id, username: users.A.username, before: before.A, after: modeStats(users.A, style).rating, ...(users.A.bot ? { bot: users.A.bot } : {}) },
        D: { userId: users.D.id, username: users.D.username, before: before.D, after: modeStats(users.D, style).rating, ...(users.D.bot ? { bot: users.D.bot } : {}) },
      },
    };
    this.store.putGame(game);
    return { deltas, ratings: { A: game.players.A.after, D: game.players.D.after }, game };
  }

  // ---------------------------------------------------------------- profiles

  /** The ladder for one draft style. */
  leaderboard(style: DraftStyle, limit = 100): (AccountView & { rank: number; provisional: boolean })[] {
    // Bot accounts start with established ratings, so they're ranked from the first day.
    const ranked = [...this.store.users.values()]
      .filter((u) => modeStats(u, style).games >= PROVISIONAL_GAMES || u.bot)
      .sort((a, b) => modeStats(b, style).rating - modeStats(a, style).rating);
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
    const modes = perMode((style): ModeProfile => {
      const m = modeStats(u, style);
      const rank = this.leaderboard(style, 10_000).find((x) => x.id === u.id)?.rank ?? null;
      return { rating: m.rating, peak: m.peak, games: m.games, wins: m.wins, losses: m.losses, history: m.history, rank };
    });
    return { username: u.username, createdAt: u.createdAt, ...(u.bot ? { bot: u.bot } : {}), modes, recent };
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
      if (p === '/api/leaderboard') {
        const style = DRAFT_STYLES.find((x) => x === url.searchParams.get('style')) ?? 'classic';
        return send(200, { style, players: this.leaderboard(style, 100) }), true;
      }
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
