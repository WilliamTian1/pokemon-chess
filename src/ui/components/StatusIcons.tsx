import type { StatId, StatusId, Unit } from '../../engine';

const STATUS: Record<StatusId, { icon: string; label: string; cls: string }> = {
  psn: { icon: '☠', label: 'Poison', cls: 'bg-purple-600' },
  tox: { icon: '☠', label: 'Toxic', cls: 'bg-fuchsia-700' },
  brn: { icon: '🔥', label: 'Burn', cls: 'bg-orange-600' },
  par: { icon: '⚡', label: 'Paralysis', cls: 'bg-yellow-400 text-slate-950' },
  slp: { icon: '💤', label: 'Sleep', cls: 'bg-slate-500' },
  frz: { icon: '❄', label: 'Freeze', cls: 'bg-cyan-400 text-slate-950' },
};

const STAT: Record<StatId, { icon: string; label: string }> = {
  atk: { icon: '⚔', label: 'Attack' },
  def: { icon: '🛡', label: 'Defense' },
  mov: { icon: '👟', label: 'Movement' },
};

interface Badge {
  key: string;
  icon: string;
  text: string;
  title: string;
  cls: string;
}

export function unitBadges(u: Unit): Badge[] {
  const out: Badge[] = [];
  if (u.status) {
    const st = STATUS[u.status];
    out.push({ key: 'status', icon: st.icon, text: u.status === 'tox' ? `TOX ${u.toxicN + 1}` : u.status.toUpperCase(), title: st.label, cls: st.cls });
  }
  for (const k of ['atk', 'def', 'mov'] as const) {
    const v = u.stages[k];
    if (!v) continue;
    out.push({
      key: k, icon: STAT[k].icon, text: `${v > 0 ? '▲' : '▼'}${Math.abs(v)}`,
      title: `${STAT[k].label} ${v > 0 ? '+' : ''}${v}`, cls: v > 0 ? 'bg-emerald-600' : 'bg-rose-600',
    });
  }
  if (u.confused) out.push({ key: 'cf', icon: '💫', text: 'CONF', title: 'Confused', cls: 'bg-pink-600' });
  if (u.flinched) out.push({ key: 'fl', icon: '✋', text: 'FLINCH', title: 'Flinched: loses its next activation', cls: 'bg-slate-600' });
  if (u.followMe) out.push({ key: 'fm', icon: '🎯', text: 'DECOY', title: 'Follow Me: opponents must target it', cls: 'bg-amber-500 text-slate-950' });
  if (u.sturdyBroken) out.push({ key: 'st', icon: '⛰', text: '1 HP', title: 'Sturdy used: hanging on', cls: 'bg-stone-500' });
  if (u.nextTurn.noAct || u.nextTurn.noMove) out.push({ key: 'rc', icon: '⏳', text: 'RECHARGE', title: 'Must recharge next turn', cls: 'bg-slate-600' });
  return out;
}

/**
 * Large status and stat-change badges laid over a card's artwork. Sizes follow the card (container
 * units), so they stay readable however big the card is drawn.
 */
export function CardStatusOverlay({ unit }: { unit: Unit }) {
  const badges = unitBadges(unit);
  if (!badges.length || unit.fainted) return null;
  return (
    <div className="pointer-events-none absolute left-[5%] top-[18%] flex max-h-[34%] flex-col flex-wrap content-start gap-[1.5cqw]">
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.title}
          className={`flex items-center gap-[1.2cqw] rounded-full px-[2.8cqw] py-[1cqw] text-[8.5cqw] font-black leading-none text-white shadow-lg shadow-black/70 ring-2 ring-white/70 ${b.cls}`}
        >
          <span aria-hidden="true">{b.icon}</span>
          <span>{b.text}</span>
        </span>
      ))}
    </div>
  );
}
