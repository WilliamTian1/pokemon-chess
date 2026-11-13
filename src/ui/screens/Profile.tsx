import { useEffect, useMemo, useRef, useState } from 'react';
import { getCard, getMap } from '../../engine';
import type { Profile as ProfileData } from '../../net/protocol';
import { type LeaderRow, fetchLeaderboard, fetchProfile, useAccount } from '../account';
import { Art } from '../components/bits';
import { PokeBallIcon } from '../components/icons';

const STYLE_NAME = { classic: 'Classic', secret: 'Secret', auction: 'Auction', freeplay: 'Freeplay' } as const;
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** A player's page: rating, record, rating history and recent ranked games. */
export function ProfileScreen({ username, onBack, onProfile }: { username: string; onBack: () => void; onProfile: (name: string) => void }) {
  const [data, setData] = useState<ProfileData | null | undefined>(undefined);
  const { account } = useAccount();
  useEffect(() => {
    setData(undefined);
    void fetchProfile(username).then(setData);
  }, [username]);
  if (data === undefined) return <Shell onBack={onBack}><div className="panel p-6 text-center font-bold">Loading…</div></Shell>;
  if (data === null) return <Shell onBack={onBack}><div className="panel p-6 text-center font-bold">No player called “{username}”.</div></Shell>;
  const decided = data.wins + data.losses;
  return (
    <Shell onBack={onBack}>
      <div className="lacquer flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-gold bg-[#fbf3dc] shadow">
          <PokeBallIcon className="h-11 w-11" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="title-banner truncate text-3xl">{data.username}</h2>
            {data.bot && <span className="chip bg-amber-400 text-slate-950">Bot · {data.bot}</span>}
            {account?.username === data.username && <span className="chip bg-emerald-400 text-slate-950">You</span>}
          </div>
          <div className="text-sm font-bold text-slate-300">Member since {fmtDate(data.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-extrabold uppercase tracking-widest text-[#f2d27a]">Rating</div>
          <div className="font-display text-5xl leading-none text-[#fff3d6]">{data.rating}</div>
          <div className="text-xs font-bold text-slate-300">{data.rank ? `#${data.rank} on the ladder` : data.games < 10 ? `Provisional (${data.games}/10 games)` : 'Unranked'}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Peak" value={data.peak} />
        <Stat label="Games" value={data.games} />
        <Stat label="Wins · losses" value={`${data.wins} · ${data.losses}`} />
        <Stat label="Win rate" value={decided ? `${Math.round((100 * data.wins) / decided)}%` : '—'} />
      </div>
      <div className="panel p-4">
        <h3 className="mb-2 font-display text-xl text-lacquer">Rating history</h3>
        {data.history.length >= 2 ? <RatingChart points={data.history} /> : <p className="text-sm font-bold text-slate-400">Play a couple of ranked games to see the chart.</p>}
      </div>
      <div className="panel p-4">
        <h3 className="mb-2 font-display text-xl text-lacquer">Recent games</h3>
        {data.recent.length === 0 ? (
          <p className="text-sm font-bold text-slate-400">No ranked games yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.recent.map((g) => {
              const d = g.ratingAfter - g.ratingBefore;
              return (
                <div key={g.id} className="paper-inset flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className={`w-12 font-display ${g.result === 'win' ? 'text-emerald-300' : g.result === 'loss' ? 'text-rose-300' : 'text-slate-400'}`}>
                    {g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw'}
                  </span>
                  <span className="font-bold text-slate-300">vs</span>
                  {g.opponent ? (
                    <button type="button" className="font-extrabold underline decoration-dotted underline-offset-2" onClick={() => onProfile(g.opponent!.username)}>
                      {g.opponent.username}{g.opponent.bot ? ' 🤖' : ''}
                    </button>
                  ) : '—'}
                  <span className="flex -space-x-1.5">{g.team.map((id) => <Art key={id} id={id} className="h-6 w-6 rounded-full border-2 border-gold" alt={getCard(id).name} />)}</span>
                  <span className="text-xs font-bold text-slate-400">
                    {g.side === 'A' ? 'Attacker' : 'Defender'} · {STYLE_NAME[g.style]} · {g.timeControl ?? 'untimed'} · {mapName(g.mapId)} · {fmtDate(g.endedAt)}
                  </span>
                  <span className={`ml-auto font-display ${d >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{d >= 0 ? `+${d}` : d}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}

function mapName(id: string): string {
  try {
    return getMap(id).name;
  } catch {
    return id;
  }
}

function Shell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6">
      <button type="button" className="btn-ghost" onClick={onBack}>← Back</button>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel p-3 text-center">
      <div className="text-xs font-extrabold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="font-display text-2xl">{value}</div>
    </div>
  );
}

/** Rating over time: one 2px line, a recessive grid, and a crosshair with the exact value on hover. */
function RatingChart({ points }: { points: { t: number; r: number }[] }) {
  const W = 720;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { lo, hi, ticks } = useMemo(() => {
    const rs = points.map((p) => p.r);
    const lo0 = Math.floor((Math.min(...rs) - 20) / 50) * 50;
    const hi0 = Math.ceil((Math.max(...rs) + 20) / 50) * 50;
    const step = hi0 - lo0 > 400 ? 100 : 50;
    const ts: number[] = [];
    for (let v = lo0; v <= hi0; v += step) ts.push(v);
    return { lo: lo0, hi: hi0, ticks: ts };
  }, [points]);
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (r: number) => pad.t + (1 - (r - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const onMove = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const fx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label={`Rating from ${points[0].r} to ${points[points.length - 1].r} over ${points.length} games`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgb(var(--slate-700))" strokeWidth="1" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="rgb(var(--slate-400))">{v}</text>
          </g>
        ))}
        <text x={pad.l} y={H - 6} fontSize="11" fontWeight="700" fill="rgb(var(--slate-400))">{fmtDate(points[0].t)}</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="11" fontWeight="700" fill="rgb(var(--slate-400))">{fmtDate(points[points.length - 1].t)}</text>
        <path d={d} fill="none" stroke="#a8261d" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--slate-500))" strokeWidth="1" />
            <circle cx={x(hover!)} cy={y(h.r)} r="5" fill="#a8261d" stroke="#f6ead0" strokeWidth="2" />
          </g>
        )}
        {/* A wide invisible target so the whole plot answers the pointer. */}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" />
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-lg border-2 border-[#4a2b16] bg-[#fbf3dc] px-2 py-1 text-xs font-bold text-[#33220f] shadow"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > points.length / 2 ? '-105%' : '5%'})` }}>
          <div className="font-display text-base">{h.r}</div>
          <div>Game {hover! + 1} · {fmtDate(h.t)}</div>
        </div>
      )}
    </div>
  );
}

/** The ranked ladder. */
export function Leaderboard({ onProfile, limit = 100, compact = false }: { onProfile: (name: string) => void; limit?: number; compact?: boolean }) {
  const [rows, setRows] = useState<LeaderRow[] | null | undefined>(undefined);
  const { account } = useAccount();
  useEffect(() => {
    void fetchLeaderboard().then(setRows);
  }, []);
  if (rows === undefined) return <p className="text-sm font-bold text-slate-400">Loading the ladder…</p>;
  if (!rows?.length) return <p className="text-sm font-bold text-slate-400">Nobody is ranked yet: players need 10 ranked games.</p>;
  return (
    <div className="space-y-1">
      {rows.slice(0, limit).map((r) => (
        <button key={r.id} type="button" onClick={() => onProfile(r.username)}
          className={`paper-inset flex w-full items-center gap-3 px-3 ${compact ? 'py-1' : 'py-1.5'} text-left text-sm hover:!border-[#a8261d] ${account?.id === r.id ? '!border-[#d9ab45]' : ''}`}>
          <span className={`w-8 font-display ${r.rank <= 3 ? 'text-lacquer' : 'text-slate-400'}`}>#{r.rank}</span>
          <span className="min-w-0 flex-1 truncate font-extrabold">{r.username}{r.bot ? <span className="ml-1.5 text-xs font-bold text-slate-400">bot</span> : null}</span>
          <span className="text-xs font-bold text-slate-400">{r.games} games</span>
          <span className="w-12 text-right font-display">{r.rating}</span>
        </button>
      ))}
    </div>
  );
}
