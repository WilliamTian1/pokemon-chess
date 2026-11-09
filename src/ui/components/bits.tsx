import type { ReactNode } from 'react';
import { type PType, type Side, type StatusId, CARDS, TYPE_COLORS } from '../../engine';

/** Cards whose artwork isn't finished yet: their tokens show the name instead (none at the moment). */
const NO_ART = new Set<string>([]);

/** A type as a little lacquered tag: its colour, a darker rim and a highlight. */
export function TypeBadge({ type, small }: { type: PType; small?: boolean }) {
  return (
    <span
      className={`type-badge ${small ? 'type-badge-sm' : ''}`}
      style={{ backgroundColor: TYPE_COLORS[type], borderColor: `color-mix(in srgb, ${TYPE_COLORS[type]} 55%, #1b120b)` }}
    >
      {type}
    </span>
  );
}

const STATUS_STYLE: Record<StatusId, [string, string]> = {
  psn: ['PSN', 'bg-purple-600'],
  tox: ['TOX', 'bg-fuchsia-700'],
  brn: ['BRN', 'bg-orange-600'],
  par: ['PAR', 'bg-yellow-500 text-slate-900'],
  slp: ['SLP', 'bg-slate-500'],
  frz: ['FRZ', 'bg-cyan-500 text-slate-900'],
};

export function StatusBadge({ status }: { status: StatusId }) {
  const [label, cls] = STATUS_STYLE[status];
  return <span className={`chip ${cls} text-white`}>{label}</span>;
}

export function Art({ id, className = '', alt }: { id: string; className?: string; alt?: string }) {
  const card = CARDS[id];
  if (NO_ART.has(id) && card) {
    const [a, b = a] = card.types;
    return (
      <span
        role="img"
        aria-label={alt ?? card.name}
        className={`flex select-none items-center justify-center overflow-hidden font-black text-white ${className}`}
        style={{ background: `linear-gradient(135deg, ${TYPE_COLORS[a]}, ${TYPE_COLORS[b]})`, textShadow: '0 1px 2px rgba(0,0,0,.6)', containerType: 'inline-size' }}
      >
        <span className="text-[38cqw] leading-none">{card.name.slice(0, 2)}</span>
      </span>
    );
  }
  return (
    <img
      src={`${import.meta.env.BASE_URL}art/${id}.jpg`}
      alt={alt ?? ''}
      draggable={false}
      loading="lazy"
      className={`select-none object-cover ${className}`}
    />
  );
}

/** The printed card, cropped from Conquest Cards.pdf (public/cards). */
export function CardImage({ id, name, className = '' }: { id: string; name: string; className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}cards/${id}.jpg`}
      alt={`${name} card`}
      draggable={false}
      loading="lazy"
      className={`block aspect-[204/265] w-full select-none rounded-lg bg-slate-800 object-cover shadow-md shadow-black/40 ${className}`}
    />
  );
}

export function HpBar({ hp, max, className = '' }: { hp: number; max: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const color = pct > 50 ? 'bg-emerald-400' : pct > 25 ? 'bg-amber-400' : 'bg-rose-500';
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-slate-950/70 ${className}`}>
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const SIDE_RING: Record<Side, string> = { A: 'ring-rose-500', D: 'ring-sky-500' };
export const SIDE_TEXT: Record<Side, string> = { A: 'text-rose-400', D: 'text-sky-400' };
export const SIDE_BG: Record<Side, string> = { A: 'bg-rose-500', D: 'bg-sky-500' };

export function SideTag({ side, children }: { side: Side; children?: ReactNode }) {
  return (
    <span className={`chip ${SIDE_BG[side]} text-white`}>{children ?? (side === 'A' ? 'Attacker' : 'Defender')}</span>
  );
}

export function Modal({ children, onClose, wide, xwide }: { children: ReactNode; onClose?: () => void; wide?: boolean; xwide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`panel max-h-[92vh] w-full overflow-y-auto p-4 ${xwide ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
