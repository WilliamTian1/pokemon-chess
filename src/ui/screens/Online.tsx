import { useEffect, useMemo, useState } from 'react';
import { type Side, getMap } from '../../engine';
import { NetClient, savedName } from '../../net/client';
import { ROOM_CODE_RE, RULE_PREFS, type RulePref, type StylePref, TIME_CONTROLS, timeControl } from '../../net/protocol';
import { refreshAccount, useAccount } from '../account';
import { AccountChip, AuthModal } from '../components/Account';
import { CardsIcon, ClockIcon, CoinIcon, PokeBallIcon, SealedIcon } from '../components/icons';
import { Leaderboard, STYLE_NAME } from './Profile';
import { SIDE_TEXT } from '../components/bits';
import { SoundButton, useMusic } from '../components/Effects';
import {
  LegendaryToggle, MapPicker, MapPreview, OptionTiles, SetupHeading, StyleToggle, TrainerToggle, savedLegendaries, savedMapId, savedStyle, savedTrainers,
} from '../components/MapPicker';
import { useNet, useOnlineGame } from '../controller';
import { GameScreen } from './GameScreen';

function OnlineScreens({ onExit, onGame, onProfile }: { onExit: () => void; onGame: (inGame: boolean) => void; onProfile: (name: string) => void }) {
  const { account } = useAccount();
  const [name, setName] = useState(savedName());
  const [client, setClient] = useState<NetClient | null>(null);
  const [ranked, setRanked] = useState(false);
  const joinFromUrl = useMemo(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '', []);
  const [code, setCode] = useState(joinFromUrl);
  const [auth, setAuth] = useState(false);
  const [tc, setTc] = useState(() => storedPref('pcc-tc', '10+5'));
  const [style, setStyle] = useState<StylePref>(() => storedPref('pcc-ranked-style', 'any') as StylePref);
  const [legends, setLegends] = useState<RulePref>(() => storedRule('pcc-ranked-legends'));
  const [trainers, setTrainers] = useState<RulePref>(() => storedRule('pcc-ranked-trainers'));

  useEffect(() => () => client?.close(), [client]);
  // Development only: `?screen=online&autoqueue=10+5` joins the ranked queue straight away (screenshots).
  const auto = import.meta.env.DEV ? new URLSearchParams(location.search).get('autoqueue') : null;
  useEffect(() => {
    if (auto && account && !client) {
      setRanked(true);
      const c = new NetClient(account.username);
      setClient(c);
      c.send({ t: 'queue', timeControl: auto.replace(' ', '+'), style: 'auction' });
    }
  }, [auto, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => {
    client?.close();
    setClient(null);
    setRanked(false);
  };
  if (client && ranked) return <RankedMatch client={client} onGame={onGame} onExit={back} />;
  if (client) return <Room client={client} onGame={onGame} onExit={() => { back(); onExit(); }} />;

  const displayName = account?.username ?? name.trim();
  const ok = displayName.length > 0;
  const connect = (then: (c: NetClient) => void) => {
    const c = new NetClient(displayName.slice(0, 20));
    setClient(c);
    then(c);
  };
  const findMatch = () => {
    savePref('pcc-tc', tc);
    savePref('pcc-ranked-style', style);
    savePref('pcc-ranked-legends', legends);
    savePref('pcc-ranked-trainers', trainers);
    setRanked(true);
    connect((c) => c.send({ t: 'queue', timeControl: tc, style, legendaries: legends, trainers }));
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" onClick={onExit}>← Back</button>
        <div className="mr-auto">
          <h2 className="title-banner text-3xl leading-tight">Play online</h2>
          <div className="text-sm font-bold text-slate-300">Ranked matches against players (or bots of your level), or a private room for friends</div>
        </div>
        <AccountChip onProfile={onProfile} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-2xl text-lacquer">Ranked</h3>
            {account && (
              <span className="font-display text-lg">
                {style === 'any'
                  ? `Your ratings: ${(['classic', 'secret', 'auction'] as const).map((k) => `${STYLE_NAME[k]} ${account.ratings[k]}`).join(' · ')}`
                  : `Your ${STYLE_NAME[style]} rating: ${account.ratings[style]}`}
              </span>
            )}
          </div>
          {account ? (
            <>
              <section>
                <SetupHeading n={1}>Time control</SetupHeading>
                <OptionTiles
                  cols={2}
                  value={tc}
                  onChange={setTc}
                  options={TIME_CONTROLS.map((t) => ({ value: t.id, title: t.label, sub: `${t.name}: ${t.baseMs / 60_000} min, +${t.incMs / 1000} s a move`, emblem: <ClockIcon className="h-full w-full" /> }))}
                />
              </section>
              <section>
                <SetupHeading n={2}>Draft style</SetupHeading>
                <OptionTiles
                  cols={2}
                  value={style}
                  onChange={setStyle}
                  options={[
                    { value: 'any' as const, title: 'Any', sub: 'Fastest match', emblem: <PokeBallIcon className="h-full w-full" /> },
                    { value: 'classic' as const, title: 'Classic', sub: 'Shared pool', emblem: <CardsIcon className="h-full w-full" /> },
                    { value: 'secret' as const, title: 'Secret', sub: 'Hidden pools', emblem: <SealedIcon className="h-full w-full" /> },
                    { value: 'auction' as const, title: 'Auction', sub: '20 coins each', emblem: <CoinIcon className="h-full w-full" /> },
                  ]}
                />
              </section>
              <section>
                <SetupHeading n={3}>Rules</SetupHeading>
                <div className="space-y-2">
                  <RuleChoice label="Legendaries" value={legends} onChange={setLegends} />
                  <RuleChoice label="Trainers" value={trainers} onChange={setTrainers} />
                </div>
              </section>
              <p className="text-xs font-bold text-slate-400">
                Ranked matches are played on a random map, and each draft style has its own rating. “Any” finds a match fastest. If nobody of your level is searching, a bot account of similar rating takes the seat after a few seconds.
              </p>
              <button type="button" className="btn-primary w-full gap-3 py-3.5 font-display text-xl" onClick={findMatch}>
                <PokeBallIcon className="h-8 w-8" /> Find a ranked match
              </button>
            </>
          ) : (
            <div className="space-y-3 text-center">
              <p className="font-bold text-slate-300">Sign in to play ranked, get a rating and climb the ladder.</p>
              <button type="button" className="btn-primary px-8 py-3 font-display text-lg" onClick={() => setAuth(true)}>Sign in or create an account</button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="panel space-y-3 p-5">
            <h3 className="font-display text-2xl text-lacquer">Private room</h3>
            {!account && (
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-slate-400">Your name</span>
                <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Ash"
                  className="w-full rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-2 font-bold outline-none focus:border-amber-400" />
              </label>
            )}
            <button type="button" disabled={!ok} className="btn-primary w-full py-2.5" onClick={() => connect((c) => c.send({ t: 'create' }))}>
              Create a private room
            </button>
            <div className="flex gap-2">
              <input value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="CODE"
                className="w-28 rounded-lg border-2 border-slate-600 bg-slate-950 px-3 py-2 text-center font-mono text-lg font-bold tracking-widest outline-none focus:border-amber-400" />
              <button type="button" disabled={!ok || !ROOM_CODE_RE.test(code)} className="btn-ghost flex-1" onClick={() => connect((c) => c.send({ t: 'join', code }))}>
                Join room
              </button>
            </div>
            <p className="text-xs font-bold text-slate-400">Private rooms are unranked. The server rolls all dice, so nobody can cheat their luck.</p>
          </div>
          <div className="panel space-y-2 p-5">
            <h3 className="font-display text-2xl text-lacquer">Ladder</h3>
            <Leaderboard onProfile={onProfile} limit={10} compact style={style === 'any' ? undefined : style} />
          </div>
        </div>
      </div>
      {auth && <AuthModal onClose={() => setAuth(false)} />}
    </div>
  );
}

const RULE_LABEL: Record<RulePref, string> = { on: 'On', off: 'Off', any: 'Either' };

/** A saved ranked rule preference (on, the long-standing ranked game, unless chosen otherwise). */
function storedRule(key: string): RulePref {
  const v = storedPref(key, 'on') as RulePref;
  return RULE_PREFS.includes(v) ? v : 'on';
}

/** One optional rule for the ranked queue: play with it, without it, or take either. */
function RuleChoice({ label, value, onChange }: { label: string; value: RulePref; onChange: (v: RulePref) => void }) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <span className="w-28 shrink-0 font-display text-[0.95rem] leading-tight">{label}</span>
      <div className="grid flex-1 grid-cols-3 gap-2">
        {RULE_PREFS.map((v) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`opt-tile !min-h-0 justify-center !py-1.5 font-display text-[0.95rem] ${value === v ? 'opt-tile-on' : ''}`}>
            {RULE_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

function storedPref(key: string, def: string): string {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}

function savePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage can be unavailable.
  }
}

/** Ranked: searching, then the match itself. */
function RankedMatch({ client, onExit, onGame }: { client: NetClient; onExit: () => void; onGame: (inGame: boolean) => void }) {
  const snap = useNet(client);
  const ctl = useOnlineGame(client, snap);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const inGame = !!(ctl && snap.room);
  useEffect(() => onGame(inGame), [inGame]); // eslint-disable-line react-hooks/exhaustive-deps
  // A rated result changes your rating: reload the signed-in account so every place that shows it
  // (the header chip, "Your rating", the next queue) agrees with your profile straight away.
  const rated = !!snap.room?.result?.ratings;
  useEffect(() => {
    if (rated) void refreshAccount();
  }, [rated]);
  if (ctl && snap.room) {
    const tc = timeControl(snap.room.timeControl);
    return <GameScreen ctl={ctl} onExit={onExit} title={`Ranked${tc ? ` · ${tc.label}` : ''}`} />;
  }
  const q = snap.queue;
  const waited = q ? Math.max(0, Math.floor((now - q.since) / 1000)) : 0;
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4">
      <div className="panel w-full space-y-4 p-6 text-center">
        <PokeBallIcon className="mx-auto h-16 w-16 animate-spin [animation-duration:2.4s]" />
        <h2 className="font-display text-2xl text-lacquer">{snap.status !== 'open' ? 'Connecting…' : q ? 'Looking for an opponent…' : 'Joining the queue…'}</h2>
        {q && (
          <div className="space-y-1 text-sm font-bold text-slate-300">
            <div className="font-display text-3xl">{Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}</div>
            <div>{timeControl(q.timeControl)?.label} · {q.style === 'any' ? 'any draft style' : `${q.style} draft`} · {q.searching} searching</div>
            <div>Legendaries: {RULE_LABEL[q.legendaries].toLowerCase()} · Trainers: {RULE_LABEL[q.trainers].toLowerCase()}</div>
            <div className="text-xs text-slate-400">A bot account of similar rating joins if nobody is found in a few seconds.</div>
          </div>
        )}
        {snap.error && <p className="text-sm font-bold text-rose-300">{snap.error}</p>}
        <button type="button" className="btn-ghost w-full" onClick={() => { client.send({ t: 'unqueue' }); onExit(); }}>Cancel</button>
      </div>
    </div>
  );
}

function Room({ client, onExit, onGame }: { client: NetClient; onExit: () => void; onGame: (inGame: boolean) => void }) {
  const snap = useNet(client);
  const ctl = useOnlineGame(client, snap);
  const [randomRoles, setRandomRoles] = useState(true);
  const [mapId, setMapId] = useState(savedMapId);
  const [legendaries, setLegendaries] = useState(savedLegendaries);
  const [trainers, setTrainers] = useState(savedTrainers);
  const [style, setStyle] = useState(savedStyle);
  const [roomTc, setRoomTc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const room = snap.room;

  const inGame = !!(ctl && room);
  useEffect(() => onGame(inGame), [inGame]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ctl && room) return <GameScreen ctl={ctl} onExit={onExit} title={`Online · room ${room.code}`} />;

  if (!room) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <div className="panel space-y-3 p-6">
          <div className="text-lg font-semibold">{snap.status === 'open' ? 'Joining room…' : snap.status === 'connecting' ? 'Connecting to server…' : 'Disconnected — retrying…'}</div>
          {snap.error && <p className="text-sm text-rose-300">{snap.error}</p>}
          <p className="text-xs text-slate-500">Online play needs the game server (<code>npm run server</code> in development, <code>npm start</code> in production).</p>
          <button type="button" className="btn-ghost" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const me = room.players.find((p) => p.id === snap.playerId);
  const isHost = room.hostId === snap.playerId;
  const seatOf = (side: Side) => room.players.find((p) => p.side === side);
  const ready = !!seatOf('A') && !!seatOf('D');
  const link = `${location.origin}${location.pathname}?room=${room.code}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <button type="button" className="btn-ghost mb-4" onClick={onExit}>← Leave room</button>
      <div className="panel space-y-5 p-5">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-slate-400">Room code</div>
          <div className="font-mono text-5xl font-black tracking-[0.3em] text-amber-300">{room.code}</div>
          <button
            type="button"
            className="btn-ghost mt-2 text-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? 'Link copied!' : 'Copy invite link'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['A', 'D'] as const).map((side) => {
            const p = seatOf(side);
            return (
              <div key={side} className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-center">
                <div className={`text-sm font-bold ${SIDE_TEXT[side]}`}>{side === 'A' ? 'Attacker' : 'Defender'}</div>
                <div className="my-2 min-h-[1.5rem] truncate text-base">{p ? `${p.name}${p.connected ? '' : ' (offline)'}` : <span className="text-slate-500">Open seat</span>}</div>
                {!p && <button type="button" className="btn-ghost w-full text-xs" onClick={() => client.send({ t: 'seat', side })}>Sit here</button>}
                {p?.id === me?.id && <button type="button" className="btn-ghost w-full text-xs" onClick={() => client.send({ t: 'seat', side: null })}>Stand up</button>}
              </div>
            );
          })}
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">In the room</div>
          <div className="flex flex-wrap gap-1.5">
            {room.players.map((p) => (
              <span key={p.id} className={`chip ${p.side === 'A' ? 'bg-rose-500/80' : p.side === 'D' ? 'bg-sky-500/80' : 'bg-slate-700'} text-white normal-case`}>
                {p.name}{p.id === room.hostId ? ' ★' : ''}{p.connected ? '' : ' ⏸'}
              </span>
            ))}
          </div>
        </div>
        {isHost ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-slate-400">Map</div>
            <MapPicker value={mapId} onChange={setMapId} />
            <StyleToggle value={style} onChange={setStyle} />
            <LegendaryToggle value={legendaries} onChange={setLegendaries} />
            <TrainerToggle value={trainers} onChange={setTrainers} />
            <label className="flex items-center justify-between gap-2 text-sm font-bold text-slate-300">
              <span>Time control</span>
              <select value={roomTc ?? ''} onChange={(e) => setRoomTc(e.target.value || null)} className="rounded-lg border-2 border-slate-600 bg-slate-950 px-2 py-1.5 font-bold">
                <option value="">Untimed</option>
                {TIME_CONTROLS.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.name})</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={randomRoles} onChange={(e) => setRandomRoles(e.target.checked)} />
              Randomize who attacks
            </label>
            <button type="button" className="btn-primary w-full py-2.5" disabled={!ready} onClick={() => client.send({ t: 'start', randomRoles, mapId, legendaries, trainers, style, timeControl: roomTc })}>
              {ready ? 'Start match' : 'Waiting for two seated players…'}
            </button>
          </div>
        ) : (
          <div className="space-y-2 text-center">
            <MapPreview map={getMap(room.mapId)} className="mx-auto max-w-xs" />
            <p className="text-sm text-slate-400">Map: <b className="text-slate-200">{getMap(room.mapId).name}</b>{room.legendaries === false ? ', no legendaries' : ''}{room.trainers ? ', with trainers' : ''} (the host chooses). Waiting for the host to start the match…</p>
            <p className="text-xs text-slate-400">{getMap(room.mapId).description}</p>
          </div>
        )}
        {snap.error && <p className="text-center text-sm text-rose-300">{snap.error}</p>}
      </div>
    </div>
  );
}

/** Online play: the lobby has the title music and a sound button; a match brings its own. */
export function Online({ onExit, onProfile }: { onExit: () => void; onProfile: (name: string) => void }) {
  const [inGame, setInGame] = useState(false);
  useMusic(inGame ? undefined : 'menu');
  return (
    <>
      <OnlineScreens onExit={onExit} onGame={setInGame} onProfile={onProfile} />
      {!inGame && <SoundButton up className="fixed bottom-3 left-3 z-40" />}
    </>
  );
}
