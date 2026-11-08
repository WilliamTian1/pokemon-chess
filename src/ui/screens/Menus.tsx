import { useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../../ai/bot';
import { CARD_LIST, type CardDef, type Side } from '../../engine';
import { Art, Modal } from '../components/bits';
import { CardDetail, MiniGrid } from '../components/CardView';
import { MapPicker, savedMapId } from '../components/MapPicker';
import { TypeChartModal } from '../components/Matchups';
import { CardGrid, useCardFilter } from './DraftView';

const SHOWCASE = ['charizard', 'blastoise', 'venusaur', 'pikachu', 'mewtwo', 'gengar', 'lapras', 'dragonite'];

export function Home({ onBot, onLocal, onOnline, onCards, onRules }: {
  onBot: () => void;
  onLocal: () => void;
  onOnline: () => void;
  onCards: () => void;
  onRules: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="text-center">
        <div className="mb-4 flex justify-center -space-x-3">
          {SHOWCASE.map((id, i) => (
            <Art key={id} id={id} className={`h-14 w-14 rounded-full ring-2 ${i % 2 ? 'ring-sky-500' : 'ring-rose-500'} shadow-lg sm:h-16 sm:w-16`} />
          ))}
        </div>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          Pokémon Conquest <span className="bg-gradient-to-r from-amber-300 to-rose-400 bg-clip-text text-transparent">Chess</span>
        </h1>
        <p className="mt-2 text-slate-400">v1.0 — draft four, outmanoeuvre, survive ten rounds.</p>
      </div>
      <div className="grid w-full gap-3 sm:grid-cols-3">
        <MenuButton title="Play vs Bot" sub="Easy · Medium · Hard" onClick={onBot} primary />
        <MenuButton title="Online match" sub="Private room with friends" onClick={onOnline} />
        <MenuButton title="Hot-seat" sub="Two players, one device" onClick={onLocal} />
      </div>
      <div className="flex gap-3">
        <button type="button" className="btn-ghost" onClick={onCards}>Card gallery</button>
        <button type="button" className="btn-ghost" onClick={onRules}>How to play</button>
      </div>
    </div>
  );
}

function MenuButton({ title, sub, onClick, primary }: { title: string; sub: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 ${primary ? 'border-amber-300/70 bg-amber-400/10 hover:bg-amber-400/20' : 'border-slate-700 bg-slate-900/80 hover:border-slate-500'}`}
    >
      <div className="text-lg font-bold">{title}</div>
      <div className="text-sm text-slate-400">{sub}</div>
    </button>
  );
}

export function LocalSetup({ onStart, onBack }: { onStart: (mapId: string) => void; onBack: () => void }) {
  const [mapId, setMapId] = useState(savedMapId);
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <button type="button" className="btn-ghost mb-4" onClick={onBack}>← Back</button>
      <div className="panel space-y-5 p-5">
        <h2 className="text-2xl font-bold">Hot-seat: choose a map</h2>
        <MapPicker value={mapId} onChange={setMapId} />
        <button type="button" className="btn-primary w-full py-3 text-base" onClick={() => onStart(mapId)}>Start draft</button>
      </div>
    </div>
  );
}

export function BotSetup({ onStart, onBack }: { onStart: (human: Side, level: Difficulty, mapId: string) => void; onBack: () => void }) {
  const [level, setLevel] = useState<Difficulty>('medium');
  const [mapId, setMapId] = useState(savedMapId);
  const [role, setRole] = useState<Side | 'R'>('A');
  const desc: Record<Difficulty, string> = {
    easy: 'Plays loosely and often picks something random. Good for learning the rules.',
    medium: 'Plans each Pokémon’s move greedily and avoids obvious danger.',
    hard: 'Drafts with a model learned from thousands of self-play games, plans whole turns and checks them against your best reply.',
  };
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <button type="button" className="btn-ghost mb-4" onClick={onBack}>← Back</button>
      <div className="panel space-y-5 p-5">
        <h2 className="text-2xl font-bold">Play vs Bot</h2>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-300">Difficulty</div>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => (
              <button key={d} type="button" onClick={() => setLevel(d)} className={`btn ${level === d ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700'} capitalize`}>
                {d}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">{desc[level]}</p>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-300">Your role</div>
          <div className="grid grid-cols-3 gap-2">
            {([['A', 'Attacker'], ['D', 'Defender'], ['R', 'Random']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setRole(v)} className={`btn ${role === v ? (v === 'A' ? 'bg-rose-500 text-white' : v === 'D' ? 'bg-sky-500 text-white' : 'bg-amber-400 text-slate-950') : 'bg-slate-800 hover:bg-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            The Attacker moves first and must faint all four Defenders within 10 rounds. The Defender wins by surviving.
          </p>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-300">Map</div>
          <MapPicker value={mapId} onChange={setMapId} />
        </div>
        <button
          type="button"
          className="btn-primary w-full py-3 text-base"
          onClick={() => onStart(role === 'R' ? (Math.random() < 0.5 ? 'A' : 'D') : role, level, mapId)}
        >
          Start draft
        </button>
      </div>
    </div>
  );
}

export function CardGallery({ onBack }: { onBack: () => void }) {
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [chart, setChart] = useState(false);
  const { cards, controls } = useCardFilter(CARD_LIST);
  return (
    <div className="mx-auto max-w-6xl space-y-3 px-3 py-4">
      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost" onClick={onBack}>← Back</button>
        <h2 className="flex-1 text-xl font-bold">Card gallery <span className="text-sm font-medium text-slate-400">({cards.length})</span></h2>
        <button type="button" className="btn-ghost" onClick={() => setChart(true)}>Type chart</button>
      </div>
      {controls}
      <CardGrid cards={cards} onOpen={setDetail} />
      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <CardDetail card={detail} />
          <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setDetail(null)}>Close</button>
        </Modal>
      )}
      {chart && <TypeChartModal onClose={() => setChart(false)} />}
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm ${color}`} />
      <span>{children}</span>
    </div>
  );
}

export function HowToPlay({ onBack }: { onBack: () => void }) {
  const example = CARD_LIST.find((c) => c.id === 'sudowoodo')!.moves[0];
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 text-sm leading-relaxed text-slate-300">
      <button type="button" className="btn-ghost" onClick={onBack}>← Back</button>
      <h2 className="text-2xl font-bold text-white">How to play</h2>
      <section className="panel space-y-2 p-4">
        <h3 className="font-bold text-white">Match flow</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>Draft:</b> each match deals 15 random Pokémon and 4 random legendaries. The Attacker and Defender alternate picking 3 Pokémon each, then each picks one legendary.</li>
          <li><b>Placement:</b> players alternate placing Pokémon on their spawn tiles (Attackers at the bottom, Defenders at the top).</li>
          <li><b>Battle:</b> up to 10 rounds. Each round the Attacker takes a full team turn, then the Defender. Round 1 is movement only: nobody can use a move or the trebuchet.</li>
        </ol>
        <p><b className="text-rose-300">Attacker</b> wins by fainting all 4 Defenders before round 10 ends. <b className="text-sky-300">Defender</b> wins by wiping the Attackers or simply surviving round 10.</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-bold text-white">Your turn</h3>
        <p>Activate each of your Pokémon once, in any order: <b>move</b> up to its Mov (orthogonal steps, through allies but not enemies), then take <b>one action</b> — use a move, fire the trebuchet, or wait. Then press <b>End turn</b>.</p>
        <p>Select a Pokémon, tap a blue tile to move, pick a move and aim it in one of four directions. Previews show the damage range and KO chance on every Pokémon hit — allies included!</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-bold text-white">Reading the move grids</h3>
        <div className="flex items-center gap-4">
          <MiniGrid move={example} size={16} />
          <div className="space-y-1">
            <Legend color="bg-lime-400">The user (aimed forward, rotated to any of 4 directions)</Legend>
            <Legend color="bg-orange-400">Tiles hit — every Pokémon on them</Legend>
            <Legend color="bg-sky-400">The user charges onto this tile first (must be free)</Legend>
            <Legend color="bg-red-500">Targets are knocked back onto these tiles</Legend>
          </div>
        </div>
        <p>A move can only be used if it hits at least one Pokémon, ally or opponent. Adjacent means all 8 surrounding tiles; “within N tiles” counts the same way.</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-bold text-white">The maps</h3>
        <p>Choose Trebuchet Meadow or Winding River before each match. On Winding River the brown bridges are ordinary ground.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Legend color="tile-water">Water: only Water, Flying and Levitate Pokémon can enter.</Legend>
          <Legend color="tile-dirt">Dirt paths are cosmetic — they play like grass.</Legend>
          <Legend color="bg-yellow-300">Flowers: +30 HP when a Pokémon ends its activation there.</Legend>
          <Legend color="bg-red-500">Berry bushes: Pokémon standing there take 30 less damage.</Legend>
          <Legend color="bg-stone-600">Trebuchet: stand on it to hit any Pokémon for a flat 40 before type effectiveness.</Legend>
        </div>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-bold text-white">Damage</h3>
        <p>Damage = move power ± 20 per Attack/Defense stage ± ability and terrain modifiers (minimum 10), × type effectiveness, rounded up to the nearest 5. Grazes replace the power with the graze value and ignore Attack boosts and Defense drops.</p>
        <p>Status: Poison/Burn 20 per turn (Burn also −30 damage), Toxic 20, 40, 60…, Paralysis −1 Mov and 20% to lose the turn, Sleep/Freeze wake on a 5–6 each turn. Flinched Pokémon lose their next activation; confused ones have a ⅓ chance to hurt themselves for 30 instead of acting.</p>
      </section>
    </div>
  );
}
