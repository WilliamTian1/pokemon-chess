import { useState } from 'react';
import {
  type CardDef, type GameState, type PType, type Side, TYPES, TYPE_COLORS, attackTypes, bestHit, cardOf, defenseProfile, hitMultiplier,
  multLabel, typeMultiplier,
} from '../../engine';
import { Art, Modal, SIDE_TEXT, TypeBadge } from './bits';

/**
 * A multiplier chip. `hit` reads from the attacker's point of view (high is good), `take` from
 * the defender's (high is bad), so the colours flip between them.
 */
export function MultChip({ mult, kind, label }: { mult: number; kind: 'hit' | 'take'; label?: string }) {
  const good = kind === 'hit' ? mult > 1 : mult < 1;
  const cls = mult === 1
    ? 'bg-slate-700 text-slate-300'
    : mult === 0
      ? kind === 'hit' ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'
      : good
        ? mult >= 4 || mult <= 0.25 ? 'bg-emerald-500 text-slate-950' : 'bg-emerald-600 text-white'
        : mult >= 4 || mult <= 0.25 ? 'bg-rose-500 text-white' : 'bg-rose-600 text-white';
  return <span className={`chip whitespace-nowrap normal-case ${cls}`}>{label ? `${label} ` : ''}{multLabel(mult)}</span>;
}

/** Weaknesses, resistances and immunities of a card, plus what its attacks hit hard. */
export function TypeMatchups({ card }: { card: CardDef }) {
  const prof = defenseProfile(card);
  const groups: { title: string; list: typeof prof; cls: string }[] = [
    { title: 'Weak to', list: prof.filter((x) => x.mult > 1), cls: 'text-rose-300' },
    { title: 'Resists', list: prof.filter((x) => x.mult > 0 && x.mult < 1), cls: 'text-emerald-300' },
    { title: 'Immune', list: prof.filter((x) => x.mult === 0), cls: 'text-sky-300' },
  ];
  const atk = attackTypes(card);
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-800/70 p-2.5 text-xs">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Type matchups</div>
      {groups.map((g) =>
        g.list.length ? (
          <div key={g.title} className="flex flex-wrap items-center gap-1">
            <span className={`w-14 shrink-0 font-semibold ${g.cls}`}>{g.title}</span>
            {g.list.map((x) => (
              <span key={x.type} className="inline-flex items-center gap-0.5">
                <TypeBadge type={x.type} small />
                {x.mult !== 2 && x.mult !== 0.5 && x.mult !== 0 && <span className="text-[10px] font-bold text-slate-300">{multLabel(x.mult)}</span>}
              </span>
            ))}
          </div>
        ) : null,
      )}
      {atk.map((t) => {
        const strong = TYPES.filter((d) => typeMultiplier(t, [d]) >= 2);
        return (
          <div key={t} className="flex flex-wrap items-center gap-1">
            <span className="w-14 shrink-0 font-semibold text-amber-200">{t} hits</span>
            {strong.length ? strong.map((d) => <TypeBadge key={d} type={d} small />) : <span className="text-slate-500">nothing super effectively</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Pool cards that have the edge over `card`, and the ones `card` has the edge over. */
export function CounterLists({ card, pool, onOpen }: { card: CardDef; pool: CardDef[]; onOpen?: (c: CardDef) => void }) {
  const others = pool.filter((c) => c.id !== card.id);
  const answers = others.filter((c) => (bestHit(c, card)?.mult ?? 0) >= 2 || (bestHit(card, c)?.mult ?? 1) <= 0.5);
  const preys = others.filter((c) => (bestHit(card, c)?.mult ?? 0) >= 2 || (bestHit(c, card)?.mult ?? 1) <= 0.5);
  const row = (title: string, list: CardDef[], cls: string) => (
    <div>
      <div className={`mb-1 text-[11px] font-semibold ${cls}`}>{title}</div>
      {list.length ? (
        <div className="flex flex-wrap gap-1">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen?.(c)} className="flex items-center gap-1 rounded-md bg-slate-900 px-1 py-0.5 hover:bg-slate-700" title={matchupTitle(c, card)}>
              <Art id={c.id} className="h-5 w-5 rounded-full" />
              <span className="text-[11px]">{c.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">None of the cards still available.</div>
      )}
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg bg-slate-800/70 p-2.5">
      {row(`Available cards good against ${card.name}`, answers, 'text-rose-300')}
      {row(`Available cards ${card.name} is good against`, preys, 'text-emerald-300')}
    </div>
  );
}

export function matchupTitle(a: CardDef, b: CardDef): string {
  const ab = bestHit(a, b);
  const ba = bestHit(b, a);
  return `${a.name}'s best attack vs ${b.name}: ${ab ? `${ab.type} ${multLabel(ab.mult)}` : 'none'} · ${b.name}'s best vs ${a.name}: ${ba ? `${ba.type} ${multLabel(ba.mult)}` : 'none'}`;
}

/** Both teams' best type matchups against each other (fainted Pokémon left out). */
export function MatchupMatrix({ state, rows, onHover }: { state: GameState; rows: Side; onHover?: (ids: string[] | null) => void }) {
  // Every Pokémon still in the match, placed or not: both teams are known once the draft ends.
  const team = (side: Side) => state.units.filter((u) => u.side === side && !u.fainted);
  const mine = team(rows);
  const theirs = team(rows === 'A' ? 'D' : 'A');
  if (!mine.length || !theirs.length) return <div className="text-xs text-slate-500">Nothing to compare.</div>;
  return (
    <div className="overflow-x-auto" onMouseLeave={() => onHover?.(null)}>
      <table className="w-full border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="text-left font-medium text-slate-500">
              <span className={SIDE_TEXT[rows]}>Row</span> hits / takes
            </th>
            {theirs.map((t) => (
              <th key={t.id} className="px-0.5" title={cardOf(t).name}>
                <Art id={t.cardId} className={`mx-auto h-7 w-7 rounded-full ring-2 ${t.side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} alt={cardOf(t).name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mine.map((m) => (
            <tr key={m.id}>
              <th className="pr-1 text-left" title={cardOf(m).name}>
                <div className="flex items-center gap-1">
                  <Art id={m.cardId} className={`h-7 w-7 shrink-0 rounded-full ring-2 ${m.side === 'A' ? 'ring-rose-500' : 'ring-sky-500'}`} alt={cardOf(m).name} />
                  <span className="hidden truncate font-semibold text-slate-300 xl:inline">{cardOf(m).name}</span>
                </div>
              </th>
              {theirs.map((t) => {
                const hit = bestHit(cardOf(m), cardOf(t));
                const take = bestHit(cardOf(t), cardOf(m));
                return (
                  <td
                    key={t.id}
                    className="rounded bg-slate-800/80 p-0.5 text-center"
                    title={matchupTitle(cardOf(m), cardOf(t))}
                    onMouseEnter={() => onHover?.([m.id, t.id])}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      {hit ? <MultChip mult={hit.mult} kind="hit" /> : <span className="text-slate-600">—</span>}
                      {take ? <MultChip mult={take.mult} kind="take" /> : <span className="text-slate-600">—</span>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] leading-snug text-slate-500">
        Top: best type multiplier of the row Pokémon's attacks on the column Pokémon. Bottom: the column Pokémon's best attack on the row Pokémon. Abilities like Levitate and Thick Fat are included.
      </p>
    </div>
  );
}

/** The 18-type chart, with the option to pick a defender (one or two types, or a card). */
export function TypeChartModal({ onClose, cards = [] }: { onClose: () => void; cards?: CardDef[] }) {
  const [def, setDef] = useState<PType[]>([]);
  const [card, setCard] = useState<CardDef | null>(null);
  const [hover, setHover] = useState<{ a: PType; d: PType } | null>(null);
  const toggle = (t: PType) => {
    setCard(null);
    setDef((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur.slice(-1), t]));
  };
  const pickedTypes = card ? card.types : def;
  const cell = (m: number) =>
    m === 0 ? 'bg-slate-950 text-slate-400' : m >= 4 ? 'bg-emerald-400 text-slate-950' : m >= 2 ? 'bg-emerald-600 text-white'
      : m <= 0.25 ? 'bg-rose-700 text-white' : m < 1 ? 'bg-rose-500/80 text-white' : 'bg-slate-800/60 text-transparent';
  return (
    <Modal onClose={onClose} wide>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">Type chart</h3>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="mb-2 text-xs text-slate-400">Pick a defender, either one or two types or a Pokémon, to see what hits it hard.</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)} className={`rounded ${!card && def.includes(t) ? 'ring-2 ring-amber-300' : 'opacity-75 hover:opacity-100'}`}>
            <TypeBadge type={t} small />
          </button>
        ))}
      </div>
      {cards.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => setCard(card?.id === c.id ? null : c)} title={c.name} className={`rounded-full ${card?.id === c.id ? 'ring-2 ring-amber-300' : 'opacity-70 hover:opacity-100'}`}>
              <Art id={c.id} className="h-7 w-7 rounded-full" alt={c.name} />
            </button>
          ))}
        </div>
      )}
      {pickedTypes.length > 0 && (
        <div className="mb-3 rounded-lg bg-slate-800/70 p-2.5 text-xs">
          <div className="mb-1.5 flex flex-wrap items-center gap-1 font-semibold">
            Damage taken by {card ? <span>{card.name}</span> : null} {pickedTypes.map((t) => <TypeBadge key={t} type={t} small />)}
          </div>
          {[4, 2, 0.5, 0.25, 0].map((m) => {
            const list = TYPES.filter((a) => (card ? hitMultiplier(a, card) : typeMultiplier(a, pickedTypes)) === m);
            if (!list.length) return null;
            return (
              <div key={m} className="mb-1 flex flex-wrap items-center gap-1">
                <span className="w-8 shrink-0"><MultChip mult={m} kind="take" /></span>
                {list.map((a) => <TypeBadge key={a} type={a} small />)}
              </div>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-px text-[9px]" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <th className="sticky left-0 bg-slate-900 p-0.5 text-left text-[9px] font-medium text-slate-500">Atk ↓ / Def →</th>
              {TYPES.map((d) => (
                <th key={d} title={d} className={`p-0 ${hover?.d === d || pickedTypes.includes(d) ? '' : 'opacity-70'}`}>
                  <span className="block rounded-sm px-px py-0.5 text-[8px] font-bold text-white" style={{ backgroundColor: TYPE_COLORS[d] }}>{d.slice(0, 3)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TYPES.map((a) => (
              <tr key={a}>
                <th className={`sticky left-0 bg-slate-900 pr-1 text-left ${hover?.a === a ? '' : 'opacity-80'}`}><TypeBadge type={a} small /></th>
                {TYPES.map((d) => {
                  const m = typeMultiplier(a, [d]);
                  const lit = hover && (hover.a === a || hover.d === d);
                  const col = pickedTypes.includes(d);
                  return (
                    <td
                      key={d}
                      onMouseEnter={() => setHover({ a, d })}
                      title={`${a} → ${d}: ${multLabel(m)}`}
                      className={`h-5 w-5 rounded-sm text-center font-bold ${cell(m)} ${lit || col ? 'outline outline-1 outline-amber-300/80' : ''}`}
                    >
                      {m === 1 ? '·' : m === 0.5 ? '½' : m === 0 ? '0' : m}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
