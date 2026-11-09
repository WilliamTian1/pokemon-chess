import { useEffect, useRef, useState } from 'react';
import { googleSignIn, rename, signIn, signOut, useAccount } from '../account';
import { Modal } from './bits';
import { PokeBallIcon } from './icons';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let gsiLoading: Promise<void> | null = null;
/** Loads Google's sign-in script once. */
function loadGoogle(): Promise<void> {
  gsiLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gsiLoading;
}

function GoogleButton({ clientId, onError, onDone }: { clientId: string; onError: (e: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    loadGoogle().then(() => {
      if (!live || !ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => void googleSignIn(r.credential).then((err) => (err ? onError(err) : onDone())),
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 280 });
    }).catch((e: Error) => onError(e.message));
    return () => {
      live = false;
    };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="flex min-h-[44px] justify-center" />;
}

/** Log in / sign up: username and password, or Google when the server has it set up. */
export function AuthModal({ onClose, initial = 'login' }: { onClose: () => void; initial?: 'login' | 'signup' }) {
  const { googleClientId, available } = useAccount();
  const [tab, setTab] = useState<'login' | 'signup'>(initial);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await signIn(tab, username.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Modal onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <PokeBallIcon className="h-10 w-10" />
          <h3 className="font-display text-2xl text-lacquer">{tab === 'login' ? 'Welcome back' : 'Create an account'}</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['login', 'signup'] as const).map((t) => (
            <button key={t} type="button" className={`opt-tile !min-h-0 justify-center !py-2 ${tab === t ? 'opt-tile-on' : ''}`} onClick={() => { setTab(t); setError(null); }}>
              <span className="font-display">{t === 'login' ? 'Log in' : 'Sign up'}</span>
            </button>
          ))}
        </div>
        {!available && <p className="text-sm font-bold text-rose-300">Accounts need the game server, which isn’t reachable from here.</p>}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-slate-400">Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20}
              className="w-full rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-2 font-bold outline-none focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-slate-400">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              className="w-full rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-2 font-bold outline-none focus:border-amber-400" />
          </label>
          {tab === 'signup' && <p className="text-xs font-bold text-slate-400">3–20 letters, digits, _ or -. Passwords need at least 8 characters.</p>}
          {error && <p className="text-sm font-bold text-rose-300">{error}</p>}
          <button type="submit" className="btn-primary w-full py-2.5 font-display text-lg" disabled={busy || !username || !password}>
            {tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        {googleClientId && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-400">
              <span className="h-px flex-1 bg-slate-600" />or<span className="h-px flex-1 bg-slate-600" />
            </div>
            <GoogleButton clientId={googleClientId} onError={setError} onDone={onClose} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Rename your account (Google accounts get a username made from your name). */
export function RenameModal({ current, onClose }: { current: string; onClose: () => void }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void rename(name.trim()).then((err) => (err ? setError(err) : onClose()));
        }}
      >
        <h3 className="font-display text-2xl text-lacquer">Change username</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
          className="w-full rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-2 font-bold outline-none focus:border-amber-400" />
        {error && <p className="text-sm font-bold text-rose-300">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1">Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** The account button for page headers: "Sign in", or your name and rating with a small menu. */
export function AccountChip({ onProfile, className = '' }: { onProfile: (name: string) => void; className?: string }) {
  const { account, available, loaded } = useAccount();
  const [auth, setAuth] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  if (!loaded || !available) return null;
  return (
    <div className={`relative ${className}`}>
      {account ? (
        <button type="button" className="btn-ghost gap-2" onClick={() => setMenu((m) => !m)}>
          <PokeBallIcon className="h-5 w-5" />
          <span className="max-w-[9rem] truncate">{account.username}</span>
          <span className="rounded-full bg-[#4a2b16] px-2 py-0.5 font-display text-xs text-[#f2d27a]">{account.rating}</span>
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setAuth(true)}>Sign in</button>
      )}
      {menu && account && (
        <div className="absolute right-0 z-[70] mt-1 w-48 space-y-1 rounded-xl border-2 border-[#d9ab45] bg-[#2a170b] p-2 shadow-xl">
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => { setMenu(false); onProfile(account.username); }}>My profile</button>
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => { setMenu(false); setRenaming(true); }}>Change username</button>
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => { setMenu(false); void signOut(); }}>Log out</button>
        </div>
      )}
      {auth && <AuthModal onClose={() => setAuth(false)} />}
      {renaming && account && <RenameModal current={account.username} onClose={() => setRenaming(false)} />}
    </div>
  );
}
