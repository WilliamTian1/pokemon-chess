import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { type GameEvent, type GameState, SIDE_NAME, type Side, getCard, getTrainer } from '../../engine';
import { type MusicSelection, type Sfx, getAudioSettings, onAudioSettings, playMusic, setAudioSettings, sfx, speakTrainer } from '../audio';
import type { EventBatch } from '../controller';
import { Art } from './bits';
import { trainerImg } from './Trainers';

/** Phones and tablets get fewer particles (each one is an animated element). */
const LITE = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px), (pointer: coarse)').matches;

// ---------------------------------------------------------------- sound hooks

/** Plays `track` while the calling screen is shown (switching tracks cross-fades); undefined leaves it alone. */
export function useMusic(track: MusicSelection | null | undefined): void {
  useEffect(() => {
    if (track !== undefined) playMusic(track);
  }, [track]);
}

const STATUS_SFX: Record<string, Sfx> = {
  brn: 'burn', par: 'paralysis', psn: 'poison', tox: 'poison', slp: 'sleep', frz: 'freeze', confused: 'confuse', flinched: 'flinch',
};

function sfxFor(e: GameEvent): Sfx | null {
  switch (e.t) {
    case 'damage':
      return e.amount >= 90 ? 'bigHit' : 'hit';
    case 'heal':
      return 'heal';
    case 'miss':
      return 'miss';
    case 'faint':
      return 'faint';
    case 'status':
      return STATUS_SFX[e.status] ?? null;
    case 'stage':
      return e.delta > 0 ? 'statUp' : 'statDown';
    case 'attack':
      return e.name === 'Trebuchet' ? 'trebuchet' : null;
    case 'move':
      return 'step';
    case 'field':
      return e.kind === 'stageMist' ? null : e.kind;
    case 'special':
      return 'special';
    case 'transform':
      return 'evolve';
    default:
      return null;
  }
}

/** Sounds for each batch of game events, spaced out a little so a big turn doesn't turn to mush. */
export function useEventSounds(events: EventBatch): void {
  useEffect(() => {
    const list = events.list.map(sfxFor).filter((x): x is Sfx => !!x);
    // One footstep is plenty; everything else gets its own slot.
    const seen = new Set<Sfx>();
    let slot = 0;
    for (const name of list) {
      if (name === 'step' && seen.has('step')) continue;
      seen.add(name);
      sfx(name, slot * 0.07);
      slot += 1;
      if (slot >= 7) break;
    }
  }, [events.seq]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- trainer special cut-in

/** A trainer's Special Move takes over the screen for a moment: their card swoops in with a voiceline. */
export function SpecialCutIn({ events, names }: { events: EventBatch; names: Record<Side, string> }) {
  const [show, setShow] = useState<{ key: number; side: Side; trainer: string } | null>(null);
  useEffect(() => {
    const e = events.list.find((x): x is Extract<GameEvent, { t: 'special' }> => x.t === 'special');
    if (!e) return;
    setShow({ key: events.seq, side: e.side, trainer: e.trainer });
    speakTrainer(e.trainer);
    const t = window.setTimeout(() => setShow(null), 2600);
    return () => window.clearTimeout(t);
  }, [events.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  const t = getTrainer(show.trainer);
  const fromLeft = show.side === 'A';
  return createPortal(
    <div key={show.key} className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center overflow-hidden" aria-live="polite">
      <div className={`absolute inset-0 animate-cutinBg ${fromLeft ? 'bg-gradient-to-r from-rose-900/90 via-rose-700/60' : 'bg-gradient-to-l from-sky-900/90 via-sky-700/60'} to-transparent`} />
      <div className="absolute inset-x-0 top-1/2 h-40 -translate-y-1/2 animate-cutinStripe bg-[repeating-linear-gradient(110deg,rgba(255,255,255,.12)_0_18px,transparent_18px_40px)]" />
      <div className={`relative flex items-center gap-6 ${fromLeft ? 'flex-row animate-cutinLeft' : 'flex-row-reverse animate-cutinRight'}`}>
        <img src={trainerImg(show.trainer)} alt="" className="w-[min(40vw,260px)] rotate-[-4deg] rounded-xl border-4 border-gold shadow-2xl ring-4 ring-[#2a170b]" />
        <div className={`max-w-md ${fromLeft ? 'text-left' : 'text-right'}`}>
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-200">{SIDE_NAME[show.side]} · {names[show.side]}</div>
          <div className="title-brush text-5xl">{t.name}</div>
          <div className="title-brush title-gold mt-1 text-3xl">Special Move!</div>
          <p className="mt-2 text-sm font-semibold text-white/90 drop-shadow">{t.special}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- field effects

type FieldKind = Extract<GameEvent, { t: 'field' }>['kind'];

const FIELD_TEXT: Record<FieldKind, string> = {
  sun: 'The sunlight turned harsh!', rain: 'It started to rain!', sand: 'A sandstorm kicked up!', hail: 'It started to hail!',
  screen: 'Light Screen!', wind: 'Tailwind!', veil: 'Aurora Veil!', guard: 'Wide Guard!', taunt: 'Taunt!', flowers: 'Flower Shield!',
  stageMist: 'A stage mist swept over the battlefield!',
};

/** Weather and other field-wide moves wash over the screen for a moment. */
export function FieldFx({ events }: { events: EventBatch }) {
  const [fx, setFx] = useState<{ key: number; kind: FieldKind } | null>(null);
  useEffect(() => {
    const e = [...events.list].reverse().find((x): x is Extract<GameEvent, { t: 'field' }> => x.t === 'field');
    if (!e) return;
    setFx({ key: events.seq, kind: e.kind });
    const t = window.setTimeout(() => setFx(null), 2000);
    return () => window.clearTimeout(t);
  }, [events.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fx) return null;
  const n = fx.kind === 'rain' ? 70 : fx.kind === 'hail' ? 45 : fx.kind === 'sand' || fx.kind === 'wind' ? 60 : fx.kind === 'flowers' ? 30 : fx.kind === 'stageMist' ? 24 : 0;
  const drops = Array.from({ length: LITE ? Math.ceil(n / 3) : n }, (_, i) => i);
  return createPortal(
    <div key={fx.key} className="pointer-events-none fixed inset-0 z-[55] overflow-hidden animate-fieldFade">
      {fx.kind === 'sun' && <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(253,224,71,.65),rgba(251,146,60,.25)_40%,transparent_70%)]" />}
      {fx.kind === 'screen' && <div className="absolute inset-0 animate-screenSweep bg-[linear-gradient(100deg,transparent_30%,rgba(165,243,252,.45)_50%,transparent_70%)]" />}
      {fx.kind === 'veil' && <div className="absolute inset-0 animate-screenSweep bg-[linear-gradient(100deg,transparent_25%,rgba(167,243,208,.4)_40%,rgba(196,181,253,.4)_55%,rgba(253,186,116,.35)_70%,transparent_80%)]" />}
      {fx.kind === 'guard' && <div className="absolute inset-0 animate-tauntPulse bg-[radial-gradient(circle,transparent_45%,rgba(56,189,248,.45))]" />}
      {fx.kind === 'taunt' && <div className="absolute inset-0 animate-tauntPulse bg-[radial-gradient(circle,transparent_40%,rgba(225,29,72,.55))]" />}
      {fx.kind === 'stageMist' && (
        <>
          <div className="absolute inset-0 bg-slate-200/20" />
          <div className="absolute inset-y-[20%] -left-1/2 w-[200%] animate-screenSweep bg-[radial-gradient(ellipse_at_25%_50%,rgba(241,245,249,.56),transparent_58%),radial-gradient(ellipse_at_75%_45%,rgba(203,213,225,.46),transparent_60%)] blur-md" />
        </>
      )}
      {fx.kind === 'sand' && <div className="absolute inset-0 bg-amber-700/25" />}
      {fx.kind === 'rain' && <div className="absolute inset-0 bg-slate-900/25" />}
      {drops.map((i) => {
        const left = (i * 37) % 100;
        const delay = ((i * 53) % 100) / 100;
        const cls = fx.kind === 'rain'
          ? 'h-6 w-px bg-sky-200/70 animate-rainDrop'
          : fx.kind === 'hail'
            ? 'h-2 w-2 rounded-full bg-white/90 animate-hailDrop'
            : fx.kind === 'sand'
              ? 'h-1 w-3 rounded-full bg-amber-300/70 animate-sandDrift'
              : fx.kind === 'wind'
                ? 'h-px w-16 rounded-full bg-white/80 animate-sandDrift'
                : 'h-3 w-3 rounded-full bg-pink-300/90 animate-hailDrop';
        const across = fx.kind === 'sand' || fx.kind === 'wind';
        return <span key={i} className={`absolute ${cls}`} style={{ left: `${left}%`, top: across ? `${(i * 29) % 100}%` : '-5%', animationDelay: `${delay}s` }} />;
      })}
      <div className="title-brush absolute inset-x-0 top-[18%] text-center text-4xl animate-fieldText">{FIELD_TEXT[fx.kind]}</div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- turn sweep

/** A small notice drops in above the board when a new turn starts, with a chime. It never covers the board. */
export function TurnSweep({ state, names, mySides }: { state: GameState; names: Record<Side, string>; mySides: Side[] }) {
  const key = state.phase === 'battle' ? `${state.round}-${state.side}` : null;
  const last = useRef<string | null>(null);
  const [show, setShow] = useState<{ key: string; side: Side; round: number } | null>(null);
  useEffect(() => {
    if (!key || key === last.current) return;
    const first = last.current === null;
    last.current = key;
    if (first && state.round === 1 && state.side === 'A' && state.log.length > 30) return;
    setShow({ key, side: state.side, round: state.round });
    sfx('turn');
    const t = window.setTimeout(() => setShow(null), TURN_NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  const yours = mySides.length === 1 && mySides[0] === show.side;
  return createPortal(
    <div key={show.key} className="pointer-events-none fixed inset-x-0 top-1 z-[50] flex justify-center px-2">
      <div className={`turn-banner animate-turnSweep flex max-w-full items-baseline gap-3 rounded-full border-x-[3px] border-x-[#e6bd55] px-5 py-1 ${show.side === 'A' ? 'turn-banner-a' : 'turn-banner-d'}`}>
        <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#f2d27a]">Round {show.round}</span>
        <span className="truncate font-display text-lg leading-tight text-[#fff3d6]">{yours ? 'Your turn!' : `${names[show.side]}’s turn`}</span>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- draft → battle

/** How long the new-turn notice stays up. */
const TURN_NOTICE_MS = 1000;

/** How long the versus screen and its 3-2-1 countdown last (the bot waits this long before placing). */
export const DRAFT_TRANSITION_MS = 2500;

/**
 * When the draft ends: both teams slide in from either side, a 3-2-1 countdown beeps, then
 * "Battle!" and the screen opens onto placement.
 */
export function DraftTransition({ state, names }: { state: GameState; names: Record<Side, string> }) {
  const prev = useRef(state.phase);
  const [show, setShow] = useState(false);
  const [count, setCount] = useState(3);
  useEffect(() => {
    const from = prev.current;
    prev.current = state.phase;
    // The versus screen marks the reveal: after the draft, or, in a Secret draft, when the battle begins.
    const secret = state.draft.style === 'secret';
    if (secret ? from !== 'placement' || state.phase !== 'battle' : from !== 'draft' || state.phase !== 'placement') return;
    setShow(true);
    setCount(3);
    const timers = [
      window.setTimeout(() => { setCount(3); sfx('count'); }, 400),
      window.setTimeout(() => { setCount(2); sfx('count'); }, 900),
      window.setTimeout(() => { setCount(1); sfx('count'); }, 1400),
      window.setTimeout(() => { setCount(0); sfx('go'); }, 1900),
      window.setTimeout(() => setShow(false), DRAFT_TRANSITION_MS),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [state.phase]);
  if (!show) return null;
  const team = (side: Side) => (
    <div className={`flex flex-col items-center gap-3 ${side === 'A' ? 'animate-vsLeft' : 'animate-vsRight'}`}>
      <div className={`text-sm font-black uppercase tracking-[0.3em] ${side === 'A' ? 'text-rose-300' : 'text-sky-300'}`}>{SIDE_NAME[side]}</div>
      <div className="text-2xl font-black text-white">{names[side]}</div>
      <div className="grid grid-cols-2 gap-3">
        {state.draft.picks[side].map((id) => (
          <div key={id} className="flex flex-col items-center gap-1">
            <Art id={id} className={`h-20 w-20 rounded-full shadow-xl ring-4 sm:h-24 sm:w-24 ${side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} alt={getCard(id).name} />
            <span className="text-xs font-bold text-white/90">{getCard(id).name}</span>
          </div>
        ))}
      </div>
      {state.trainers?.picks[side] && (
        <div className="flex items-center gap-2 rounded-lg bg-black/40 px-2 py-1">
          <img src={trainerImg(state.trainers.picks[side]!)} alt="" className="h-12 w-9 rounded object-cover object-top" />
          <span className="text-sm font-bold text-amber-200">{getTrainer(state.trainers.picks[side]!).name}</span>
        </div>
      )}
    </div>
  );
  return createPortal(
    <div className={`fixed inset-0 z-[65] flex items-center justify-center overflow-hidden bg-slate-950/95 ${count === 0 ? 'animate-vsOut' : 'animate-fadeIn'}`}>
      <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(225,29,72,.35)_0%,transparent_45%,transparent_55%,rgba(14,165,233,.35)_100%)]" />
      <div className="relative flex w-full max-w-5xl items-center justify-around gap-4 px-4">
        {team('A')}
        <div className="flex w-32 flex-col items-center">
          <div className="text-6xl font-black italic text-white drop-shadow-[0_4px_0_rgba(0,0,0,.6)]">VS</div>
          <div key={count} className="mt-6 h-24 animate-countPop text-7xl font-black text-amber-300 drop-shadow-[0_4px_0_rgba(0,0,0,.6)]">
            {count > 0 ? count : 'Battle!'}
          </div>
        </div>
        {team('D')}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- victory confetti

/** Confetti for a win. */
export function Confetti() {
  const bits = Array.from({ length: LITE ? 32 : 90 }, (_, i) => i);
  const colors = ['#f43f5e', '#38bdf8', '#facc15', '#34d399', '#a78bfa', '#fb923c'];
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      {bits.map((i) => (
        <span
          key={i}
          className="absolute top-[-4%] h-3 w-2 animate-confetti rounded-sm"
          style={{ left: `${(i * 41) % 100}%`, background: colors[i % colors.length], animationDelay: `${((i * 17) % 60) / 30}s`, animationDuration: `${2.8 + ((i * 7) % 10) / 5}s` }}
        />
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- sound settings

/** The speaker button: music, sound effects and voices on or off, and the volume. */
export function SoundButton({ className = '', up = false }: { className?: string; up?: boolean }) {
  const s = useSyncExternalStore(onAudioSettings, getAudioSettings);
  const [open, setOpen] = useState(false);
  const muted = !s.music && !s.sfx && !s.voice;
  return (
    <div className={`relative ${className}`}>
      <button type="button" className="btn-ghost !px-2.5" aria-label="Sound settings" title="Sound" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
          {muted || s.volume === 0 ? <path d="m22 9-6 6m0-6 6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
        </svg>
      </button>
      {open && (
        <div className={`absolute z-[70] w-52 space-y-2 rounded-xl bg-slate-900 p-3 text-sm shadow-xl ring-1 ring-white/10 ${up ? 'bottom-full left-0 mb-1' : 'right-0 mt-1'}`}>
          {([['music', 'Music'], ['sfx', 'Sound effects'], ['voice', 'Trainer voices']] as const).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between gap-2">
              <span>{label}</span>
              <input type="checkbox" checked={s[k]} onChange={(e) => setAudioSettings({ [k]: e.target.checked })} className="h-4 w-4 accent-amber-400" />
            </label>
          ))}
          <label className="flex cursor-pointer items-center justify-between gap-2" title="Off: the original chiptune music and effects">
            <span>Conquest soundtrack</span>
            <input type="checkbox" checked={s.soundtrack === 'conquest'} onChange={(e) => setAudioSettings({ soundtrack: e.target.checked ? 'conquest' : 'chiptune' })} className="h-4 w-4 accent-amber-400" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => setAudioSettings({ volume: Number(e.target.value) })} className="w-full accent-amber-400" />
          </label>
        </div>
      )}
    </div>
  );
}
