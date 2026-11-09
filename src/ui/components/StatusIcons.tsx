import { useEffect, useRef, useState } from 'react';
import type { GameEvent, GameState, StatId, StatusId, Unit } from '../../engine';
import type { EventBatch } from '../controller';

// ---------------------------------------------------------------- effect tags

/**
 * The tabletop's effect tags (public/tags, cropped from the card sheet): one tag per stat stage,
 * the status condition, and a "!" or sweat-drop tag for temporary effects, with a red number for
 * how many of the Pokémon's turns the effect still lasts.
 */
interface Tag {
  key: string;
  /** Image in public/tags, or null for the frozen tag (drawn in the same style). */
  img: string | null;
  title: string;
  turns?: number;
}

const STATUS_TAG: Record<StatusId, { img: string | null; title: string }> = {
  psn: { img: 'psn', title: 'Poisoned' },
  tox: { img: 'tox', title: 'Badly poisoned' },
  brn: { img: 'brn', title: 'Burned' },
  par: { img: 'par', title: 'Paralyzed' },
  slp: { img: 'slp', title: 'Asleep' },
  frz: { img: null, title: 'Frozen' },
};
const STAT_TAG: Record<StatId, string> = { atk: 'Attack', def: 'Defense', mov: 'Movement' };

export function unitTags(state: GameState | null, u: Unit): Tag[] {
  const out: Tag[] = [];
  if (u.status) {
    const st = STATUS_TAG[u.status];
    out.push({ key: 'status', img: st.img, title: u.status === 'tox' ? `${st.title} (${20 * (u.toxicN + 1)} damage next)` : st.title });
  }
  for (const k of ['atk', 'def', 'mov'] as const) {
    const v = u.stages[k];
    for (let i = 0; i < Math.abs(v); i++) {
      out.push({ key: `${k}${v > 0 ? '+' : '-'}${i}`, img: `${k}-${v > 0 ? 'up' : 'down'}`, title: `${STAT_TAG[k]} ${v > 0 ? '+' : ''}${v}` });
    }
  }
  if (u.flinched) out.push({ key: 'flinch', img: 'sweat', title: 'Flinched: loses its next activation', turns: 1 });
  if (u.nextTurn.noAct || u.nextTurn.noMove) {
    out.push({ key: 'recharge', img: 'sweat', title: u.nextTurn.noAct ? 'Recharging: can’t move or act next turn' : 'Can’t move next turn', turns: 1 });
  }
  if (u.confused) out.push({ key: 'confused', img: 'effect', title: 'Confused: ⅓ chance its next action fails', turns: 1 });
  if (u.followMe) out.push({ key: 'decoy', img: 'effect', title: 'Follow Me: opponents must target it next turn', turns: 1 });
  if (u.wideGuard) out.push({ key: 'guard', img: 'effect', title: 'Wide Guard: next turn, attacks that hit it and other Pokémon fail', turns: 1 });
  if (state?.taunted === u.side) out.push({ key: 'taunt', img: 'effect', title: 'Taunted: must attack if it can', turns: 1 });
  if (u.dmgBonus > 0) out.push({ key: 'boost', img: 'atk-up', title: `+${u.dmgBonus} damage this turn`, turns: 1 });
  if (u.locked.length) out.push({ key: 'cooldown', img: 'effect', title: `${u.locked.join(', ')} on cooldown until it ends a turn 4+ tiles from opponents` });
  if (u.sturdyBroken) out.push({ key: 'sturdy', img: 'effect', title: 'Sturdy used: faints the next time it’s hurt' });
  if (state?.futureSight.some((f) => f.userId === u.id)) out.push({ key: 'fs', img: 'effect', title: 'Future Sight lands at the start of its next turn', turns: 1 });
  return out;
}

/** Small deterministic PRNG, so a tag keeps its spot and tilt from render to render. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tag diameter as a fraction of the card's width: smaller when many share a card, so they still don't overlap. */
const tagSize = (n: number): number => (n <= 4 ? 0.24 : n <= 7 ? 0.2 : 0.17);
/** Card height in card widths (cards are 204 × 265). */
const CARD_H = 265 / 204;

interface Placed {
  tag: Tag;
  x: number;
  y: number;
  rot: number;
}

/**
 * Scatters the tags over the card like tokens dropped on a real one: each tag tries spots from its
 * own seeded sequence, over the picture first and then the whole card, and takes the first that
 * doesn't overlap a tag placed before it.
 */
function layout(unitId: string, tags: Tag[]): { placed: Placed[]; size: number } {
  const TAG = tagSize(tags.length);
  const placed: Placed[] = [];
  const free = (x: number, y: number) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= TAG * 0.98);
  for (const tag of tags) {
    const rnd = seeded(`${unitId}|${tag.key}`);
    const rot = (rnd() - 0.5) * 30;
    let spot: { x: number; y: number } | null = null;
    let fallback = { x: 0, y: 0 };
    for (let i = 0; i < 80 && !spot; i++) {
      const wide = i >= 40;
      const x = 0.02 + rnd() * (0.96 - TAG);
      const y = wide ? 0.03 + rnd() * (CARD_H - 0.06 - TAG) : 0.1 + rnd() * (0.66 - TAG);
      if (i === 0) fallback = { x, y };
      if (free(x, y)) spot = { x, y };
    }
    placed.push({ tag, ...(spot ?? fallback), rot });
  }
  return { placed, size: TAG };
}

/** The effect tags of `unit`, scattered over its card (inside a container-sized card box). */
export function CardTags({ state, unit }: { state?: GameState | null; unit: Unit }) {
  if (unit.fainted) return null;
  const { placed, size } = layout(unit.id, unitTags(state ?? null, unit));
  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {placed.map(({ tag, x, y, rot }) => (
        <div
          key={tag.key}
          title={tag.title}
          className="absolute aspect-square animate-tagDrop drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)]"
          style={{ left: `${x * 100}%`, top: `${(y / CARD_H) * 100}%`, width: `${size * 100}%`, ['--rot' as string]: `${rot}deg`, transform: `rotate(${rot}deg)` }}
        >
          {tag.img ? (
            <img src={`${import.meta.env.BASE_URL}tags/${tag.img}.png`} alt={tag.title} draggable={false} className="h-full w-full select-none" />
          ) : (
            <FrozenTag />
          )}
          {tag.turns !== undefined && (
            <span className="absolute -right-[6%] -top-[6%] flex aspect-square w-[42%] items-center justify-center rounded-full bg-red-600 text-[6cqw] font-black leading-none text-white ring-1 ring-white/80">
              {tag.turns}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The sheet has no frozen tag; this one is drawn to match the others. */
function FrozenTag() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-label="Frozen">
      <circle cx="50" cy="50" r="48" fill="#eeeeee" stroke="#555" strokeWidth="2.5" />
      <g stroke="#111" strokeWidth="6" strokeLinecap="round">
        {[0, 60, 120].map((a) => (
          <g key={a} transform={`rotate(${a} 50 50)`}>
            <line x1="50" y1="20" x2="50" y2="80" />
            <line x1="50" y1="28" x2="42" y2="20" />
            <line x1="50" y1="28" x2="58" y2="20" />
            <line x1="50" y1="72" x2="42" y2="80" />
            <line x1="50" y1="72" x2="58" y2="80" />
          </g>
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- hit effects

type FxKind = 'damage' | 'heal' | 'status' | 'stage' | 'miss' | 'faint';
interface Fx {
  key: string;
  kind: FxKind;
  text: string;
  img?: string | null;
  /** Colour of the status flash. */
  tint?: string;
}

const STATUS_FX: Record<StatusId | 'confused' | 'flinched', { text: string; img: string | null; tint: string }> = {
  psn: { text: 'Poisoned!', img: 'psn', tint: 'rgba(168, 85, 247, 0.55)' },
  tox: { text: 'Badly poisoned!', img: 'tox', tint: 'rgba(147, 51, 234, 0.6)' },
  brn: { text: 'Burned!', img: 'brn', tint: 'rgba(249, 115, 22, 0.6)' },
  par: { text: 'Paralyzed!', img: 'par', tint: 'rgba(250, 204, 21, 0.55)' },
  slp: { text: 'Asleep!', img: 'slp', tint: 'rgba(148, 163, 184, 0.6)' },
  frz: { text: 'Frozen!', img: null, tint: 'rgba(103, 232, 249, 0.6)' },
  confused: { text: 'Confused!', img: 'effect', tint: 'rgba(236, 72, 153, 0.5)' },
  flinched: { text: 'Flinched!', img: 'sweat', tint: 'rgba(148, 163, 184, 0.5)' },
};

function fxFor(e: GameEvent): { unitId: string; fx: Omit<Fx, 'key'> } | null {
  switch (e.t) {
    case 'damage':
      return e.amount > 0 ? { unitId: e.unitId, fx: { kind: 'damage', text: `−${e.amount}` } } : null;
    case 'heal':
      return { unitId: e.unitId, fx: { kind: 'heal', text: `+${e.amount}` } };
    case 'status': {
      const st = STATUS_FX[e.status];
      return { unitId: e.unitId, fx: { kind: 'status', text: st.text, img: st.img, tint: st.tint } };
    }
    case 'stage':
      return { unitId: e.unitId, fx: { kind: 'stage', text: `${STAT_TAG[e.stat]} ${e.delta > 0 ? '▲'.repeat(e.delta) : '▼'.repeat(-e.delta)}`, img: `${e.stat}-${e.delta > 0 ? 'up' : 'down'}` } };
    case 'miss':
      return { unitId: e.unitId, fx: { kind: 'miss', text: 'Miss' } };
    case 'faint':
      return { unitId: e.unitId, fx: { kind: 'faint', text: 'Fainted!' } };
    default:
      return null;
  }
}

/** Effects playing on each Pokémon's card, from the latest batch of game events. */
export function useCardFx(events: EventBatch): Record<string, Fx[]> {
  const [fx, setFx] = useState<Record<string, Fx[]>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const add: Record<string, Fx[]> = {};
    events.list.forEach((e, i) => {
      const f = fxFor(e);
      if (!f) return;
      (add[f.unitId] ??= []).push({ ...f.fx, key: `${events.seq}-${i}` });
    });
    if (!Object.keys(add).length) return;
    setFx((cur) => {
      const next = { ...cur };
      for (const [id, list] of Object.entries(add)) next[id] = [...(next[id] ?? []), ...list];
      return next;
    });
    const keys = new Set(Object.values(add).flat().map((f) => f.key));
    timers.current.push(window.setTimeout(() => {
      setFx((cur) => Object.fromEntries(Object.entries(cur).map(([id, list]) => [id, list.filter((f) => !keys.has(f.key))])));
    }, 1600));
  }, [events.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  return fx;
}

/** Plays a card's effects: a shake and red flash for damage, a green glow for healing, the status tag bursting in, floating numbers. */
export function CardFx({ list }: { list?: Fx[] }) {
  if (!list?.length) return null;
  const hit = list.find((f) => f.kind === 'damage');
  const heal = list.find((f) => f.kind === 'heal');
  const statuses = list.filter((f) => f.kind === 'status');
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {hit && <div key={`h${hit.key}`} className="absolute inset-0 animate-cardHit rounded-lg bg-red-500/60 mix-blend-screen" />}
      {heal && <div key={`g${heal.key}`} className="absolute inset-0 animate-cardHeal rounded-lg" />}
      {statuses.map((f) => (
        <div key={`s${f.key}`} className="absolute inset-0 animate-cardHeal rounded-lg" style={{ background: f.tint }} />
      ))}
      {list.filter((f) => f.img !== undefined && f.kind !== 'damage').map((f) => (
        <div key={`b${f.key}`} className="absolute left-1/2 top-[34%] aspect-square w-[44%] -translate-x-1/2 -translate-y-1/2 animate-tagBurst">
          {f.img ? <img src={`${import.meta.env.BASE_URL}tags/${f.img}.png`} alt="" className="h-full w-full" /> : <FrozenTag />}
        </div>
      ))}
      {list.map((f, i) => (
        <div
          key={`t${f.key}`}
          className={`absolute left-1/2 animate-floatUp whitespace-nowrap rounded px-[2cqw] text-[10cqw] font-black leading-none shadow-lg ${
            f.kind === 'damage' ? 'bg-rose-600 text-white' : f.kind === 'heal' ? 'bg-emerald-500 text-white' : f.kind === 'faint' ? 'bg-slate-900 text-white' : 'bg-white/90 text-slate-900'
          }`}
          style={{ top: `${30 + (i % 4) * 11}%`, animationDelay: `${(i % 4) * 0.08}s` }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}

/** A card container's shake while it takes a hit (class to add to the card's own box). */
export const shakeClass = (list?: Fx[]): string => (list?.some((f) => f.kind === 'damage') ? 'animate-cardShake' : '');
