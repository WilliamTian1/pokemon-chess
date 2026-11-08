import type { ReactNode } from 'react';
import {
  type CardDef, type GameState, type MoveDef, type TargetPreview, type Unit, STAT_NAME, cardOf, damageVs, liveUnits, onBoard,
} from '../../engine';
import { Art, CardImage, HpBar, StatusBadge } from './bits';
import { TypeMatchups } from './Matchups';

/** The card's 3×N targeting diagram, in the same colours as the printed cards. */
export function MiniGrid({ move, size = 12 }: { move: MoveDef; size?: number }) {
  const t = move.target;
  if (t.kind === 'self' || t.kind === 'global' || t.kind === 'ally') {
    const label = t.kind === 'self' ? 'Self' : t.kind === 'global' ? 'Field' : 'Ally';
    return <span className="chip bg-slate-700 text-slate-200">{label}</span>;
  }
  if (t.kind === 'range') return <span className="chip bg-slate-700 text-slate-200">≤{t.range} tiles</span>;
  const rows = t.grid.split('/');
  const color: Record<string, string> = {
    O: 'bg-orange-400',
    G: 'bg-lime-400',
    B: 'bg-sky-400',
    R: 'bg-red-500',
    '.': 'bg-slate-200/90',
  };
  return (
    <div className="inline-grid gap-px rounded-sm border border-slate-500 bg-slate-500" style={{ gridTemplateColumns: `repeat(3, ${size}px)` }}>
      {rows.flatMap((row, r) =>
        [...row].map((ch, c) => (
          <div key={`${r}-${c}`} className={color[ch] ?? color['.']} style={{ width: size, height: size }} />
        )),
      )}
    </div>
  );
}

export interface VsEntry {
  unit: Unit;
  p: TargetPreview;
}

/** Damage text for a preview: "45", "40–60", "immune", with KO odds when it can faint the target. */
export function damageText(p: TargetPreview): string {
  if (p.kind === 'immune') return 'immune';
  if (p.kind === 'absorb') return 'absorbs';
  const base = p.min === p.max ? `${p.max}` : `${p.min}–${p.max}`;
  if (p.koChance >= 0.995) return `${base} KO`;
  return p.koChance > 0 ? `${base} KO ${Math.round(p.koChance * 100)}%` : base;
}

/** "Damage vs" chips: what an attack would deal to each opponent if it landed from where the user stands. */
export function VsList({ list }: { list: VsEntry[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {list.map(({ unit, p }) => {
        const se = p.notes.some((n) => n.startsWith('Super'));
        const nve = p.notes.some((n) => n.startsWith('Not very'));
        const cls = p.koChance > 0 ? 'bg-rose-600 text-white'
          : p.kind !== 'damage' ? 'bg-slate-700 text-slate-400'
          : se ? 'bg-emerald-700 text-white' : nve ? 'bg-amber-800 text-amber-100' : 'bg-slate-700 text-slate-100';
        return (
          <span key={unit.id} className={`inline-flex items-center gap-1 rounded-full py-px pl-px pr-1.5 text-[10px] font-bold ${cls}`} title={`vs ${cardOf(unit).name}${p.notes.length ? ` · ${p.notes.join(', ')}` : ''}`}>
            <Art id={unit.cardId} className="h-4 w-4 rounded-full" alt={cardOf(unit).name} />
            {damageText(p)}
          </span>
        );
      })}
    </div>
  );
}

/** Status, stat stages and turn notes for a Pokémon on the board. */
export function UnitChips({ unit }: { unit: Unit }) {
  const chips = [
    unit.status && <StatusBadge key="st" status={unit.status} />,
    ...(['atk', 'def', 'mov'] as const).map((k) =>
      unit.stages[k] ? (
        <span key={k} className={`chip ${unit.stages[k] > 0 ? 'bg-emerald-600' : 'bg-rose-700'} text-white`}>
          {STAT_NAME[k]} {unit.stages[k] > 0 ? '+' : ''}{unit.stages[k]}
        </span>
      ) : null,
    ),
    unit.confused && <span key="cf" className="chip bg-pink-600 text-white">Confused</span>,
    unit.flinched && <span key="fl" className="chip bg-slate-600 text-white">Flinched</span>,
    unit.followMe && <span key="fm" className="chip bg-amber-500 text-slate-900">Follow Me</span>,
    unit.sturdyBroken && <span key="sb" className="chip bg-stone-500 text-white">Hanging on</span>,
  ].filter(Boolean);
  return chips.length ? <div className="flex flex-wrap gap-1 text-[11px]">{chips}</div> : null;
}

/** For a Pokémon on the board, each attack's damage against every opponent. */
export function vsTable(s: GameState, u: Unit): (VsEntry[] | undefined)[] {
  if (!onBoard(u) || (s.phase !== 'battle' && s.phase !== 'placement')) return [undefined, undefined];
  const foes = liveUnits(s).filter((x) => x.side !== u.side);
  return ([0, 1] as const).map((i) => {
    const list = foes.map((t) => ({ unit: t, p: damageVs(s, u.id, i, t.id) })).filter((x): x is VsEntry => !!x.p);
    return list.length ? list : undefined;
  });
}

/** A card's details: the printed card itself, live state if it's on the board, and its type matchups. */
export function CardDetail({ card, unit, extra }: { card: CardDef; unit?: Unit; extra?: ReactNode }) {
  return (
    <div className="space-y-3">
      <CardImage id={card.id} name={card.name} className="mx-auto w-full max-w-[340px]" />
      {unit && !unit.fainted && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>HP</span>
            <b>{unit.hp}/{unit.maxHp}</b>
          </div>
          <HpBar hp={unit.hp} max={unit.maxHp} />
          <UnitChips unit={unit} />
        </div>
      )}
      {card.notes?.map((n) => <p key={n} className="text-[11px] italic text-slate-500">Note: {n}</p>)}
      <TypeMatchups card={card} />
      {extra}
    </div>
  );
}
