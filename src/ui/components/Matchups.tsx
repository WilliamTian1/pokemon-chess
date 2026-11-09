import { useState } from 'react';
import {
  type CardDef, type GameState, type PType, type Side, TYPES, TYPE_COLORS, attackTypes, bestHit, cardOf, defenseProfile, hitMultiplier,
  multLabel, typeMultiplier,
} from '../../engine';
import { Art, Modal, TypeBadge } from './bits';

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
  const [hover, setHover] = useState<{ r: string; c: string } | null>(null);
  if (!mine.length || !theirs.length) return <div className="text-sm text-slate-500">Nothing to compare.</div>;
  const medal = (u: (typeof mine)[number], size: string) => (
    <Art id={u.cardId} className={`${size} rounded-full border-[3px] border-gold shadow ring-2 ${u.side === 'A' ? 'ring-red-800' : 'ring-blue-900'}`} alt={cardOf(u).name} />
  );
  return (
    <div onMouseLeave={() => { setHover(null); onHover?.(null); }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-slate-300">
        <span className="flex items-center gap-1.5"><span className="mu-tag">deals</span> the row Pokémon's best attack on the column Pokémon</span>
        <span className="flex items-center gap-1.5"><span className="mu-tag">takes</span> the column Pokémon's best attack on it</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-[28%] text-left align-bottom">
                <span className={`sash ${rows === 'A' ? 'sash-a' : 'sash-d'}`}>{rows === 'A' ? 'Attacker' : 'Defender'}</span>
                <span className="mx-1.5 text-xs font-extrabold text-slate-400">vs</span>
                <span className={`sash ${rows === 'A' ? 'sash-d' : 'sash-a'}`}>{rows === 'A' ? 'Defender' : 'Attacker'}</span>
              </th>
              {theirs.map((t) => (
                <th key={t.id} className={`px-1 pb-1 transition ${hover && hover.c !== t.id ? 'opacity-50' : ''}`} title={cardOf(t).name}>
                  <div className="flex flex-col items-center gap-1">
                    {medal(t, 'h-12 w-12')}
                    <span className="max-w-[6rem] truncate text-xs font-extrabold text-slate-200">{cardOf(t).name}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.map((m) => (
              <tr key={m.id}>
                <th className={`text-left transition ${hover && hover.r !== m.id ? 'opacity-50' : ''}`} title={cardOf(m).name}>
                  <div className="flex items-center gap-2">
                    {medal(m, 'h-11 w-11 shrink-0')}
                    <span className="truncate text-sm font-extrabold text-slate-200">{cardOf(m).name}</span>
                  </div>
                </th>
                {theirs.map((t) => {
                  const hit = bestHit(cardOf(m), cardOf(t));
                  const take = bestHit(cardOf(t), cardOf(m));
                  const lit = hover?.r === m.id && hover?.c === t.id;
                  return (
                    <td
                      key={t.id}
                      className={`mu-cell ${lit ? 'mu-cell-lit' : ''}`}
                      title={matchupTitle(cardOf(m), cardOf(t))}
                      onMouseEnter={() => { setHover({ r: m.id, c: t.id }); onHover?.([m.id, t.id]); }}
                    >
                      <div className="flex items-center justify-between gap-1"><span className="mu-label">deals</span>{hit ? <MultChip mult={hit.mult} kind="hit" /> : <span className="text-slate-500">—</span>}</div>
                      <div className="flex items-center justify-between gap-1"><span className="mu-label">takes</span>{take ? <MultChip mult={take.mult} kind="take" /> : <span className="text-slate-500">—</span>}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-400">
        Green is good for the row Pokémon, red is bad. Abilities like Levitate and Thick Fat are included.
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
  const cell = (m: number) => (m === 0 ? 'tc-0' : m >= 2 ? 'tc-2' : m < 1 ? 'tc-half' : 'tc-1');
  return (
    <Modal onClose={onClose} xwide>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-2xl text-lacquer">Type chart</h3>
          <p className="text-xs font-bold text-slate-400">Read across from the attacking type, down from the defending type.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 overflow-x-auto">
          <table className="tc-ledger" onMouseLeave={() => setHover(null)}>
            <thead>
              <tr>
                <th className="tc-corner">
                  <span>Defending →</span>
                  <span>Attacking ↓</span>
                </th>
                {TYPES.map((d) => (
                  <th key={d} title={d} className={`tc-colhead ${hover?.d === d ? 'tc-hl' : ''} ${pickedTypes.includes(d) ? 'tc-picked' : ''}`}>
                    <span className="tc-vname">{d}</span>
                    <i className="tc-dot" style={{ backgroundColor: TYPE_COLORS[d] }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TYPES.map((a) => (
                <tr key={a} className={hover?.a === a ? 'tc-row-hl' : ''}>
                  <th className="tc-rowhead">
                    <i className="tc-dot" style={{ backgroundColor: TYPE_COLORS[a] }} />
                    {a}
                  </th>
                  {TYPES.map((d) => {
                    const m = typeMultiplier(a, [d]);
                    return (
                      <td
                        key={d}
                        onMouseEnter={() => setHover({ a, d })}
                        title={`${a} → ${d}: ${multLabel(m)}`}
                        className={`tc-td ${hover?.d === d ? 'tc-col-hl' : ''} ${pickedTypes.includes(d) ? 'tc-col-picked' : ''} ${hover?.a === a && hover?.d === d ? 'tc-focus' : ''}`}
                      >
                        {m !== 1 && <span className={`tc-seal ${cell(m)}`}>{m === 0.5 ? '½' : m}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-bold text-slate-300">
            <span className="flex items-center gap-1.5"><span className="tc-seal tc-2">2</span> super effective</span>
            <span className="flex items-center gap-1.5"><span className="tc-seal tc-half">½</span> not very effective</span>
            <span className="flex items-center gap-1.5"><span className="tc-seal tc-0">0</span> no effect</span>
          </div>
        </div>
        <div className="paper-inset min-w-[260px] flex-1 space-y-3 p-3">
          <div className="font-display text-lg text-slate-100">Who hits it hard?</div>
          <p className="text-xs font-bold text-slate-400">Pick a defender: one or two types{cards.length ? ', or a Pokémon' : ''}.</p>
          <div className="flex flex-wrap gap-1">
            {TYPES.map((t) => (
              <button key={t} type="button" onClick={() => toggle(t)} className={`rounded-full transition ${!card && def.includes(t) ? 'scale-110 ring-2 ring-lacquer ring-offset-1 ring-offset-paper' : 'opacity-80 hover:opacity-100'}`}>
                <TypeBadge type={t} small />
              </button>
            ))}
          </div>
          {cards.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cards.map((c) => (
                <button key={c.id} type="button" onClick={() => setCard(card?.id === c.id ? null : c)} title={c.name}
                  className={`rounded-full transition ${card?.id === c.id ? 'scale-110' : 'opacity-75 hover:opacity-100'}`}>
                  <Art id={c.id} className={`h-9 w-9 rounded-full border-[3px] ${card?.id === c.id ? 'border-lacquer' : 'border-gold'}`} alt={c.name} />
                </button>
              ))}
            </div>
          )}
          {pickedTypes.length > 0 ? (
            <div className="space-y-1.5 border-t-2 border-dashed border-slate-700 pt-2 text-xs">
              <div className="flex flex-wrap items-center gap-1 font-extrabold text-slate-200">
                Damage taken by {card ? <span>{card.name}</span> : null} {pickedTypes.map((t) => <TypeBadge key={t} type={t} small />)}
              </div>
              {[4, 2, 0.5, 0.25, 0].map((m) => {
                const list = TYPES.filter((a) => (card ? hitMultiplier(a, card) : typeMultiplier(a, pickedTypes)) === m);
                if (!list.length) return null;
                return (
                  <div key={m} className="flex flex-wrap items-center gap-1">
                    <span className="w-9 shrink-0"><MultChip mult={m} kind="take" /></span>
                    {list.map((a) => <TypeBadge key={a} type={a} small />)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border-2 border-dashed border-slate-700 p-3 text-center text-xs font-bold text-slate-500">Nothing picked yet.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
