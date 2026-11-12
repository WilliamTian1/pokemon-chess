import { type ReactNode, useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../../ai/levels';
import { CARD_LIST, type CardDef, type Side, TRAINER_LIST } from '../../engine';
import { Art, Modal } from '../components/bits';
import { CardDetail, MiniGrid } from '../components/CardView';
import { BannerIcon, DiceIcon, GreatBallIcon, PokeBallIcon, ShieldIcon, SpearIcon, SwordsIcon, UltraBallIcon } from '../components/icons';
import {
  LegendaryToggle, MapPicker, OptionTiles, SetupHeading, StyleToggle, TrainerToggle, savedLegendaries, savedMapId, savedStyle, savedTrainers,
} from '../components/MapPicker';
import type { MatchOptions } from '../controller';
import { AccountChip } from '../components/Account';
import { TypeChartModal } from '../components/Matchups';
import { CardGrid, useCardFilter } from './DraftView';

const SHOWCASE = ['charizard', 'blastoise', 'venusaur', 'pikachu', 'mewtwo', 'gengar', 'lapras', 'dragonite'];

export function Home({ onBot, onLocal, onOnline, onCards, onLab, onRules, onProfile }: {
  onBot: () => void;
  onLocal: () => void;
  onOnline: () => void;
  onCards: () => void;
  /** Only for the owner (see useLabAccess in App.tsx). */
  onLab?: () => void;
  onRules: () => void;
  onProfile: (username: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-7 px-4 py-10">
      <AccountChip onProfile={onProfile} className="fixed right-3 top-3 z-40" />
      <div className="flex w-full flex-col items-center text-center">
        <div className="mb-4 flex justify-center -space-x-2">
          {SHOWCASE.map((id, i) => (
            <Art
              key={id}
              id={id}
              className={`h-10 w-10 rounded-full border-[3px] border-gold shadow-[0_4px_10px_rgba(0,0,0,.55)] sm:h-16 sm:w-16 ${i % 2 ? 'ring-2 ring-sky-700' : 'ring-2 ring-red-800'}`}
            />
          ))}
        </div>
        <div className="title-plaque">
          <PokeBallIcon className="absolute -left-5 -top-5 h-12 w-12 -rotate-12 drop-shadow-[0_3px_4px_rgba(0,0,0,.5)]" />
          <h1 className="title-brush text-[2.1rem] leading-[1.05] sm:text-6xl">Pokémon Conquest</h1>
          <div className="title-brush title-gold mt-1 text-3xl sm:text-5xl">Chess</div>
        </div>
        <p className="mt-4 text-sm text-slate-300">v1.5.1</p>
      </div>
      <div className="scroll w-full max-w-3xl">
        <div className="grid gap-3 sm:grid-cols-3">
          <MenuButton title="Play vs Bot" sub="Easy · Medium · Hard" icon={<PokeBallIcon className="h-9 w-9" />} onClick={onBot} primary />
          <MenuButton title="Play online" sub="Ranked ladder · private rooms" icon={<BannerIcon className="h-9 w-9" />} onClick={onOnline} />
          <MenuButton title="Hot-seat" sub="Two players, one device" icon={<SwordsIcon className="h-9 w-9" />} onClick={onLocal} />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-ghost" onClick={onCards}>Card gallery</button>
          {onLab && <button type="button" className="btn-ghost" onClick={onLab}>Draft analysis</button>}
          <button type="button" className="btn-ghost" onClick={onRules}>How to play</button>
        </div>
      </div>
    </div>
  );
}

function MenuButton({ title, sub, icon, onClick, primary }: { title: string; sub: string; icon: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`menu-btn ${primary ? 'menu-btn-primary' : ''}`}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 text-left">
        <span className="block font-display text-lg leading-tight">{title}</span>
        <span className="block text-xs font-bold opacity-80">{sub}</span>
      </span>
    </button>
  );
}

export function LocalSetup({ onStart, onBack }: { onStart: (opts: MatchOptions) => void; onBack: () => void }) {
  const [mapId, setMapId] = useState(savedMapId);
  const [legendaries, setLegendaries] = useState(savedLegendaries);
  const [trainers, setTrainers] = useState(savedTrainers);
  const [style, setStyle] = useState(savedStyle);
  return (
    <SetupFrame title="Hot-seat" sub="Two players, one device" onBack={onBack}
      left={(
        <>
          <section><SetupHeading n={1}>Draft style</SetupHeading><StyleToggle value={style} onChange={setStyle} /></section>
          <section><SetupHeading n={2}>Legendaries</SetupHeading><LegendaryToggle value={legendaries} onChange={setLegendaries} /></section>
          <section><SetupHeading n={3}>Trainers</SetupHeading><TrainerToggle value={trainers} onChange={setTrainers} /></section>
        </>
      )}
      map={<MapPicker value={mapId} onChange={setMapId} />}
      mapStep={4}
      onStart={() => onStart({ mapId, legendaries, trainers, style })}
    />
  );
}

/** A setup screen: a parchment banner title, options on the left, the map and the start button on the right. */
function SetupFrame({ title, sub, onBack, left, map, mapStep, onStart }: {
  title: string; sub: string; onBack: () => void; left: ReactNode; map: ReactNode; mapStep: number; onStart: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" className="btn-ghost" onClick={onBack}>← Back</button>
        <div>
          <h2 className="title-banner text-3xl leading-tight">{title}</h2>
          <div className="text-sm font-bold text-slate-300">{sub}</div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="panel space-y-5 p-5">{left}</div>
        <div className="panel flex flex-col gap-4 p-5">
          <section><SetupHeading n={mapStep}>Battlefield</SetupHeading>{map}</section>
          <button type="button" className="btn-primary mt-auto w-full gap-3 py-3.5 font-display text-xl" onClick={onStart}>
            <PokeBallIcon className="h-8 w-8" /> Start the draft
          </button>
        </div>
      </div>
    </div>
  );
}

export function BotSetup({ onStart, onBack }: { onStart: (human: Side, level: Difficulty, opts: MatchOptions) => void; onBack: () => void }) {
  const [level, setLevel] = useState<Difficulty>('medium');
  const [mapId, setMapId] = useState(savedMapId);
  const [legendaries, setLegendaries] = useState(savedLegendaries);
  const [trainers, setTrainers] = useState(savedTrainers);
  const [style, setStyle] = useState(savedStyle);
  const [role, setRole] = useState<Side | 'R'>('A');
  const desc: Record<Difficulty, string> = {
    easy: 'Plays loosely and often picks something random. Good for learning the rules.',
    medium: 'Plans each Pokémon’s move greedily and avoids obvious danger.',
    hard: 'Drafts with a model learned from thousands of self-play games, plans whole turns and checks them against your best reply.',
  };
  return (
    <SetupFrame title="Play vs Bot" sub="Draft against the computer" onBack={onBack}
      left={(
        <>
          <section>
            <SetupHeading n={1}>Difficulty</SetupHeading>
            <OptionTiles
              value={level}
              onChange={setLevel}
              options={DIFFICULTIES.map((d) => ({
                value: d,
                title: d[0].toUpperCase() + d.slice(1),
                emblem: d === 'easy' ? <PokeBallIcon className="h-full w-full" /> : d === 'medium' ? <GreatBallIcon className="h-full w-full" /> : <UltraBallIcon className="h-full w-full" />,
              }))}
            />
            <p className="mt-2 text-xs font-bold text-slate-400">{desc[level]}</p>
          </section>
          <section>
            <SetupHeading n={2}>Your side</SetupHeading>
            <OptionTiles
              value={role}
              onChange={setRole}
              options={[
                { value: 'A' as const, title: 'Attacker', sub: 'Moves first', emblem: <SpearIcon className="h-full w-full" /> },
                { value: 'D' as const, title: 'Defender', sub: 'Holds out', emblem: <ShieldIcon className="h-full w-full" /> },
                { value: 'R' as const, title: 'Random', sub: 'Toss a die', emblem: <DiceIcon className="h-full w-full" /> },
              ]}
            />
            <p className="mt-2 text-xs font-bold text-slate-400">
              The Attacker must faint all four Defenders within 10 rounds. The Defender wins by surviving.
            </p>
          </section>
          <section><SetupHeading n={3}>Draft style</SetupHeading><StyleToggle value={style} onChange={setStyle} /></section>
          <section><SetupHeading n={4}>Legendaries</SetupHeading><LegendaryToggle value={legendaries} onChange={setLegendaries} /></section>
          <section><SetupHeading n={5}>Trainers</SetupHeading><TrainerToggle value={trainers} onChange={setTrainers} /></section>
        </>
      )}
      map={<MapPicker value={mapId} onChange={setMapId} />}
      mapStep={6}
      onStart={() => onStart(role === 'R' ? (Math.random() < 0.5 ? 'A' : 'D') : role, level, { mapId, legendaries, trainers, style })}
    />
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
      <h3 className="pt-3 text-lg font-bold">Trainers <span className="text-sm font-medium text-slate-400">(trainer mode)</span></h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3">
        {TRAINER_LIST.map((t) => (
          <div key={t.id} className="space-y-1.5">
            <img src={`${import.meta.env.BASE_URL}trainers/${t.id}.jpg`} alt={`${t.name} card`} loading="lazy" className="w-full rounded-lg shadow-md shadow-black/40" />
            <p className="text-xs text-slate-300"><b>Passive:</b> {t.passive}</p>
            <p className="text-xs text-slate-300"><b>Special (once per game):</b> {t.special}</p>
          </div>
        ))}
      </div>
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
      <h2 className="title-banner text-3xl">How to play</h2>
      <section className="panel space-y-2 p-4">
        <h3 className="font-display text-lg text-lacquer">Match flow</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>Draft:</b> each match deals 15 random Pokémon and 4 random legendaries. The Attacker and Defender alternate picking 3 Pokémon each, then each picks one legendary. With <b>No legendaries</b> chosen at setup, the pool is 20 Pokémon and both players pick all 4 from it.</li>
          <li><b>Trainers</b> (if <b>With trainers</b> was chosen at setup): after the draft, 4 random trainers are shown. The Attacker takes one, then the Defender picks from the other three. A trainer's passive always applies to its own side, and its <b>Special Move</b> can be used once per game at any point of your own turn (between Pokémon) without using up an action.</li>
          <li><b>Placement:</b> the Attacker places first, then players alternate placing Pokémon on their spawn tiles. Like a chessboard, the board is turned so your own side is at the bottom.</li>
          <li><b>Battle:</b> up to 10 rounds. Each round the Attacker takes a full team turn, then the Defender. Both sides can move and attack from round 1.</li>
        </ol>
        <p><b className="text-rose-300">Attacker</b> wins by fainting all 4 Defenders before round 10 ends. <b className="text-sky-300">Defender</b> wins by wiping the Attackers or simply surviving round 10.</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-display text-lg text-lacquer">Your turn</h3>
        <p>Activate each of your Pokémon once, in any order: <b>move</b> up to its Mov (orthogonal steps, through allies but not enemies), then take <b>one action</b> — use a move, fire the trebuchet, or wait. Then press <b>End turn</b>.</p>
        <p>Select a Pokémon, tap a blue tile to move, pick a move and aim it in one of four directions (or just click the Pokémon you want to hit). Previews show the damage range and KO chance on every Pokémon hit — allies included!</p>
        <p><b>Reach:</b> click an opposing Pokémon to see every tile it can attack on its next turn, after moving. Its first move's range is filled red, its second move's is outlined in yellow. Click it again or press Esc to hide it.</p>
        <p><b>Tags:</b> like tokens on a real table, stat changes and conditions are tags dropped onto the Pokémon's card: sword = Attack, shield = Defense, boot = Movement (one tag per stage, + or −), fire = burn, bubbles = poison (purple: badly poisoned), lightning = paralysis, Zzz = sleep, snowflake = frozen, sweat drop = flinched or recharging, and “!” for other effects (confusion, Taunt, Follow Me, cooldowns). A red number on a tag is how many of the Pokémon's turns the effect still lasts. Hover a tag for details.</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-display text-lg text-lacquer">Reading the move grids</h3>
        <div className="flex items-center gap-4">
          <MiniGrid move={example} size={16} />
          <div className="space-y-1">
            <Legend color="bg-lime-400">The user (aimed forward, rotated to any of 4 directions)</Legend>
            <Legend color="bg-orange-400">Tiles hit — every Pokémon on them</Legend>
            <Legend color="bg-sky-400">The user charges onto this tile first (must be free)</Legend>
            <Legend color="bg-red-500">Targets are knocked back onto these tiles</Legend>
          </div>
        </div>
        <p>A move can only be used if it hits at least one Pokémon, ally or opponent. Adjacent means all 8 surrounding tiles, diagonals included. “Within N tiles” counts steps like movement, so a diagonal tile is 2 away.</p>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-display text-lg text-lacquer">The maps</h3>
        <p>Choose Trebuchet Meadow or Winding River before each match. On Winding River the brown bridges are ordinary ground.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Legend color="tile-water">Water: only Water, Flying and Levitate Pokémon can enter.</Legend>
          <Legend color="tile-dirt">Dirt paths are cosmetic — they play like grass.</Legend>
          <Legend color="bg-yellow-300">Flowers: +30 HP when a Pokémon ends its activation there (Flying and Levitate Pokémon hover over them: no bonus).</Legend>
          <Legend color="bg-red-500">Berry bushes: Pokémon standing there take 30 less damage (not Flying or Levitate Pokémon).</Legend>
          <Legend color="bg-stone-600">Trebuchet: stand on it to hit any Pokémon for a flat 40, fired as whichever of the user's types does the most damage to it.</Legend>
        </div>
      </section>
      <section className="panel space-y-2 p-4">
        <h3 className="font-display text-lg text-lacquer">Damage</h3>
        <p>Damage = move power ± 20 per Attack/Defense stage ± ability and terrain modifiers (minimum 10), × type effectiveness, rounded up to the nearest 5. Grazes replace the power with the graze value and ignore Attack boosts and Defense drops.</p>
        <p>Status: Poison/Burn 20 per turn (Burn also −30 damage), Toxic 20, 40, 60…, Paralysis −1 Mov and 20% to lose the turn, Sleep/Freeze wake on a 5–6 each turn. Flinched Pokémon lose their next activation; confused ones have a ⅓ chance to hurt themselves for 30 instead of acting.</p>
      </section>
    </div>
  );
}
