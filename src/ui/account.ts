import { useSyncExternalStore } from 'react';
import type { AccountView, Profile } from '../net/protocol';

/**
 * The signed-in account (a session cookie set by the game server) and the account API: sign up, log in,
 * Sign in with Google, log out, rename, profiles and the leaderboard. Without a game server (static
 * hosting) everything here quietly reports "no account".
 */

export interface AccountState {
  account: AccountView | null;
  /** /api answered at all (false on static hosting or when the server is down). */
  available: boolean;
  loaded: boolean;
  /** Set when the server has Sign in with Google configured. */
  googleClientId: string | null;
}

let state: AccountState = { account: null, available: false, loaded: false, googleClientId: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch };
  listeners.forEach((f) => f());
};

const api = (p: string) => `${import.meta.env.BASE_URL}api/${p}`;

async function getJson<T>(p: string): Promise<T | null> {
  try {
    const r = await fetch(api(p), { credentials: 'same-origin' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function post(p: string, body: unknown): Promise<{ ok: boolean; data: { account?: AccountView | null; error?: string } }> {
  try {
    const r = await fetch(api(p), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as { account?: AccountView | null; error?: string };
    return { ok: r.ok, data };
  } catch {
    return { ok: false, data: { error: 'Can’t reach the game server.' } };
  }
}

let started = false;
export async function refreshAccount(): Promise<void> {
  const [me, cfg] = await Promise.all([getJson<{ account: AccountView | null }>('me'), getJson<{ googleClientId: string | null }>('config')]);
  set({ account: me?.account ?? null, available: !!me, loaded: true, googleClientId: cfg?.googleClientId ?? null });
}

export function useAccount(): AccountState {
  if (!started) {
    started = true;
    void refreshAccount();
  }
  return useSyncExternalStore((f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  }, () => state);
}

/** Logs in or signs up; returns an error message, or null on success. */
export async function signIn(kind: 'login' | 'signup', username: string, password: string): Promise<string | null> {
  const r = await post(kind === 'login' ? 'auth/login' : 'auth/signup', { username, password });
  if (!r.ok) return r.data.error ?? 'Something went wrong.';
  set({ account: r.data.account ?? null });
  return null;
}

export async function googleSignIn(credential: string): Promise<string | null> {
  const r = await post('auth/google', { credential });
  if (!r.ok) return r.data.error ?? 'Google sign-in failed.';
  set({ account: r.data.account ?? null });
  return null;
}

export async function signOut(): Promise<void> {
  await post('auth/logout', {});
  set({ account: null });
}

export async function rename(username: string): Promise<string | null> {
  const r = await post('me/username', { username });
  if (!r.ok) return r.data.error ?? 'Something went wrong.';
  set({ account: r.data.account ?? null });
  return null;
}

export const fetchProfile = (name: string): Promise<Profile | null> => getJson<Profile>(`users/${encodeURIComponent(name)}`);

export type LeaderRow = AccountView & { rank: number };
export const fetchLeaderboard = async (): Promise<LeaderRow[] | null> => (await getJson<{ players: LeaderRow[] }>('leaderboard'))?.players ?? null;
